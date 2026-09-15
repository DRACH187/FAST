"use client";

/**
 * FAST — local vault (ADVANCED data-saving layer, v3)
 * ===================================================
 * Persists NON-SECRET data in IndexedDB so sessions survive reloads:
 *   - session rows: code, createdAt, unread, heldKey (metadata only)
 *   - wire blobs:   ciphertext, SEALED AT REST under a device-only
 *                   non-extractable AES-256-GCM key that lives inside the
 *                   vault itself and never leaves it (v3 format)
 *   - composer drafts: sessionStorage (tab-scoped, wiped when the tab closes)
 *   - device fingerprints (public identifiers) for "mine" attribution
 *
 * Security invariants:
 *   - Session keys and identity keys NEVER touch this store. All key
 *     material lives in module RAM (lib/crypto/keyvault.ts) and dies with
 *     the tab — reloading always requires a member to re-wrap the key.
 *   - v3: cached wire blobs are double-sealed. The inner layer is the
 *     session's own E2EE ciphertext; the outer layer is this device's vault
 *     key (generated once, non-extractable, stored as a CryptoKey handle
 *     inside IndexedDB). Pulling the raw rows off another device — or out of
 *     a stolen profile directory — yields fokol without the device vault.
 *   - Legacy v2 rows (plain ciphertext-at-rest) are still readable; they are
 *     re-sealed into v3 on their next write.
 *   - PASSPHRASE EXPORT/IMPORT: the whole vault can be smelted into one
 *     .fgv archive sealed under PBKDF2-SHA256 (310k rounds) + AES-256-GCM.
 *     Without the passphrase the archive is fokol — by design.
 *   - Deleting a session wipes its rows here immediately.
 *   - OPEN VUUR (the public room) is never written here at all: its key
 *     rotates with every 5-hour wipe epoch, so a cached copy would be dead
 *     weight — the room itself is the source of truth.
 */

import type { WireMessage } from "@/lib/fast/api";

const DB_NAME = "fast-vault";
const DB_VERSION = 3;
const S_SESSIONS = "sessions";
const S_WIRE = "wire";
const S_META = "meta";
const S_KEYS = "vaultkeys";
const MAX_WIRE_PER_SESSION = 200;
const DRAFT_PREFIX = "fast-draft:";
const MY_FPS_KEY = "my-fps";
const DEVICE_KEY_ID = "device-vault-key";
const EXPORT_MAGIC = "FG187-VAULT";
const EXPORT_VERSION = 3;
const PBKDF2_ROUNDS = 310_000;

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

/** v3 at-rest row: the wire message sealed under the device vault key. */
type SealedWireRow = {
  code: string;
  id: string;
  /** storage-seal IV (the message's own IV lives INSIDE the sealed box) */
  iv: string;
  box: string;
  savedAt: number;
};

/** v2 legacy row (still readable; never written anymore). */
type LegacyWireRow = WireMessage & { code: string };

type AnyWireRow = SealedWireRow | LegacyWireRow;

