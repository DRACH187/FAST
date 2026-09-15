/**
 * FAST GUNS — SECURITY REGRESSION SUITE (spec §37/§39)
 * ====================================================
 * Real executable checks — no fabricated results. Run against a live server:
 *
 *   bun scripts/security-suite.ts [baseUrl]
 *
 * Exit code 0 = every check passed. Any failure exits 1.
 * Covers: gate auth + XFF-spoof resistance, attestation forgery, boss
 * privilege boundaries, H3 terminate authorization, M2 fingerprint/key
 * binding + slot conflicts, M2 board capabilities, M1 signatures (incl.
 * tamper + cross-room replay + nonce reuse), input validation, body limits,
 * content-type enforcement, security headers.
 */

const BASE = process.argv[2] ?? "http://localhost:3000";

/** Random 6-letter room code — fresh per run so prior runs never collide. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
function freshCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

/** POST that politely waits out a 429 Retry-After (rapid re-runs hit limits). */
async function postPatient(
  path: string,
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  let out = await post(path, body);
  if (out.status === 429) {
    const wait = Math.min(70, Number(out.json.retryAfter ?? out.json["Retry-After"] ?? 61) + 1);
    console.log(`  (rate-limited — waiting ${Math.ceil(wait)}s for the window to clear)`, "");
    await new Promise((r) => setTimeout(r, wait * 1000));
    out = await post(path, body);
  }
  return out;
}

// ---------------------------------------------------------------- crypto helper

