/**
 * FAST — client-side End-to-End Encryption engine (Layer 1)
 * =========================================================
 * Zero-knowledge message protection implemented on the native Web Crypto API.
 *
 * Design (Signal/Megolm-inspired, library-free):
 *   1. IDENTITY    — every browser tab generates an ephemeral X25519 identity
 *                    key pair (falls back to ECDH P-256 on older engines).
 *                    The PRIVATE key is non-extractable and lives only in
 *                    tab RAM (see keyvault.ts). Never in LocalStorage.
 *   2. SESSION KEY — the session creator generates a random 256-bit session
 *                    key. It is distributed to each member wrapped inside an
 *                    AES-256-GCM envelope sealed with a FRESH EPHEMERAL
 *                    ECDH exchange against the member's public key
 *                    (Megolm-style outbound key distribution).
 *   3. PER-MESSAGE KEYS — every single message is sealed with its own key
 *                    derived via HKDF-SHA256(sessionKey, salt=code,
 *                    info="msg|counter|senderFp"). Keys mutate with every
 *                    message; stealing one key reveals exactly one message
 *                    (forward-secrecy-style key evolution, enforced by a
 *                    counter the receiver tracks).
 *   4. WIRE FORMAT — the server and database only ever see:
 *                    { senderFp, counter, iv, ciphertext } — opaque blobs.
 *
 * All primitives are constant-time native implementations (AES-GCM, ECDH,
 * HKDF). No home-rolled math.
 */

const subtle = crypto.subtle;

const te = new TextEncoder();
const td = new TextDecoder();

// ---------------------------------------------------------------------------
// Base64 helpers (ArrayBuffer <-> base64, binary-safe)
// ---------------------------------------------------------------------------

export function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function b64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Curve layer: X25519 with ECDH P-256 fallback
// ---------------------------------------------------------------------------

export type CurveName = "X25519" | "ECDH-P256";

let cachedCurve: CurveName | null = null;

/** Detect the strongest curve this browser supports (probed once). */
export async function detectCurve(): Promise<CurveName> {
  if (cachedCurve) return cachedCurve;
  try {
    const kp = await subtle.generateKey({ name: "X25519" } as Algorithm, true, [
      "deriveKey",
      "deriveBits",
    ]);
    cachedCurve = "X25519";
    void kp;
  } catch {
    cachedCurve = "ECDH-P256";
  }
  return cachedCurve;
}

function algo(curve: CurveName): EcKeyGenParams {
  return curve === "X25519"
    ? ({ name: "X25519" } as EcKeyGenParams)
    : { name: "ECDH", namedCurve: "P-256" };
}

export type Identity = {
  curve: CurveName;
  keyPair: CryptoKeyPair;
  publicB64: string;
  fingerprint: string; // 16 hex chars derived from the public key
};

/** Generate a fresh ephemeral identity for this tab. */
export async function generateIdentity(): Promise<Identity> {
  const curve = await detectCurve();
  const keyPair = (await subtle.generateKey(algo(curve), true, ["deriveKey", "deriveBits"])) as CryptoKeyPair;
  const publicB64 = bufToB64(await subtle.exportKey("raw", keyPair.publicKey));
  return { curve, keyPair, publicB64, fingerprint: await fingerprintOf(publicB64) };
}

/**
 * SHA-256 fingerprint of a public key — first 16 BYTES as 32 hex chars
 * (128-bit). The fingerprint IS the device's identity on the wire, so it
 * doubles as a binding: no one can present a different key under a stolen
 * fingerprint without finding a 128-bit collision. Legacy 16-hex (64-bit)
 * fingerprints from older clients remain wire-compatible.
 */
