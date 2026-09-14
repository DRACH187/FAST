import { db } from "@/lib/db";
import { clientIp, json, rateLimit } from "@/lib/server-guard";

const CODE_RE = /^[A-Z]{6}$/;
const FP_RE = /^[a-f0-9]{8,64}$/;
const B64_RE = /^[A-Za-z0-9+/=]{1,16384}$/;

type Ctx = { params: Promise<{ code: string }> };

/**
 * Ciphertext-at-rest store. This is ALL the server ever holds of a
 * conversation: sender fingerprint, ratchet counter, IV, ciphertext.
 * No plaintext. No key material. Zero knowledge by construction.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  if (!CODE_RE.test(code)) return json({ ok: false, error: "Bad code" }, 400);

  const session = await db.session.findUnique({ where: { code } });
  if (!session || session.deletedAt) return json({ ok: false, error: "Session not found" }, 404);

  const sinceParam = new URL(req.url).searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : null;

  const messages = await db.encryptedMessage.findMany({
    where: {
      sessionId: session.id,
      ...(since && !isNaN(since.getTime()) ? { createdAt: { gt: since } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  return json({
    ok: true,
    messages: messages.map((m) => ({
      id: m.id,
      senderFp: m.senderFp,
      counter: m.counter,
      iv: m.iv,
      ciphertext: m.ciphertext,
      createdAt: m.createdAt,
    })),
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  if (!CODE_RE.test(code)) return json({ ok: false, error: "Bad code" }, 400);

  const rl = rateLimit(`msg:${clientIp(req)}`, 120, 60_000);
  if (!rl.ok) return json({ ok: false, error: "Rate limited" }, 429, { "Retry-After": String(rl.retryAfter) });

  let body: { message?: { id?: unknown; senderFp?: unknown; counter?: unknown; iv?: unknown; ciphertext?: unknown } };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Malformed request" }, 400);
  }

  const m = body.message;
  if (!m) return json({ ok: false, error: "Missing message" }, 400);

  const id = typeof m.id === "string" && m.id.length <= 64 ? m.id : "";
  const senderFp = typeof m.senderFp === "string" ? m.senderFp : "";
  const counter = typeof m.counter === "number" && Number.isInteger(m.counter) && m.counter >= 0 && m.counter < 1e9 ? m.counter : -1;
  const iv = typeof m.iv === "string" ? m.iv : "";
  const ciphertext = typeof m.ciphertext === "string" ? m.ciphertext : "";

  if (!id || !FP_RE.test(senderFp) || counter < 0 || !B64_RE.test(iv) || !B64_RE.test(ciphertext) || ciphertext.length > 12000) {
    return json({ ok: false, error: "Invalid message blob" }, 400);
  }

  const session = await db.session.findUnique({ where: { code } });
  if (!session || session.deletedAt) return json({ ok: false, error: "Session not found" }, 404);

  const created = await db.encryptedMessage.create({
    data: { sessionId: session.id, senderFp, counter, iv, ciphertext },
  });

  return json({ ok: true, serverId: created.id, createdAt: created.createdAt }, 201);
}
