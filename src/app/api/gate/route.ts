import { clientIp, json, rateLimit, verifyPasscode } from "@/lib/server-guard";

/**
 * Layer 3 slice (front door): the access gate.
 * A single shared passcode ("187") checked in constant time.
 * In a full enterprise deployment this screen is replaced by
 * Keycloak + WebAuthn passkeys — here it is the lightweight equivalent.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`gate:${clientIp(req)}`, 10, 60_000);
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
    // small constant delay to blunt online guessing
    await new Promise((r) => setTimeout(r, 350));
    return json({ ok: false, error: "Access denied" }, 401);
  }

  return json({ ok: true });
}