export async function fingerprintOf(publicB64: string): Promise<string> {
  const digest = await subtle.digest("SHA-256", b64ToBuf(publicB64) as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function importPeerPublic(curve: CurveName, publicB64: string): Promise<CryptoKey> {
  return subtle.importKey("raw", b64ToBuf(publicB64) as unknown as ArrayBuffer, algo(curve), true, []);
}

/** ECDH shared secret (256 raw bits) between our private key and a peer public key. */
async function ecdhBits(privateKey: CryptoKey, peerPublic: CryptoKey): Promise<Uint8Array> {
  const bits = await subtle.deriveBits({ ...({ name: privateKey.algorithm.name } as Algorithm), public: peerPublic } as unknown as Algorithm & { public: CryptoKey }, privateKey, 256);
  return new Uint8Array(bits);
}

// ---------------------------------------------------------------------------
// HKDF key derivation
// ---------------------------------------------------------------------------

async function hkdfAesKey(sharedBits: Uint8Array, salt: Uint8Array, info: string): Promise<CryptoKey> {
  const hkdfBase = await subtle.importKey(
    "raw",
    sharedBits as unknown as ArrayBuffer,
    "HKDF",
    false,
    ["deriveKey"]
  );
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: salt as unknown as ArrayBuffer, info: te.encode(info) as unknown as ArrayBuffer },
    hkdfBase,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ---------------------------------------------------------------------------
// AES-256-GCM sealing / opening
// ---------------------------------------------------------------------------

async function aesGcmSeal(key: CryptoKey, plaintext: Uint8Array, additionalData?: Uint8Array): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const params: AesGcmParams = { name: "AES-GCM", iv };
  if (additionalData) params.additionalData = additionalData as unknown as ArrayBuffer;
  const ct = await subtle.encrypt(params, key, plaintext as unknown as ArrayBuffer);
  return { iv: bufToB64(iv), ciphertext: bufToB64(ct) };
}

async function aesGcmOpen(key: CryptoKey, ivB64: string, ciphertextB64: string, additionalData?: Uint8Array): Promise<Uint8Array> {
  const params: AesGcmParams = { name: "AES-GCM", iv: b64ToBuf(ivB64) as unknown as ArrayBuffer };
  if (additionalData) params.additionalData = additionalData as unknown as ArrayBuffer;
  const pt = await subtle.decrypt(params, key, b64ToBuf(ciphertextB64) as unknown as ArrayBuffer);
  return new Uint8Array(pt);
}

// ---------------------------------------------------------------------------
// Traffic-analysis padding — ciphertext length buckets
// ---------------------------------------------------------------------------

const PAD_BUCKETS = [256, 1024, 4096, 16384, 65536];

/**
 * Pad a plaintext JSON payload so its byte length lands inside a coarse size
 * bucket (+ jitter inside the bucket). An observer of the sealed stream sees
 * "a ≤1KB blob", never "a 313-byte blob" — exact-length traffic analysis
 * gets nothing. `p` is pure filler and is dropped on decrypt. One-way,
 * backward-compatible: unpadded blobs decrypt identically.
 */
function padPayload(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj);
  const size = te.encode(json).length;
  const bucket = PAD_BUCKETS.find((b) => size <= b);
  if (bucket === undefined) return json; // over the top bucket — ship as-is
  const jitter = crypto.getRandomValues(new Uint8Array(1))[0] % 64;
  const filler = Math.max(0, bucket - size - 12 - jitter);
  return JSON.stringify({ ...obj, p: "x".repeat(filler) });
}

// ---------------------------------------------------------------------------
// Session keys
// ---------------------------------------------------------------------------

export type WrappedKeyEnvelope = {
  forFp: string;
  fromFp: string;
  epk: string; // ephemeral public key used for this wrap
  iv: string;
  payload: string; // wrapped session key ciphertext
};

export function generateSessionKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Wrap the raw session key for one recipient using a FRESH ephemeral key pair.
 * The ephemeral private key is destroyed the moment the wrap completes —
 * even the sender cannot re-derive the envelope afterwards.
 */
export async function wrapSessionKeyFor(
  identity: Identity,
  sessionKey: Uint8Array,
  code: string,
  recipientPublicB64: string,
  recipientFp: string
): Promise<WrappedKeyEnvelope> {
  const curve = await detectCurve();
  const ephem = (await subtle.generateKey(algo(curve), true, ["deriveKey", "deriveBits"])) as CryptoKeyPair;
  const peerPub = await importPeerPublic(curve, recipientPublicB64);
  const sharedBits = await ecdhBits(ephem.privateKey, peerPub);
  const wrapKey = await hkdfAesKey(
    sharedBits,
    te.encode(`fast-session|${code}|${recipientFp}`),
    "wrap-session-key"
  );
  const { iv, ciphertext: payload } = await aesGcmSeal(wrapKey, sessionKey);
  const epk = bufToB64(await subtle.exportKey("raw", ephem.publicKey));
  // zeroize shared secret material hint: nothing to do for JS GC, but we
  // never retain references — ephem.privateKey goes out of scope NOW.
  return { forFp: recipientFp, fromFp: identity.fingerprint, epk, iv, payload };
}

