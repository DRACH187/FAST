/**
 * NOOI-STRINGS — signed, expiring, burn-on-use invite capability (RAM only)
 * ========================================================================
 * "Allow inviting people with a secure string."
 *
 * A nooi-string is a self-contained, HMAC-signed capability that opens ONE
 * door: it carries the 6-letter room code and an expiry, and it is verified
 * server-side in constant time. It NEVER carries the session key — the E2EE
 * law holds: every newcomer still gets the key wrapped from a member's
 * device, oog tot oog, or sees fokol.
 *
 *   FG187.<base64url(code|exp|nonce|maxUses)>.<base64url(HMAC-SHA256)>
 *
 * WHAT IS STORED: nonce -> { code, exp, maxUses, uses, minterFp, createdAt }.
 * No IPs, no nicknames, no ciphertext. Redemption burns a use; `maxUses`
 * reached deletes the row. Every string dies on its own expiry, with the
 * room, or the moment the boss/creator revokes the code's strings — and of
 * course with the process itself. RAM only, zero persistence.
 *
 * Abuse control: forged signatures and mangled strings are counted (boss
 * panel) and feed the room-probe tarpit from the redeem route. Mints are
 * rate-limited at the route and bounded by the table cap below.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import { attestSecret } from "@/lib/server-env";

export const INVITE_PREFIX = "FG187.";

export type InviteRec = {
  code: string;
  exp: number;
  maxUses: number;
  uses: number;
  minterFp: string;
  createdAt: number;
};

/* globalThis pinning: one table per process, shared across route modules —
   same law as every other FAST table. */
const g = globalThis as unknown as {
  __fastInvites?: Map<string, InviteRec>;
  __fastInvRedeemed?: number;
  __fastInvForged?: number;
};
const table: Map<string, InviteRec> = g.__fastInvites ?? new Map<string, InviteRec>();
g.__fastInvites = table;
const redeemed = (): number => (g.__fastInvRedeemed ?? 0);
const forged = (): number => (g.__fastInvForged ?? 0);

const MAX_INVITES = 400;
export const MIN_TTL_MIN = 5;
export const MAX_TTL_MIN = 300;
export const MIN_USES = 1;
export const MAX_USES = 25;

const CODE_RE = /^[A-Z]{6}$/;
const FP_RE = /^[a-f0-9]{8,64}$/;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.floor(Number(n) || lo)));
}

function sweep(now: number = Date.now()): void {
  for (const [nonce, rec] of table) {
    if (now > rec.exp) table.delete(nonce);
  }
}

function sign(payload: string): string {
  return createHmac("sha256", attestSecret()).update(payload).digest("base64url");
}

/** Constant-time string compare over digests (length-safe). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function registerForged(): void {
  g.__fastInvForged = forged() + 1;
}

function registerRedeemed(): void {
  g.__fastInvRedeemed = redeemed() + 1;
}

// ------------------------------------------------------------------- mint

export type MintOpts = { ttlMinutes?: number; maxUses?: number };

/**
 * Mint a signed invite string for a room. `minterFp` is recorded for
 * counting/abuse shaping only — it never leaves the process.
 */
export function mintInvite(
  code: string,
  minterFp: string,
  opts: MintOpts = {}
): { invite: string; expiresAt: number } {
  if (!CODE_RE.test(code) || !FP_RE.test(minterFp)) throw new Error("Bad invite request");
  sweep();

  // capacity: drop the soonest-dying strings first — fresh work beats stale
  if (table.size >= MAX_INVITES) {
    const doomed = [...table.entries()].sort((a, b) => a[1].exp - b[1].exp)[0];
    if (doomed) table.delete(doomed[0]);
  }

  const exp = Date.now() + clamp(opts.ttlMinutes ?? 240, MIN_TTL_MIN, MAX_TTL_MIN) * 60_000;
  const maxUses = clamp(opts.maxUses ?? MIN_USES, MIN_USES, MAX_USES);
  const nonce = randomHex(12); // 24 hex chars — collision-proof for this scale
  const payload = `${code}|${exp}|${nonce}|${maxUses}`;
  const body = Buffer.from(payload, "utf8").toString("base64url");
  const invite = `${INVITE_PREFIX}${body}.${sign(`fginv.v1|${payload}`)}`;

  table.set(nonce, { code, exp, maxUses, uses: 0, minterFp, createdAt: Date.now() });
  return { invite, expiresAt: exp };
}

// ----------------------------------------------------------------- redeem

export type RedeemReason = "bad" | "expired" | "burned" | "dead";
export type RedeemResult =
  | { ok: true; code: string; usesLeft: number }
  | { ok: false; reason: RedeemReason };

/**
 * Verify + consume one use of an invite string.
 * `roomAlive` lets the caller veto the burn when the room behind the string
 * is already gone (a dead room should not cost the holder a use).
 * Signature failures and mangled strings count as forged (boss panel +
 * route-side tarpit); authentic-but-stale strings get honest reasons.
 */
export function redeemInvite(
  raw: string,
  roomAlive: (code: string) => boolean = () => true
): RedeemResult {
  sweep();
  const s = (typeof raw === "string" ? raw : "").trim();
  if (!s.startsWith(INVITE_PREFIX)) {
    registerForged();
    return { ok: false, reason: "bad" };
  }
  const rest = s.slice(INVITE_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0 || dot === rest.length - 1) {
    registerForged();
    return { ok: false, reason: "bad" };
  }
  const body = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    registerForged();
    return { ok: false, reason: "bad" };
  }
  if (!safeEqual(sig, sign(`fginv.v1|${payload}`))) {
    registerForged();
    return { ok: false, reason: "bad" };
  }

  const parts = payload.split("|");
  if (parts.length !== 4) {
    registerForged();
    return { ok: false, reason: "bad" };
  }
  const [code, expS, nonce, usesS] = parts;
  const exp = Number(expS);
  const maxUses = Number(usesS);
  if (!CODE_RE.test(code) || !Number.isFinite(exp) || !Number.isFinite(maxUses) || nonce.length < 8) {
    registerForged();
    return { ok: false, reason: "bad" };
  }

  const rec = table.get(nonce);
  if (!rec || rec.code !== code || rec.exp !== exp || rec.maxUses !== maxUses) {
    // revoked or swept: authentic string, but the house killed it
    return { ok: false, reason: "expired" };
  }
  if (Date.now() > rec.exp) {
    table.delete(nonce);
    return { ok: false, reason: "expired" };
  }
  if (!roomAlive(code)) {
    return { ok: false, reason: "dead" };
  }
  if (rec.uses >= rec.maxUses) {
    table.delete(nonce);
    return { ok: false, reason: "burned" };
  }

  rec.uses += 1;
  registerRedeemed();
  const usesLeft = Math.max(0, rec.maxUses - rec.uses);
  // NOTE: a burned-out row STAYS in the table until its expiry so further
  // redemption attempts get the honest "burned" answer (not "expired").
  return { ok: true, code, usesLeft };
}

// ----------------------------------------------------------------- revoke

/** Kill every live string for a room (creator/boss move). Returns the count. */
export function revokeInvites(code: string): number {
  if (!CODE_RE.test(code)) return 0;
  let killed = 0;
  for (const [nonce, rec] of table) {
    if (rec.code === code) {
      table.delete(nonce);
      killed += 1;
    }
  }
  return killed;
}

// ------------------------------------------------------------------ stats

/** Boss panel feed — counts only, as always. */
export function inviteStats(): { active: number; redemptions: number; forged: number } {
  sweep();
  return { active: table.size, redemptions: redeemed(), forged: forged() };
}
