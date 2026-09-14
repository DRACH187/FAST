import { z } from "zod";
import { clientIp, json, rateLimit } from "@/lib/server-guard";

/**
 * WANTED board — zero-knowledge encrypted CASE FILES.
 * ===================================================
 * The browser seals EVERYTHING with AES-256-GCM (key derived from the gate
 * passcode): the text envelope, every media exhibit (JPEG stills / short
 * clips) and every sakboek comment. This route stores and serves CIPHERTEXT
 * only — it can never read a post, an exhibit, a comment or an author.
 *
 *   GET                            -> light list: text ciphertext + media
 *                                     DESCRIPTORS + comments (no media bytes)
 *   GET ?id=..&media=<index>       -> one sealed exhibit (keeps GET light:
 *                                     a board with clips never ships megabytes
 *                                     in one response)
 *   POST create                    -> publish the sealed text envelope
 *   POST attach                     -> upload ONE sealed exhibit (serverless
 *                                     body limits: one per request)
 *   POST comment | uncomment        -> sakboek notes on a case
 *   POST delete                     -> creator (fingerprint match) burns a case
 *   POST reseed                     -> clients re-upload cached ciphertext
 *                                     after a cold restart (self-heal)
 *
 * Retention: 24h, enforced on every access + a lazy sweep. Durability:
 * process RAM only — ZERO DATABASE (project law). Client-side reseed covers
 * cold restarts.
 */
export const dynamic = "force-dynamic";

const POST_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_POSTS = 200;
const MAX_RESEED = 30;
const MAX_MEDIA_PER_POST = 8;
const MAX_MEDIA_CHARS = 3_600_000; // b64 ceiling per exhibit (~2.6MB binary)
const MAX_MEDIA_TOTAL_CHARS = 96_000_000; // whole-board exhibit budget
const MAX_COMMENTS_PER_POST = 60;
const MAX_COMMENT_CHARS = 8_000;

const B64_RE = /^[A-Za-z0-9+/=]+$/;
const MIME_RE = /^(image\/jpeg|video\/mp4|video\/webm)$/;

const fpSchema = z.string().regex(/^[a-f0-9]{8,64}$/);
const mediaItemSchema = z.object({
  iv: z.string().max(512),
  ciphertext: z.string().max(MAX_MEDIA_CHARS),
  mime: z.string().regex(MIME_RE),
});
const legacyImageSchema = z.object({
  imgIv: z.string().max(512).optional(),
  imgCiphertext: z.string().max(1_400_000).optional(),
});

const createSchema = z.object({
  action: z.literal("create"),
  fingerprint: fpSchema,
  post: z.object({
    id: z.string().min(8).max(64),
    iv: z.string().max(512),
    ciphertext: z.string().max(12_000),
  }),
});

const attachSchema = z.object({
  action: z.literal("attach"),
  fingerprint: fpSchema,
  id: z.string().min(8).max(64),
  index: z.number().int().min(0).max(MAX_MEDIA_PER_POST - 1),
  item: mediaItemSchema,
});

const commentSchema = z.object({
  action: z.literal("comment"),
  fingerprint: fpSchema,
  id: z.string().min(8).max(64),
  comment: z.object({
    id: z.string().min(8).max(64),
    iv: z.string().max(512),
    ciphertext: z.string().max(MAX_COMMENT_CHARS),
  }),
});

const uncommentSchema = z.object({
  action: z.literal("uncomment"),
  fingerprint: fpSchema,
  id: z.string().min(8).max(64),
  commentId: z.string().min(8).max(64),
});

const deleteSchema = z.object({
  action: z.literal("delete"),
  fingerprint: fpSchema,
  id: z.string().min(8).max(64),
});

const reseedPostSchema = z.object({
  id: z.string().min(8).max(64),
  iv: z.string().max(512),
  ciphertext: z.string().max(12_000),
  imgIv: z.string().max(512).optional(),
  imgCiphertext: z.string().max(1_400_000).optional(),
  media: z.array(mediaItemSchema).max(4).optional(),
  comments: z
    .array(
      z.object({
        id: z.string().min(8).max(64),
        iv: z.string().max(512),
        ciphertext: z.string().max(MAX_COMMENT_CHARS),
        creatorFp: fpSchema,
        createdAt: z.string().max(40),
      })
    )
    .max(MAX_COMMENTS_PER_POST)
    .optional(),
  creatorFp: fpSchema,
  createdAt: z.string().max(40),
});

const reseedSchema = z.object({
  action: z.literal("reseed"),
  fingerprint: fpSchema,
  posts: z.array(reseedPostSchema).max(MAX_RESEED),
});

const bodySchema = z.discriminatedUnion("action", [
  createSchema,
  attachSchema,
  commentSchema,
  uncommentSchema,
  deleteSchema,
  reseedSchema,
]);