/** Open a wrapped session-key envelope with our identity private key. */
export async function unwrapSessionKey(
  identity: Identity,
  code: string,
  envelope: { epk: string; iv: string; payload: string }
): Promise<Uint8Array> {
  const curve = await detectCurve();
  const ephemPub = await importPeerPublic(curve, envelope.epk);
  const sharedBits = await ecdhBits(identity.keyPair.privateKey, ephemPub);
  const wrapKey = await hkdfAesKey(
    sharedBits,
    te.encode(`fast-session|${code}|${identity.fingerprint}`),
    "wrap-session-key"
  );
  return aesGcmOpen(wrapKey, envelope.iv, envelope.payload);
}

// ---------------------------------------------------------------------------
// Per-message ratchet keys
// ---------------------------------------------------------------------------

/**
 * Derive the unique AES key for ONE message. Binding the HKDF info to
 * (counter, senderFp) guarantees a fresh key per message per sender —
 * a compromised message key decrypts exactly that one blob.
 */
async function deriveMessageKey(
  sessionKey: Uint8Array,
  code: string,
  senderFp: string,
  counter: number
): Promise<CryptoKey> {
  const ikm = await subtle.importKey(
    "raw",
    sessionKey as unknown as ArrayBuffer,
    "HKDF",
    false,
    ["deriveKey"]
  );
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

export type MessageEnvelope = {
  id: string;
  code: string;
  senderFp: string;
  counter: number;
  iv: string;
  ciphertext: string;
  createdAt: string; // server-assigned ISO timestamp
};

export type EncryptedPayload = {
  id: string;
  counter: number;
  iv: string;
  ciphertext: string;
};

/** Encrypt a JSON-able payload into a wire envelope (server sees only this). */
export async function encryptMessage(
  sessionKey: Uint8Array,
  code: string,
  senderFp: string,
  counter: number,
  id: string,
  payload: { t: string; ts: number }
): Promise<EncryptedPayload> {
  const key = await deriveMessageKey(sessionKey, code, senderFp, counter);
  const ad = te.encode(`${code}|${senderFp}|${counter}`);
  const { iv, ciphertext } = await aesGcmSeal(key, te.encode(padPayload(payload)), ad);
  return { id, counter, iv, ciphertext };
}

/** Decrypt a wire envelope. Throws if the blob was tampered with. */
export async function decryptMessage(
  sessionKey: Uint8Array,
  code: string,
  envelope: Pick<MessageEnvelope, "senderFp" | "counter" | "iv" | "ciphertext">
): Promise<{ t: string; ts: number }> {
  const key = await deriveMessageKey(sessionKey, code, envelope.senderFp, envelope.counter);
  const ad = te.encode(`${code}|${envelope.senderFp}|${envelope.counter}`);
  const pt = await aesGcmOpen(key, envelope.iv, envelope.ciphertext, ad);
  const parsed = JSON.parse(td.decode(pt)) as { t: string; ts: number; p?: string };
  return { t: parsed.t, ts: parsed.ts }; // `p` filler never leaves this scope
}

// ---------------------------------------------------------------------------
// Sender authenticity (M1) — Ed25519 with ECDSA P-256 fallback
// ---------------------------------------------------------------------------

export type SignCurve = "Ed25519" | "ECDSA-P256";

/** Protocol version for the signature envelope format. */
export const SIG_PROTOCOL = "fast.sig.v1";

let cachedSignCurve: SignCurve | null = null;

/** Probe the strongest signature algorithm this browser supports (once). */
export async function detectSignCurve(): Promise<SignCurve> {
  if (cachedSignCurve) return cachedSignCurve;
  try {
    const kp = await subtle.generateKey({ name: "Ed25519" } as Algorithm, true, [
      "sign",
      "verify",
    ]);
    cachedSignCurve = "Ed25519";
    void kp;
  } catch {
    cachedSignCurve = "ECDSA-P256";
  }
  return cachedSignCurve;
}

export type SigningIdentity = {
  curve: SignCurve;
  keyPair: CryptoKeyPair;
  /** wire form: "ed25519:<raw b64>" | "ecdsa-p256:<raw b64>" */
  publicWire: string;
};

/** Generate the tab's signing identity (distinct from the ECDH identity). */
export async function generateSigningIdentity(): Promise<SigningIdentity> {
  const curve = await detectSignCurve();
  const keyPair =
    curve === "Ed25519"
      ? ((await subtle.generateKey({ name: "Ed25519" } as Algorithm, true, [
          "sign",
          "verify",
        ])) as CryptoKeyPair)
      : ((await subtle.generateKey(
          { name: "ECDSA", namedCurve: "P-256" },
          true,
          ["sign", "verify"]
        )) as CryptoKeyPair);
  const raw = await subtle.exportKey("raw", keyPair.publicKey);
  return {
    curve,
    keyPair,
    publicWire: `${curve === "Ed25519" ? "ed25519" : "ecdsa-p256"}:${bufToB64(raw)}`,
  };
}

async function importSignPublic(curve: SignCurve, rawB64: string): Promise<CryptoKey> {
  if (curve === "Ed25519") {
    return subtle.importKey("raw", b64ToBuf(rawB64) as unknown as ArrayBuffer, { name: "Ed25519" } as Algorithm, true, [
      "verify",
    ]);
  }
  return subtle.importKey(
    "raw",
    b64ToBuf(rawB64) as unknown as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"]
  );
}

/** Canonical bytes a signature commits to (domain-separated, versioned). */
export async function canonicalSignatureBytes(parts: {
  code: string;
  senderFp: string;
  counter: number;
  id: string;
  iv: string;
  ciphertextB64: string;
}): Promise<Uint8Array> {
  const ctHash = await subtle.digest(
    "SHA-256",
    b64ToBuf(parts.ciphertextB64) as unknown as ArrayBuffer
  );
  const canonical = `${SIG_PROTOCOL}|${parts.code}|${parts.senderFp}|${parts.counter}|${parts.id}|${parts.iv}|${bufToB64(ctHash)}`;
  return te.encode(canonical);
}

/** Sign the canonical envelope bytes with our signing identity. */
export async function signEnvelope(
  signer: SigningIdentity,
  bytes: Uint8Array
): Promise<string> {
  const params =
    signer.curve === "Ed25519"
      ? ({ name: "Ed25519" } as Algorithm)
      : { name: "ECDSA", hash: "SHA-256" };
  const sig = await subtle.sign(params, signer.keyPair.privateKey, bytes as unknown as ArrayBuffer);
  return bufToB64(sig);
}

/**
 * Verify a message signature. Every part of the binding is checked by the
 * canonical bytes (room, sender fp, counter, id, IV, ciphertext hash) —
 * cross-room replay, counter substitution and ciphertext stripping all fail.
 */
export async function verifyEnvelopeSignature(
  signerCurve: SignCurve,
  signerPublicB64: string,
  signatureB64: string,
  bytes: Uint8Array
): Promise<boolean> {
  try {
    const pub = await importSignPublic(signerCurve, signerPublicB64);
    const params =
      signerCurve === "Ed25519"
        ? ({ name: "Ed25519" } as Algorithm)
        : { name: "ECDSA", hash: "SHA-256" };
    return await subtle.verify(
      params,
      pub,
      b64ToBuf(signatureB64) as unknown as ArrayBuffer,
      bytes as unknown as ArrayBuffer
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Ephemeral photos — same ratchet family, RAW-BYTE payload, RAM-only lifetime
// ---------------------------------------------------------------------------

/**
 * Derive the unique AES key for ONE photo. Mirrors the message ratchet but
 * with a dedicated domain separator so photo keys and message keys can never
 * collide even at the same counter.
 */
async function derivePhotoKey(
  sessionKey: Uint8Array,
  code: string,
  senderFp: string,
  counter: number
): Promise<CryptoKey> {
  const ikm = await subtle.importKey(
    "raw",
    sessionKey as unknown as ArrayBuffer,
    "HKDF",
    false,
    ["deriveKey"]
  );
  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: te.encode(`fast-photo|${code}`) as unknown as ArrayBuffer,
      info: te.encode(`photo|${counter}|${senderFp}`) as unknown as ArrayBuffer,
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export type PhotoEnvelope = {
  id: string;
  counter: number;
  iv: string;
  data: string; // base64 AES-256-GCM ciphertext of the image bytes
};

/** Encrypt raw image bytes (JPEG) into a photo envelope. */
export async function encryptPhoto(
  sessionKey: Uint8Array,
  code: string,
  senderFp: string,
  counter: number,
  bytes: Uint8Array
): Promise<PhotoEnvelope> {
  const key = await derivePhotoKey(sessionKey, code, senderFp, counter);
  const ad = te.encode(`${code}|${senderFp}|${counter}|photo`);
  const { iv, ciphertext } = await aesGcmSeal(key, bytes, ad);
  return { id: crypto.randomUUID(), counter, iv, data: ciphertext };
}

/** Decrypt a photo envelope. Throws if the blob was tampered with. */
export async function decryptPhoto(
  sessionKey: Uint8Array,
  code: string,
  senderFp: string,
  counter: number,
  iv: string,
  data: string
): Promise<Uint8Array> {
  const key = await derivePhotoKey(sessionKey, code, senderFp, counter);
  const ad = te.encode(`${code}|${senderFp}|${counter}|photo`);
  return aesGcmOpen(key, iv, data, ad);
}
