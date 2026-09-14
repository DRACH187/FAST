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

type SessionRec = {
  code: string;
  createdAt: Date;
  participants: Map<string, { publicKey: string; nickname: string; role: string; joinedAt: Date }>;
  messages: (WireBlob & { seq: number })[];
  envelopes: (EnvelopeBlob & { seq: number })[];
  photos: (PhotoBlob & { seq: number })[];
  keyRequests: Map<string, number>; // fp -> requested-at ms
  terminated: boolean;
  /** true once the 5h retention window elapsed — distinct from user delete */
  expired: boolean;
  lastActivity: number;
};

// code -> session
const sessions = new Map<string, SessionRec>();
// code -> (fp -> lastSeen ms) — ephemeral presence, never persisted
const presence = new Map<string, Map<string, number>>();

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
 * Create the session if absent. Returns the record plus whether it was newly
 * provisioned (used by the creator's self-healing sync so a cold serverless
 * restart can never strand a room).
 */
export function provisionSession(code: string): { created: boolean } {
  if (!CODE_RE.test(code)) throw new Error("Bad code");
  gcGlobal();
  const existing = sessions.get(code);
  if (existing && !existing.terminated) {
    existing.lastActivity = Date.now();
    return { created: false };
  }
  sessions.set(code, {
    code,
    createdAt: new Date(),
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

/**
 * Manually enforce the retention window (used by the sync route on every
 * mutation so expiry never depends on gc timing).
 */
export function enforceTtl(code: string): void {
  const s = sessions.get(code);
  if (s && !s.terminated && isExpired(s)) expireSession(s);
}

export function upsertParticipant(
  code: string,
  fingerprint: string,
  publicKey: string,
  nickname?: string,
  role?: string
): boolean {
  if (!FP_RE.test(fingerprint) || typeof publicKey !== "string" || publicKey.length === 0 || publicKey.length > 512) {
    return false;
  }
  const s = getSession(code);
  if (!s) return false;
  const existing = s.participants.get(fingerprint);
  if (existing) {
    existing.publicKey = publicKey;
    if (typeof nickname === "string" && nickname.length > 0 && nickname.length <= 32) {
      existing.nickname = nickname;
      existing.role = role === "boss" ? "boss" : "member";
    }
  } else {
    s.participants.set(fingerprint, {
      publicKey,
      nickname: typeof nickname === "string" && nickname.length > 0 ? nickname.slice(0, 32) : "",
      role: role === "boss" ? "boss" : "member",
      joinedAt: new Date(),
    });
  }
  s.lastActivity = Date.now();
  return true;
}

export type RosterEntry = {
  fingerprint: string;
  publicKey: string;
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

export function addMessage(code: string, blob: Omit<WireBlob, "createdAt"> & { createdAt?: string }): WireBlob | null {
  const s = getSession(code);
  if (!s) return null;
  const rec: WireBlob & { seq: number } = {
    id: blob.id,
    senderFp: blob.senderFp,
    counter: blob.counter,
    iv: blob.iv,
    ciphertext: blob.ciphertext,
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
