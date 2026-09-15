import { z } from "zod";
import {
  json,
  missingConfigResponse,
  rateLimit,
  readJson,
  securityStats,
  verifyAttestation,
} from "@/lib/server-guard";
import { listLive, listRoster } from "@/lib/fast/identity-store";
import { memberTotal } from "@/lib/fast/server-roll";
import { bossChatTotals, bossInspect, bossReplayBlocks } from "@/lib/fast/memory-store";
import { summonStats } from "@/lib/fast/summons";
import { wantedBoardStats } from "@/lib/fast/wanted-board";

/**
 * BOSS COMMAND PANEL — DRACH's admin room feed.
 * ============================================
 *   POST { fingerprint, token } -> the WHOLE site in one response
 *
 * Access: the signed callsign attestation must verify AND carry the boss
 * role. Same law as the roster route — a member, an anonymous request, a
 * stolen fingerprint without the boss attestation gets nothing but a 403.
 *
 * WHAT THE BOSS SEES (all of it operational metadata):
 *   - DIE ROL:    every callsign ever claimed on this warm instance, plus
 *                 the all-time 187-door total and the live heartbeat table.
 *   - WERWE:      every room the instance holds — codes, rosters, message/
 *                 envelope/photo counts, TTL deadlines, status. ZERO chat
 *                 content: the E2EE law means the boss sees the shape of
 *                 the conversation, never a single word of it.
 *   - WANTED:     board counts (cases, exhibits, sakboek notes, tombstones,
 *                 ciphertext weight). The board itself stays ciphertext-only.
 *   - ONTBIEDINGS: doorbells currently hanging.
 *   - STELSEL:    process uptime, RAM, warm-start time, abuse-control
 *                 counters (limiter buckets, gate locks, circuit load).
 *
 * PRIVACY LAW (unconditional, mirrors the roster route): callsigns, roles,
 * counts and timestamps only. NO emails, NO real names, NO IPs, NO keys,
 * NO ciphertext. RAM only — everything dies with the process.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{8,64}$/),
    token: z.string().min(8).max(1024),
  })
  .strict();

export async function POST(req: Request) {
  const missing = missingConfigResponse();
  if (missing) return missing;
  const rl = await rateLimit(req, "boss-panel", 20, 60_000);
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

  // ------------------------------------------------------------ the roll
  const roll = listRoster();
  const live = listLive();
  const liveByFp = new Map(live.map((l) => [l.fp, l.since]));

  // ------------------------------------------------------------ the rooms
  const rooms = bossInspect();
  const chatTotals = bossChatTotals();

  // ----------------------------------------------------------- the board
  const wanted = wantedBoardStats();
  const summons = summonStats();
  const security = securityStats();

  // ---------------------------------------------------------- the system
  const mem = process.memoryUsage();
  const uptimeSec = Math.floor(process.uptime());

  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    members: {
      rollCount: roll.length,
      onlineCount: roll.filter((r) => r.online).length,
      allTime: memberTotal(),
      roll: roll.map((r) => ({
        nickname: r.nickname,
        role: r.role,
        online: r.online,
        firstSeen: new Date(r.firstSeen).toISOString(),
        lastSeen: r.lastSeen ? new Date(r.lastSeen).toISOString() : null,
      })),
      live: live.map((l) => ({
        nickname: l.nickname,
        role: l.role,
        since: new Date(liveByFp.get(l.fp) ?? l.since).toISOString(),
      })),
    },
    sessions: {
      total: chatTotals.sessions,
      live: chatTotals.liveSessions,
      membersInRooms: chatTotals.membersInRooms,
      messages: chatTotals.messages,
      list: rooms,
    },
    wanted: {
      posts: wanted.posts,
      exhibits: wanted.exhibits,
      comments: wanted.comments,
      tombstones: wanted.tombstones,
      bytes: wanted.bytes,
      freshestPostAt: wanted.freshestPostAt,
    },
    summons,
    system: {
      uptimeSec,
      startedAt: new Date(Date.now() - uptimeSec * 1000).toISOString(),
      rssMb: Math.round(mem.rss / (1024 * 1024)),
      heapMb: Math.round(mem.heapUsed / (1024 * 1024)),
      node: process.version,
      platform: process.platform,
      limiterBuckets: security.limiterBuckets,
      gateLocks: security.gateLocks,
      gateLockoutsLive: security.gateLockoutsLive,
      circuitCount: security.circuitCount,
      replayBlocks: bossReplayBlocks(),
      probeWatch: security.probeWatch,
      probeTarpits: security.probeTarpits,
    },
  });
}
