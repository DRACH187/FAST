import { z } from "zod";
import { json, missingConfigResponse, rateLimit, readJson, verifyAttestation } from "@/lib/server-guard";
import { postSummons } from "@/lib/fast/summons";

/**
 * BOSS SUMMONS — DRACH pulls online operatives into a session.
 * ============================================================
 *   POST { fingerprint, token, code, targets: [fp, …] }
 *     -> { ok, summoned }
 *
 * The attestation token must verify AND carry the boss role — the same
 * unforgeable HMAC the roster uses. A member, a GHOST or a forged token
 * gets nothing. The session code must be a real 6-letter room code; the
 * boss's client has ALREADY created that room (and holds its key) before
 * calling here, so every summoned device auto-joins a live E2EE session.
 *
 * No content rides this route — it is a doorbell keyed by fingerprint.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CODE_RE = /^[A-Z]{6}$/;
const MAX_TARGETS = 100;

const bodySchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{8,64}$/),
    token: z.string().min(8).max(1024),
    code: z.string().regex(CODE_RE),
    targets: z.array(z.string().regex(/^[a-f0-9]{8,64}$/)).min(1).max(MAX_TARGETS),
  })
  .strict();

export async function POST(req: Request) {
  const missing = missingConfigResponse();
  if (missing) return missing;
  const rl = await rateLimit(req, "summons", 10, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Slow down." }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  const parsed = await readJson(req, 32_768);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);

  const check = bodySchema.safeParse(parsed.body);
  if (!check.success) return json({ ok: false, error: "Invalid payload" }, 400);
  const { fingerprint, token, code, targets } = check.data;

  const attested = verifyAttestation(token, fingerprint);
  if (!attested) {
    return json({ ok: false, error: "Attestation invalid — re-enter the gate." }, 401);
  }
  if (attested.role !== "boss") {
    return json({ ok: false, error: "Boss ground only." }, 403);
  }

  // never let the boss ring his own doorbell
  const targets_ = [...new Set(targets.filter((t) => t !== fingerprint))];
  if (targets_.length === 0) {
    return json({ ok: false, error: "No one to summon." }, 400);
  }

  const summoned = postSummons(targets_, code);
  return json({ ok: true, summoned });
}
