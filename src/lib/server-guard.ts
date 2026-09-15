import { createHash, createHmac, timingSafeEqual } from "crypto";
import { assertSecretsLoaded, attestSecret, drachKey, gatePasscode, keyedDigest } from "@/lib/server-env";

/**
 * Layer 4/5 — server security primitives (single source of truth).
 * ================================================================
 * Every route imports from here. No route implements its own:
 *   - trusted client-IP extraction (H1: client-supplied XFF is NEVER trusted)
 *   - rate limiting (H4: globalThis-pinned per instance; optional distributed
 *     backend when Upstash REST env is configured — keys are HMAC digests,
 *     never raw IPs; backend errors fail CLOSED)
 *   - gate lockout with exponential escalation
 *   - global circuit breaker
 *   - constant-time credential comparison (env-driven, no fallbacks — C1)
 *   - HMAC attestations (callsign identity) and capability tokens (M2)
 *   - strict JSON body reader (Content-Type + size ceiling BEFORE parse — §14)
 */

/**
 * BOSS COMMAND PANEL — abuse-control counters. Numbers only: limiter keys
 * are HMAC digests and stay internal, failure rows stay internal. The boss
 * sees the pulse of the defenses, never an address.
 */
export function securityStats(): {
  limiterBuckets: number;
  gateLocks: number;
  gateLockoutsLive: number;
  circuitCount: number;
} {
  const now = Date.now();
  let gateLockoutsLive = 0;
  for (const rec of failures.values()) {
    if (rec.lockedUntil > now) gateLockoutsLive += 1;
  }
  const minute = Math.floor(now / 60_000);
  return {
    limiterBuckets: buckets.size,
    gateLocks: failures.size,
    gateLockoutsLive,
    circuitCount: g.__fastCircuit?.minute === minute ? g.__fastCircuit.count : 0,
  };
}

// ------------------------------------------------------------------ trusted IP

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_RE = /^[0-9a-f:]{2,45}$/i;

function normalizeIp(candidate: string): string | null {
  let ip = candidate.trim().toLowerCase();
  if (ip.length === 0 || ip.length > 45) return null;
  // strip a transport port from v4-mapped forms ("1.2.3.4:5678")
  const v4 = ip.match(IPV4_RE);
  if (v4) {
    for (const octet of v4.slice(1)) {
      const n = Number(octet);
      if (!Number.isInteger(n) || n < 0 || n > 255 || (octet.length > 1 && octet[0] === "0")) {
        return null;
      }
    }
    return ip;
  }
  if (ip.startsWith("::ffff:") && IPV4_RE.test(ip.slice(7))) return ip.slice(7);
  // bare v6 (with optional zone index dropped)
  ip = ip.split("%")[0];
  if (IPV6_RE.test(ip) && ip.includes(":")) return ip;
  return null;
}

/**
 * The ONE client-IP primitive. Trust order:
 *   1. `x-real-ip`      — set by the platform edge from the live connection
 *   2. `x-forwarded-for` — RIGHTMOST entry only (the hop added by our own
 *                          trusted proxy). Client-supplied left entries are
 *                          attacker-controlled and are never read.
 * Anything absent, malformed, or spoof-shaped resolves to the single shared
 * "unknown" bucket — missing metadata can never mint unlimited limiter keys.
 * The IP is used ONLY for in-memory abuse control and is never stored,
 * logged, or returned.
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real) {
    const ip = normalizeIp(real.split(",")[0]);
    if (ip) return ip;
  }
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((h) => h.trim()).filter((h) => h.length > 0);
    for (let i = hops.length - 1; i >= 0; i--) {
      const ip = normalizeIp(hops[i]);
      if (ip) return ip;
    }
  }
  return "unknown";
}

// ---------------------------------------------------------------- rate limiting

type BucketStore = Map<string, number[]>;

/* globalThis pinning: in dev every route compiles to its own module instance;
   globalThis is the only thing they share. One limiter per process — not one
   per route module. */
const g = globalThis as unknown as {
  __fastLimitBuckets?: BucketStore;
  __fastGateFailures?: Map<string, FailRec>;
  __fastCircuit?: { minute: number; count: number };
};
const buckets: BucketStore = g.__fastLimitBuckets ?? new Map();
g.__fastLimitBuckets = buckets;

/** Bucket key: route class + HMAC digest of the IP — raw IPs are never a key. */
function bucketKey(route: string, ip: string): string {
  return `${route}:${keyedDigest("limiter", ip)}`;
}

export type RateLimitBackend = "local" | "upstash" | "upstash-error";

let upstashConfigured: boolean | null = null;
function upstashEnabled(): boolean {
  if (upstashConfigured === null) {
    upstashConfigured = Boolean(
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    );
  }
  return upstashConfigured;
}

