import { createHash, createHmac, timingSafeEqual } from "crypto";

/**
 * Layer 4/5 (application slice): in-process sliding-window rate limiter.
 * This is the code-level counterpart of a perimeter WAF rule set — it throttles
 * brute-force attempts on the gate and socket-flood-style API abuse per IP.
 * (Full OWASP Coraza/Nginx + Wazuh sit at the deployment edge in production.)
 */

const buckets = new Map<string, number[]>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    const retryAfter = Math.ceil((windowMs - (now - hits[0])) / 1000);
    buckets.set(key, hits);
    return { ok: false, retryAfter };
  }
  hits.push(now);
  buckets.set(key, hits);

  // opportunistic GC to keep the map bounded
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }
  return { ok: true, retryAfter: 0 };
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

/** Constant-time passcode verification (hash both sides first so lengths never leak). */
export function verifyPasscode(candidate: string): boolean {
  const expected = process.env.GATE_PASSCODE ?? "187";
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * The BOSS key ("DRACH" callsign). Verified in constant time against the
 * DRACH_KEY env (default "BIGBOSS27"). Hashing both sides first means the
 * comparison never leaks length or prefix content.
 */
export function verifyDrachKey(candidate: string): boolean {
  const expected = process.env.DRACH_KEY ?? "BIGBOSS27";
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// ------------------------------------------------------------------ lockout
// Escalating lockout for the gate: repeated failures per IP trip a hard cool-
// down that no successful attempt inside the window can shorten. This is the
// brute-force backstop behind the sliding-window rate limiter.
type FailRec = { count: number; first: number; lockedUntil: number };
const failures = new Map<string, FailRec>();
const FAIL_WINDOW_MS = 10 * 60_000;
const FAIL_MAX = 8;
const LOCKOUT_MS = 10 * 60_000;

export function gateLockState(ip: string): { locked: boolean; retryAfter: number } {
  const rec = failures.get(ip);
  if (!rec) return { locked: false, retryAfter: 0 };
  const now = Date.now();
  if (rec.lockedUntil > now) {
    return { locked: true, retryAfter: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  if (now - rec.first > FAIL_WINDOW_MS) {
    failures.delete(ip); // window elapsed without a lockout — fresh start
  }
  return { locked: false, retryAfter: 0 };
}

export function registerGateFailure(ip: string): void {
  const now = Date.now();
  const rec = failures.get(ip);
  if (!rec || now - rec.first > FAIL_WINDOW_MS) {
    failures.set(ip, { count: 1, first: now, lockedUntil: 0 });
    return;
  }
  rec.count += 1;
  if (rec.count >= FAIL_MAX) {
    rec.lockedUntil = now + LOCKOUT_MS;
  }
}

export function clearGateFailures(ip: string): void {
  failures.delete(ip);
}

// opportunistic GC so the failure map stays bounded
const failGc = setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of failures) {
    if (rec.lockedUntil < now && now - rec.first > FAIL_WINDOW_MS) failures.delete(ip);
  }
}, 60_000);
failGc.unref?.();

// ------------------------------------------------------------- attestation
// Callsign attestation — the anti-impersonation layer for nicknames.
//
// Every route on serverless runs in its OWN lambda with its OWN module
// memory, so the identity registry cannot be consulted from the chat sync
// or presence routes. Instead, a successful callsign registration returns a
// signed attestation token: HMAC(fp|nickname|role|exp, server secret). Any
// route can verify it with the shared env secret — meaning "DRACH"/boss
// display material is unforgeable without the boss key, and a random
// client cannot join a room claiming a callsign it never registered.

const ATTEST_TTL_MS = 24 * 60 * 60 * 1000; // 24h — clients re-assert every app entry

function attestSecret(): string {
  // deployment secret; the default keeps self-host/dev working out of the box
  return process.env.FAST_ATTEST_SECRET ?? "fast-attest-dev-187-do-not-ship-to-prod";
}

/** Mint an attestation for a freshly verified callsign. */
export function signAttestation(fp: string, nickname: string, role: string): string {
  const exp = Date.now() + ATTEST_TTL_MS;
  const payload = `${fp}|${nickname}|${role}|${exp}`;
  const sig = createHmac("sha256", attestSecret()).update(payload).digest("base64url");
  const body = Buffer.from(payload).toString("base64url");
  return `${body}.${sig}`;
}

/**
 * Verify an attestation against a fingerprint. Returns the attested
 * { nickname, role } or null (bad sig, wrong fp, expired).
 */
export function verifyAttestation(
  token: unknown,
  fp: string
): { nickname: string; role: string } | null {
  if (typeof token !== "string" || token.length === 0 || token.length > 1024) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const bodyB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(bodyB64, "base64url").toString();
  } catch {
    return null;
  }
  const expected = createHmac("sha256", attestSecret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const parts = payload.split("|");
  if (parts.length !== 4) return null;
  const [tokFp, nickname, role, exp] = parts;
  if (tokFp !== fp || !nickname || !role) return null;
  if (!Number.isFinite(Number(exp)) || Date.now() > Number(exp)) return null;
  return { nickname: nickname.slice(0, 24), role: role === "boss" ? "boss" : "member" };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
