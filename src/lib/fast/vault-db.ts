"use client";

/**
 * FAST — local vault (data-saving layer)
 * ======================================
 * Persists NON-SECRET data in IndexedDB so sessions survive reloads:
 *   - session rows: code, createdAt, unread, heldKey (metadata only)
 *   - wire blobs:   ciphertext + IV + counter (sealed data — never keys)
 *   - composer drafts: sessionStorage (tab-scoped, wiped when the tab closes)
 *
 * Security invariants:
 *   - Session keys and identity keys NEVER touch this store. All key
 *     material lives in module RAM (lib/crypto/keyvault.ts) and dies with
 *     the tab — reloading always requires a member to re-wrap the key.
 *   - Restored ciphertext is rendered sealed until a member re-wraps the
 *     session key; only then is it decrypted again (see session-manager).
 *   - Deleting a session wipes its rows here immediately.
 */

import type { WireMessage } from "@/lib/fast/api";

const DB_NAME = "fast-vault";
const DB_VERSION = 2;
const S_SESSIONS = "sessions";
const S_WIRE = "wire";
const S_META = "meta";
const MAX_WIRE_PER_SESSION = 200;
const DRAFT_PREFIX = "fast-draft:";
const MY_FPS_KEY = "my-fps";
/**
 * HARD RETENTION LIMIT — the server wipes every chat 5 hours after it was
 * created; the local vault honours the exact same window so no ciphertext
 * outlives the room on this device either.
 */
const RETENTION_MS = 5 * 60 * 60 * 1000;

export type StoredSession = {
  code: string;
  createdAt: string;
  unread: number;
  heldKey: boolean;
  savedAt: number;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const conn = req.result;
        if (!conn.objectStoreNames.contains(S_SESSIONS)) {
          conn.createObjectStore(S_SESSIONS, { keyPath: "code" });
        }
        if (!conn.objectStoreNames.contains(S_WIRE)) {
          const store = conn.createObjectStore(S_WIRE, { keyPath: ["code", "id"] });
          store.createIndex("byCode", "code", { unique: false });
        }
        if (!conn.objectStoreNames.contains(S_META)) {
          conn.createObjectStore(S_META, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function db(): Promise<IDBDatabase | null> {
  dbPromise ??= openDb();
  return dbPromise;
}

function asPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb request failed"));
  });
}

// ------------------------------------------------------------------ retention

/**
 * Purge every stored session row and ciphertext blob older than 5 hours
 * (mirrors the server-side retention window). Called on app entry and on a
 * slow interval; safe to call repeatedly.
 */
export async function sweepExpired(): Promise<void> {
  const conn = await db();
  if (!conn) return;
  const cutoff = Date.now() - RETENTION_MS;
  try {
    const sessions = (await (async () => {
      const tx = conn.transaction(S_SESSIONS);
      return asPromise(tx.objectStore(S_SESSIONS).getAll()) as Promise<StoredSession[]>;
    })()) as StoredSession[];

    const staleRows = sessions.filter((s) => {
      const at = Date.parse(s.createdAt);
      return Number.isFinite(at) && at < cutoff;
    });
    if (staleRows.length === 0) return;

    const tx = conn.transaction([S_SESSIONS, S_WIRE], "readwrite");
    const sStore = tx.objectStore(S_SESSIONS);
    const wStore = tx.objectStore(S_WIRE);
    for (const row of staleRows) {
      sStore.delete(row.code);
      wStore.delete(IDBKeyRange.bound([row.code, ""], [row.code, "\uffff"]));
    }
  } catch {
    /* ignore — worst case a stale sealed blob lingers until the next sweep */
  }
}

// ---------------------------------------------------------------- sessions

/**
 * Upsert session rows. `heldKey` is merged (never downgraded): a reload
 * strips the in-RAM key but the device DID hold it, which is what allows
 * the restored transcript to be re-revealed after a key re-wrap.
 */
export async function saveSessions(rows: StoredSession[]): Promise<void> {
  const conn = await db();
  if (!conn || rows.length === 0) return;
  try {
    const current = (await (async () => {
      const tx = conn.transaction(S_SESSIONS);
      return asPromise(tx.objectStore(S_SESSIONS).getAll()) as Promise<StoredSession[]>;
    })()) as StoredSession[];
    const prev = new Map(current.map((r) => [r.code, r]));
    const tx = conn.transaction(S_SESSIONS, "readwrite");
    const store = tx.objectStore(S_SESSIONS);
    for (const row of rows) {
      const old = prev.get(row.code);
      store.put({
        code: row.code,
        createdAt: row.createdAt,
        unread: row.unread,
        heldKey: (old?.heldKey ?? false) || row.heldKey,
        savedAt: Date.now(),
      });
    }
  } catch {
    /* storage unavailable — session simply stays memory-only */
  }
}

export async function markKeyHeld(code: string): Promise<void> {
  const conn = await db();
  if (!conn) return;
  try {
    const row = (await (async () => {
      const tx = conn.transaction(S_SESSIONS);
      return asPromise(tx.objectStore(S_SESSIONS).get(code)) as Promise<StoredSession | undefined>;
    })()) as StoredSession | undefined;
    if (!row) return;
    const tx = conn.transaction(S_SESSIONS, "readwrite");
    tx.objectStore(S_SESSIONS).put({ ...row, heldKey: true, savedAt: Date.now() });
  } catch {
    /* ignore */
  }
}

