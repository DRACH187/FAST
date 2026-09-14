import { db } from "@/lib/db";
import { clientIp, json, rateLimit } from "@/lib/server-guard";

const CODE_RE = /^[A-Z]{6}$/;
const FP_RE = /^[a-f0-9]{8,64}$/;
const B64_RE = /^[A-Za-z0-9+/=]{1,1024}$/;

type Ctx = { params: Promise<{ code: string }> };

/**
 * Session-key distribution store (Megolm-style, per-recipient).
 * A holder of the session key wraps it for a specific recipient using an
 * ephemeral ECDH exchange (see src/lib/crypto/e2ee.ts) and posts the blob here.
 * The server stores opaque math — without the recipient's private key the
 * envelope is unusable, and the private key never leaves the browser.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  if (!CODE_RE.test(code)) return json({ ok: false, error: "Bad code" }, 400);

  const rl = rateLimit(`keys:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) return json({ ok: false, error: "Rate limited" }, 429, { "Retry-After": String(rl.retryAfter) });

  let body: { envelope?: { forFp?: unknown; epk?: unknown; iv?: unknown; payload?: unknown; fromFp?: unknown } };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Malformed request" }, 400);
  }

  const e = body.envelope;
  if (!e) return json({ ok: false, error: "Missing envelope" }, 400);

  const forFp = typeof e.forFp === "string" ? e.forFp : "";
  const fromFp = typeof e.fromFp === "string" ? e.fromFp : "";
  const epk = typeof e.epk === "string" ? e.epk : "";
  const iv = typeof e.iv === "string" ? e.iv : "";
  const payload = typeof e.payload === "string" ? e.payload : "";

  if (!FP_RE.test(forFp) || !FP_RE.test(fromFp) || !B64_RE.test(epk) || !B64_RE.test(iv) || !B64_RE.test(payload)) {
    return json({ ok: false, error: "Invalid envelope" }, 400);
  }

  const session = await db.session.findUnique({ where: { code } });
  if (!session || session.deletedAt) return json({ ok: false, error: "Session not found" }, 404);

  await db.keyEnvelope.create({
    data: { sessionId: session.id, forFp, epk, iv, payload },
  });

  return json({ ok: true }, 201);
}

/** Fetch every envelope addressed to this fingerprint. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  if (!CODE_RE.test(code)) return json({ ok: false, error: "Bad code" }, 400);

  const fp = new URL(req.url).searchParams.get("fingerprint") ?? "";
  if (!FP_RE.test(fp)) return json({ ok: false, error: "Bad fingerprint" }, 400);

  const session = await db.session.findUnique({ where: { code } });
  if (!session || session.deletedAt) return json({ ok: false, error: "Session not found" }, 404);

  const envelopes = await db.keyEnvelope.findMany({
    where: { sessionId: session.id, forFp: fp },
    orderBy: { createdAt: "asc" },
  });

  return json({
    ok: true,
    envelopes: envelopes.map((e) => ({ id: e.id, epk: e.epk, iv: e.iv, payload: e.payload, fromFp: "" })),
  });
}
