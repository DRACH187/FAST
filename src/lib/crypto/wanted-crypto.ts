"use client";

/**
 * WANTED board — zero-knowledge content crypto (Layer 1 companion)
 * ================================================================
 * Every post is sealed in the browser with AES-256-GCM. The key is derived
 * with PBKDF2-SHA512 (310k iterations) from the gate passcode — which every
 * legitimate user proved at the front door — plus a fixed board salt.
 *
 * Invariants:
 *  - the server stores ONLY { id, iv, ciphertext[, imgIv, imgCiphertext] };
 *    it cannot read a title, a description, an image, or an author
 *  - the passcode and every derived key live in RAM only (keyvault), never
 *    in LocalStorage / IndexedDB / cookies
 *  - images decrypt straight into RAM blob URLs and are revoked + dropped
 *    the moment their card unmounts
 */

import { b64ToBuf, bufToB64 } from "@/lib/crypto/e2ee";

const subtle = crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

/** b64 -> fresh ArrayBuffer-backed bytes (satisfies BufferSource strictly). */
function toBuf(b64: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(b64ToBuf(b64));
}

const PBKDF2_ITERATIONS = 310_000;
const BOARD_SALT = "FAST.WANTED.BOARD.v1.aes256gcm";

/** Content payload carried INSIDE the encrypted envelope. */
export type WantedContent = {
  title: string;
  description: string;
  alias: string;
  lastSeen: string;
  threat: 1 | 2 | 3 | 4 | 5;
  status: "ACTIVE" | "CAPTURED" | "ELIMINATED" | "MISSING";
  bounty: string;
  by: string; // author callsign
  byRole: string; // "member" | "boss"
};

export type WantedWire = {
  id: string;
  iv: string;
  ciphertext: string;
  imgIv?: string;
  imgCiphertext?: string;
  creatorFp: string;
  createdAt: string;
  expiresAt: string;
};

// RAM key cache — derived once per tab, dropped with the tab
let boardKey: CryptoKey | null = null;

async function deriveBoardKey(): Promise<CryptoKey> {
  if (boardKey) return boardKey;
  const { getGatePasscode } = await import("@/lib/crypto/keyvault");
  const passcode = getGatePasscode() ?? "";
  const base = await subtle.importKey("raw", te.encode(passcode), "PBKDF2", false, [
    "deriveKey",
  ]);
  boardKey = await subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: te.encode(BOARD_SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-512",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable: the raw key material can never be read back out
    ["encrypt", "decrypt"]
  );
  return boardKey;
}

export function hasWantedKeyMaterial(): boolean {
  return boardKey !== null;
}

/** Called when the gate is re-entered / phase changes so the key follows. */
export function resetWantedKey(): void {
  boardKey = null;
}

// ------------------------------------------------------------------ seal

export async function encryptWantedPost(
  content: WantedContent,
  imageBytes: Uint8Array | null
): Promise<Pick<WantedWire, "iv" | "ciphertext" | "imgIv" | "imgCiphertext">> {
  const key = await deriveBoardKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    te.encode(JSON.stringify(content))
  );

  let imgIv: string | undefined;
  let imgCiphertext: string | undefined;
  if (imageBytes && imageBytes.length > 0) {
    const iv2 = crypto.getRandomValues(new Uint8Array(12));
    const enc = await subtle.encrypt(
      { name: "AES-GCM", iv: iv2, tagLength: 128 },
      key,
      new Uint8Array(imageBytes)
    );
    imgIv = bufToB64(iv2);
    imgCiphertext = bufToB64(enc);
  }

  return {
    iv: bufToB64(iv),
    ciphertext: bufToB64(ciphertext),
    imgIv,
    imgCiphertext,
  };
}

export async function decryptWantedContent(post: {
  iv: string;
  ciphertext: string;
}): Promise<WantedContent | null> {
  try {
    const key = await deriveBoardKey();
    const plain = await subtle.decrypt(
      { name: "AES-GCM", iv: toBuf(post.iv), tagLength: 128 },
      key,
      toBuf(post.ciphertext)
    );
    const parsed = JSON.parse(td.decode(plain)) as Partial<WantedContent>;
    if (typeof parsed.title !== "string" || parsed.title.length === 0) return null;
    return {
      title: String(parsed.title).slice(0, 80),
      description: String(parsed.description ?? "").slice(0, 4000),
      alias: String(parsed.alias ?? "").slice(0, 60),
      lastSeen: String(parsed.lastSeen ?? "").slice(0, 60),
      threat: (Math.min(5, Math.max(1, Number(parsed.threat) || 3)) as WantedContent["threat"]),
      status: (["ACTIVE", "CAPTURED", "ELIMINATED", "MISSING"] as const).includes(
        parsed.status as WantedContent["status"]
      )
        ? (parsed.status as WantedContent["status"])
        : "ACTIVE",
      bounty: String(parsed.bounty ?? "").slice(0, 60),
      by: String(parsed.by ?? "UNKNOWN").slice(0, 24),
      byRole: parsed.byRole === "boss" ? "boss" : "member",
    };
  } catch {
    return null; // wrong key generation or tampered blob — never render
  }
}

export async function decryptWantedImage(post: {
  imgIv?: string;
  imgCiphertext?: string;
}): Promise<Blob | null> {
  if (!post.imgIv || !post.imgCiphertext) return null;
  try {
    const key = await deriveBoardKey();
    const plain = await subtle.decrypt(
      { name: "AES-GCM", iv: toBuf(post.imgIv), tagLength: 128 },
      key,
      toBuf(post.imgCiphertext)
    );
    return new Blob([plain], { type: "image/jpeg" });
  } catch {
    return null;
  }
}
