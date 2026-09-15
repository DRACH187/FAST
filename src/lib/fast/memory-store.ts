/**
 * FAST chat state — single-process memory store (Layer 2)
 * ========================================================
 * The relay previously lived in a socket.io server; chat now moves over one
 * HTTP endpoint (POST /api/sessions/[code]/sync) so the whole transport works
 * on serverless hosts (Vercel) where custom WebSocket servers and SQLite
 * writes are impossible.
 *
 * Because EVERY chat operation flows through that one route function, a
 * module-scope store is the correct persistence story:
 *   - Vercel:   one warm lambda instance holds the room (low-traffic rooms
 *               almost always stay on one instance; the client self-heals by
 *               re-asserting `create` so a cold restart cannot kill a room).
 *   - Self-host/sandbox: same code, same guarantees, no SQLite dependency.
 *
 * Security invariant (unchanged): this store only ever holds PUBLIC key
 * material and CIPHERTEXT. No plaintext. No key material. Zero knowledge.
 *
 * The ONLY non-ciphertext state kept here is ephemeral presence (last-seen
 * timestamps), key-request flags and photo TTLs — all short-lived operational
 * metadata that never leaves this process's RAM for long.
 */

const CODE_RE = /^[A-Z]{6}$/;
const FP_RE = /^[a-f0-9]{8,64}$/;

const MAX_SESSIONS = 400;
const MAX_MESSAGES_PER_SESSION = 600;
const MAX_ENVELOPES_PER_SESSION = 400;
const MAX_PHOTOS_PER_SESSION = 24;

/** Presence TTL — a fingerprint is "live" if it synced within this window. */
export const PRESENCE_TTL_MS = 15_000;
/** A key request stays visible to holders for this long. */
const KEY_REQUEST_TTL_MS = 45_000;
/** Ephemeral photos live in RAM for exactly this long, then vanish. */
export const PHOTO_TTL_MS = 60_000;
/**
 * HARD RETENTION LIMIT — every chat wipes itself 5 hours after its session
 * was created. The server purges the transcript, terminates the room, and
 * every member's next sync evicts itself and burns its local copy too.
 */
export const SESSION_TTL_MS = 5 * 60 * 60 * 1000;

export type WireBlob = {
  id: string;
  senderFp: string;
  counter: number;
  iv: string;
  ciphertext: string;
  /** client signature over the sealed envelope (fast.sig.v1) — opaque to the
   *  server, verified by every receiving member (M1 sender authenticity) */
  sig?: string;
  createdAt: string;
};

export type EnvelopeBlob = {
  id: string;
  forFp: string;
  fromFp: string;
  epk: string;
  iv: string;
  payload: string;
  createdAt: string;
};

export type PhotoBlob = {
  id: string;
  senderFp: string;
  counter: number;
  iv: string;
  data: string;
  createdAt: string;
  expiresAt: number;
};

type ParticipantRec = {
  publicKey: string;
  /** write-once E2EE-signing public key ("ed25519:" | "ecdsa-p256:" prefix + raw b64) */
  signPub: string | null;
  nickname: string;
  role: string;
  joinedAt: Date;
};

type SessionRec = {
  code: string;
  createdAt: Date;
  /** the fingerprint that provisioned this room — the only member (besides
   *  an attested boss) who may terminate it (H3 hardening) */
  creatorFp: string | null;
  participants: Map<string, ParticipantRec>;
  messages: (WireBlob & { seq: number })[];
  envelopes: (EnvelopeBlob & { seq: number })[];
  photos: (PhotoBlob & { seq: number })[];
  keyRequests: Map<string, number>; // fp -> requested-at ms
  terminated: boolean;
  /** true once the 5h retention window elapsed — distinct from user delete */
  expired: boolean;
  lastActivity: number;
};

// code -> session — globalThis-pinned: one store per process, shared across
// route-module instances in dev exactly like every other FAST table.
const gStore = globalThis as unknown as {
  __fastSessions?: Map<string, SessionRec>;
  __fastPresence?: Map<string, Map<string, number>>;
};
const sessions: Map<string, SessionRec> = gStore.__fastSessions ?? new Map();
gStore.__fastSessions = sessions;
// code -> (fp -> lastSeen ms) — ephemeral presence, never persisted
const presence: Map<string, Map<string, number>> = gStore.__fastPresence ?? new Map();
gStore.__fastPresence = presence;

// monotonic cursor for delta sync
let seqCounter = 0;
const nextSeq = () => ++seqCounter;

// --------------------------------------------------------------------- gc

