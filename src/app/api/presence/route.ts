import { z } from "zod";
import { clientIp, json, rateLimit, verifyAttestation } from "@/lib/server-guard";
import * as ids from "@/lib/fast/identity-store";

/**
 * Presence — site-wide "who is on right now" heartbeat.
 *
 *   POST { fingerprint, token } -> register heartbeat + return everyone
 *          heartbeating within the last 25 seconds.
 *
 * The attestation token (minted at callsign registration, HMAC-signed by the
 * server) is the ONLY source of nickname/role — a client cannot claim
 * display material it was never attested for, so impersonating "DRACH" on
 * the live board without the boss key is impossible.
 *
 * The client polls every ~8s while the app is open, which doubles as the
 * data source for the LIVE board and the hub's online counter.
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{8,64}$/),
  token: z.string().max(1024).optional(),
});

export async function POST(req: Request) {
  // ~8s heartbeat cadence -> 30/min is generous headroom
  const rl = rateLimit(`presence:${clientIp(req)}`, 30, 60_000);
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
  if (!parsed.success) return json({ ok: false, error: "Bad heartbeat" }, 400);

  const { fingerprint } = parsed.data;
  // nickname/role come ONLY from the server-signed attestation
  const attested = verifyAttestation(parsed.data.token, fingerprint);
  const nickname = attested?.nickname ?? "GHOST";
  const role = (attested?.role ?? "member") as ids.Role;

  ids.heartbeat(fingerprint, nickname, role);
  const online = ids.listLive();

  return json({
    ok: true,
    count: online.length,
    online: online.map((e) => ({ fp: e.fp, nickname: e.nickname, role: e.role, since: e.since })),
  });
}
