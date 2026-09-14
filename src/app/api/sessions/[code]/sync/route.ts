import { clientIp, json, rateLimit, verifyAttestation } from "@/lib/server-guard";
import * as store from "@/lib/fast/memory-store";

/**
 * FAST unified session sync (Layer 2/3 over HTTP)
 * ================================================
 * ONE endpoint, ONE serverless function, ALL chat operations:
 *
 *   action "sync"      poll: presence + message/envelope/photo deltas
 *   action "join"      register participant (+ optionally provision room)
 *   action "leave"     drop presence
 *   action "msg"       store a ciphertext message
 *   action "key"       store a wrapped session-key envelope
 *   action "keyreq"    announce "I need the session key"
 *   action "photo"     store an ephemeral RAM-only photo (60s TTL)
 *   action "terminate" soft-delete so every member's poll evicts itself
 *
 * Every mutation returns the SAME delta payload as a poll, so a send also
 * acts as an immediate poll (zero extra round trips).
 *
 * RETENTION: every payload carries createdAt / expiresAt / serverNow. A
 * session is hard-wiped 5 hours after creation — the server burns the whole
 * transcript and flags `expired` so every client evicts and purges locally.
 *
 * Consolidating everything into one function is what makes this work on
 * Vercel: a route = a function = one warm process holding the room state.
 * The creator re-asserts `create: true` on every sync, so even a cold
 * restart cannot permanently kill a room. The server only ever sees
 * ciphertext and public key material — zero knowledge, by construction.
 */

export const dynamic = "force-dynamic";

const CODE_RE = /^[A-Z]{6}$/;
const FP_RE = /^[a-f0-9]{8,64}$/;
const B64_RE = /^[A-Za-z0-9+/=]+$/;

type Ctx = { params: Promise<{ code: string }> };

type SyncBody = {
  fingerprint?: unknown;
  action?: unknown;
  create?: unknown;
  cursors?: { msg?: unknown; env?: unknown; photo?: unknown };
  publicKey?: unknown;
  attestation?: unknown;
  message?: { id?: unknown; senderFp?: unknown; counter?: unknown; iv?: unknown; ciphertext?: unknown };
  envelope?: { forFp?: unknown; fromFp?: unknown; epk?: unknown; iv?: unknown; payload?: unknown };
  photo?: { id?: unknown; senderFp?: unknown; counter?: unknown; iv?: unknown; data?: unknown };
};

const MAX_MSG_CIPHERTEXT = 12_000;
const MAX_PHOTO_B64 = 1_500_000; // ephemeral encrypted photos ride this route
const MAX_TINY_B64 = 2048; // ivs / wrapped keys / pubkeys

function isB64(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max && B64_RE.test(v);
}

function isFp(v: unknown): v is string {
  return typeof v === "string" && FP_RE.test(v);
}

function asSeq(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER ? Math.floor(v) : 0;
}

