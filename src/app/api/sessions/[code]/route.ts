import { db } from "@/lib/db";
import { clientIp, json, rateLimit } from "@/lib/server-guard";

const CODE_RE = /^[A-Z]{6}$/;
const B64_RE = /^[A-Za-z0-9+/=]{1,512}$/;

type Ctx = { params: Promise<{ code: string }> };

/** Session intel: does it exist, who is registered (fingerprints + PUBLIC keys only). */
export async function GET(_req: Request, { params }: Ctx) {
  const { code } = await params;
  if (!CODE_RE.test(code)) return json({ ok: false, error: "Bad code" }, 400);

  const session = await db.session.findUnique({
    where: { code },
    include: { participants: { orderBy: { joinedAt: "asc" } } },
  });
  if (!session || session.deletedAt) return json({ ok: false, error: "Session not found" }, 404);

  return json({
    ok: true,
    code: session.code,
    createdAt: session.createdAt,
    participants: session.participants.map((p) => ({
      fingerprint: p.fingerprint,
      publicKey: p.publicKey,
      joinedAt: p.joinedAt,
    })),
  });
}

/** Destroy a session for EVERYONE: cascade-wipes the code, membership,
 *  all ciphertext history, and all wrapped key envelopes. Irreversible. */
export async function DELETE(req: Request, { params }: Ctx) {
  const { code } = await params;
  if (!CODE_RE.test(code)) return json({ ok: false, error: "Bad code" }, 400);

  const rl = rateLimit(`delete:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) return json({ ok: false, error: "Rate limited" }, 429, { "Retry-After": String(rl.retryAfter) });

  const session = await db.session.findUnique({ where: { code } });
  if (!session || session.deletedAt) return json({ ok: false, error: "Session not found" }, 404);

  await db.session.update({ where: { code }, data: { deletedAt: new Date() } });
  await db.session.delete({ where: { code } }); // cascades: messages, participants, envelopes
  return json({ ok: true, deleted: code });
}
