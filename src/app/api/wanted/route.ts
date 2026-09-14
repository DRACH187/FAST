import { z } from "zod";
import { db } from "@/lib/db";
import { clientIp, json, rateLimit } from "@/lib/server-guard";

/**
 * WANTED board — zero-knowledge encrypted bulletins.
 * ===================================================
 * The browser encrypts EVERYTHING (title, description, alias, threat level,
 * status, bounty, author callsign) with AES-256-GCM using a key derived
 * from the gate passcode; the image is a second encrypted blob. This route
 * stores and serves CIPHERTEXT only — it can never read a single post.
 *
 *   GET                 -> list live posts (newest first, ciphertext)
 *   POST create         -> publish a new encrypted post
 *   POST reseed         -> clients re-upload cached ciphertext after a cold
 *                          restart, so the board self-heals on serverless
 *   POST delete         -> creator (fingerprint match) burns a post
 *
 * Retention: 24 hours, enforced on every access + a lazy sweep.
 * Durability: memory mirror for speed; SQLite best-effort (writable FS);
 * client-side reseed covers cold starts on read-only hosts.
 */
export const dynamic = "force-dynamic";

const POST_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_POSTS = 200;
const MAX_RESEED = 30;

const B64_RE = /^[A-Za-z0-9+/=]+$/;

const createSchema = z.object({
  action: z.literal("create"),
  fingerprint: z.string().regex(/^[a-f0-9]{8,64}$/),
  post: z.object({
    id: z.string().min(8).max(64),
    iv: z.string().max(512),
    ciphertext: z.string().max(12_000),
    imgIv: z.string().max(512).optional(),
    imgCiphertext: z.string().max(1_400_000).optional(),
  }),
});

const reseedSchema = z.object({
  action: z.literal("reseed"),
  fingerprint: z.string().regex(/^[a-f0-9]{8,64}$/),
  posts: z
    .array(
      z.object({
        id: z.string().min(8).max(64),
        iv: z.string().max(512),
        ciphertext: z.string().max(12_000),
        imgIv: z.string().max(512).optional(),
        imgCiphertext: z.string().max(1_400_000).optional(),
        creatorFp: z.string().regex(/^[a-f0-9]{8,64}$/),
        createdAt: z.string().max(40),
      })
    )
    .max(MAX_RESEED),
});

const deleteSchema = z.object({
  action: z.literal("delete"),
  fingerprint: z.string().regex(/^[a-f0-9]{8,64}$/),
  id: z.string().min(8).max(64),
});

const bodySchema = z.discriminatedUnion("action", [createSchema, reseedSchema, deleteSchema]);

// ------------------------------------------------------------ memory mirror

type WantedRec = {
  id: string;
  iv: string;
  ciphertext: string;
  imgIv: string | null;
  imgCiphertext: string | null;
  creatorFp: string;
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms
};

const memory = new Map<string, WantedRec>();
let dbHydrated = false;

function isB64(v: string): boolean {
  return v.length > 0 && B64_RE.test(v);
}

function sweep(): void {
  const now = Date.now();
  for (const [id, rec] of memory) {
    if (rec.expiresAt <= now) memory.delete(id);
  }
  if (memory.size > MAX_POSTS) {
    const entries = [...memory.values()].sort((a, b) => a.createdAt - b.createdAt);
    const excess = memory.size - MAX_POSTS;
    for (let i = 0; i < excess; i++) memory.delete(entries[i].id);
  }
}

function validBlob(b: { iv: string; ciphertext: string; imgIv?: string; imgCiphertext?: string }): boolean {
  if (!isB64(b.iv) || !isB64(b.ciphertext)) return false;
  if (b.imgIv !== undefined && !isB64(b.imgIv)) return false;
  if (b.imgCiphertext !== undefined && !isB64(b.imgCiphertext)) return false;
  if ((b.imgIv === undefined) !== (b.imgCiphertext === undefined)) return false; // both or neither
  return true;
}

function store(rec: WantedRec): void {
  memory.set(rec.id, rec);
  void db.wantedPost
    .create({
      data: {
        id: rec.id,
        iv: rec.iv,
        ciphertext: rec.ciphertext,
        imgIv: rec.imgIv,
        imgCiphertext: rec.imgCiphertext,
        creatorFp: rec.creatorFp,
        createdAt: new Date(rec.createdAt),
        expiresAt: new Date(rec.expiresAt),
      },
    })
    .catch(() => undefined); // read-only FS on serverless -> memory is truth
}

