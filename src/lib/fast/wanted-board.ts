/**
 * WANTED board — BOSS COMMAND PANEL stats sidecar.
 * ================================================
 * The WANTED board store lives in the wanted route module and pins itself on
 * globalThis (`__fastWantedBoard`) so one process holds exactly one board.
 * This sidecar reads THAT SAME pinned store — it owns nothing, writes
 * nothing — so the boss panel route can report board counts without the
 * route module's logic being imported (Next.js route files may not export
 * arbitrary helpers, hence this module).
 *
 * ZERO-KNOWLEDGE LAW: everything on the board is AES-256-GCM ciphertext.
 * These stats are COUNTS and byte weights only — no sealed blob, no key,
 * no author ever leaves the process through here.
 */

type MediaRec = { iv: string; ciphertext: string; mime: string; size: number };
type CommentRec = { id: string; iv: string; ciphertext: string };
type WantedRec = {
  id: string;
  media: (MediaRec | null)[];
  comments: CommentRec[];
  createdAt: number;
  expiresAt: number;
};

type BoardStore = Map<string, WantedRec> & { __bytes?: number; __tombstones?: Set<string> };

export type WantedBoardStats = {
  posts: number;
  exhibits: number;
  comments: number;
  tombstones: number;
  bytes: number;
  oldestPostAt: string | null;
  freshestPostAt: string | null;
};

/** Read-only stats over the shared pinned board (safe on a cold process). */
export function wantedBoardStats(): WantedBoardStats {
  const g = globalThis as unknown as { __fastWantedBoard?: BoardStore };
  const board = g.__fastWantedBoard;
  if (!board) {
    return { posts: 0, exhibits: 0, comments: 0, tombstones: 0, bytes: 0, oldestPostAt: null, freshestPostAt: null };
  }
  let exhibits = 0;
  let comments = 0;
  let oldest = Infinity;
  let freshest = 0;
  for (const rec of board.values()) {
    for (const m of rec.media) {
      if (m) exhibits += 1;
    }
    comments += rec.comments.length;
    if (rec.createdAt < oldest) oldest = rec.createdAt;
    if (rec.createdAt > freshest) freshest = rec.createdAt;
  }
  return {
    posts: board.size,
    exhibits,
    comments,
    tombstones: board.__tombstones?.size ?? 0,
    bytes: board.__bytes ?? 0,
    oldestPostAt: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null,
    freshestPostAt: freshest > 0 ? new Date(freshest).toISOString() : null,
  };
}