let dbPromise: Promise<IDBDatabase | null> | null = null;
/** device vault key — lazy, cached, never extractable */
let deviceKeyPromise: Promise<CryptoKey | null> | null = null;

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
        if (!conn.objectStoreNames.contains(S_KEYS)) {
          conn.createObjectStore(S_KEYS, { keyPath: "key" });
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

// ------------------------------------------------------------- device key

/**
 * The device vault key: AES-256-GCM, NON-extractable, generated once and
 * stored as a CryptoKey handle inside the vault itself. JS code can use it
 * to seal/open rows but can never read the raw bytes — and neither can
 * anything that copies the profile directory without also running as this
 * origin. If the environment refuses (private mode quirks), the vault
 * degrades gracefully to v2 plaintext-at-rest rows.
 */
function getDeviceKey(): Promise<CryptoKey | null> {
  deviceKeyPromise ??= (async () => {
    try {
      const conn = await db();
      if (!conn || typeof crypto === "undefined" || !crypto.subtle) return null;
      const tx = conn.transaction(S_KEYS);
      const row = (await asPromise(
        tx.objectStore(S_KEYS).get(DEVICE_KEY_ID)
      )) as { key: string; handle: CryptoKey } | undefined;
      if (row?.handle instanceof CryptoKey) return row.handle;
      const fresh = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
      const tx2 = conn.transaction(S_KEYS, "readwrite");
      tx2.objectStore(S_KEYS).put({ key: DEVICE_KEY_ID, handle: fresh });
      return fresh;
    } catch {
      return null;
    }
  })();
  return deviceKeyPromise;
}

const te = new TextEncoder();
const td = new TextDecoder();

async function sealWithDeviceKey(payload: string): Promise<{ iv: string; box: string } | null> {
  try {
    const key = await getDeviceKey();
    if (!key) return null;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const box = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(payload));
    return {
      iv: btoa(String.fromCharCode(...iv)),
      box: btoa(String.fromCharCode(...new Uint8Array(box))),
    };
  } catch {
    return null;
  }
}

async function openWithDeviceKey(ivB64: string, boxB64: string): Promise<string | null> {
  try {
    const key = await getDeviceKey();
    if (!key) return null;
    const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
    const box = Uint8Array.from(atob(boxB64), (c) => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, box);
    return td.decode(pt);
  } catch {
    return null;
  }
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

// -------------------------------------------------------- passphrase crypto

async function derivePasskey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    te.encode(passphrase) as unknown as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as unknown as ArrayBuffer,
      iterations: PBKDF2_ROUNDS,
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
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

function wireFromRow(row: AnyWireRow): WireMessage | null {
  if ("box" in row) return null; // handled async elsewhere
  return {
    id: row.id,
    senderFp: row.senderFp,
    counter: row.counter,
    iv: row.iv,
    ciphertext: row.ciphertext,
    ...(row.sig ? { sig: row.sig } : {}),
    createdAt: row.createdAt,
  };
}

async function rowsToWire(rows: AnyWireRow[]): Promise<WireMessage[]> {
  const out: WireMessage[] = [];
  for (const row of rows) {
    if ("box" in row) {
      const json = await openWithDeviceKey(row.iv, row.box);
      if (!json) continue; // sealed to another device vault — drop quietly
      try {
        const parsed = JSON.parse(json) as WireMessage;
        if (parsed && typeof parsed.id === "string") out.push(parsed);
      } catch {
        /* corrupt row — skip */
      }
    } else {
      const w = wireFromRow(row);
      if (w) out.push(w);
    }
  }
  return out;
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
      return asPromise(tx.objectStore(S_WIRE).getAll()) as Promise<AnyWireRow[]>;
    })()) as AnyWireRow[];

    const wire: Record<string, WireMessage[]> = {};
    for (const row of raw) {
      let msg: WireMessage | null = null;
      if ("box" in row) {
        const json = await openWithDeviceKey(row.iv, row.box);
        if (json) {
          try {
            const parsed = JSON.parse(json) as WireMessage;
            if (parsed && typeof parsed.id === "string") msg = parsed;
          } catch {
            /* corrupt row — skip */
          }
        }
      } else {
        msg = {
          id: row.id,
          senderFp: row.senderFp,
          counter: row.counter,
          iv: row.iv,
          ciphertext: row.ciphertext,
          ...(row.sig ? { sig: row.sig } : {}),
          createdAt: row.createdAt,
        };
      }
      if (!msg) continue;
      (wire[row.code] ??= []).push(msg);
    }
    for (const code of Object.keys(wire)) {
      wire[code] = wire[code]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .slice(-MAX_WIRE_PER_SESSION);
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
      return asPromise(tx.objectStore(S_WIRE).index("byCode").getAll(code)) as Promise<AnyWireRow[]>;
    })()) as AnyWireRow[];
    const decoded = await rowsToWire(raw);
    return decoded
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .slice(-MAX_WIRE_PER_SESSION);
  } catch {
    return [];
  }
}

