import { z } from "zod";
import { json, missingConfigResponse, rateLimit, readJson, verifyAttestation } from "@/lib/server-guard";
import { listLive, listRoster, type RosterEntry } from "@/lib/fast/identity-store";
import { roomsOfFp } from "@/lib/fast/memory-store";
import { inviteStats } from "@/lib/fast/invites";

/**
 * DIE GRIP — the BOSS-only live directory.
 * ========================================
 *   POST { fingerprint, token }
 *     -> { ok, total, onlineCount, rows: [...], invites: {...} }
 *
 * Merges three RAM tables into one profile-card feed:
 *   - the all-time callsign roll (every callsign ever claimed),
 *   - the live heartbeat table (who is on RIGHT NOW, longest first),
 *   - the room slots each fingerprint currently holds (codes only).
 *
 * Every row: nickname, role, online, firstSeen, lastSeen, rooms[].
 * STRICTLY pseudonymous — the app holds no emails, no real names, no raw
 * IPs at rest, and no chat content EVER (the boss sees the shape of the
 * war, never a single word of it). RAM only; dies with the process.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{8,64}$/),
    token: z.string().min(8).max(1024),
  })
  .strict();

type DirRow = {
  nickname: string;
  role: "member" | "boss";
  fp: string;
  online: boolean;
  firstSeen: string;
  lastSeen: string | null;
  rooms: string[];
};

export async function POST(req: Request) {
  const missing = missingConfigResponse();
  if (missing) return missing;
  const rl = await rateLimit(req, "boss-directory", 20, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Stadig af, baas." }, 429, {
      "Retry-After": String(rl.retryAfter),
    });
  }

  const parsed = await readJson(req, 4_096);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);

  const check = bodySchema.safeParse(parsed.body);
  if (!check.success) return json({ ok: false, error: "Invalid payload" }, 400);

  const attested = verifyAttestation(check.data.token, check.data.fingerprint);
  if (!attested) {
    return json({ ok: false, error: "Attestation invalid — re-enter the gate." }, 401);
  }
  if (attested.role !== "boss") {
    return json({ ok: false, error: "Boss ground only." }, 403);
  }

  const roll: RosterEntry[] = listRoster();
  const live = listLive();
  const now = Date.now();
  const byFp = new Map<string, RosterEntry>(roll.map((r) => [r.fp, r]));

  // live heartbeats whose fingerprint somehow escaped the roll (cold-start
  // edge) still belong on the grip — they are standing right there
  for (const l of live) {
    if (!byFp.has(l.fp)) {
      byFp.set(l.fp, {
        nickname: l.nickname,
        role: l.role,
        fp: l.fp,
        firstSeen: l.since,
        lastSeen: now,
        online: true,
      });
    }
  }

  const rows: DirRow[] = [...byFp.values()]
    .map((r) => ({
      nickname: r.nickname,
      role: r.role,
      fp: r.fp,
      online: r.online,
      firstSeen: new Date(r.firstSeen).toISOString(),
      lastSeen: r.lastSeen ? new Date(r.lastSeen).toISOString() : null,
      rooms: roomsOfFp(r.fp),
    }))
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (a.role !== b.role) return a.role === "boss" ? -1 : 1;
      return Date.parse(a.firstSeen) - Date.parse(b.firstSeen);
    });

  return json({
    ok: true,
    total: rows.length,
    onlineCount: rows.filter((r) => r.online).length,
    rows,
    invites: inviteStats(),
  });
}
