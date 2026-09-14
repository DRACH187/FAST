import { db } from "@/lib/db";
import { clientIp, json, rateLimit } from "@/lib/server-guard";

/** 23-letter alphabet: unambiguous letters only (no I/L/O look-alikes). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";

function generateCode(): string {
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (let i = 0; i < 6; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/**
 * Start a session: the server mints a random 6-letter rendezvous code.
 * No keys, no plaintext — key material is generated and held client-side only.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`create:${clientIp(req)}`, 8, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Too many sessions created. Slow down." }, 429, {
      "Retry-After": String(rl.retryAfter),
    });
  }

  // collision-resistant mint (23^6 ≈ 148M codes)
  let code = generateCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const clash = await db.session.findUnique({ where: { code } });
    if (!clash) break;
    code = generateCode();
  }

  const session = await db.session.create({ data: { code } });
  return json({ ok: true, code: session.code, createdAt: session.createdAt }, 201);
}
