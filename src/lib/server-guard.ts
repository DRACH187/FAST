import { createHash, timingSafeEqual } from "crypto";

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

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
