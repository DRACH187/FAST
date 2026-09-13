/**
 * FAST — session-isolated key vault (Layer 1 companion)
 * =====================================================
 * Holds ALL secret key material in module-scope RAM only.
 *
 *  - Nothing here ever touches LocalStorage / sessionStorage / cookies /
 *    IndexedDB. Close the tab and every key is gone forever.
 *  - Session keys, identity key pairs and ratchet counters are keyed by
 *    session code, so several sessions can be open side-by-side
 *    (multiple sessions per tab is a first-class feature).
 *  - `keyReceivedAt` marks the moment this device obtained the session key;
 *    ciphertext older than that is intentionally undecryptable to us and is
 *    rendered as a sealed block (zero-knowledge join).
 */

import type { Identity, MessageEnvelope } from "./e2ee";

export type DecryptedMessage = {
  id: string;
  code: string;
  senderFp: string;
  mine: boolean;
  text: string;
  ts: number; // client send timestamp inside the encrypted payload
  createdAt: string; // server receive timestamp (wire ordering)
  counter?: number; // ratchet counter — stable logical identity per sender
  failed?: boolean; // AEAD authentication failure — tamper indicator
  sealed?: boolean; // arrived before this device held the session key
};

const vault = {
  identity: null as Identity | null,
  /** code -> raw 256-bit session key (never leaves this map) */
  sessionKeys: new Map<string, Uint8Array>(),
  /** code -> ratchet counter state { next to send, highest seen } */
  counters: new Map<string, { next: number; maxSeen: number }>(),
  /** code -> epoch ms when this device obtained the session key */
  keyReceivedAt: new Map<string, number>(),
  /** code -> blobs that arrived before we held the key (decrypted later) */
  pending: new Map<string, MessageEnvelope[]>(),
  /** code -> Set of envelope ids already applied to the transcript */
  seen: new Map<string, Set<string>>(),
};

// -- identity ---------------------------------------------------------------

export function setIdentity(identity: Identity) {
  vault.identity = identity;
}

export function getIdentity(): Identity | null {
  return vault.identity;
}

export async function ensureIdentity(): Promise<Identity> {
  if (!vault.identity) {
    const { generateIdentity } = await import("./e2ee");
    vault.identity = await generateIdentity();
  }
  return vault.identity;
}

// -- session keys ------------------------------------------------------------

export function storeSessionKey(code: string, key: Uint8Array) {
  if (!vault.sessionKeys.has(code)) {
    vault.sessionKeys.set(code, key);
    vault.keyReceivedAt.set(code, Date.now());
    vault.counters.set(code, { next: 0, maxSeen: -1 });
  }
}

export function getSessionKey(code: string): Uint8Array | null {
  return vault.sessionKeys.get(code) ?? null;
}

export function hasSessionKey(code: string): boolean {
  return vault.sessionKeys.has(code);
}

export function keyReceivedAt(code: string): number {
  return vault.keyReceivedAt.get(code) ?? Number.MAX_SAFE_INTEGER;
}

// -- counters (per-sender chains keyed by fingerprint inside HKDF info) ------

export function nextCounter(code: string): number {
  const state = vault.counters.get(code) ?? { next: 0, maxSeen: -1 };
  const counter = state.next;
  state.next = counter + 1;
  state.maxSeen = Math.max(state.maxSeen, counter);
  vault.counters.set(code, state);
  return counter;
}

export function observeCounter(code: string, counter: number) {
  const state = vault.counters.get(code) ?? { next: 0, maxSeen: -1 };
  if (counter > state.maxSeen) {
    state.maxSeen = counter;
    state.next = Math.max(state.next, counter + 1);
  }
  vault.counters.set(code, state);
}

// -- pending blobs (arrived pre-key) ------------------------------------------

export function stashPending(code: string, envelope: MessageEnvelope) {
  const list = vault.pending.get(code) ?? [];
  if (!list.some((e) => e.id === envelope.id)) list.push(envelope);
  vault.pending.set(code, list);
}

export function takePending(code: string): MessageEnvelope[] {
  const list = vault.pending.get(code) ?? [];
  vault.pending.delete(code);
  return list;
}

// -- dedupe -------------------------------------------------------------------

export function markSeen(code: string, id: string): boolean {
  let set = vault.seen.get(code);
  if (!set) {
    set = new Set();
    vault.seen.set(code, set);
  }
  if (set.has(id)) return false;
  set.add(id);
  return true;
}

// -- teardown ------------------------------------------------------------------

/** Forget a session entirely (called after "delete for everyone"). */
export function purgeSession(code: string) {
  vault.sessionKeys.delete(code);
  vault.counters.delete(code);
  vault.keyReceivedAt.delete(code);
  vault.pending.delete(code);
  vault.seen.delete(code);
}

/** Dev/diagnostics: prove nothing was ever persisted. */
export function vaultIsEmpty(): boolean {
  return vault.sessionKeys.size === 0;
}