function gcSession(s: SessionRec) {
  const now = Date.now();
  if (s.messages.length > MAX_MESSAGES_PER_SESSION) {
    s.messages.splice(0, s.messages.length - MAX_MESSAGES_PER_SESSION);
  }
  if (s.envelopes.length > MAX_ENVELOPES_PER_SESSION) {
    s.envelopes.splice(0, s.envelopes.length - MAX_ENVELOPES_PER_SESSION);
  }
  if (s.photos.length > 0) {
    s.photos = s.photos.filter((p) => p.expiresAt > now);
  }
  if (s.photos.length > MAX_PHOTOS_PER_SESSION) {
    s.photos.splice(0, s.photos.length - MAX_PHOTOS_PER_SESSION);
  }
  for (const [fp, at] of s.keyRequests) {
    if (now - at > KEY_REQUEST_TTL_MS) s.keyRequests.delete(fp);
  }
  s.lastActivity = now;
}

/** Has the 5-hour retention window elapsed for this session? */
function isExpired(s: SessionRec): boolean {
  return Date.now() - s.createdAt.getTime() > SESSION_TTL_MS;
}

function gcGlobal() {
  const now = Date.now();
  // hard-kill anything past the 5h retention window regardless of capacity
  for (const [code, s] of sessions) {
    if (!s.terminated && isExpired(s)) expireSession(s);
    if (s.terminated && now - s.lastActivity > 60_000) {
      sessions.delete(code);
      presence.delete(code);
    }
  }
  if (sessions.size <= MAX_SESSIONS) return;
  // drop the least recently active sessions (terminated first)
  const entries = [...sessions.values()].sort((a, b) => {
    if (a.terminated !== b.terminated) return a.terminated ? -1 : 1;
    return a.lastActivity - b.lastActivity;
  });
  const excess = sessions.size - MAX_SESSIONS;
  for (let i = 0; i < excess; i++) {
    sessions.delete(entries[i].code);
    presence.delete(entries[i].code);
  }
}

/**
 * 5h retention enforcement: burn the ENTIRE transcript + key envelopes +
 * photos, drop the roster, then soft-terminate so every member's next poll
 * learns the room is gone and wipes its local copy too.
 */
function expireSession(s: SessionRec) {
  s.messages = [];
  s.envelopes = [];
  s.photos = [];
  s.keyRequests = new Map();
  s.participants = new Map();
  s.terminated = true;
  s.expired = true;
  s.lastActivity = Date.now();
}

// ----------------------------------------------------------------- queries

function getSession(code: string): SessionRec | null {
  if (!CODE_RE.test(code)) return null;
  const s = sessions.get(code) ?? null;
  if (s && !s.terminated) {
    if (isExpired(s)) {
      expireSession(s);
      return s; // still addressable this tick so clients learn "expired"
    }
    gcSession(s);
  }
  return s;
}

export function isExpiredSession(code: string): boolean {
  return sessions.get(code)?.expired ?? false;
}

/** Age metadata for countdown UIs (all ISO strings). */
export function sessionMeta(code: string): { createdAt: string; expiresAt: string } | null {
  const s = sessions.get(code);
  if (!s) return null;
  return {
    createdAt: s.createdAt.toISOString(),
    expiresAt: new Date(s.createdAt.getTime() + SESSION_TTL_MS).toISOString(),
  };
}

export function sessionExists(code: string): boolean {
  return getSession(code) !== null;
}

/**
 * Create the session if absent. `creatorFp` binds the provisioning device as
 * the room's creator (H3): only the creator — or an attested boss — may
 * terminate the room later. When an existing room has no bound creator (a
 * pre-upgrade room, or a re-provision after a cold restart) the first
 * creator-style re-assert adopts it; an EXISTING creator is never replaced.
 */
export function provisionSession(
  code: string,
  opts: { creatorFp?: string } = {}
): { created: boolean } {
  if (!CODE_RE.test(code)) throw new Error("Bad code");
  gcGlobal();
  const existing = sessions.get(code);
  if (existing && !existing.terminated) {
    if (existing.creatorFp === null && opts.creatorFp) {
      existing.creatorFp = opts.creatorFp;
    }
    existing.lastActivity = Date.now();
    return { created: false };
  }
  sessions.set(code, {
    code,
    createdAt: new Date(),
    creatorFp: opts.creatorFp ?? null,
    participants: new Map(),
    messages: [],
    envelopes: [],
    photos: [],
    keyRequests: new Map(),
    terminated: false,
    expired: false,
    lastActivity: Date.now(),
  });
  return { created: true };
}

/** The room's creator (or null when unbound). */
export function sessionCreator(code: string): string | null {
  return sessions.get(code)?.creatorFp ?? null;
}

/** Bind a creator to an existing room that has none (idempotent). */
export function adoptCreator(code: string, fingerprint: string): boolean {
  const s = sessions.get(code);
  if (!s || s.creatorFp !== null) return false;
  s.creatorFp = fingerprint;
  return true;
}

export function deleteSession(code: string): boolean {
  const s = sessions.get(code);
  if (!s) return false;
  sessions.delete(code);
  presence.delete(code);
  return true;
}

