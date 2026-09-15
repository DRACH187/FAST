"use client";

/**
 * WANTED capability store (client side — v3, UNTRACEABLE)
 * =======================================================
 * The server mints HMAC capabilities for "manage this case" and "uncomment
 * this note". Each capability is a bearer token bound to
 * (action, resource, HOLDER, expiry) — where the HOLDER is a RANDOM PER-ITEM
 * NONCE this device generated when it posted. The holder nonce is stored
 * HERE, next to the cap, and NOWHERE else: the server can authorize this
 * device without ever learning who the device is. Knowing a creator's
 * public fingerprint grants NOTHING (it never even reaches the board).
 *
 * Storage choice: localStorage (justified per spec §24 — display-level risk
 * under XSS, but deleting someone's case is low-harm). Never contains
 * plaintext content, never contains keys. v2/v1 records (fingerprint-bound)
 * are intentionally DROPPED — old caps cannot verify against holder-bound
 * tokens, so carrying them would be dead weight.
 */

const KEY = "fast_wanted_caps_v3";

type CapEntry = { cap: string; holder: string };

type CapRecord = {
  /** caseId -> manage cap + holder nonce */
  manage: Record<string, CapEntry>;
  /** commentId -> uncomment cap + holder nonce */
  comments: Record<string, CapEntry>;
};

/** Fresh random holder nonce — 32 hex chars, generated per post/comment. */
export function newHolderNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function load(): CapRecord {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { manage: {}, comments: {} };
    const parsed = JSON.parse(raw) as Partial<CapRecord>;
    const pick = (v: unknown): Record<string, CapEntry> => {
      if (typeof v !== "object" || v === null) return {};
      const out: Record<string, CapEntry> = {};
      for (const [k, entry] of Object.entries(v as Record<string, unknown>)) {
        if (
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as CapEntry).cap === "string" &&
          typeof (entry as CapEntry).holder === "string"
        ) {
          out[k] = { cap: (entry as CapEntry).cap, holder: (entry as CapEntry).holder };
        }
      }
      return out;
    };
    return { manage: pick(parsed.manage), comments: pick(parsed.comments) };
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

export function storeManageCap(caseId: string, cap: string, holder: string): void {
  if (!caseId || !cap || !holder) return;
  const rec = load();
  rec.manage[caseId] = { cap, holder };
  // bound the ledger: keep the newest 500 entries
  const keys = Object.keys(rec.manage);
  if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete rec.manage[k];
  save(rec);
}

export function storeCommentCap(commentId: string, cap: string, holder: string): void {
  if (!commentId || !cap || !holder) return;
  const rec = load();
  rec.comments[commentId] = { cap, holder };
  const keys = Object.keys(rec.comments);
  if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete rec.comments[k];
  save(rec);
}

export function getManageCap(caseId: string): CapEntry | undefined {
  return load().manage[caseId];
}

export function getCommentCap(commentId: string): CapEntry | undefined {
  return load().comments[commentId];
}

export function forgetCase(caseId: string): void {
  const rec = load();
  delete rec.manage[caseId];
  save(rec);
}