/** Remove a session and all of its ciphertext + draft (delete / close / terminated). */
export async function forgetSession(code: string): Promise<void> {
  const conn = await db();
  if (!conn) return;
  try {
    conn.transaction(S_SESSIONS, "readwrite").objectStore(S_SESSIONS).delete(code);
    conn
      .transaction(S_WIRE, "readwrite")
      .objectStore(S_WIRE)
      .delete(IDBKeyRange.bound([code, ""], [code, "\uffff"]));
  } catch {
    /* ignore */
  }
  clearDraft(code);
}

export async function loadVault(): Promise<{
  sessions: StoredSession[];
  wire: Record<string, WireMessage[]>;
}> {
  const conn = await db();
  if (!conn) return { sessions: [], wire: {} };
  try {
    const sessions = (await (async () => {
      const tx = conn.transaction(S_SESSIONS);
      return asPromise(tx.objectStore(S_SESSIONS).getAll()) as Promise<StoredSession[]>;
    })()) as StoredSession[];

    const raw = (await (async () => {
      const tx = conn.transaction(S_WIRE);
      return asPromise(tx.objectStore(S_WIRE).getAll()) as Promise<(WireMessage & { code: string })[]>;
    })()) as (WireMessage & { code: string })[];

    const wire: Record<string, WireMessage[]> = {};
    for (const row of raw) {
      (wire[row.code] ??= []).push({
        id: row.id,
        senderFp: row.senderFp,
        counter: row.counter,
        iv: row.iv,
        ciphertext: row.ciphertext,
        createdAt: row.createdAt,
      });
    }
    for (const code of Object.keys(wire)) {
      wire[code].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      wire[code] = wire[code].slice(-MAX_WIRE_PER_SESSION);
    }
    sessions.sort((a, b) => a.savedAt - b.savedAt);
    return { sessions, wire };
  } catch {
    return { sessions: [], wire: {} };
  }
}

// -------------------------------------------------------------------- wire

export async function loadWire(code: string): Promise<WireMessage[]> {
  const conn = await db();
  if (!conn) return [];
  try {
    const raw = (await (async () => {
      const tx = conn.transaction(S_WIRE);
      return asPromise(tx.objectStore(S_WIRE).index("byCode").getAll(code)) as Promise<
        (WireMessage & { code: string })[]
      >;
    })()) as (WireMessage & { code: string })[];
    return raw
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(({ id, senderFp, counter, iv, ciphertext, createdAt }) => ({
        id,
        senderFp,
        counter,
        iv,
        ciphertext,
        createdAt,
      }));
  } catch {
    return [];
  }
}

/** Persist wire blobs (ciphertext only) and keep growth bounded per session. */
export async function saveWire(code: string, messages: WireMessage[]): Promise<void> {
  const conn = await db();
  if (!conn || messages.length === 0) return;
  try {
    const putTx = conn.transaction(S_WIRE, "readwrite");
    const putStore = putTx.objectStore(S_WIRE);
    for (const m of messages) putStore.put({ ...m, code });

    // trim in a separate transaction (safe from auto-commit)
    const all = (await (async () => {
      const tx = conn.transaction(S_WIRE);
      return asPromise(tx.objectStore(S_WIRE).index("byCode").getAll(code)) as Promise<
        (WireMessage & { code: string })[]
      >;
    })()) as (WireMessage & { code: string })[];
    if (all.length > MAX_WIRE_PER_SESSION) {
      all.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const stale = all.slice(0, all.length - MAX_WIRE_PER_SESSION);
      const tx = conn.transaction(S_WIRE, "readwrite");
      const store = tx.objectStore(S_WIRE);
      for (const row of stale) store.delete([code, row.id]);
    }
  } catch {
    /* ignore */
  }
}

// --------------------------------------------------------------------- meta
// Fingerprints are PUBLIC identifiers (the server stores them as participant
// rows) — keeping this device's past fingerprints lets restored history stay
// correctly attributed as "mine" across reloads. No key material, ever.

export async function getMyFingerprints(): Promise<string[]> {
  const conn = await db();
  if (!conn) return [];
  try {
    const row = (await (async () => {
      const tx = conn.transaction(S_META);
      return asPromise(tx.objectStore(S_META).get(MY_FPS_KEY)) as Promise<
        { key: string; fps: string[] } | undefined
      >;
    })()) as { key: string; fps: string[] } | undefined;
    return row?.fps ?? [];
  } catch {
    return [];
  }
}

export async function recordMyFingerprint(fp: string): Promise<void> {
  const conn = await db();
  if (!conn || !fp) return;
  try {
    const known = new Set(await getMyFingerprints());
    known.add(fp);
    const tx = conn.transaction(S_META, "readwrite");
    tx.objectStore(S_META).put({ key: MY_FPS_KEY, fps: [...known].slice(-20) });
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ drafts
// Drafts are pre-encryption plaintext: tab-scoped sessionStorage only, never
// synced, never persisted across tab close, wiped the moment a message sends.

export function saveDraft(code: string, text: string): void {
  try {
    if (text) sessionStorage.setItem(DRAFT_PREFIX + code, text);
    else sessionStorage.removeItem(DRAFT_PREFIX + code);
  } catch {
    /* ignore */
  }
}

export function loadDraft(code: string): string {
  try {
    return sessionStorage.getItem(DRAFT_PREFIX + code) ?? "";
  } catch {
    return "";
  }
}

export function clearDraft(code: string): void {
  try {
    sessionStorage.removeItem(DRAFT_PREFIX + code);
  } catch {
    /* ignore */
  }
}
