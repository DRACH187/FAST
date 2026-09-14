import { z } from "zod";
import { clientIp, json, rateLimit, signAttestation, verifyDrachKey } from "@/lib/server-guard";
import * as ids from "@/lib/fast/identity-store";

/**
 * Identity — the callsign (nickname) registry.
 *
 *   POST  { fingerprint, nickname, bossKey? }  -> register / refresh callsign
 *   GET   ?fps=hex,hex                         -> batch nickname lookup
 *
 * The DRACH callsign is reserved: registering it requires the boss key,
 * verified server-side in constant time (DRACH_KEY env, default BIGBOSS27).
 * Nicknames are public display data; no secret material ever flows here.
 */
export const dynamic = "force-dynamic";

const postSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{8,64}$/),
  nickname: z.string(),
  bossKey: z.string().max(128).optional(),
  nickPass: z.string().max(128).optional(),
});

export async function POST(req: Request) {
  // registration is rare — tight limit
  const rl = rateLimit(`identity:${clientIp(req)}`, 12, 60_000);
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
  if (!parsed.success) return json({ ok: false, error: "Invalid identity material" }, 400);

  const { fingerprint, bossKey, nickPass } = parsed.data;
  const nickname = ids.normalizeNickname(parsed.data.nickname);
  if (!nickname) {
    return json(
      { ok: false, error: "Callsign: 2–16 chars, letters/numbers/space/._- only." },
      400
    );
  }

  // the boss key never touches storage or logs — verify and forget
  const wantsBoss = nickname.toLowerCase() === "drach";
  const bossOk = wantsBoss && typeof bossKey === "string" ? verifyDrachKey(bossKey) : false;

  const result = ids.registerCallsign(fingerprint, nickname, bossOk, nickPass);
  if (!result.ok) {
    return json({ ok: false, error: result.error }, result.status);
  }
  // attestation: proof this callsign was legitimately registered — carried on
  // every later join/heartbeat so no route ever has to trust the client.
  // nickPass is returned ONLY when it was newly minted.
  return json({
    ok: true,
    nickname: result.nickname,
    role: result.role,
    token: signAttestation(fingerprint, result.nickname, result.role),
    nickPass: result.nickPass,
  });
}

const FPS_PARAM_MAX = 64 * 65; // up to 64 fps, 64 chars each + separators

export async function GET(req: Request) {
  const rl = rateLimit(`identity-q:${clientIp(req)}`, 120, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Slow down." }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  const param = new URL(req.url).searchParams.get("fps") ?? "";
  if (param.length > FPS_PARAM_MAX) return json({ ok: false, error: "Too many fps" }, 400);

  const fps = param.split(",").filter((fp) => ids.isFingerprint(fp)).slice(0, 64);
  return json({ ok: true, names: ids.lookupCallsigns(fps) });
}
