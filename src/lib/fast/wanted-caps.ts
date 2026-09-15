"use client";

/**
 * WANTED capability store (client side — M2)
 * ==========================================
 * The server mints HMAC capabilities for "manage this case" and "uncomment
 * this note". They are bearer tokens bound to (action, resource, holder fp,
 * expiry) and are stored here — the ONLY authorization the client holds for
 * its own content. Knowing a creator's public fingerprint grants nothing.
 *
 * Storage choice: localStorage (justified per spec §24 — display-level risk
 * under XSS, but deleting someone's case is low-harm; the alternative of
 * RAM-only caps would make creators lose manage power on every reload,
 * which the fingerprint rotation already caused once). Never contains
 * plaintext content, never contains keys.
 */

const KEY = "fast_wanted_caps_v1";

type CapRecord = {
  /** caseId -> manage cap */
  manage: Record<string, string>;
  /** commentId -> uncomment cap */
  comments: Record<string, string>;
};

function load(): CapRecord {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { manage: {}, comments: {} };
    const parsed = JSON.parse(raw) as Partial<CapRecord>;
    return {
      manage: typeof parsed.manage === "object" && parsed.manage ? parsed.manage : {},
      comments: typeof parsed.comments === "object" && parsed.comments ? parsed.comments : {},
    };
  } catch {
    return { manage: {}, comments: {} };
  }
}

function save(rec: CapRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rec));
  } catch {
    /* storage unavailable — caps stay session-only */
  }
}

export function storeManageCap(caseId: string, cap: string): void {
  if (!caseId || !cap) return;
  const rec = load();
  rec.manage[caseId] = cap;
  // bound the ledger: keep the newest 500 entries
  const keys = Object.keys(rec.manage);
  if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete rec.manage[k];
  save(rec);
}

export function storeCommentCap(commentId: string, cap: string): void {
  if (!commentId || !cap) return;
  const rec = load();
  rec.comments[commentId] = cap;
  const keys = Object.keys(rec.comments);
  if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete rec.comments[k];
  save(rec);
}

export function getManageCap(caseId: string): string | undefined {
  return load().manage[caseId];
}

export function getCommentCap(commentId: string): string | undefined {
  return load().comments[commentId];
}

export function forgetCase(caseId: string): void {
  const rec = load();
  delete rec.manage[caseId];
  save(rec);
}
