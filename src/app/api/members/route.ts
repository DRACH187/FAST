import { z } from "zod";
import { json, rateLimit, readJson, verifyAttestation } from "@/lib/server-guard";
import { listLive } from "@/lib/fast/identity-store";
import { registerMember, memberTotal, admitBudget } from "@/lib/fast/server-roll";

/**
 * ALL-TIME MEMBER ROLL — "how many ouens have ever walked in".
 *
 *   POST { memberHash, token }  -> join the roll (or tick a visit), returns { total, online }
 *   GET                         -> { total, online }
 *
 * HARDENING (M5): joining the roll now requires a valid server-signed
 * callsign attestation, and the server admits at most a bounded number of
 * NEW digests per minute globally (`admitBudget`). A flooding attacker can
 * no longer inflate the roll or evict real members via the coldest-row
 * recycler — repeated known digests only tick their visit counter.
 *
 * ZERO-KNOWLEDGE + ZERO-DATABASE: `memberHash` is a salted SHA-256 digest
 * computed in the browser over a persistent device id + callsign. The
 * plaintext never touches the wire, the roll lives in process RAM (no DB
 * anywhere on this project by law), and rows are never deleted — "ever"
 * means ever.
 */
export const dynamic = "force-dynamic";

const HASH_RE = /^[a-f0-9]{64}$/;

const postSchema = z
  .object({
    memberHash: z.string().regex(HASH_RE),
    fingerprint: z.string().regex(/^[a-f0-9]{8,64}$/),
    token: z.string().min(8).max(1024),
  })
  .strict();

export async function POST(req: Request) {
  const rl = await rateLimit(req, "members", 30, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Stadig af, ouen." }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  const parsed = await readJson(req, 4_096);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);

  const check = postSchema.safeParse(parsed.body);
  if (!check.success) return json({ ok: false, error: "Invalid member digest" }, 400);

  // the roll counts ATTESTED members only — anonymous digests cannot mint rows
  const attested = verifyAttestation(check.data.token, check.data.fingerprint);
  if (!attested) {
    return json({ ok: false, error: "Attestation invalid — re-enter the gate." }, 401);
  }

  const admitted = admitBudget();
  if (admitted) registerMember(check.data.memberHash);
  return json({ ok: true, total: memberTotal(), online: listLive().length });
}

export async function GET(req: Request) {
  const rl = await rateLimit(req, "members-q", 60, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Stadig af, ouen." }, 429, { "Retry-After": String(rl.retryAfter) });
  }
  return json({ ok: true, total: memberTotal(), online: listLive().length });
}