// ------------------------------------------------------------ memory mirror

type MediaRec = { iv: string; ciphertext: string; mime: string; size: number };
type CommentRec = {
  id: string;
  iv: string;
  ciphertext: string;
  creatorFp: string;
  createdAt: number;
};
type WantedRec = {
  id: string;
  iv: string;
  ciphertext: string;
  /** Sparse by exhibit index — legacy single images fold in as slot 0. */
  media: (MediaRec | null)[];
  comments: CommentRec[];
  creatorFp: string;
  createdAt: number;
  expiresAt: number;
};

type BoardStore = Map<string, WantedRec> & { __bytes?: number };

/* globalThis pinning: survives dev-server module reloads and keeps exactly
   one board per process. ZERO DATABASE — process RAM only, dies with the
   process, and the client vault reseeds it after any cold restart. */
const g = globalThis as unknown as { __fastWantedBoard?: BoardStore };
const memory: BoardStore =
  g.__fastWantedBoard ?? new Map<string, WantedRec>() as BoardStore;
g.__fastWantedBoard = memory;
memory.__bytes ??= 0;

function isB64(v: string): boolean {
  return v.length > 0 && B64_RE.test(v);
}

function boardBytes(): number {
  return memory.__bytes ?? 0;
}

function sweep(): void {
  const now = Date.now();
  for (const [id, rec] of memory) {
    if (rec.expiresAt <= now) {
      for (const m of rec.media) {
        if (m) memory.__bytes = (memory.__bytes ?? 0) - (m.iv.length + m.ciphertext.length);
      }
      memory.delete(id);
    }
  }
  if (memory.size > MAX_POSTS) {
    const entries = [...memory.values()].sort((a, b) => a.createdAt - b.createdAt);
    const excess = memory.size - MAX_POSTS;
    for (let i = 0; i < excess; i++) {
      const rec = entries[i];
      for (const m of rec.media) {
        if (m) memory.__bytes = (memory.__bytes ?? 0) - (m.iv.length + m.ciphertext.length);
      }
      memory.delete(rec.id);
    }
  }
}

function validSealed(v: string, max: number): boolean {
  return v.length > 0 && v.length <= max && isB64(v);
}

function makeRec(
  p: { id: string; iv: string; ciphertext: string },
  creatorFp: string,
  createdAt: number
): WantedRec {
  return {
    id: p.id,
    iv: p.iv,
    ciphertext: p.ciphertext,
    media: Array(MAX_MEDIA_PER_POST).fill(null),
    comments: [],
    creatorFp,
    createdAt,
    expiresAt: createdAt + POST_TTL_MS,
  };
}

function putMedia(rec: WantedRec, index: number, item: { iv: string; ciphertext: string; mime: string }): boolean {
  if (!validSealed(item.iv, 512) || !validSealed(item.ciphertext, MAX_MEDIA_CHARS)) return false;
  if (!MIME_RE.test(item.mime)) return false;
  if (boardBytes() + item.ciphertext.length > MAX_MEDIA_TOTAL_CHARS) return false;
  const prev = rec.media[index];
  let delta = item.iv.length + item.ciphertext.length;
  if (prev) delta -= prev.iv.length + prev.ciphertext.length;
  memory.__bytes = (memory.__bytes ?? 0) + delta;
  rec.media[index] = { ...item, size: item.ciphertext.length };
  return true;
}

function putComment(rec: WantedRec, c: { id: string; iv: string; ciphertext: string; creatorFp: string; createdAt: number }): boolean {
  if (!validSealed(c.iv, 512) || !validSealed(c.ciphertext, MAX_COMMENT_CHARS)) return false;
  if (rec.comments.some((x) => x.id === c.id)) return true; // idempotent
  if (rec.comments.length >= MAX_COMMENTS_PER_POST) return false;
  rec.comments.push({ ...c });
  return true;
}

function toWire(rec: WantedRec) {
  return {
    id: rec.id,
    iv: rec.iv,
    ciphertext: rec.ciphertext,
    // light exhibit descriptors — ciphertext rides only in single fetches
    mediaList: rec.media
      .filter((m): m is MediaRec => m !== null)
      .map((m) => ({ mime: m.mime, size: m.size })),
    comments: rec.comments.map((c) => ({
      id: c.id,
      iv: c.iv,
      ciphertext: c.ciphertext,
      creatorFp: c.creatorFp,
      createdAt: new Date(c.createdAt).toISOString(),
    })),
    creatorFp: rec.creatorFp,
    createdAt: new Date(rec.createdAt).toISOString(),
    expiresAt: new Date(rec.expiresAt).toISOString(),
  };
}