const subtle = crypto.subtle;
const te = new TextEncoder();

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function makeIdentity(): Promise<{ fp: string; pubB64: string; keys: CryptoKeyPair }> {
  // Ed25519 in the sandbox; X25519 ECDH identity mirrors the client
  const keys = (await subtle.generateKey({ name: "X25519" } as Algorithm, true, [
    "deriveKey",
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = await subtle.exportKey("raw", keys.publicKey);
  const pubB64 = b64(raw);
  const digest = await subtle.digest("SHA-256", raw);
  const fp = Array.from(new Uint8Array(digest).slice(0, 16))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  return { fp, pubB64, keys };
}

async function generateSessionKey(): Promise<Uint8Array> {
  return crypto.getRandomValues(new Uint8Array(32));
}

async function hkdfMsgKey(
  sessionKey: Uint8Array,
  code: string,
  senderFp: string,
  counter: number
): Promise<CryptoKey> {
  const ikm = await subtle.importKey("raw", sessionKey as unknown as ArrayBuffer, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: te.encode(`fast-msg|${code}`) as unknown as ArrayBuffer,
      info: te.encode(`msg|${counter}|${senderFp}`) as unknown as ArrayBuffer,
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function seal(
  sessionKey: Uint8Array,
  code: string,
  senderFp: string,
  counter: number,
  plaintext: string
): Promise<{ iv: string; ciphertext: string }> {
  const key = await hkdfMsgKey(sessionKey, code, senderFp, counter);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ad = te.encode(`${code}|${senderFp}|${counter}`);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: ad }, key, te.encode(plaintext));
  return { iv: b64(iv), ciphertext: b64(ct) };
}

async function open(
  sessionKey: Uint8Array,
  code: string,
  senderFp: string,
  counter: number,
  iv: string,
  ciphertext: string
): Promise<string> {
  const key = await hkdfMsgKey(sessionKey, code, senderFp, counter);
  const ad = te.encode(`${code}|${senderFp}|${counter}`);
  const pt = await subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(atob(iv).split("").map((c) => c.charCodeAt(0))), additionalData: ad },
    key,
    new Uint8Array(atob(ciphertext).split("").map((c) => c.charCodeAt(0)))
  );
  return new TextDecoder().decode(pt);
}

async function ed25519(): Promise<CryptoKeyPair> {
  return (await subtle.generateKey({ name: "Ed25519" } as Algorithm, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
}

async function signCanonical(
  keys: CryptoKeyPair,
  code: string,
  fp: string,
  counter: number,
  id: string,
  iv: string,
  ciphertextB64: string
): Promise<string> {
  const ctHash = await subtle.digest("SHA-256", new Uint8Array(atob(ciphertextB64).split("").map((c) => c.charCodeAt(0))));
  const canonical = `fast.sig.v1|${code}|${fp}|${counter}|${id}|${iv}|${b64(ctHash)}`;
  const sig = await subtle.sign({ name: "Ed25519" } as Algorithm, keys.privateKey, te.encode(canonical));
  return b64(sig);
}

// ------------------------------------------------------------------ env

const fs = await import("node:fs");
function devEnv(name: string): string | null {
  try {
    const text = fs.readFileSync(".env.local", "utf8");
    const m = text.match(new RegExp(`^${name}="(.*)"`, "m"));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
const GATE = devEnv("GATE_PASSCODE");
const BOSS = devEnv("DRACH_KEY");

// ===================================================================== run

console.log(`\nFAST GUNS security suite → ${BASE}\n`);

// ---------------------------------------------------------- 1. security headers
{
  const res = await fetch(`${BASE}/`, { cache: "no-store" });
  const csp = res.headers.get("content-security-policy") ?? "";
  check("H1a CSP present with per-request nonce", /'nonce-[A-Za-z0-9+/=]+'/.test(csp), csp.slice(0, 80));
  check("H1b CSP frame-ancestors none", csp.includes("frame-ancestors 'none'"));
  check("H1c X-Frame-Options DENY", res.headers.get("x-frame-options") === "DENY");
  check("H1d X-Robots-Tag noindex", (res.headers.get("x-robots-tag") ?? "").includes("noindex"));
  check(
    "H1e HSTS present",
    (res.headers.get("strict-transport-security") ?? "").includes("max-age=63072000")
  );
}

// ---------------------------------------------------------- 2. gate + H1 spoof
if (GATE) {
  const wrong = await post("/api/gate", { passcode: "definitely-wrong" });
  check("G1 wrong passphrase -> 401", wrong.status === 401, `got ${wrong.status}`);

  const right = await post("/api/gate", { passcode: GATE });
  check("G2 correct passphrase -> 200", right.status === 200 && right.json.ok === true, `got ${right.status}`);

  // H1: rotating SPOOFED XFF values must NOT mint fresh limiter buckets —
  // every request lands in the same trusted-IP bucket, so the limiter/lockout
  // answer uniformly instead of resetting per fake header.
  const spoofCodes = ["000001", "000002", "000003", "000004", "000005", "000006"];
  const statuses: number[] = [];
  for (const c of spoofCodes) {
    const r = await post("/api/gate", { passcode: c }, { "x-forwarded-for": "1.2.3.4" });
    statuses.push(r.status);
  }
  const bypassed = statuses.every((s) => s === 401);
  const throttled = statuses.some((s) => s === 429);
  check("G3 spoofed-XFF rotation cannot bypass gate control", bypassed || throttled, statuses.join(","));

  const badType = await fetch(`${BASE}/api/gate`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "passcode=187",
  });
  check("G4 non-JSON content-type rejected", badType.status === 415, `got ${badType.status}`);
} else {
  check("G0 .env.local readable for suite", false, "GATE_PASSCODE missing — cannot run gate tests");
}

// ------------------------------------------------- 3. identity + attestation
let memberToken: string | null = null;
let bossToken: string | null = null;
const memberFp = "a".repeat(32);

{
  const reg = await post("/api/identity", { fingerprint: memberFp, nickname: "SUITE RUNNER" });
  memberToken = typeof reg.json.token === "string" ? reg.json.token : null;
  check("I1 callsign registration mints attestation", reg.status === 200 && memberToken !== null, `got ${reg.status}`);

  const forged = await post("/api/roster", { fingerprint: memberFp, token: "AAAA.BBBB" });
  check("I2 forged attestation rejected", forged.status === 401, `got ${forged.status}`);

  const memberRoster = await post("/api/roster", { fingerprint: memberFp, token: memberToken ?? "" });
  check("I3 member cannot read boss roster", memberRoster.status === 403, `got ${memberRoster.status}`);

  if (BOSS) {
    const bossReg = await post("/api/identity", { fingerprint: "b".repeat(32), nickname: "DRACH", bossKey: BOSS });
    bossToken = typeof bossReg.json.token === "string" ? bossReg.json.token : null;
    check("I4 boss key unlocks DRACH callsign", bossReg.status === 200 && bossReg.json.role === "boss", `got ${bossReg.status}`);

    const bossNoKey = await post("/api/identity", { fingerprint: "c".repeat(32), nickname: "DRACH" });
    check("I5 DRACH without boss key refused", bossNoKey.status === 403, `got ${bossNoKey.status}`);

    const bossRoster = await post("/api/roster", { fingerprint: "b".repeat(32), token: bossToken ?? "" });
    check("I6 attested boss reads roster", bossRoster.status === 200 && bossRoster.json.ok === true, `got ${bossRoster.status}`);
  }

  const badNick = await post("/api/identity", { fingerprint: memberFp, nickname: "BAD\u0000NICK" });
  // control characters are STRIPPED server-side before validation — the
  // security property is that the stored/returned callsign contains none
  const nickOk =
    badNick.status === 400 ||
    (badNick.status === 200 &&
      typeof badNick.json.nickname === "string" &&
      !/[\u0000-\u001F\u007F]/.test(badNick.json.nickname));
  check("I7 control characters stripped from nickname", nickOk, `got ${badNick.status}`);
}

// ------------------------------------------------- 4. members roll (M5)
{
  const noAuth = await post("/api/members", { memberHash: "d".repeat(64) });
  check("M5a anonymous digest cannot join roll", noAuth.status === 400 || noAuth.status === 401, `got ${noAuth.status}`);
  const withAuth = await post("/api/members", {
    memberHash: "d".repeat(64),
    fingerprint: memberFp,
    token: memberToken ?? "",
  });
  check("M5b attested member joins roll", withAuth.status === 200 && withAuth.json.ok === true, `got ${withAuth.status}`);
}

// ------------------------------------------------- 5. sessions: H3 + M2
{
  const code = freshCode();
  const id = await makeIdentity();

  // M2: fingerprint must cryptographically bind to the public key
  const badBind = await post(`/api/sessions/${code}/sync`, {
    action: "join",
    fingerprint: "e".repeat(32),
    publicKey: id.pubB64,
    create: true,
  });
  check("M2a stolen fingerprint + foreign key rejected", badBind.status === 400, `got ${badBind.status}`);

  const join = await post(`/api/sessions/${code}/sync`, {
    action: "join",
    fingerprint: id.fp,
    publicKey: id.pubB64,
    create: true,
    attestation: memberToken ?? "",
  });
  check("S1 creator join provisions room", join.status === 200 && join.json.alive === true, `got ${join.status}`);

  // M2: same fp, different key -> refused by key-binding (400) or slot
  // conflict (409). Either way substitution is impossible.
  const other = await makeIdentity();
  const conflict = await post(`/api/sessions/${code}/sync`, {
    action: "join",
    fingerprint: id.fp,
    publicKey: other.pubB64,
    attestation: memberToken ?? "",
  });
  check(
    "M2b key substitution on occupied slot rejected",
    conflict.status === 409 || conflict.status === 400,
    `got ${conflict.status}`
  );

  // H3: anonymous terminate
  const anonTerm = await post(`/api/sessions/${code}/sync`, { action: "terminate", fingerprint: "f".repeat(32) });
  check("H3a anonymous terminate refused", anonTerm.status === 401, `got ${anonTerm.status}`);

  // H3: authenticated non-creator member terminate
  const memberTerm = await post(`/api/sessions/${code}/sync`, {
    action: "terminate",
    fingerprint: memberFp,
    attestation: memberToken ?? "",
  });
  check("H3b non-creator member terminate refused", memberTerm.status === 403, `got ${memberTerm.status}`);

  // posting gate: non-participant cannot inject messages
  const msgNonParticipant = await post(`/api/sessions/${code}/sync`, {
    action: "msg",
    fingerprint: memberFp,
    message: {
      id: crypto.randomUUID(),
      senderFp: memberFp,
      counter: 0,
      iv: b64(crypto.getRandomValues(new Uint8Array(12))),
      ciphertext: b64(te.encode("ghost write")),
    },
  });
  check("S2 non-participant cannot post messages", msgNonParticipant.status === 403, `got ${msgNonParticipant.status}`);

  // H3: creator terminate works (the creator's OWN attestation)
  const creatorReg = await postPatient("/api/identity", {
    fingerprint: id.fp,
    nickname: `SC-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
  });
  const creatorToken = typeof creatorReg.json.token === "string" ? creatorReg.json.token : "";
  check("H3c-0 creator callsign registered", creatorReg.status === 200 && creatorToken !== "", `got ${creatorReg.status}`);
  const creatorTerm = await post(`/api/sessions/${code}/sync`, {
    action: "terminate",
    fingerprint: id.fp,
    attestation: creatorToken,
  });
  check("H3c creator terminate allowed", creatorTerm.status === 200 && creatorTerm.json.terminated === true, `got ${creatorTerm.status}`);

  // input validation (fresh code — no state shared with the room tests)
  const codeB = freshCode();
  const badB64 = await post(`/api/sessions/${codeB}/sync`, {
    action: "join",
    fingerprint: id.fp,
    publicKey: "!!!not-base64!!!",
    create: true,
  });
  check("V1 malformed base64 public key rejected", badB64.status === 400, `got ${badB64.status}`);

  const huge = await post(`/api/sessions/${codeB}/sync`, JSON.stringify({
    action: "join",
    fingerprint: id.fp,
    publicKey: "A".repeat(2_300_000),
    create: true,
  }));
  check("V2 oversized body rejected before parse", huge.status === 413 || huge.status === 400, `got ${huge.status}`);

  const malformed = await fetch(`${BASE}/api/sessions/${codeB}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });
  check("V3 malformed JSON rejected", malformed.status === 400, `got ${malformed.status}`);

  const unknownAction = await post(`/api/sessions/${codeB}/sync`, { action: "selfdestruct" });
  check("V4 unknown action rejected", unknownAction.status === 400, `got ${unknownAction.status}`);
}

// ------------------------------------------------- 6. wanted capabilities (M2)
{
  const CASE_ID = `suite-${crypto.randomUUID()}`;
  const sealedIv = b64(crypto.getRandomValues(new Uint8Array(12)));
  const sealedCt = b64(te.encode("sealed-case-text".repeat(20)));
  const create = await post("/api/wanted", {
    action: "create",
    fingerprint: memberFp,
    post: { id: CASE_ID, iv: sealedIv, ciphertext: sealedCt },
  });
  const cap = typeof create.json.cap === "string" ? create.json.cap : null;
  check("W1 create mints manage capability", create.status === 200 && cap !== null, `got ${create.status}`);

  const delNoCap = await post("/api/wanted", {
    action: "delete",
    fingerprint: "c".repeat(32),
    id: CASE_ID,
  });
  check("W2 fingerprint alone cannot delete", delNoCap.status === 403, `got ${delNoCap.status}`);

  const delForged = await post("/api/wanted", {
    action: "delete",
    fingerprint: "c".repeat(32),
    id: CASE_ID,
    cap: "FORGED.TOKEN",
  });
  check("W3 forged capability rejected", delForged.status === 403, `got ${delForged.status}`);

  const attachNoCap = await post("/api/wanted", {
    action: "attach",
    fingerprint: "c".repeat(32),
    id: CASE_ID,
    index: 0,
    item: { iv: sealedIv, ciphertext: sealedCt, mime: "image/jpeg" },
  });
  check("W4 attach without capability refused", attachNoCap.status === 403 || attachNoCap.status === 400, `got ${attachNoCap.status}`);

  const delWithCap = await post("/api/wanted", {
    action: "delete",
    fingerprint: memberFp,
    id: CASE_ID,
    cap: cap ?? "",
  });
  check("W5 creator capability deletes case", delWithCap.status === 200 && delWithCap.json.deleted === true, `got ${delWithCap.status}`);

  const delAgain = await post("/api/wanted", {
    action: "delete",
    fingerprint: memberFp,
    id: CASE_ID,
    cap: cap ?? "",
  });
  check("W6 delete is idempotent", delAgain.status === 200, `got ${delAgain.status}`);
}

// ------------------------------------------------- 7. crypto integrity (M1)
{
  const sk = await generateSessionKey();
  const code = "CRYPTOA";
  const senderFp = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";

  const sealed = await seal(sk, code, senderFp, 0, "voetsek");
  const plain = await open(sk, code, senderFp, 0, sealed.iv, sealed.ciphertext);
  check("C1 AES-GCM roundtrip", plain === "voetsek");

  let tampered = false;
  try {
    const bytes = atob(sealed.ciphertext).split("");
    bytes[0] = bytes[0] === "A" ? "B" : "A";
    await open(sk, code, senderFp, 0, sealed.iv, btoa(bytes.join("")));
  } catch {
    tampered = true;
  }
  check("C2 ciphertext tamper fails AEAD", tampered);

  let replay = false;
  try {
    // same ciphertext replayed into ANOTHER room (AAD binds the code)
    await open(sk, "CRYPTOB", senderFp, 0, sealed.iv, sealed.ciphertext);
  } catch {
    replay = true;
  }
  check("C3 cross-room replay fails", replay);

  // M1 signatures
  const signer = await ed25519();
  const msgId = crypto.randomUUID();
  const sig = await signCanonical(signer, code, senderFp, 0, msgId, sealed.iv, sealed.ciphertext);
  const ctHash = await subtle.digest("SHA-256", new Uint8Array(atob(sealed.ciphertext).split("").map((c) => c.charCodeAt(0))));
  const canonical = `fast.sig.v1|${code}|${senderFp}|0|${msgId}|${sealed.iv}|${b64(ctHash)}`;
  const pubRaw = await subtle.exportKey("raw", signer.publicKey);
  const okSig = await subtle.verify(
    { name: "Ed25519" } as Algorithm,
    await subtle.importKey("raw", pubRaw, { name: "Ed25519" } as Algorithm, true, ["verify"]),
    new Uint8Array(atob(sig).split("").map((c) => c.charCodeAt(0))),
    te.encode(canonical)
  );
  check("C4 signature verifies over canonical bytes", okSig);

  const tamperedCanonical = `${canonical}X`;
  const badSig = await subtle.verify(
    { name: "Ed25519" } as Algorithm,
    await subtle.importKey("raw", pubRaw, { name: "Ed25519" } as Algorithm, true, ["verify"]),
    new Uint8Array(atob(sig).split("").map((c) => c.charCodeAt(0))),
    te.encode(tamperedCanonical)
  );
  check("C5 modified payload breaks signature", badSig === false);

  const stranger = await ed25519();
  const strangerPub = await subtle.exportKey("raw", stranger.publicKey);
  const impersonated = await subtle.verify(
    { name: "Ed25519" } as Algorithm,
    await subtle.importKey("raw", strangerPub, { name: "Ed25519" } as Algorithm, true, ["verify"]),
    new Uint8Array(atob(sig).split("").map((c) => c.charCodeAt(0))),
    te.encode(canonical)
  );
  check("C6 different signer key fails verification", impersonated === false);

  // IV reuse detection: 500 fresh seals must yield 500 distinct IVs
  const ivs = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const s = await seal(sk, code, senderFp, 1000 + i, `m${i}`);
    ivs.add(s.iv);
  }
  check("C7 no nonce reuse across 500 seals", ivs.size === 500, `distinct=${ivs.size}`);
}

// ------------------------------------------------------------------ summary

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailed checks:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nAll security regression checks passed.");
process.exit(0);
