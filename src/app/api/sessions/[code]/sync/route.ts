import { createHash } from "crypto";
import { z } from "zod";
import {
  json,
  rateLimit,
  readJson,
  verifyAttestation,
} from "@/lib/server-guard";
import * as store from "@/lib/fast/memory-store";

/**
 * FAST unified session sync (Layer 2/3 over HTTP)
 * ================================================
 * ONE endpoint, ONE serverless function, ALL chat operations:
 *
 *   action "sync"      poll: presence + message/envelope/photo deltas
 *   action "join"      register participant (+ optionally provision room)
 *   action "leave"     drop presence
 *   action "msg"       store a ciphertext message (+ optional signature)
 *   action "key"       store a wrapped session-key envelope
 *   action "keyreq"    announce "I need the session key"
 *   action "photo"     store an ephemeral RAM-only photo (60s TTL)
 *   action "terminate" creator/boss-only soft-delete (H3)
 *
 * Every mutation returns the SAME delta payload as a poll, so a send also
 * acts as an immediate poll (zero extra round trips).
 *
 * RETENTION: every payload carries createdAt / expiresAt / serverNow. A
 * session is hard-wiped 5 hours after creation — the server burns the whole
 * transcript and flags `expired` so every client evicts and purges locally.
 *
 * IDENTITY BINDING (M2): the fingerprint IS a prefix of SHA-256(ECDH public
 * key) and the route verifies that binding on join — a client cannot pair
 * an arbitrary public key with a stolen fingerprint. Participant key slots
 * are write-once (memory-store). Nickname/role come only from a verified
 * attestation.
 *
 * TERMINATION (H3): requires a valid attestation AND either the room
 * creator or an attested boss. Anonymous or member terminate -> 403.
 *
 * The server only ever sees ciphertext, public keys and signatures — zero
 * knowledge, by construction.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CODE_RE = /^[A-Z]{6}$/;

const MAX_MSG_CIPHERTEXT = 12_000;
const MAX_PHOTO_B64 = 1_500_000; // ephemeral encrypted photos ride this route
const MAX_TINY_B64 = 2048; // ivs / wrapped keys / pubkeys
const MAX_SIG_B64 = 1024; // Ed25519 (64B) or ECDSA P-256 (≤72B DER) signatures
const MAX_BODY_BYTES = 2_200_000; // largest legal body = photo action + overhead

const bodySchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{8,64}$/),
    action: z.string().max(16).optional(),
    create: z.boolean().optional(),
    /** server-signed callsign attestation (join + terminate authorization) */
    attestation: z.string().max(1024).optional(),
    cursors: z
      .object({
        msg: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
        env: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
        photo: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
      })
      .strict()
      .optional(),
    publicKey: z.string().max(MAX_TINY_B64).optional(),
    signPub: z.string().max(256).optional(),
    message: z
      .object({
        id: z.string().min(1).max(64),
        senderFp: z.string().regex(/^[a-f0-9]{8,64}$/),
        counter: z.number().int().min(0).max(1e9),
        iv: z.string().max(MAX_TINY_B64),
        ciphertext: z.string().max(MAX_MSG_CIPHERTEXT),
        sig: z.string().max(MAX_SIG_B64).optional(),
      })
      .strict()
      .optional(),
    envelope: z
      .object({
        forFp: z.string().regex(/^[a-f0-9]{8,64}$/),
        fromFp: z.string().regex(/^[a-f0-9]{8,64}$/),
        epk: z.string().max(MAX_TINY_B64),
        iv: z.string().max(MAX_TINY_B64),
        payload: z.string().max(MAX_TINY_B64),
      })
      .strict()
      .optional(),
    photo: z
      .object({
        id: z.string().min(1).max(64),
        senderFp: z.string().regex(/^[a-f0-9]{8,64}$/),
        counter: z.number().int().min(0).max(1e9),
        iv: z.string().max(512),
        data: z.string().max(MAX_PHOTO_B64),
      })
      .strict()
      .optional(),
  })
  .strict();

type Ctx = { params: Promise<{ code: string }> };

const B64_RE = /^[A-Za-z0-9+/=]+$/;
const SIGN_ALGO_RE = /^(ed25519|ecdsa-p256)$/;

function isB64(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max && B64_RE.test(v);
}

/**
 * The fingerprint is defined as a prefix of SHA-256(raw public key). This
 * check makes "borrow someone's fp, supply my key" structurally impossible:
 * the key must hash to the claimed fp (M2 defense-in-depth).
 */
