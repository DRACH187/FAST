import { z } from "zod";
import { json, missingConfigResponse, rateLimit, readJson, verifyAttestation } from "@/lib/server-guard";
import { isParticipant, isTerminated } from "@/lib/fast/memory-store";
import { MAX_TTL_MIN, MAX_USES, MIN_TTL_MIN, MIN_USES, mintInvite, revokeInvites } from "@/lib/fast/invites";

/**
 * NOOI-STRINGS — mint + revoke secure invite strings for a room.
 * ==============================================================
 *   POST { fingerprint, token, code, action: "mint",
 *          ttlMinutes?, maxUses? }
 *     -> { ok, invite, expiresAt, code, maxUses }
 *
 *   POST { fingerprint, token, code, action: "revoke" }
 *     -> { ok, revoked }
 *
 * The caller must hold a LIVE slot in that room (attestation verified,
 * membership checked server-side — a callsign alone mints nothing). The
 * minted string opens the door only: it never carries the session key.
 * Revocation kills every live string for the room in one move.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{8,64}$/),
    token: z.string().min(8).max(1024),
    code: z.string().regex(/^[A-Z]{6}$/),
    action: z.enum(["mint", "revoke"]).default("mint"),
    ttlMinutes: z.number().int().min(MIN_TTL_MIN).max(MAX_TTL_MIN).optional(),
    maxUses: z.number().int().min(MIN_USES).max(MAX_USES).optional(),
  })
  .strict();

export async function POST(req: Request) {
  const missing = missingConfigResponse();
  if (missing) return missing;
  const rl = await rateLimit(req, "invite", 10, 60_000);
  if (!rl.ok) {
    return json({ ok: false, reason: "rate" }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  const parsed = await readJson(req, 4_096);
  if (!parsed.ok) return json({ ok: false, reason: "bad" }, parsed.status);

  const check = bodySchema.safeParse(parsed.body);
  if (!check.success) return json({ ok: false, reason: "bad" }, 400);
  const { fingerprint, token, code, action, ttlMinutes, maxUses } = check.data;

  const attested = verifyAttestation(token, fingerprint);
  if (!attested) {
    return json({ ok: false, reason: "attest" }, 401);
  }

  // only a LIVE participant of the room shapes its strings
  if (!isParticipant(code, fingerprint)) {
    return json({ ok: false, reason: "membership" }, 403);
  }
  if (isTerminated(code)) {
    return json({ ok: false, reason: "dead" }, 410);
  }

  if (action === "revoke") {
    const revoked = revokeInvites(code);
    return json({ ok: true, revoked });
  }

  const { invite, expiresAt } = mintInvite(code, fingerprint, { ttlMinutes, maxUses });
  return json({
    ok: true,
    invite,
    expiresAt: new Date(expiresAt).toISOString(),
    code,
    maxUses: maxUses ?? MIN_USES,
  });
}