// -------------------------------------------------------------------- GET

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const mediaIndex = url.searchParams.get("media");

  // single sealed exhibit fetch
  if (id && mediaIndex !== null) {
    const rl = rateLimit(`wanted-media:${clientIp(req)}`, 240, 60_000);
    if (!rl.ok) {
      return json({ ok: false, error: "Slow down." }, 429, { "Retry-After": String(rl.retryAfter) });
    }
    sweep();
    const rec = memory.get(id);
    if (!rec) return json({ ok: false, error: "Case gone." }, 404);
    const idx = Number(mediaIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_MEDIA_PER_POST) {
      return json({ ok: false, error: "Bad exhibit index." }, 400);
    }
    const item = rec.media[idx];
    if (!item) return json({ ok: false, error: "No exhibit there." }, 404);
    return json({ ok: true, iv: item.iv, ciphertext: item.ciphertext, mime: item.mime });
  }

  const rl = rateLimit(`wanted:${clientIp(req)}`, 90, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Slow down." }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  sweep();

  const posts = [...memory.values()].sort((a, b) => b.createdAt - a.createdAt).map(toWire);
  return json({ ok: true, count: posts.length, posts });
}

// ------------------------------------------------------------------- POST

export async function POST(req: Request) {
  const rl = rateLimit(`wanted-post:${clientIp(req)}`, 40, 60_000);
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
    if (!validSealed(p.iv, 512) || !validSealed(p.ciphertext, 12_000)) {
      return json({ ok: false, error: "Invalid encrypted blob" }, 400);
    }
    const now = Date.now();
    const rec = makeRec(p, body.fingerprint, now);
    memory.set(rec.id, rec);
    return json({ ok: true, id: rec.id, expiresAt: toWire(rec).expiresAt });
  }

  if (body.action === "attach") {
    sweep();
    const rec = memory.get(body.id);
    if (!rec) return json({ ok: false, error: "Case gone." }, 404);
    if (rec.creatorFp !== body.fingerprint) {
      return json({ ok: false, error: "Only the poster can build this case." }, 403);
    }
    const ok = putMedia(rec, body.index, body.item);
    if (!ok) {
      return json({ ok: false, error: "Exhibit rejected — too fat or board full." }, 413);
    }
    return json({ ok: true, index: body.index });
  }

  if (body.action === "comment") {
    sweep();
    const rec = memory.get(body.id);
    if (!rec) return json({ ok: false, error: "Case gone." }, 404);
    const now = Date.now();
    const ok = putComment(rec, {
      ...body.comment,
      creatorFp: body.fingerprint,
      createdAt: now,
    });
    if (!ok) return json({ ok: false, error: "Sakboek is vol." }, 413);
    return json({ ok: true });
  }

  if (body.action === "uncomment") {
    sweep();
    const rec = memory.get(body.id);
    if (!rec) return json({ ok: true, deleted: true });
    const before = rec.comments.length;
    rec.comments = rec.comments.filter(
      (c) => !(c.id === body.commentId && c.creatorFp === body.fingerprint)
    );
    return json({ ok: true, deleted: rec.comments.length !== before });
  }

  if (body.action === "reseed") {
    sweep();
    let restored = 0;
    for (const p of body.posts) {
      if (memory.has(p.id)) continue;
      if (!validSealed(p.iv, 512) || !validSealed(p.ciphertext, 12_000)) continue;
      const at = Date.parse(p.createdAt);
      if (!Number.isFinite(at) || at > Date.now() || Date.now() - at > POST_TTL_MS) continue;
      const rec = makeRec({ id: p.id, iv: p.iv, ciphertext: p.ciphertext }, p.creatorFp, at);
      // legacy single-image fold + v2 exhibits (best-effort)
      if (p.imgIv && p.imgCiphertext) {
        putMedia(rec, 0, { iv: p.imgIv, ciphertext: p.imgCiphertext, mime: "image/jpeg" });
      }
      if (p.media) {
        for (let i = 0; i < p.media.length && i < 4; i++) putMedia(rec, i, p.media[i]);
      }
      for (const c of p.comments ?? []) {
        const cat = Date.parse(c.createdAt);
        putComment(rec, {
          id: c.id,
          iv: c.iv,
          ciphertext: c.ciphertext,
          creatorFp: c.creatorFp,
          createdAt: Number.isFinite(cat) ? cat : at,
        });
      }
      memory.set(rec.id, rec);
      restored += 1;
    }
    return json({ ok: true, restored });
  }

  // delete — the creator's fingerprint must match (public material compare)
  const rec = memory.get(body.id);
  if (!rec) {
    return json({ ok: true, deleted: true }); // already gone — idempotent burn
  }
  if (rec.creatorFp !== body.fingerprint) {
    return json({ ok: false, error: "Only the poster can burn this." }, 403);
  }
  for (const m of rec.media) {
    if (m) memory.__bytes = (memory.__bytes ?? 0) - (m.iv.length + m.ciphertext.length);
  }
  memory.delete(body.id);
  return json({ ok: true, deleted: true });
}