function fpMatchesKey(fp: string, publicB64: string): boolean {
  try {
    const raw = Buffer.from(publicB64, "base64");
    if (raw.length < 8) return false;
    const hex = createHash("sha256").update(raw).digest("hex");
    return hex.startsWith(fp.toLowerCase());
  } catch {
    return false;
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const { code: rawCode } = await params;
  const code = typeof rawCode === "string" ? rawCode.toUpperCase() : "";
  if (!CODE_RE.test(code)) return json({ ok: false, error: "Bad code" }, 400);

  // Chat sync limit: generous for 1.5–3s polling, still flood-proof.
  const rl = await rateLimit(req, "sync", 240, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Rate limited" }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  const parsed = await readJson(req, MAX_BODY_BYTES);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);

  const check = bodySchema.safeParse(parsed.body);
  if (!check.success) return json({ ok: false, error: "Invalid payload" }, 400);
  const body = check.data;

  const fp = body.fingerprint;
  const action = body.action ?? "sync";
  const create = body.create === true;
  const cursors = {
    msg: body.cursors?.msg ?? 0,
    env: body.cursors?.env ?? 0,
    photo: body.cursors?.photo ?? 0,
  };

  // ------------------------------------------------------------- mutations
  if (action === "terminate") {
    // H3: termination is a privileged operation. Requires a server-signed
    // attestation for the acting fingerprint, and the actor must be the
    // room creator or an attested boss. Everything else -> 403.
    if (!store.sessionExists(code)) {
      return json({ ok: true, alive: false, terminated: true }); // idempotent
    }
    const attested = verifyAttestation(body.attestation, fp);
    if (!attested) {
      return json({ ok: false, error: "Attestation invalid — re-enter the gate." }, 401);
    }
    const creator = store.sessionCreator(code);
    if (creator !== null && creator !== fp && attested.role !== "boss") {
      return json({ ok: false, error: "Only the walla who opened this session can close it." }, 403);
    }
    store.provisionSession(code); // ensure addressable even across odd orders
    store.terminateSession(code);
    return json({ ok: true, alive: false, terminated: true });
  }

  if (action === "join") {
    if (!isB64(body.publicKey, MAX_TINY_B64)) {
      return json({ ok: false, error: "Invalid identity material" }, 400);
    }
    // M2: the fingerprint must cryptographically bind to the public key
    if (!fpMatchesKey(fp, body.publicKey)) {
      return json({ ok: false, error: "Identity binding failed" }, 400);
    }
    // signing key: prefixed raw b64 ("ed25519:..." | "ecdsa-p256:...")
    let signPub: string | undefined;
    if (body.signPub !== undefined) {
      const sp = body.signPub;
      const colon = sp.indexOf(":");
      const algo = colon > 0 ? sp.slice(0, colon) : "";
      const raw = colon > 0 ? sp.slice(colon + 1) : "";
      if (!SIGN_ALGO_RE.test(algo) || !isB64(raw, 200)) {
        return json({ ok: false, error: "Invalid signing key" }, 400);
      }
      signPub = sp;
    }
    // callsign comes ONLY from the server-signed attestation — a client can
    // never claim a nickname (let alone the boss callsign) it was not given
    const attested = verifyAttestation(body.attestation, fp);
    if (create || store.sessionExists(code)) {
      const provisioned = store.provisionSession(code, { creatorFp: create ? fp : undefined });
      if (!provisioned.created && create && store.sessionCreator(code) === null) {
        store.adoptCreator(code, fp);
      }
      const put = store.upsertParticipant(code, fp, body.publicKey, {
        nickname: attested?.nickname,
        role: attested?.role,
        signPub,
      });
      if (!put.ok && put.reason === "key-conflict") {
        // M2: someone already holds this fingerprint slot with different
        // key material. Refuse — never overwrite, never leak which key won.
        return json({ ok: false, error: "Identity slot conflict" }, 409);
      }
      store.enforceTtl(code);
      return syncPayload(code, fp, cursors, true);
    }
    return json({ ok: true, alive: false });
  }

  if (action === "leave") {
    store.dropPresence(code, fp);
    return json({ ok: true });
  }

  if (action === "keyreq") {
    if (!store.sessionExists(code)) {
      // unknown room -> poll-style answer lets the client self-heal
      return json({ ok: true, alive: false });
    }
    store.enforceTtl(code);
    store.addKeyRequest(code, fp);
    return syncPayload(code, fp, cursors, false);
  }

  if (action === "msg") {
    const m = body.message;
    if (!m || !isB64(m.iv, MAX_TINY_B64) || !isB64(m.ciphertext, MAX_MSG_CIPHERTEXT)) {
      return json({ ok: false, error: "Invalid message blob" }, 400);
    }
    if (m.sig !== undefined && !isB64(m.sig, MAX_SIG_B64)) {
      return json({ ok: false, error: "Invalid message blob" }, 400);
    }
    if (!store.sessionExists(code)) return json({ ok: true, alive: false });
    // only a bound participant may post into the room
    if (!store.isParticipant(code, fp)) {
      return json({ ok: false, error: "Join before posting." }, 403);
    }
    store.enforceTtl(code);
    store.addMessage(code, {
      id: m.id,
      senderFp: m.senderFp,
      counter: m.counter,
      iv: m.iv,
      ciphertext: m.ciphertext,
      sig: m.sig,
    });
    return syncPayload(code, fp, cursors, false);
  }

  if (action === "key") {
    const e = body.envelope;
    if (!e || !isB64(e.epk, MAX_TINY_B64) || !isB64(e.iv, MAX_TINY_B64) || !isB64(e.payload, MAX_TINY_B64)) {
      return json({ ok: false, error: "Invalid envelope" }, 400);
    }
    if (!store.sessionExists(code)) return json({ ok: true, alive: false });
    if (!store.isParticipant(code, fp)) {
      return json({ ok: false, error: "Join before posting." }, 403);
    }
    store.enforceTtl(code);
    store.addEnvelope(code, { forFp: e.forFp, fromFp: e.fromFp, epk: e.epk, iv: e.iv, payload: e.payload });
    return syncPayload(code, fp, cursors, false);
  }

  if (action === "photo") {
    const p = body.photo;
    if (!p || !isB64(p.iv, 512) || !isB64(p.data, MAX_PHOTO_B64)) {
      return json({ ok: false, error: "Invalid photo blob" }, 400);
    }
    if (!store.sessionExists(code)) return json({ ok: true, alive: false });
    if (!store.isParticipant(code, fp)) {
      return json({ ok: false, error: "Join before posting." }, 403);
    }
    store.enforceTtl(code);
    // RAM-ONLY with a hard 60s TTL — the server forwards and forgets.
    store.addPhoto(code, {
      id: p.id,
      senderFp: p.senderFp,
      counter: p.counter,
      iv: p.iv,
      data: p.data,
    });
    return syncPayload(code, fp, cursors, false);
  }

  // ------------------------------------------------------------------ sync
  if (action === "sync") {
    const known = store.sessionExists(code);
    if (!known && create) {
      // creator self-heal: a cold serverless restart re-provisions the room
      store.provisionSession(code, { creatorFp: fp });
      store.touchPresence(code, fp);
      return syncPayload(code, fp, cursors, true);
    }
    if (!known) return json({ ok: true, alive: false });
    store.enforceTtl(code);
    store.touchPresence(code, fp);
    return syncPayload(code, fp, cursors, false);
  }

  return json({ ok: false, error: "Unknown action" }, 400);
}

// ------------------------------------------------------------- delta payload

type DeltaResponse = {
  ok: boolean;
  alive: boolean;
  terminated?: boolean;
  /** true when the termination came from the 5h retention window */
  expired?: boolean;
  createdAt?: string;
  expiresAt?: string;
  serverNow?: string;
  cursor?: { msg: number; env: number; photo: number };
  presence?: string[];
  members?: { fingerprint: string; publicKey: string }[];
  /** callsign roster — public display material (nickname + role per member) */
  roster?: { fingerprint: string; nickname: string; role: string }[];
  /** signing keys per fingerprint (write-once slots) for M1 verification */
  signKeys?: { fingerprint: string; signPub: string }[];
  keyRequests?: string[];
  messages?: store.WireBlob[];
  envelopes?: { id: string; forFp: string; fromFp: string; epk: string; iv: string; payload: string }[];
  photos?: Omit<store.PhotoBlob, "expiresAt">[];
};

function syncPayload(
  code: string,
  fp: string,
  cursors: { msg: number; env: number; photo: number },
  _includeRoster = true
): Response {
  if (!store.sessionExists(code)) return json({ ok: true, alive: false });

  const meta = store.sessionMeta(code);
  const presence = store.touchPresence(code, fp);
  const cursor = store.headSeq(code);
  const participants = store.listParticipants(code);
  const signKeys = participants
    .filter((p) => p.signPub !== null)
    .map((p) => ({ fingerprint: p.fingerprint, signPub: p.signPub as string }));
  const payload: DeltaResponse = {
    ok: true,
    alive: true,
    terminated: store.isTerminated(code) || undefined,
    expired: store.isExpiredSession(code) || undefined,
    createdAt: meta?.createdAt,
    expiresAt: meta?.expiresAt,
    serverNow: new Date().toISOString(),
    cursor,
    presence,
    members: participants.map((p) => ({ fingerprint: p.fingerprint, publicKey: p.publicKey })),
    roster: participants
      .filter((p) => p.nickname.length > 0)
      .map((p) => ({ fingerprint: p.fingerprint, nickname: p.nickname, role: p.role })),
    signKeys,
    keyRequests: store.listKeyRequests(code).filter((x) => x !== fp),
    messages: store.listMessages(code, cursors.msg).map(store.toWire.message),
    envelopes: store.listEnvelopes(code, fp, cursors.env).map(store.toWire.envelope),
    photos: store.listPhotos(code, cursors.photo).map(store.toWire.photo),
  };
  return json(payload);
}
