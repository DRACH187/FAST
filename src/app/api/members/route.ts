import { z } from "zod";
import { db } from "@/lib/db";
import { clientIp, json, rateLimit } from "@/lib/server-guard";
import { listLive } from "@/lib/fast/identity-store";

/**
 * ALL-TIME MEMBER LEDGER — "how many ouens have ever walked in".
 *
 *   POST { memberHash }  -> upsert the member digest, returns { total, online }
 *   GET                  -> { total, online }
 *
 * ZERO-KNOWLEDGE: `memberHash` is a salted SHA-256 digest computed in the
 * browser over a persistent device id + callsign. The plaintext never
 * touches the wire, so the ledger counts shadows, not people. Rows are
 * never deleted — this is the permanent count of everyone who ever entered.
 */
export const dynamic = "force-dynamic";

const HASH_RE = /^[a-f0-9]{64}$/;

const postSchema = z.object({
  memberHash: z.string().regex(HASH_RE),
});

async function totals(): Promise<{ total: number; online: number }> {
  const total = await db.memberLedger.count();
  return { total, online: listLive().length };
}

export async function POST(req: Request) {
  const rl = rateLimit(`members:${clientIp(req)}`, 30, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Slow down." }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ ok: false, error: "Malformed request" }, 400);
  }

  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "Invalid member digest" }, 400);

  const { memberHash } = parsed.data;

  try {
    // Pure count-upsert: new digests join the roll; known digests tick their
    // visit counter. Nothing is ever removed — "ever" means ever.
    await db.memberLedger.upsert({
      where: { memberHash },
      update: { lastSeen: new Date(), visits: { increment: 1 } },
      create: { id: memberHash, memberHash },
    });
    return json({ ok: true, ...(await totals()) });
  } catch {
    return json({ ok: false, error: "Ledger unavailable" }, 503);
  }
}

export async function GET(req: Request) {
  const rl = rateLimit(`members-q:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Slow down." }, 429, { "Retry-After": String(rl.retryAfter) });
  }
  try {
    return json({ ok: true, ...(await totals()) });
  } catch {
    return json({ ok: false, error: "Ledger unavailable" }, 503);
  }
}