/**
 * Soft-terminate: the room stays addressable so EVERY member's next poll
 * learns `terminated: true` and evicts itself, then the record is reaped.
 */
export function terminateSession(code: string): boolean {
  const s = getSession(code);
  if (!s) return false;
  s.terminated = true;
  s.expired = false; // user-initiated delete, not the retention window
  s.lastActivity = Date.now();
  return true;
}

export function isTerminated(code: string): boolean {
  return sessions.get(code)?.terminated ?? false;
}

/** True when this fingerprint holds a bound slot in the room (posting gate). */
export function isParticipant(code: string, fingerprint: string): boolean {
  if (!FP_RE.test(fingerprint)) return false;
  return sessions.get(code)?.participants.has(fingerprint) ?? false;
}

/**
 * Manually enforce the retention window (used by the sync route on every
 * mutation so expiry never depends on gc timing).
 */
export function enforceTtl(code: string): void {
  const s = sessions.get(code);
  if (s && !s.terminated && isExpired(s)) expireSession(s);
}

/**
 * Register (or re-assert) a participant.
 *
 * M2 HARDENING — participant slots are WRITE-ONCE for key material:
 *   - the ECDH public key and the signing public key of a slot are set by
 *     the FIRST join only; later joins presenting different keys are denied
 *     (the stored keys stay, the request is refused) — a hijacker can no
 *     longer silently substitute a victim's key material. Legitimate
 *     clients never hit this: fingerprints and keys rotate together every
 *     reload (a fresh tab is a fresh identity).
 *   - nickname/role come only from a verified server attestation and may
 *     refresh freely — they are display data, not trust anchors.
 */
export function upsertParticipant(
  code: string,
  fingerprint: string,
  publicKey: string,
  opts: { nickname?: string; role?: string; signPub?: string } = {}
): { ok: boolean; reason?: "key-conflict" } {
  if (!FP_RE.test(fingerprint) || typeof publicKey !== "string" || publicKey.length === 0 || publicKey.length > 512) {
    return { ok: false };
  }
  const s = getSession(code);
  if (!s) return { ok: false };
  const existing = s.participants.get(fingerprint);
  if (existing) {
    if (existing.publicKey !== publicKey) return { ok: false, reason: "key-conflict" };
    if (opts.signPub !== undefined && existing.signPub !== null && existing.signPub !== opts.signPub) {
      return { ok: false, reason: "key-conflict" };
    }
    if (existing.signPub === null && typeof opts.signPub === "string") {
      existing.signPub = opts.signPub;
    }
    if (typeof opts.nickname === "string" && opts.nickname.length > 0 && opts.nickname.length <= 32) {
      existing.nickname = opts.nickname;
      existing.role = opts.role === "boss" ? "boss" : "member";
    }
  } else {
    s.participants.set(fingerprint, {
      publicKey,
      signPub: typeof opts.signPub === "string" ? opts.signPub : null,
      nickname: typeof opts.nickname === "string" && opts.nickname.length > 0 ? opts.nickname.slice(0, 32) : "",
      role: opts.role === "boss" ? "boss" : "member",
      joinedAt: new Date(),
    });
  }
  s.lastActivity = Date.now();
  return { ok: true };
}

export type RosterEntry = {
  fingerprint: string;
  publicKey: string;
  /** signing public key (write-once; null for pre-upgrade slots) */
  signPub: string | null;
  nickname: string;
  role: string;
  joinedAt: string;
};

export function listParticipants(code: string): RosterEntry[] {
  const s = getSession(code);
  if (!s) return [];
  return [...s.participants.entries()]
    .sort((a, b) => a[1].joinedAt.getTime() - b[1].joinedAt.getTime())
    .map(([fingerprint, p]) => ({
      fingerprint,
      publicKey: p.publicKey,
      signPub: p.signPub,
      nickname: p.nickname,
      role: p.role,
      joinedAt: p.joinedAt.toISOString(),
    }));
}

// ---------------------------------------------------------------- presence

export function touchPresence(code: string, fingerprint: string): string[] {
  const now = Date.now();
  let room = presence.get(code);
  if (!room) {
    room = new Map();
    presence.set(code, room);
  }
  room.set(fingerprint, now);
  // reap stale entries opportunistically
  for (const [fp, at] of room) {
    if (now - at > PRESENCE_TTL_MS * 3) room.delete(fp);
  }
  const live: string[] = [];
  for (const [fp, at] of room) {
    if (now - at <= PRESENCE_TTL_MS && !live.includes(fp)) live.push(fp);
  }
  return live;
}

export function dropPresence(code: string, fingerprint: string) {
  presence.get(code)?.delete(fingerprint);
}

// ---------------------------------------------------------------- messages

