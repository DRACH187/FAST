import { z } from "zod";
import {
  json,
  mintCapability,
  missingConfigResponse,
  rateLimit,
  readJson,
  verifyAttestation,
  verifyCapability,
} from "@/lib/server-guard";

/**
 * WANTED board — zero-knowledge encrypted CASE FILES.
 * ===================================================
 * The browser seals EVERYTHING with AES-256-GCM (key derived client-side from
 * the now high-entropy gate passphrase — see wanted-crypto v2). This route
 * stores and serves CIPHERTEXT only — it can never read a post, an exhibit,
 * a comment or an author.
 *
 * AUTHORIZATION (M2 hardening — capabilities, never bare fingerprints):
 *   create  -> anyone past the gate; the server mints a MANAGE capability
 *              (HMAC bound to case id + holder fingerprint + expiry) that
 *              the creator stores. Knowing the creator's public fingerprint
 *              no longer grants ANY power.
 *   attach  -> valid MANAGE capability for that case.
 *   delete  -> valid MANAGE capability for that case, OR a boss attestation.
 *   comment -> returns a COMMENT capability bound to the comment id.
 *   uncomment-> valid COMMENT capability for that comment, OR boss.
 *   wipe    -> boss attestation required; wiped ids are tombstoned so client
 *              vault reseed can never resurrect them.
 *   reseed  -> ciphertext-only restore after a cold restart; tombstones and
 *              the 24h freshness window always apply.
 *
 *   GET                            -> light list: text ciphertext + media
 *                                     descriptors + comments (no media bytes)
 *   GET ?id=..&media=<index>       -> one sealed exhibit
 *
 * Retention: 24h, enforced on every access + a lazy sweep. Durability:
 * process RAM only — ZERO DATABASE (project law).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POST_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_POSTS = 200;
const MAX_RESEED = 30;
const MAX_MEDIA_PER_POST = 8;
const MAX_MEDIA_CHARS = 3_600_000; // b64 ceiling per exhibit (~2.6MB binary)
const MAX_MEDIA_TOTAL_CHARS = 96_000_000; // whole-board exhibit budget
const MAX_COMMENTS_PER_POST = 60;
const MAX_COMMENT_CHARS = 8_000;
const MAX_BODY_BYTES = 96_500_000; // attach rides under the board budget

const B64_RE = /^[A-Za-z0-9+/=]+$/;
const MIME_RE = /^(image\/jpeg|video\/mp4|video\/webm)$/;

const fpSchema = z.string().regex(/^[a-f0-9]{8,64}$/);
const mediaItemSchema = z.object({
  iv: z.string().max(512),
  ciphertext: z.string().max(MAX_MEDIA_CHARS),
  mime: z.string().regex(MIME_RE),
});

const createSchema = z
  .object({
    action: z.literal("create"),
    fingerprint: fpSchema,
    post: z.object({
      id: z.string().min(8).max(64),
      iv: z.string().max(512),
      ciphertext: z.string().max(12_000),
    }),
  })
  .strict();

const attachSchema = z
  .object({
    action: z.literal("attach"),
    fingerprint: fpSchema,
    id: z.string().min(8).max(64),
    index: z.number().int().min(0).max(MAX_MEDIA_PER_POST - 1),
    cap: z.string().min(8).max(1024).optional(),
    item: mediaItemSchema,
  })
  .strict();

const commentSchema = z
  .object({
    action: z.literal("comment"),
    fingerprint: fpSchema,
    id: z.string().min(8).max(64),
    comment: z.object({
      id: z.string().min(8).max(64),
      iv: z.string().max(512),
      ciphertext: z.string().max(MAX_COMMENT_CHARS),
    }),
  })
  .strict();

const uncommentSchema = z
  .object({
    action: z.literal("uncomment"),
    fingerprint: fpSchema,
    id: z.string().min(8).max(64),
    commentId: z.string().min(8).max(64),
    cap: z.string().min(8).max(1024).optional(),
    token: z.string().min(8).max(1024).optional(),
  })
  .strict();

const deleteSchema = z
  .object({
    action: z.literal("delete"),
    fingerprint: fpSchema,
    id: z.string().min(8).max(64),
    cap: z.string().min(8).max(1024).optional(),
    token: z.string().min(8).max(1024).optional(),
  })
  .strict();

const wipeSchema = z
  .object({
    action: z.literal("wipe"),
    fingerprint: fpSchema,
    // boss attestation REQUIRED — nobody else may purge the whole board
    token: z.string().min(8).max(1024),
  })
  .strict();

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

const reseedSchema = z
  .object({
    action: z.literal("reseed"),
    fingerprint: fpSchema,
    posts: z.array(reseedPostSchema).max(MAX_RESEED),
  })
  .strict();

const bodySchema = z.discriminatedUnion("action", [
  createSchema,
  attachSchema,
  commentSchema,
  uncommentSchema,
  deleteSchema,
  wipeSchema,
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

type BoardStore = Map<string, WantedRec> & { __bytes?: number; __tombstones?: Set<string> };

/* globalThis pinning: survives dev-server module reloads and keeps exactly
   one board per process. ZERO DATABASE — process RAM only, dies with the
   process, and the client vault reseeds it after any cold restart. */
