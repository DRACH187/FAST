"use client";

/**
 * WANTED board — zero-knowledge content crypto (Layer 1 companion)
 * ================================================================
 * Every post is sealed in the browser with AES-256-GCM. The key is derived
 * with PBKDF2-SHA512 (310k iterations) from the gate passcode — which every
 * legitimate user proved at the front door — plus a fixed board salt.
 *
 * A post is a CASE FILE:
 *  - one sealed text envelope (title, description, alias, threat, status…)
 *  - N sealed media exhibits (JPEG stills / short MP4 clips), each with its
 *    own IV — uploaded one exhibit per request (serverless body limits)
 *  - N sealed comments in the sakboek, each with its own IV
 *
 * Invariants:
 *  - the server stores ONLY ciphertext + IVs; it cannot read a title, a
 *    description, an image, a clip, a comment, or an author
 *  - the passcode and every derived key live in RAM only (keyvault), never
 *    in LocalStorage / IndexedDB / cookies
 *  - media decrypt straight into RAM blob URLs and are revoked the moment
 *    their viewer unmounts — nothing media-related ever touches disk
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

/** Content payload carried INSIDE the encrypted text envelope. */
export type WantedStatus = "WANTED" | "ELIMINATED";

export type WantedContent = {
  title: string;
  description: string;
  alias: string;
  lastSeen: string;
  threat: 1 | 2 | 3 | 4 | 5;
  status: WantedStatus;
  bounty: string;
  by: string; // author callsign
  byRole: string; // "member" | "boss"
};

/** One sealed exhibit on the wire. */
export type WantedMediaWire = {
  iv: string;
  ciphertext: string;
  mime: string; // "image/jpeg" | "video/mp4" | "video/webm"
};

/** One sealed sakboek note on the wire. */
export type WantedCommentWire = {
  id: string;
  iv: string;
  ciphertext: string;
  creatorFp: string;
  createdAt: string;
};

/** Comment payload carried INSIDE the encrypted comment envelope. */
export type WantedComment = {
  text: string;
  by: string;
  byRole: string;
};

export type WantedWire = {
  id: string;
  iv: string;
  ciphertext: string;
  /** v2 exhibits (ciphertext rides only in single-exhibit fetches). */
  media?: WantedMediaWire[];
  /** Legacy v1 single-image fields — still accepted, folded into media. */
  imgIv?: string;
  imgCiphertext?: string;
  /** Light descriptors served with the list (no ciphertext). */
  mediaList?: Array<{ mime: string; size: number }>;
  comments?: WantedCommentWire[];
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

/** A media exhibit prepared for sealing: raw bytes + locked mime. */
export type MediaDraft = {
  bytes: Uint8Array;
  mime: "image/jpeg" | "video/mp4" | "video/webm";
};

/** Per-exhibit ciphertext ceiling on the wire (b64 chars, ~3.4MB binary). */
export const MAX_MEDIA_CIPHER_CHARS = 3_600_000;

async function encryptBytes(bytes: Uint8Array): Promise<{ iv: string; ciphertext: string }> {
  const key = await deriveBoardKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    new Uint8Array(bytes)
  );
  return { iv: bufToB64(iv), ciphertext: bufToB64(ciphertext) };
}

/** Seal the text envelope + every exhibit. Throws when an exhibit is too fat. */
export async function encryptWantedCase(
  content: WantedContent,
  media: MediaDraft[]
): Promise<{ iv: string; ciphertext: string; media: WantedMediaWire[] }> {
  const key = await deriveBoardKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    te.encode(JSON.stringify(content))
  );

  const sealed: WantedMediaWire[] = [];
  for (const item of media) {
    const sealedItem = await encryptBytes(item.bytes);
    if (sealedItem.ciphertext.length > MAX_MEDIA_CIPHER_CHARS) {
      throw new Error("media-too-big");
    }
    sealed.push({ ...sealedItem, mime: item.mime });
  }

  return {
    iv: bufToB64(iv),
    ciphertext: bufToB64(ciphertext),
    media: sealed,
  };
}

/** Legacy v1 composer shim — single image in, one-exhibit case out. */
export async function encryptWantedPost(
  content: WantedContent,
  imageBytes: Uint8Array | null
): Promise<{ iv: string; ciphertext: string; media: WantedMediaWire[] }> {
  return encryptWantedCase(
    content,
    imageBytes && imageBytes.length > 0
      ? [{ bytes: imageBytes, mime: "image/jpeg" }]
      : []
  );
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
      // ONLY two categories exist: WANTED and ELIMINATED. Legacy entries
      // posted under the old four-status scheme fold into WANTED.
      status: parsed.status === "ELIMINATED" ? "ELIMINATED" : "WANTED",
      bounty: String(parsed.bounty ?? "").slice(0, 60),
      by: String(parsed.by ?? "UNKNOWN").slice(0, 24),
      byRole: parsed.byRole === "boss" ? "boss" : "member",
    };
  } catch {
    return null; // wrong key generation or tampered blob — never render
  }
}

/** Decrypt one exhibit into a RAM blob (correct mime, zero disk). */
export async function decryptWantedMedia(item: {
  iv: string;
  ciphertext: string;
  mime: string;
}): Promise<Blob | null> {
  try {
    const key = await deriveBoardKey();
    const plain = await subtle.decrypt(
      { name: "AES-GCM", iv: toBuf(item.iv), tagLength: 128 },
      key,
      toBuf(item.ciphertext)
    );
    const mime = item.mime.startsWith("video/") ? item.mime : "image/jpeg";
    return new Blob([plain], { type: mime });
  } catch {
    return null;
  }
}

/** Legacy v1 single-image decrypt — folded into the media pipeline. */
export async function decryptWantedImage(post: {
  imgIv?: string;
  imgCiphertext?: string;
}): Promise<Blob | null> {
  if (!post.imgIv || !post.imgCiphertext) return null;
  return decryptWantedMedia({
    iv: post.imgIv,
    ciphertext: post.imgCiphertext,
    mime: "image/jpeg",
  });
}

// --------------------------------------------------------------- sakboek

/** Seal one sakboek note. */
export async function encryptWantedComment(note: WantedComment): Promise<{
  iv: string;
  ciphertext: string;
}> {
  const key = await deriveBoardKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    te.encode(JSON.stringify(note))
  );
  return { iv: bufToB64(iv), ciphertext: bufToB64(ciphertext) };
}

export async function decryptWantedComment(comment: {
  iv: string;
  ciphertext: string;
}): Promise<WantedComment | null> {
  try {
    const key = await deriveBoardKey();
    const plain = await subtle.decrypt(
      { name: "AES-GCM", iv: toBuf(comment.iv), tagLength: 128 },
      key,
      toBuf(comment.ciphertext)
    );
    const parsed = JSON.parse(td.decode(plain)) as Partial<WantedComment>;
    return {
      text: String(parsed.text ?? "").slice(0, 400),
      by: String(parsed.by ?? "GHOST").slice(0, 24),
      byRole: parsed.byRole === "boss" ? "boss" : "member",
    };
  } catch {
    return null;
  }
}
