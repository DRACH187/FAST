import { z } from "zod";
import { clientIp, json, rateLimit } from "@/lib/server-guard";
import { listLive } from "@/lib/fast/identity-store";
import { memberTotal, registerMember } from "@/lib/fast/server-roll";

/**
 * ALL-TIME MEMBER ROLL — "how many ouens have ever walked in".
 *
 *   POST { memberHash }  -> join the roll (or tick a visit), returns { total, online }
 *   GET                  -> { total, online }
 *
 * ZERO-KNOWLEDGE + ZERO-DATABASE: `memberHash` is a salted SHA-256 digest
 * computed in the browser over a persistent device id + callsign. The
 * plaintext never touches the wire, the roll lives in process RAM (no DB
 * anywhere on this project by law), and rows are never deleted — "ever"
 * means ever.
 */
export const dynamic = "force-dynamic";

const HASH_RE = /^[a-f0-9]{64}$/;

const postSchema = z.object({
  memberHash: z.string().regex(HASH_RE),
});

export async function POST(req: Request) {
  const rl = rateLimit(`members:${clientIp(req)}`, 30, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Stadig af, ouen." }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ ok: false, error: "Malformed request" }, 400);
  }

  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "Invalid member digest" }, 400);

  registerMember(parsed.data.memberHash);
  return json({ ok: true, total: memberTotal(), online: listLive().length });
}

export async function GET(req: Request) {
  const rl = rateLimit(`members-q:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Stadig af, ouen." }, 429, { "Retry-After": String(rl.retryAfter) });
  }
  return json({ ok: true, total: memberTotal(), online: listLive().length });
}