const g = globalThis as unknown as { __fastWantedBoard?: BoardStore };
const memory: BoardStore =
  g.__fastWantedBoard ?? new Map<string, WantedRec>() as BoardStore;
g.__fastWantedBoard = memory;
memory.__bytes ??= 0;
memory.__tombstones ??= new Set<string>();

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

/** Wiped ids can never come back via reseed — the boss's burn is final. */
function tombstone(id: string): void {
  const t = memory.__tombstones;
  if (!t) return;
  t.add(id);
  if (t.size > 2000) {
    // bounded: drop the oldest quarter when the ledger fills
    let n = Math.floor(t.size / 4);
    for (const v of t) {
      if (n-- <= 0) break;
      t.delete(v);
    }
  }
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
    const rl = await rateLimit(req, "wanted-media", 240, 60_000);
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

  const rl = await rateLimit(req, "wanted", 90, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Slow down." }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  sweep();

  const posts = [...memory.values()].sort((a, b) => b.createdAt - a.createdAt).map(toWire);
  return json({ ok: true, count: posts.length, posts });
}

// ------------------------------------------------------------------- POST

export async function POST(req: Request) {
  const missing = missingConfigResponse();
  if (missing) return missing;
  const rl = await rateLimit(req, "wanted-post", 40, 60_000);
  if (!rl.ok) {
    return json({ ok: false, error: "Slow down." }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  const parsed = await readJson(req, MAX_BODY_BYTES);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);

  const check = bodySchema.safeParse(parsed.body);
  if (!check.success) return json({ ok: false, error: "Invalid payload" }, 400);
  const body = check.data;

  if (body.action === "create") {
    sweep();
    const p = body.post;
    if (!validSealed(p.iv, 512) || !validSealed(p.ciphertext, 12_000)) {
      return json({ ok: false, error: "Invalid encrypted blob" }, 400);
    }
    const now = Date.now();
    const rec = makeRec(p, body.fingerprint, now);
    memory.set(rec.id, rec);
    // mint the creator's MANAGE capability — bearer token for this case only
    const cap = mintCapability("manage", rec.id, body.fingerprint);
    return json({ ok: true, id: rec.id, expiresAt: toWire(rec).expiresAt, cap: cap.token, capExpiresAt: cap.expiresAt });
  }

  if (body.action === "attach") {
    sweep();
    const rec = memory.get(body.id);
    if (!rec) return json({ ok: false, error: "Case gone." }, 404);
    // MANAGE capability or nothing (M2: a stolen fingerprint grants nothing)
    if (!verifyCapability(body.cap, "manage", body.id, body.fingerprint)) {
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
    // mint the author's COMMENT capability for this one note
    const cap = mintCapability("uncomment", body.comment.id, body.fingerprint);
    return json({ ok: true, cap: cap.token, capExpiresAt: cap.expiresAt });
  }

  if (body.action === "uncomment") {
    sweep();
    const rec = memory.get(body.id);
    if (!rec) return json({ ok: true, deleted: true });
    // author capability, or an attested boss
    const capOk = body.cap
      ? verifyCapability(body.cap, "uncomment", body.commentId, body.fingerprint)
      : false;
    const bossOk = body.token
      ? verifyAttestation(body.token, body.fingerprint)?.role === "boss"
      : false;
    if (!capOk && !bossOk) {
      return json({ ok: false, error: "Not your note." }, 403);
    }
    const before = rec.comments.length;
    rec.comments = rec.comments.filter((c) => c.id !== body.commentId);
    return json({ ok: true, deleted: rec.comments.length !== before });
  }

  if (body.action === "reseed") {
    sweep();
    let restored = 0;
    for (const p of body.posts) {
      if (memory.has(p.id)) continue;
      if (memory.__tombstones?.has(p.id)) continue; // boss-burned stays dead
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

  if (body.action === "wipe") {
    // BOSS ONLY — the whole board burns and every wiped id is tombstoned so
    // client-vault reseeds cannot resurrect the garbage
    const attested = verifyAttestation(body.token, body.fingerprint);
    if (!attested || attested.role !== "boss") {
      return json({ ok: false, error: "Boss ground only." }, 403);
    }
    sweep();
    const wiped = memory.size;
    for (const [id, rec] of memory) {
      tombstone(id);
      for (const m of rec.media) {
        if (m) memory.__bytes = (memory.__bytes ?? 0) - (m.iv.length + m.ciphertext.length);
      }
      memory.delete(id);
    }
    return json({ ok: true, wiped });
  }

  // delete — MANAGE capability for this case, or an attested boss.
  // (M2: the creator's fingerprint is public and grants nothing by itself.)
  const rec = memory.get(body.id);
  if (!rec) {
    return json({ ok: true, deleted: true }); // already gone — idempotent burn
  }
  const capOk = body.cap
    ? verifyCapability(body.cap, "manage", body.id, body.fingerprint)
    : false;
  const bossOk = body.token
    ? verifyAttestation(body.token, body.fingerprint)?.role === "boss"
    : false;
  if (!capOk && !bossOk) {
    return json({ ok: false, error: "Only the poster or the boss can burn this." }, 403);
  }
  tombstone(body.id);
  for (const m of rec.media) {
    if (m) memory.__bytes = (memory.__bytes ?? 0) - (m.iv.length + m.ciphertext.length);
  }
  memory.delete(body.id);
  return json({ ok: true, deleted: true });
}