/** Persist wire blobs (double-sealed) and keep growth bounded per session. */
export async function saveWire(code: string, messages: WireMessage[]): Promise<void> {
  const conn = await db();
  if (!conn || messages.length === 0) return;
  try {
    for (const m of messages) {
      const sealed = await sealWithDeviceKey(
        JSON.stringify({
          id: m.id,
          senderFp: m.senderFp,
          counter: m.counter,
          iv: m.iv,
          ciphertext: m.ciphertext,
          ...(m.sig ? { sig: m.sig } : {}),
          createdAt: m.createdAt,
        })
      );
      const tx = conn.transaction(S_WIRE, "readwrite");
      const store = tx.objectStore(S_WIRE);
      if (sealed) {
        const row: SealedWireRow = { code, id: m.id, iv: sealed.iv, box: sealed.box, savedAt: Date.now() };
        store.put(row);
      } else {
        // degraded mode — plaintext-at-rest v2 row (still ciphertext of the E2EE)
        store.put({ ...m, code } satisfies LegacyWireRow);
      }
    }

    // trim in separate reads (safe from auto-commit)
    const all = (await (async () => {
      const tx = conn.transaction(S_WIRE);
      return asPromise(tx.objectStore(S_WIRE).index("byCode").getAll(code)) as Promise<AnyWireRow[]>;
    })()) as AnyWireRow[];
    if (all.length > MAX_WIRE_PER_SESSION) {
      const stamped = await Promise.all(
        all.map(async (row) => {
          if ("box" in row) return { row, at: row.savedAt };
          return { row, at: Date.parse(row.createdAt) || 0 };
        })
      );
      stamped.sort((a, b) => a.at - b.at);
      const stale = stamped.slice(0, stamped.length - MAX_WIRE_PER_SESSION);
      const tx = conn.transaction(S_WIRE, "readwrite");
      const store = tx.objectStore(S_WIRE);
      for (const { row } of stale) store.delete([code, row.id]);
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

// --------------------------------------------------------------- telemetry

/**
 * Live vault telemetry for the DATA-KLUIS panel: how many sealed blocks are
 * cached and how much of the device quota the vault occupies. Pure counters
 * and sizes — never a byte of content.
 */
export async function vaultStats(): Promise<{
  blobs: number;
  usedBytes: number | null;
  quotaBytes: number | null;
}> {
  let blobs = 0;
  try {
    const conn = await db();
    if (conn) {
      const tx = conn.transaction(S_WIRE);
      const n = await asPromise(tx.objectStore(S_WIRE).count());
      blobs = n;
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      return { blobs, usedBytes: est.usage ?? null, quotaBytes: est.quota ?? null };
    }
  } catch {
    /* ignore */
  }
  return { blobs, usedBytes: null, quotaBytes: null };
}

// ------------------------------------------------------------ export/import

export type ExportResult = { ok: true; json: string; blobs: number } | { ok: false };

/**
 * Smelt the whole vault into one passphrase-sealed archive. Inside the box:
 * session rows + wire blobs (still E2EE ciphertext). Outside: fokol anyone
 * can read without the passphrase — PBKDF2-SHA256 310k rounds, AES-256-GCM.
 */
export async function exportVault(passphrase: string): Promise<ExportResult> {
  if (passphrase.length < 8) return { ok: false };
  try {
    const conn = await db();
    if (!conn) return { ok: false };
    const sessions = (await (async () => {
      const tx = conn.transaction(S_SESSIONS);
      return asPromise(tx.objectStore(S_SESSIONS).getAll()) as Promise<StoredSession[]>;
    })()) as StoredSession[];
    const rawRows = (await (async () => {
      const tx = conn.transaction(S_WIRE);
      return asPromise(tx.objectStore(S_WIRE).getAll()) as Promise<AnyWireRow[]>;
    })()) as AnyWireRow[];

    // decode to portable form: the archive must be openable on ANY device
    // with just the passphrase — device-vault seals never leave this machine
    const wire: { code: string; msg: WireMessage }[] = [];
    for (const row of rawRows) {
      if ("box" in row) {
        const json = await openWithDeviceKey(row.iv, row.box);
        if (!json) continue;
        try {
          const parsed = JSON.parse(json) as WireMessage;
          if (parsed && typeof parsed.id === "string") wire.push({ code: row.code, msg: parsed });
        } catch {
          /* corrupt row — skip */
        }
      } else {
        wire.push({
          code: row.code,
          msg: {
            id: row.id,
            senderFp: row.senderFp,
            counter: row.counter,
            iv: row.iv,
            ciphertext: row.ciphertext,
            ...(row.sig ? { sig: row.sig } : {}),
            createdAt: row.createdAt,
          },
        });
      }
    }

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const passkey = await derivePasskey(passphrase, salt);
    const box = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      passkey,
      te.encode(
        JSON.stringify({
          sessions,
          // every blob rides with its room code so the import can file it again
          wire,
        })
      )
    );
    const archive = {
      app: EXPORT_MAGIC,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ROUNDS, salt: bytesToB64(salt) },
      iv: bytesToB64(iv),
      box: bytesToB64(new Uint8Array(box)),
      blobs: wire.length,
    };
    return { ok: true, json: JSON.stringify(archive), blobs: wire.length };
  } catch {
    return { ok: false };
  }
}

export type ImportResult = { ok: true; blobs: number; sessions: number } | { ok: false };

/**
 * Pour a passphrase-sealed archive back into the vault. Every imported wire
 * blob is re-sealed under THIS device's vault key on arrival. Rows older
 * than the 5h retention window are refused — dead kak stays dead.
 */
export async function importVault(archiveJson: string, passphrase: string): Promise<ImportResult> {
  if (passphrase.length < 8) return { ok: false };
  try {
    const parsed = JSON.parse(archiveJson) as {
      app?: string;
      version?: number;
      kdf?: { salt?: string; iterations?: number };
      iv?: string;
      box?: string;
      sessions?: StoredSession[];
      wire?: WireMessage[];
    };
    if (parsed.app !== EXPORT_MAGIC || typeof parsed.box !== "string" || typeof parsed.iv !== "string") {
      return { ok: false };
    }
    const salt = b64ToBytes(parsed.kdf?.salt ?? "");
    const passkey = await derivePasskey(passphrase, salt);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(parsed.iv) as unknown as ArrayBuffer },
      passkey,
      b64ToBytes(parsed.box) as unknown as ArrayBuffer
    );
    const content = JSON.parse(td.decode(pt)) as {
      sessions?: StoredSession[];
      wire?: { code: string; msg: WireMessage }[];
    };
    const sessions = (content.sessions ?? []).filter((s) => {
      const at = Date.parse(s.createdAt);
      return Number.isFinite(at) && Date.now() - at <= RETENTION_MS;
    });
    const wireRows = (content.wire ?? []).filter((entry) => {
      const at = Date.parse(entry?.msg?.createdAt ?? "");
      return (
        typeof entry?.code === "string" &&
        /^[A-Z]{6}$/.test(entry.code) &&
        typeof entry?.msg?.id === "string" &&
        Number.isFinite(at) &&
        Date.now() - at <= RETENTION_MS
      );
    });
    if (sessions.length > 0) await saveSessions(sessions);
    const byCode = new Map<string, WireMessage[]>();
    for (const { code, msg } of wireRows) {
      const list = byCode.get(code);
      if (list) list.push(msg);
      else byCode.set(code, [msg]);
    }
    let blobs = 0;
    for (const [code, list] of byCode) {
      await saveWire(code, list);
      blobs += list.length;
    }
    return { ok: true, blobs, sessions: sessions.length };
  } catch {
    return { ok: false };
  }
}
