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
 *  - UNTRACEABLE (v3): the wire carries NO creator fingerprint anywhere.
 *    Posts and comments are managed via random per-item HOLDER nonces
 *    (capability-bound, stored only on the poster's device), and "mine"
 *    detection rides a one-way creator tag sealed INSIDE the envelope —
 *    the server can never link two posts, or a post to a member.
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

const PBKDF2_ITERATIONS = 600_000;
/**
 * v2 BOARD SALT (H2 hardening): the board key is now derived from the
 * HIGH-ENTROPY gate passphrase (env-configured, never the historical
 * 3-digit public code) with a fresh versioned salt. Old v1 ciphertext
 * fails AEAD under the new key and simply never renders — it ages out of
 * the 24h server retention on its own.
 */
const BOARD_SALT = "FAST.WANTED.BOARD.v2.aes256gcm";

/** Ciphertext length buckets for the text envelopes — blunts exact-length
 *  traffic analysis (the observer sees "≤1KB case", not "213 bytes").
 *  `p` is pure filler, dropped on decrypt; unpadded blobs still decrypt. */
const PAD_BUCKETS = [256, 1024, 4096, 16384];

function padJson(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj);
  const size = te.encode(json).length;
  const bucket = PAD_BUCKETS.find((b) => size <= b);
  if (bucket === undefined) return json;
  const jitter = crypto.getRandomValues(new Uint8Array(1))[0] % 48;
  const filler = Math.max(0, bucket - size - 12 - jitter);
  return JSON.stringify({ ...obj, p: "x".repeat(filler) });
}

/** Content payload carried INSIDE the encrypted text envelope. */
export type WantedStatus = "WANTED" | "ELIMINATED";

/** Explicit content-format version — decrypt refuses anything else. */
const CONTENT_VERSION = 2;

export type WantedContent = {
  /** content-format version stamped inside the sealed envelope (v2 board) */
  wv?: number;
  title: string;
  description: string;
  alias: string;
  lastSeen: string;
  threat: 1 | 2 | 3 | 4 | 5;
  status: WantedStatus;
  bounty: string;
  by: string; // author callsign
  byRole: string; // "member" | "boss"
  /** one-way creator tag — sealed inside; never on the wire (v3 law) */
  tag?: string;
};

/** One sealed exhibit on the wire. */
export type WantedMediaWire = {
  iv: string;
  ciphertext: string;
  mime: string; // "image/jpeg" | "video/mp4" | "video/webm"
};

/** One sealed sakboek note on the wire — authorship is SEALED, never public. */
export type WantedCommentWire = {
  id: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
};

/** Comment payload carried INSIDE the encrypted comment envelope. */
export type WantedComment = {
  text: string;
  by: string;
  byRole: string;
  /** one-way creator tag — sealed inside; never on the wire (v3 law) */
  tag?: string;
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
  createdAt: string;
  expiresAt: string;
};

// -------------------------------------------------------------- creator tag
// A post's authorship never touches the wire. Instead the creator seals a
// ONE-WAY tag inside the envelope: SHA-256(domain || fingerprint), truncated.
// Every device holding the same fingerprint derives the same tag, so "mine"
// still lights up — but the server and outside observers get fokol to link.

const TAG_DOMAIN = "fast.wanted.creator.v1";

export async function wantedCreatorTag(fp: string): Promise<string> {
  const digest = await subtle.digest("SHA-256", te.encode(`${TAG_DOMAIN}:${fp}`));
  const view = new DataView(digest);
  let hex = "";
  for (let i = 0; i < 8; i++) hex += view.getUint16(i * 2).toString(16).padStart(4, "0");
  return hex.slice(0, 32);
}

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
  content: Omit<WantedContent, "wv">,
  media: MediaDraft[]
): Promise<{ iv: string; ciphertext: string; media: WantedMediaWire[] }> {
  const key = await deriveBoardKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    te.encode(padJson({ ...content, wv: CONTENT_VERSION }))
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
    const parsed = JSON.parse(td.decode(plain)) as Partial<WantedContent> & { wv?: number };
    // explicit versioning (spec §9): anything not v2 is refused, never
    // rendered — old-format blobs simply never appear on the v2 board
    if (parsed.wv !== CONTENT_VERSION) return null;
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
      tag: typeof parsed.tag === "string" ? parsed.tag.slice(0, 32) : "",
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
    te.encode(padJson(note))
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
      tag: typeof parsed.tag === "string" ? parsed.tag.slice(0, 32) : "",
    };
  } catch {
    return null;
  }
}
