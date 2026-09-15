/**
 * FAST — OPEN VUUR, the fully public room (shared truth)
 * ======================================================
 * One room for the whole house: every ouen who passed the 187 gate walks in
 * without a code, an invite or a key wrap. It still answers to the harshest
 * crypto law in the app:
 *
 *   - every message rides the standard per-message AES-256-GCM ratchet
 *   - every envelope is signed by its sender (M1)
 *   - the room key is DERIVED, never distributed: HKDF over a constant house
 *     seed + the room's current EPOCH. Every 5-hour wipe bumps the epoch and
 *     rotates the key — ciphertext anyone archived from an older epoch turns
 *     into permanent fokol the moment the room burns.
 *
 * This module is importable from BOTH the server routes and client code —
 * pure constants and pure functions, no node APIs, no react.
 */

/** The 6-letter room code ("PUBLIC" fits the CODE_RE shape by design). */
export const PUBLIC_ROOM = "PUBLIC";

/** The wipe cycle — same 5h law as every private werf, but ROLLING. */
export const PUBLIC_WIPE_MS = 5 * 60 * 60 * 1000;

export function isPublicRoom(code: string): boolean {
  return code === PUBLIC_ROOM;
}
