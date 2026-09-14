"use client";

/**
 * WANTED vault — ciphertext-only IndexedDB cache (data-saving layer).
 * ===================================================================
 * After every board sync the raw wire (sealed envelopes, sealed exhibits,
 * sealed sakboek notes — NEVER keys) is mirrored here. When the serverless
 * process wakes up cold and the board is empty, the client reseeds the
 * board from this vault: the board self-heals, still zero-knowledge.
 *
 * Retention mirrors the server: 24h per entry, hard-pruned on every write.
 * Budget: ~64MB total, oldest entries dropped first — big case files die
 * so the board keeps breathing.
 */

import type { WantedWire } from "@/lib/crypto/wanted-crypto";

const DB_NAME = "fast-wanted-vault";
const DB_VERSION = 1;
const STORE = "wire";
const KEY = "board";
const MAX_POSTS = 120;
const MAX_TOTAL_CHARS = 64_000_000; // ~64MB of ciphertext
const RETENTION_MS = 24 * 60 * 60 * 1000;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const conn = req.result;
          if (!conn.objectStoreNames.contains(STORE)) conn.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function wireWeight(p: WantedWire): number {
  let n = p.iv.length + p.ciphertext.length;
  for (const m of p.media ?? []) n += m.iv.length + m.ciphertext.length;
  for (const c of p.comments ?? []) n += c.iv.length + c.ciphertext.length;
  if (p.imgIv) n += p.imgIv.length + (p.imgCiphertext?.length ?? 0);
  return n;
}

/** Read the cached wire, pruned to TTL. Best-effort — never throws. */
export async function loadVault(): Promise<WantedWire[]> {
  const conn = await openDb();
  if (!conn) return [];
  return new Promise((resolve) => {
    try {
      const tx = conn.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => {
        try {
          const raw = req.result as WantedWire[] | undefined;
          if (!Array.isArray(raw)) return resolve([]);
          const now = Date.now();
          resolve(
            raw.filter((p) => {
              const at = Date.parse(p.createdAt);
              return Number.isFinite(at) && now - at < RETENTION_MS;
            })
          );
        } catch {
          resolve([]);
        }
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** Mirror the board (ciphertext only). Best-effort — never throws. */
export async function saveVault(posts: WantedWire[]): Promise<void> {
  const conn = await openDb();
  if (!conn) return;
  return new Promise((resolve) => {
    try {
      const tx = conn.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      // the light board sync carries NO exhibit ciphertext — never let it
      // wipe exhibits/comments already merged into the vault
      const prevReq = store.get(KEY);
      prevReq.onsuccess = () => {
        try {
          const prevRows = Array.isArray(prevReq.result) ? (prevReq.result as WantedWire[]) : [];
          const prevById = new Map(prevRows.map((p) => [p.id, p]));
          const merged = posts.map((p) => {
            const old = prevById.get(p.id);
            if (!old) return p;
            const oldMedia = (old.media ?? []).filter((m) => m.ciphertext.length > 0);
            return {
              ...p,
              media: oldMedia.length > 0 ? oldMedia : p.media,
              comments: (p.comments ?? []).length > 0 ? p.comments : old.comments,
            };
          });
          const kept: WantedWire[] = [];
          let budget = MAX_TOTAL_CHARS;
          // newest first, then drop the fat tail once the budget is gone
          for (const p of [...merged].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))) {
            const w = wireWeight(p);
            if (kept.length < MAX_POSTS && budget - w >= 0) {
              kept.push(p);
              budget -= w;
            }
          }
          store.put(kept, KEY);
        } catch {
          /* best-effort */
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Wipe the vault (board burn / privacy purge). */
export async function clearVault(): Promise<void> {
  const conn = await openDb();
  if (!conn) return;
  return new Promise((resolve) => {
    try {
      const tx = conn.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Merge one decrypted-fetched exhibit back into the cached wire so a case
 * can reseed with its evidence after a cold restart (ciphertext only —
 * still zero knowledge). Creates the wire row if the board sync has not
 * written it yet.
 */
export async function upsertWire(
  post: WantedWire,
  exhibit: { iv: string; ciphertext: string; mime: string },
  index: number
): Promise<void> {
  const conn = await openDb();
  if (!conn) return;
  return new Promise((resolve) => {
    try {
      const tx = conn.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.get(KEY);
      req.onsuccess = () => {
        try {
          const board = Array.isArray(req.result) ? (req.result as WantedWire[]) : [];
          const row = board.find((p) => p.id === post.id);
          if (row) {
            row.media = Array.isArray(row.media) ? row.media : [];
            while (row.media.length <= index) row.media.push({ iv: "", ciphertext: "", mime: "image/jpeg" });
            row.media[index] = exhibit;
          } else {
            if (board.length >= MAX_POSTS) board.shift();
            const media: WantedWire["media"] = [];
            for (let i = 0; i <= index; i++) media.push({ iv: "", ciphertext: "", mime: "image/jpeg" });
            media[index] = exhibit;
            board.push({ ...post, media });
          }
          store.put(board, KEY);
        } catch {
          /* best-effort */
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
