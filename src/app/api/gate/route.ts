import {
  clearGateFailures,
  clientIp,
  gateLockState,
  json,
  rateLimit,
  registerGateFailure,
  verifyPasscode,
} from "@/lib/server-guard";

/**
 * Layer 3 slice (front door): the access gate.
 * A single shared passcode ("187") checked in constant time.
 *
 * Brute-force defenses, in order:
 *   1. sliding-window rate limit (10 / minute / IP)
 *   2. escalating lockout — 8 failures inside 10 minutes hard-locks the IP
 *      for 10 minutes (success inside the window does NOT shorten it)
 *   3. constant-time comparison + a constant delay on failure
 * In a full enterprise deployment this screen is replaced by
 * Keycloak + WebAuthn passkeys — here it is the lightweight equivalent.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);

  // 1. hard lockout check runs BEFORE the rate limiter so locked IPs hear
  //    about the lockout, not the limiter
  const lock = gateLockState(ip);
  if (lock.locked) {
    return json({ ok: false, error: "Locked. Try again later." }, 429, {
      "Retry-After": String(lock.retryAfter),
    });
  }

  const rl = rateLimit(`gate:${ip}`, 10, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Too many attempts. Cool down." }, 429, {
      "Retry-After": String(rl.retryAfter),
    });
  }

  let body: { passcode?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Malformed request" }, 400);
  }

  if (typeof body.passcode !== "string") {
    return json({ ok: false, error: "Missing passcode" }, 400);
  }

  if (!verifyPasscode(body.passcode)) {
    // 2. escalating lockout + small constant delay to blunt online guessing
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