export async function POST(req: Request, { params }: Ctx) {
  const { code: rawCode } = await params;
  const code = typeof rawCode === "string" ? rawCode.toUpperCase() : "";
  if (!CODE_RE.test(code)) return json({ ok: false, error: "Bad code" }, 400);

  // Chat sync limit: generous for 1.5–3s polling, still flood-proof.
  const rl = rateLimit(`sync:${clientIp(req)}`, 240, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Rate limited" }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  let body: SyncBody;
  try {
    body = (await req.json()) as SyncBody;
  } catch {
    return json({ ok: false, error: "Malformed request" }, 400);
  }

  const fp = body.fingerprint;
  if (!isFp(fp)) return json({ ok: false, error: "Bad fingerprint" }, 400);

  const action = typeof body.action === "string" ? body.action : "sync";
  const create = body.create === true;
  const cursors = {
    msg: asSeq(body.cursors?.msg),
    env: asSeq(body.cursors?.env),
    photo: asSeq(body.cursors?.photo),
  };

  // ------------------------------------------------------------- mutations
  if (action === "terminate") {
    store.provisionSession(code); // ensure addressable even across odd orders
    store.terminateSession(code);
    return json({ ok: true, alive: false, terminated: true });
  }

  if (action === "join") {
    if (typeof body.publicKey !== "string" || body.publicKey.length === 0 || body.publicKey.length > MAX_TINY_B64) {
      return json({ ok: false, error: "Invalid identity material" }, 400);
    }
    // callsign comes ONLY from the server-signed attestation — a client can
    // never claim a nickname (let alone the boss callsign) it was not given
    const attested = verifyAttestation(body.attestation, fp);
    if (create || store.sessionExists(code)) {
      store.provisionSession(code);
      store.upsertParticipant(code, fp, body.publicKey, attested?.nickname, attested?.role);
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
    if (
      !m ||
      typeof m.id !== "string" ||
      m.id.length === 0 ||
      m.id.length > 64 ||
      !isFp(m.senderFp) ||
      typeof m.counter !== "number" ||
      !Number.isInteger(m.counter) ||
      m.counter < 0 ||
      m.counter > 1e9 ||
      !isB64(m.iv, MAX_TINY_B64) ||
      !isB64(m.ciphertext, MAX_MSG_CIPHERTEXT)
    ) {
      return json({ ok: false, error: "Invalid message blob" }, 400);
    }
    if (!store.sessionExists(code)) return json({ ok: true, alive: false });
    store.enforceTtl(code);
    store.addMessage(code, {
      id: m.id,
      senderFp: m.senderFp,
      counter: m.counter,
      iv: m.iv,
      ciphertext: m.ciphertext,
    });
    return syncPayload(code, fp, cursors, false);
  }

  if (action === "key") {
    const e = body.envelope;
    if (
      !e ||
      !isFp(e.forFp) ||
      !isFp(e.fromFp) ||
      !isB64(e.epk, MAX_TINY_B64) ||
      !isB64(e.iv, MAX_TINY_B64) ||
      !isB64(e.payload, MAX_TINY_B64)
    ) {
      return json({ ok: false, error: "Invalid envelope" }, 400);
    }
    if (!store.sessionExists(code)) return json({ ok: true, alive: false });
    store.enforceTtl(code);
    store.addEnvelope(code, { forFp: e.forFp, fromFp: e.fromFp, epk: e.epk, iv: e.iv, payload: e.payload });
    return syncPayload(code, fp, cursors, false);
  }

  if (action === "photo") {
    const p = body.photo;
    if (
      !p ||
      typeof p.id !== "string" ||
      p.id.length === 0 ||
      p.id.length > 64 ||
      !isFp(p.senderFp) ||
      typeof p.counter !== "number" ||
      !Number.isInteger(p.counter) ||
      p.counter < 0 ||
      p.counter > 1e9 ||
      !isB64(p.iv, 512) ||
      !isB64(p.data, MAX_PHOTO_B64)
    ) {
      return json({ ok: false, error: "Invalid photo blob" }, 400);
    }
    if (!store.sessionExists(code)) return json({ ok: true, alive: false });
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
      store.provisionSession(code);
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
  /** actual session creation time (ISO) */
  createdAt?: string;
  /** createdAt + 5h — the hard wipe deadline (ISO) */
  expiresAt?: string;
  /** server clock at response time — lets clients correct for skew */
  serverNow?: string;
  cursor?: { msg: number; env: number; photo: number };
  presence?: string[];
  members?: { fingerprint: string; publicKey: string }[];
  /** callsign roster — public display material (nickname + role per member) */
  roster?: { fingerprint: string; nickname: string; role: string }[];
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
    members: store
      .listParticipants(code)
      .map((p) => ({ fingerprint: p.fingerprint, publicKey: p.publicKey })),
    roster: store
      .listParticipants(code)
      .filter((p) => p.nickname.length > 0)
      .map((p) => ({ fingerprint: p.fingerprint, nickname: p.nickname, role: p.role })),
    keyRequests: store.listKeyRequests(code).filter((x) => x !== fp),
    messages: store.listMessages(code, cursors.msg).map(store.toWire.message),
    envelopes: store.listEnvelopes(code, fp, cursors.env).map(store.toWire.envelope),
    photos: store.listPhotos(code, cursors.photo).map(store.toWire.photo),
  };
  return json(payload);
}