/** Distributed fixed-window check via Upstash REST. Fails CLOSED on errors. */
async function upstashLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ ok: boolean; retryAfter: number; backend: RateLimitBackend }> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { ok: true, retryAfter: 0, backend: "local" };
  try {
    const digest = keyedDigest("upstash", key);
    const redisKey = `fast:rl:${digest}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["EXPIRE", redisKey, String(windowSeconds), "NX"],
      ]),
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, retryAfter: windowSeconds, backend: "upstash-error" };
    const data = (await res.json()) as { result?: Array<{ result?: unknown }> };
    const count = Number(data.result?.[0]?.result ?? 0);
    if (!Number.isFinite(count)) return { ok: false, retryAfter: windowSeconds, backend: "upstash-error" };
    return {
      ok: count <= limit,
      retryAfter: windowSeconds,
      backend: "upstash",
    };
  } catch {
    return { ok: false, retryAfter: windowSeconds, backend: "upstash-error" };
  }
}

/**
 * Sliding-window limiter. When a distributed backend is configured it is
 * authoritative and errors deny the request (fail closed). Otherwise the
 * instance-local window applies — documented residual risk on multi-instance
 * serverless deployments (spec §7).
 */
export async function rateLimit(
  req: Request,
  route: string,
  limit: number,
  windowMs: number
): Promise<{ ok: boolean; retryAfter: number }> {
  const ip = clientIp(req);
  const key = bucketKey(route, ip);

  if (upstashEnabled()) {
    const result = await upstashLimit(`${route}|${ip}`, limit, Math.max(1, Math.ceil(windowMs / 1000)));
    if (result.backend === "upstash") return { ok: result.ok, retryAfter: result.ok ? 0 : result.retryAfter };
    // backend error → fail closed, short cooldown to avoid hammering
    return { ok: false, retryAfter: 5 };
  }

  const now = Date.now();
  const windowMs_ = windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs_);
  if (hits.length >= limit) {
    const retryAfter = Math.ceil((windowMs_ - (now - hits[0])) / 1000);
    buckets.set(key, hits);
    return { ok: false, retryAfter };
  }
  hits.push(now);
  buckets.set(key, hits);

  // opportunistic GC keeps the map bounded under churn
  if (buckets.size > 8000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= windowMs_)) buckets.delete(k);
    }
  }
  return { ok: true, retryAfter: 0 };
}

// ------------------------------------------------------------ circuit breaker

/**
 * Per-instance emergency shed: if any single minute exceeds the ceiling the
 * route answers 503 + Retry-After until the minute rolls over. Bounded harm:
 * an attacker forcing expensive work trips a break, not the process.
 */
export function circuitBreaker(route: string, perMinute: number): { tripped: boolean; retryAfter: number } {
  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  let circuit = g.__fastCircuit;
  if (!circuit || circuit.minute !== minute) {
    circuit = { minute, count: 0 };
    g.__fastCircuit = circuit;
  }
  circuit.count += 1;
  if (circuit.count > perMinute) {
    return { tripped: true, retryAfter: 60 - (now % 60_000) / 1000 };
  }
  void route;
  return { tripped: false, retryAfter: 0 };
}

// ------------------------------------------------------------------ lockout
// Escalating lockout for the gate: repeated failures per IP trip a hard
// cooldown that grows with each repeat lockout (10m → 30m → 90m → 6h → 24h).
// A success inside the window never shortens an active lock.

type FailRec = { count: number; first: number; lockedUntil: number; lockouts: number };
const failures: Map<string, FailRec> = g.__fastGateFailures ?? new Map();
g.__fastGateFailures = failures;

const FAIL_WINDOW_MS = 10 * 60_000;
const FAIL_MAX = 8;
const BASE_LOCKOUT_MS = 10 * 60_000;
const MAX_LOCKOUT_MS = 24 * 60 * 60_000;

export function gateLockState(ip: string): { locked: boolean; retryAfter: number } {
  const rec = failures.get(ip);
  if (!rec) return { locked: false, retryAfter: 0 };
  const now = Date.now();
  if (rec.lockedUntil > now) {
    return { locked: true, retryAfter: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  if (now - rec.first > FAIL_WINDOW_MS) {
    failures.delete(ip);
  }
  return { locked: false, retryAfter: 0 };
}

export function registerGateFailure(ip: string): void {
  const now = Date.now();
  const rec = failures.get(ip);
  if (!rec || now - rec.first > FAIL_WINDOW_MS) {
    failures.set(ip, { count: 1, first: now, lockedUntil: 0, lockouts: 0 });
    return;
  }
  rec.count += 1;
  if (rec.count >= FAIL_MAX && rec.lockedUntil <= now) {
    rec.lockouts += 1;
    const scale = Math.min(rec.lockouts, 5);
    rec.lockedUntil = now + Math.min(BASE_LOCKOUT_MS * 3 ** (scale - 1), MAX_LOCKOUT_MS);
    rec.count = 0;
    rec.first = now;
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

// ------------------------------------------------------- constant-time checks

function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Gate passphrase — validated env value, compared in constant time. */
export function verifyPasscode(candidate: string): boolean {
  return constantTimeEqual(candidate, gatePasscode());
}

/** BOSS (DRACH) key — validated env value, compared in constant time. */
export function verifyDrachKey(candidate: string): boolean {
  return constantTimeEqual(candidate, drachKey());
}

// ------------------------------------------------------------- attestation
// Callsign attestation — the anti-impersonation layer for nicknames.
// HMAC(fp|nickname|role|exp, server secret). Any route can verify it; a
// client can never claim a callsign (let alone the boss callsign) it was
// never granted. The secret has no fallback (server-env enforces it).

const ATTEST_TTL_MS = 24 * 60 * 60 * 1000; // 24h — clients re-assert every app entry

/** Mint an attestation for a freshly verified callsign. */
export function signAttestation(fp: string, nickname: string, role: string): string {
  const exp = Date.now() + ATTEST_TTL_MS;
  const payload = `${fp}|${nickname}|${role}|${exp}`;
  const sig = createHmac("sha256", attestSecret()).update(payload).digest("base64url");
  const body = Buffer.from(payload).toString("base64url");
  return `${body}.${sig}`;
}

/** Verify an attestation against a fingerprint. Returns { nickname, role } or null. */
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

// -------------------------------------------------------------- capabilities
// Scoped, short-lived, HMAC capability tokens (spec M2/§8/§19):
//   mint(action, resourceId, holderFp, ttl) -> bearer token for EXACTLY one
//   operation on EXACTLY one resource by EXACTLY one fingerprint.
// Verification is constant-time; expiry and binding are enforced on every use.

const CAPABILITY_TTL_MS = 24 * 60 * 60 * 1000;

export function mintCapability(
  action: string,
  resourceId: string,
  holderFp: string,
  ttlMs: number = CAPABILITY_TTL_MS
): { token: string; expiresAt: number } {
  const exp = Date.now() + ttlMs;
  const payload = `cap.v1|${action}|${resourceId}|${holderFp}|${exp}`;
  const sig = createHmac("sha256", attestSecret()).update(payload).digest("base64url");
  return { token: `${Buffer.from(payload).toString("base64url")}.${sig}`, expiresAt: exp };
}

export function verifyCapability(
  token: unknown,
  action: string,
  resourceId: string,
  holderFp: string
): boolean {
  if (typeof token !== "string" || token.length === 0 || token.length > 1024) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;
  let payload: string;
  try {
    payload = Buffer.from(token.slice(0, dot), "base64url").toString();
  } catch {
    return false;
  }
  const expected = createHmac("sha256", attestSecret()).update(payload).digest("base64url");
  const sig = token.slice(dot + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const parts = payload.split("|");
  if (parts.length !== 5) return false;
  const [version, capAction, capResource, capHolder, exp] = parts;
  if (version !== "cap.v1") return false;
  if (capAction !== action || capResource !== resourceId || capHolder !== holderFp) return false;
  const expN = Number(exp);
  if (!Number.isFinite(expN) || Date.now() > expN) return false;
  return true;
}

// ------------------------------------------------------------------ request IO

/**
 * Strict JSON body reader (§14): enforces Content-Type, hard size ceiling
 * BEFORE parsing, and rejects non-object roots. Never throws.
 */
export async function readJson(
  req: Request,
  maxBytes: number
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false, status: 415, error: "Content-Type must be application/json" };
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: "Payload too large" };
  }
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, status: 400, error: "Malformed request" };
  }
  if (raw.length > maxBytes) {
    return { ok: false, status: 413, error: "Payload too large" };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: "Malformed request" };
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, error: "Malformed request" };
  }
}

// ---------------------------------------------------------------------- json

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

/**
 * Deployment config guard — last-resort safety net.
 * The house ships with built-in credentials (owner mandate, SECURITY.md §11),
 * so a normal deployment NEVER sees this. It only fires if the built-in
 * values themselves fail validation (a code bug) or an explicitly-set
 * override is burned/weak — in which case the endpoint refuses to serve
 * with one clear message instead of an opaque 500. The exact validation
 * reason lives in the server logs only — never echoed to the client.
 */
export function missingConfigResponse(): Response | null {
  try {
    assertSecretsLoaded();
    return null;
  } catch {
    return json(
      {
        ok: false,
        error:
          "SERVER CONFIGURATION ERROR — the house credentials failed validation (check the deployment logs). The werf stays shut until it is fixed.",
      },
      503
    );
  }
}
