import { z } from "zod";
import { json, rateLimit, readJson, verifyAttestation } from "@/lib/server-guard";
import * as ids from "@/lib/fast/identity-store";
import { takeSummons } from "@/lib/fast/summons";

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
 * The heartbeat ALSO drains the boss-summons doorbell: any session the boss
 * summoned this device into rides back on this response (code + timestamp
 * only — a doorbell, not a letter) and the client auto-joins.
 */
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{8,64}$/),
    token: z.string().max(1024).optional(),
  })
  .strict();

export async function POST(req: Request) {
  // ~8s heartbeat cadence -> 30/min is generous headroom
  const rl = await rateLimit(req, "presence", 30, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Slow down." }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  const parsed = await readJson(req, 4_096);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);

  const check = bodySchema.safeParse(parsed.body);
  if (!check.success) return json({ ok: false, error: "Bad heartbeat" }, 400);

  const { fingerprint } = check.data;
  // nickname/role come ONLY from the server-signed attestation
  const attested = verifyAttestation(check.data.token, fingerprint);
  const nickname = attested?.nickname ?? "GHOST";
  const role = (attested?.role ?? "member") as ids.Role;

  ids.heartbeat(fingerprint, nickname, role);
  const online = ids.listLive();

  // drain the boss-summons doorbell for THIS device only
  const summons = takeSummons(fingerprint);

  return json({
    ok: true,
    count: online.length,
    online: online.map((e) => ({ fp: e.fp, nickname: e.nickname, role: e.role, since: e.since })),
    summons: summons.map((s) => ({ code: s.code, at: s.at })),
  });
}
