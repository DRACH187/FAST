/**
 * FAST — global identity registry + site-wide live presence (RAM only)
 * ====================================================================
 * Three process-wide tables, all strictly operational:
 *
 *  1. CALLSIGNS  fingerprint -> { nickname, role }
 *  2. OWNERS     lowercased nickname -> { fp, passHash, role }
 *     Devices rotate fingerprints on every reload (ephemeral keys are
 *     RAM-only by design), so ownership is NOT bound to a fingerprint: the
 *     first registration mints a random NICK PASS (returned once, stored by
 *     the client). Re-registering from a rotated fingerprint requires that
 *     pass — possession transfers ownership. The pass is a device-local
 *     display secret; chat keys remain RAM-only. "DRACH" additionally
 *     requires the boss key on first claim (verified constant-time server
 *     side).
 *  3. LIVE       fingerprint -> { nickname, role, since, lastSeen }
 *
 * Serverless reality: per-warm-instance state exactly like the chat memory
 * store. Clients re-assert their callsign on every app entry and heartbeat
 * while active, so a cold restart self-heals within seconds.
 */

import { createHash } from "crypto";

const FP_RE = /^[a-f0-9]{8,64}$/;

export type Role = "member" | "boss";

export type CallsignRec = { nickname: string; role: Role; updatedAt: number };
export type LiveRec = { nickname: string; role: Role; since: number; lastSeen: number };
type Owner = { fp: string; passHash: string; role: Role };

const callsigns = new Map<string, CallsignRec>(); // fp -> record
const nicknameOwner = new Map<string, Owner>(); // lowercased nickname -> owner
const live = new Map<string, LiveRec>(); // fp -> heartbeat

/** Presence heartbeat freshness window (site-wide "online" definition). */
export const LIVE_TTL_MS = 25_000;
const MAX_CALLSIGNS = 2000;
const MAX_LIVE = 2000;

// ------------------------------------------------------------------ helpers

/** Server-side nickname normalisation — mirrors the client's rules. */
export function normalizeNickname(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const nick = raw
    .replace(/[\u0000-\u001F\u007F]/g, "") // control chars out
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 16);
  if (nick.length < 2) return null;
  if (!/^[a-zA-Z0-9 _.\-]+$/.test(nick)) return null; // no homoglyph tricks
  return nick;
}

export function isFingerprint(v: unknown): v is string {
  return typeof v === "string" && FP_RE.test(v);
}

function hashPass(p: string): string {
  return createHash("sha256").update(`fast-nick-pass:${p}`).digest("hex");
}

function mintNickPass(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

// ---------------------------------------------------------------- callsigns

export type RegisterResult =
  | { ok: true; nickname: string; role: Role; nickPass?: string }
  | { ok: false; error: string; status: number };

/**
 * Register (or re-assert) a callsign for a device fingerprint.
 * `isBossKey` = the caller already verified the boss key in constant time.
 * `nickPass` = ownership proof for re-claims from a rotated fingerprint.
 */
export function registerCallsign(
  fingerprint: string,
  nickname: string,
  isBossKey: boolean,
  nickPass?: string
): RegisterResult {
  // gc before capacity checks
  const now = Date.now();
  if (callsigns.size > MAX_CALLSIGNS) {
    for (const [fp, rec] of callsigns) {
      if (now - rec.updatedAt > 24 * 60 * 60_000) {
        callsigns.delete(fp);
      }
    }
  }

  const key = nickname.toLowerCase();
  const reserved = key === "drach";
  const role: Role = reserved ? "boss" : "member";
  const owner = nicknameOwner.get(key);
  const passOk =
    typeof nickPass === "string" &&
    nickPass.length > 0 &&
    nickPass.length <= 128 &&
    owner !== undefined &&
    hashPass(nickPass) === owner.passHash;

  if (!owner) {
    // first claim
    if (reserved && !isBossKey) {
      return { ok: false, error: "This callsign is protected. Boss key required.", status: 403 };
    }
    const pass = mintNickPass();
    nicknameOwner.set(key, { fp: fingerprint, passHash: hashPass(pass), role });
    callsigns.set(fingerprint, { nickname, role, updatedAt: now });
    mirrorLive(fingerprint, nickname, role);
    return { ok: true, nickname, role, nickPass: pass };
  }

  if (owner.fp !== fingerprint && !passOk && !(reserved && isBossKey)) {
    // (reserved && isBossKey) = the boss key itself re-claims the callsign
    return {
      ok: false,
      error: reserved
        ? "This callsign is protected. Boss key required."
        : "That callsign is already taken.",
      status: reserved ? 403 : 409,
    };
  }

  // owner proof accepted (same fingerprint, or rotated fingerprint + pass)
  owner.fp = fingerprint;
  owner.role = role;
  callsigns.set(fingerprint, { nickname, role, updatedAt: now });
  mirrorLive(fingerprint, nickname, role);
  return { ok: true, nickname, role };
}

function mirrorLive(fp: string, nickname: string, role: Role): void {
  const liveRec = live.get(fp);
  if (liveRec) {
    liveRec.nickname = nickname;
    liveRec.role = role;
  }
}

/** Batch lookup: fingerprints -> { nickname, role } (missing fps omitted). */
export function lookupCallsigns(fps: string[]): Record<string, { nickname: string; role: Role }> {
  const out: Record<string, { nickname: string; role: Role }> = {};
  for (const fp of fps) {
    if (!FP_RE.test(fp)) continue;
    const rec = callsigns.get(fp);
    if (rec) out[fp] = { nickname: rec.nickname, role: rec.role };
  }
  return out;
}

// --------------------------------------------------------------------- live

/** Heartbeat: upsert the device into the site-wide live table. */
export function heartbeat(fingerprint: string, nickname: string, role: Role): void {
  const now = Date.now();
  const existing = live.get(fingerprint);
  live.set(fingerprint, {
    nickname,
    role,
    since: existing && now - existing.lastSeen <= LIVE_TTL_MS * 2 ? existing.since : now,
    lastSeen: now,
  });

  // keep the table bounded — evict coldest entries past capacity
  if (live.size > MAX_LIVE) {
    const entries = [...live.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    const excess = live.size - MAX_LIVE;
    for (let i = 0; i < excess; i++) live.delete(entries[i][0]);
  }
}

export type LiveEntry = { fp: string; nickname: string; role: Role; since: number };

/** Everyone heartbeating within the freshness window, longest-online first. */
export function listLive(): LiveEntry[] {
  const now = Date.now();
  const out: LiveEntry[] = [];
  for (const [fp, rec] of live) {
    if (now - rec.lastSeen > LIVE_TTL_MS) {
      live.delete(fp);
      continue;
    }
    out.push({ fp, nickname: rec.nickname, role: rec.role, since: rec.since });
  }
  return out.sort((a, b) => a.since - b.since).slice(0, 200);
}

export function dropLive(fingerprint: string): void {
  live.delete(fingerprint);
}