export function addMessage(
  code: string,
  blob: Omit<WireBlob, "createdAt"> & { createdAt?: string }
): WireBlob | null {
  const s = getSession(code);
  if (!s) return null;
  const rec: WireBlob & { seq: number } = {
    id: blob.id,
    senderFp: blob.senderFp,
    counter: blob.counter,
    iv: blob.iv,
    ciphertext: blob.ciphertext,
    sig: typeof blob.sig === "string" && blob.sig.length > 0 ? blob.sig : undefined,
    createdAt: blob.createdAt ?? new Date().toISOString(),
    seq: nextSeq(),
  };
  // idempotent by id (client retries must not duplicate)
  if (s.messages.some((m) => m.id === rec.id)) {
    return s.messages.find((m) => m.id === rec.id) ?? null;
  }
  s.messages.push(rec);
  s.lastActivity = Date.now();
  gcSession(s);
  return rec;
}

export function listMessages(code: string, sinceSeq: number): (WireBlob & { seq: number })[] {
  const s = getSession(code);
  if (!s) return [];
  return s.messages.filter((m) => m.seq > sinceSeq);
}

export function headSeq(code: string): { msg: number; env: number; photo: number } {
  const s = getSession(code);
  return {
    msg: s ? Math.max(0, ...s.messages.map((m) => m.seq)) : 0,
    env: s ? Math.max(0, ...s.envelopes.map((e) => e.seq)) : 0,
    photo: s ? Math.max(0, ...s.photos.map((p) => p.seq)) : 0,
  };
}

// --------------------------------------------------------------- envelopes

export function addEnvelope(
  code: string,
  blob: { forFp: string; fromFp: string; epk: string; iv: string; payload: string }
): EnvelopeBlob | null {
  const s = getSession(code);
  if (!s) return null;
  const rec: EnvelopeBlob & { seq: number } = {
    id: `k${nextSeq()}`,
    forFp: blob.forFp,
    fromFp: blob.fromFp,
    epk: blob.epk,
    iv: blob.iv,
    payload: blob.payload,
    createdAt: new Date().toISOString(),
    seq: seqCounter,
  };
  s.envelopes.push(rec);
  s.lastActivity = Date.now();
  gcSession(s);
  return rec;
}

export function listEnvelopes(code: string, forFp: string, sinceSeq: number): (EnvelopeBlob & { seq: number })[] {
  const s = getSession(code);
  if (!s) return [];
  return s.envelopes.filter((e) => e.forFp === forFp && e.seq > sinceSeq);
}

// ------------------------------------------------------------- key requests

export function addKeyRequest(code: string, fingerprint: string): boolean {
  const s = getSession(code);
  if (!s) return false;
  s.keyRequests.set(fingerprint, Date.now());
  return true;
}

export function listKeyRequests(code: string): string[] {
  const s = getSession(code);
  if (!s) return [];
  const now = Date.now();
  const out: string[] = [];
  for (const [fp, at] of s.keyRequests) {
    if (now - at <= KEY_REQUEST_TTL_MS) out.push(fp);
  }
  return out;
}

// ------------------------------------------------------------------ photos

export function addPhoto(
  code: string,
  blob: { id: string; senderFp: string; counter: number; iv: string; data: string }
): PhotoBlob | null {
  const s = getSession(code);
  if (!s) return null;
  const rec: PhotoBlob & { seq: number } = {
    ...blob,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + PHOTO_TTL_MS,
    seq: nextSeq(),
  };
  s.photos.push(rec);
  s.lastActivity = Date.now();
  gcSession(s);
  return rec;
}

export function listPhotos(code: string, sinceSeq: number): (PhotoBlob & { seq: number })[] {
  const s = getSession(code);
  if (!s) return [];
  const now = Date.now();
  return s.photos.filter((p) => p.seq > sinceSeq && p.expiresAt > now);
}

/** Strip volatile fields for the wire. */
export const toWire = {
  message: (m: WireBlob & { seq: number }): WireBlob => ({
    id: m.id,
    senderFp: m.senderFp,
    counter: m.counter,
    iv: m.iv,
    ciphertext: m.ciphertext,
    ...(m.sig ? { sig: m.sig } : {}),
    createdAt: m.createdAt,
  }),
  envelope: (e: EnvelopeBlob & { seq: number }): EnvelopeBlob & { fromFp: string } => ({
    id: e.id,
    forFp: e.forFp,
    fromFp: e.fromFp,
    epk: e.epk,
    iv: e.iv,
    payload: e.payload,
    createdAt: e.createdAt,
  }),
  photo: (p: PhotoBlob & { seq: number }): Omit<PhotoBlob, "expiresAt"> => ({
    id: p.id,
    senderFp: p.senderFp,
    counter: p.counter,
    iv: p.iv,
    data: p.data,
    createdAt: p.createdAt,
  }),
};
