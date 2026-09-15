import { z } from "zod";
import {
  json,
  missingConfigResponse,
  probeTarpitMs,
  rateLimit,
  readJson,
  registerProbe,
  tarpitSleep,
  verifyAttestation,
} from "@/lib/server-guard";
import { sessionExists, isTerminated } from "@/lib/fast/memory-store";
import { redeemInvite } from "@/lib/fast/invites";

/**
 * NOOI-STRING REDEMPTION — trade a signed string for a door.
 * =========================================================
 *   POST { fingerprint, token, invite } -> { ok, code, usesLeft }
 *                                        | { ok: false, reason }
 *
 * Attestation (ANY role) is required so anonymous crawlers burn their time
 * elsewhere, but the string itself is the authority: whoever holds a live,
 * signed, unburned string gets the room code to join. The session key still
 * comes only from a member's device — E2EE law untouched.
 *
 * Hostility law: mangled or forged strings count as probes and the source
 * stews in the same escalating tarpit as room-code guessers. Authentic
 * strings with honest problems (expired / burned / dead room) get a straight
 * answer with no stew.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{8,64}$/),
    token: z.string().min(8).max(1024),
    invite: z.string().min(12).max(400),
  })
  .strict();

export async function POST(req: Request) {
  const missing = missingConfigResponse();
  if (missing) return missing;
  const rl = await rateLimit(req, "invite-redeem", 20, 60_000);
  if (!rl.ok) {
    return json({ ok: false, reason: "rate" }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  const parsed = await readJson(req, 4_096);
  if (!parsed.ok) return json({ ok: false, reason: "bad" }, parsed.status);

  const check = bodySchema.safeParse(parsed.body);
  if (!check.success) return json({ ok: false, reason: "bad" }, 400);
  const { fingerprint, token, invite } = check.data;

  const attested = verifyAttestation(token, fingerprint);
  if (!attested) {
    return json({ ok: false, reason: "attest" }, 401);
  }

  const result = redeemInvite(invite, (code) => sessionExists(code) && !isTerminated(code));

  if (!result.ok) {
    if (result.reason === "bad") {
      // forged/mangled string — same mud the code-guessers wade through
      const ip = req.headers.get("x-real-ip") ?? "";
      registerProbe(ip || fingerprint);
      const stew = probeTarpitMs(ip || fingerprint);
      if (stew > 0) await tarpitSleep(stew);
    }
    return json({ ok: false, reason: result.reason }, 400);
  }

  return json({ ok: true, code: result.code, usesLeft: result.usesLeft });
}
