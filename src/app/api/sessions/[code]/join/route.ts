import { db } from "@/lib/db";
import { clientIp, json, rateLimit } from "@/lib/server-guard";

const CODE_RE = /^[A-Z]{6}$/;
const FP_RE = /^[a-f0-9]{8,64}$/;
const B64_RE = /^[A-Za-z0-9+/=]{1,512}$/;

type Ctx = { params: Promise<{ code: string }> };

/**
 * Register this device on the session. The client posts its fingerprint
 * (truncated SHA-256 of its public key) and its PUBLIC key only —
 * private key material never leaves the browser.
 * Returns the member roster so the joiner's client knows who to
 * expect wrapped session keys from / who to wrap keys for.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  if (!CODE_RE.test(code)) return json({ ok: false, error: "Bad code" }, 400);

  const rl = rateLimit(`join:${clientIp(req)}`, 30, 60_000);
  if (!rl.ok) return json({ ok: false, error: "Rate limited" }, 429, { "Retry-After": String(rl.retryAfter) });

  let body: { fingerprint?: unknown; publicKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Malformed request" }, 400);
  }

  const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : "";
  const publicKey = typeof body.publicKey === "string" ? body.publicKey : "";
  if (!FP_RE.test(fingerprint) || !B64_RE.test(publicKey)) {
    return json({ ok: false, error: "Invalid identity material" }, 400);
  }

  const session = await db.session.findUnique({ where: { code } });
  if (!session || session.deletedAt) return json({ ok: false, error: "Session not found" }, 404);

  await db.participant.upsert({
    where: { sessionId_fingerprint: { sessionId: session.id, fingerprint } },
    update: { publicKey },
    create: { sessionId: session.id, fingerprint, publicKey },
  });

  const participants = await db.participant.findMany({
    where: { sessionId: session.id },
    orderBy: { joinedAt: "asc" },
  });

  return json({
    ok: true,
    members: participants.map((p) => ({
      fingerprint: p.fingerprint,
      publicKey: p.publicKey,
    })),
  });
}