function toWire(rec: WantedRec) {
  return {
    id: rec.id,
    iv: rec.iv,
    ciphertext: rec.ciphertext,
    imgIv: rec.imgIv ?? undefined,
    imgCiphertext: rec.imgCiphertext ?? undefined,
    creatorFp: rec.creatorFp,
    createdAt: new Date(rec.createdAt).toISOString(),
    expiresAt: new Date(rec.expiresAt).toISOString(),
  };
}

// -------------------------------------------------------------------- GET

export async function GET(req: Request) {
  const rl = rateLimit(`wanted:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Slow down." }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  sweep();

  // cold start: hydrate the mirror from SQLite (writable hosts only)
  if (!dbHydrated) {
    dbHydrated = true;
    try {
      const rows = await db.wantedPost.findMany({
        where: { expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        take: MAX_POSTS,
      });
      for (const row of rows) {
        if (!memory.has(row.id)) {
          memory.set(row.id, {
            id: row.id,
            iv: row.iv,
            ciphertext: row.ciphertext,
            imgIv: row.imgIv,
            imgCiphertext: row.imgCiphertext,
            creatorFp: row.creatorFp,
            createdAt: row.createdAt.getTime(),
            expiresAt: row.expiresAt.getTime(),
          });
        }
      }
    } catch {
      // no writable DB -> the memory mirror (plus client reseed) is the board
    }
  }

  const posts = [...memory.values()].sort((a, b) => b.createdAt - a.createdAt).map(toWire);
  return json({ ok: true, count: posts.length, posts });
}

// ------------------------------------------------------------------- POST

export async function POST(req: Request) {
  const rl = rateLimit(`wanted-post:${clientIp(req)}`, 20, 60_000);
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
  const body = parsed.data;

  if (body.action === "create") {
    sweep();
    const p = body.post;
    if (!validBlob(p)) return json({ ok: false, error: "Invalid encrypted blob" }, 400);

    const now = Date.now();
    const rec: WantedRec = {
      id: p.id,
      iv: p.iv,
      ciphertext: p.ciphertext,
      imgIv: p.imgIv ?? null,
      imgCiphertext: p.imgCiphertext ?? null,
      creatorFp: body.fingerprint,
      createdAt: now,
      expiresAt: now + POST_TTL_MS,
    };
    if (!memory.has(rec.id)) store(rec);
    return json({ ok: true, id: rec.id, expiresAt: toWire(rec).expiresAt });
  }

  if (body.action === "reseed") {
    sweep();
    let restored = 0;
    for (const p of body.posts) {
      if (memory.has(p.id) || !validBlob(p)) continue;
      const at = Date.parse(p.createdAt);
      if (!Number.isFinite(at) || at > Date.now() || Date.now() - at > POST_TTL_MS) continue;
      memory.set(p.id, {
        id: p.id,
        iv: p.iv,
        ciphertext: p.ciphertext,
        imgIv: p.imgIv ?? null,
        imgCiphertext: p.imgCiphertext ?? null,
        creatorFp: p.creatorFp,
        createdAt: at,
        expiresAt: at + POST_TTL_MS,
      });
      restored += 1;
    }
    return json({ ok: true, restored });
  }

  // delete — the creator's fingerprint must match (public material compare)
  const rec = memory.get(body.id);
  if (!rec) {
    // try the DB before declaring defeat (fresh lambda without hydration)
    try {
      const row = await db.wantedPost.findUnique({ where: { id: body.id } });
      if (row && row.creatorFp === body.fingerprint) {
        await db.wantedPost.delete({ where: { id: body.id } }).catch(() => undefined);
        return json({ ok: true, deleted: true });
      }
    } catch {
      /* fall through */
    }
    return json({ ok: true, deleted: true }); // already gone — idempotent burn
  }
  if (rec.creatorFp !== body.fingerprint) {
    return json({ ok: false, error: "Only the poster can burn this." }, 403);
  }
  memory.delete(body.id);
  void db.wantedPost.deleteMany({ where: { id: body.id } }).catch(() => undefined);
  return json({ ok: true, deleted: true });
}
