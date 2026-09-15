import { z } from "zod";
import {
  circuitBreaker,
  clearGateFailures,
  clientIp,
  gateLockState,
  json,
  missingConfigResponse,
  rateLimit,
  readJson,
  registerGateFailure,
  verifyPasscode,
} from "@/lib/server-guard";

/**
 * Layer 3 slice (front door): the access gate.
 * A high-entropy passphrase (Tier B — spec §5) verified in constant time.
 * There is NO default value: if GATE_PASSCODE is not configured the process
 * fails closed at env validation, long before this route runs (C1).
 *
 * Brute-force defenses, in order:
 *   1. global circuit breaker (per-instance shed)
 *   2. hard lockout check BEFORE the rate limiter
 *   3. sliding-window rate limit keyed on the TRUSTED client IP (H1) —
 *      client-supplied XFF values cannot mint new buckets
 *   4. escalating lockout — 8 failures inside 10 minutes locks the source
 *      for 10m, then 30m, 90m, 6h, 24h on repeat offenses
 *   5. constant-time comparison + constant delay on failure
 */

const bodySchema = z.object({ passcode: z.string().min(1).max(256) }).strict();

export async function POST(req: Request) {
  const missing = missingConfigResponse();
  if (missing) return missing;

  const breaker = circuitBreaker("gate", 600);
  if (breaker.tripped) {
    return json({ ok: false, error: "Too much noise. Cool down." }, 503, {
      "Retry-After": String(Math.ceil(breaker.retryAfter)),
    });
  }

  const ip = clientIp(req);

  // 1. hard lockout check runs BEFORE the rate limiter so locked sources
  //    hear about the lockout, not the limiter
  const lock = gateLockState(ip);
  if (lock.locked) {
    return json({ ok: false, error: "Locked. Try again later." }, 429, {
      "Retry-After": String(lock.retryAfter),
    });
  }

  const rl = await rateLimit(req, "gate", 10, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Too many attempts. Cool down." }, 429, {
      "Retry-After": String(rl.retryAfter),
    });
  }

  const parsed = await readJson(req, 4_096);
  if (!parsed.ok) {
    return json({ ok: false, error: parsed.error }, parsed.status);
  }

  const check = bodySchema.safeParse(parsed.body);
  if (!check.success) {
    return json({ ok: false, error: "Missing passcode" }, 400);
  }

  if (!verifyPasscode(check.data.passcode)) {
    // escalating lockout + small constant delay to blunt online guessing
    registerGateFailure(ip);
    await new Promise((r) => setTimeout(r, 350));
    const after = gateLockState(ip);
    return json(
      { ok: false, error: after.locked ? "Locked. Try again later." : "Access denied" },
      401,
      after.locked ? { "Retry-After": String(after.retryAfter) } : undefined
    );
  }

  clearGateFailures(ip);
  return json({ ok: true });
}
