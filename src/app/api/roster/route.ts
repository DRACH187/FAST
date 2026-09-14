import { z } from "zod";
import { clientIp, json, rateLimit, verifyAttestation } from "@/lib/server-guard";
import { listRoster } from "@/lib/fast/identity-store";

/**
 * DIE WERF ROL — the BOSS-only roll of every callsign that ever claimed or
 * re-asserted on this warm instance.
 *
 *   POST { fingerprint, token }   -> { ok, roll: [...], total, online }
 *
 * Access is gated by the signed callsign attestation: the HMAC token minted
 * at registration must verify (fingerprint match, unexpired) AND carry the
 * boss role. Nobody else — no member, no anonymous request — gets past it.
 *
 * PRIVACY LAW (unconditional): entries are pseudonymous CALLSIGNS with
 * role and timestamps. This app collects NO emails, NO phone numbers, NO
 * real names and stores NO raw IPs — those can never appear here, ever.
 * RAM only: the roll dies with the process, exactly like every other table.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{8,64}$/),
  token: z.string().min(8).max(1024),
});

export async function POST(req: Request) {
  const rl = rateLimit(`roster:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Slow down." }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ ok: false, error: "Malformed request" }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "Invalid payload" }, 400);

  const attested = verifyAttestation(parsed.data.token, parsed.data.fingerprint);
  if (!attested) {
    return json({ ok: false, error: "Attestation invalid — re-enter the gate." }, 401);
  }
  if (attested.role !== "boss") {
    return json({ ok: false, error: "Boss ground only." }, 403);
  }

  const roll = listRoster();
  return json({
    ok: true,
    total: roll.length,
    online: roll.filter((r) => r.online).length,
    roll: roll.map((r) => ({
      nickname: r.nickname,
      role: r.role,
      fp: r.fp,
      online: r.online,
      firstSeen: new Date(r.firstSeen).toISOString(),
      lastSeen: r.lastSeen ? new Date(r.lastSeen).toISOString() : null,
    })),
  });
}
