"use client";

/**
 * FAST — WANTED BOARD (case files)
 * ================================
 * Every entry is a CASE: a sealed text envelope plus up to 8 sealed media
 * exhibits (JPEG stills / short MP4/WebM clips) and a sealed comment thread
 * ("DIE SAKBOEK"). Everything is AES-256-GCM sealed client-side before it
 * leaves the tab; the server stores ciphertext only.
 *
 * UNTRACEABLE (v3): the wire carries NO creator fingerprint — posts and
 * comments are managed with random holder nonces stored only on the poster's
 * device, and "mine" rides a one-way creator tag sealed INSIDE each envelope.
 * PERSISTENT (v3): 7-day retention server-side + the IndexedDB ciphertext
 * vault reseeds a cold board, so material outlives restarts — still spoorloos.
 *
 * The case view reads like an evidence file: the MAIN EXHIBIT dominates the
 * RIGHT — scaled huge — with the paperwork + sakboek notes on the LEFT. On
 * phones it stacks — gallery first, huge, then the paper work. Exhibits
 * decrypt straight into RAM blob URLs and are revoked when the board
 * unmounts — nothing media-related ever touches disk. Tapping an exhibit
 * blows it up fullscreen (lightbox).
 *
 * Board features: live status filters, search across decrypted content,
 * threat meters, creator-only burn, 60s auto-refresh, cold-start self-heal
 * via the IndexedDB ciphertext vault, 7-day retention.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  ArrowLeft,
  Camera,
  Check,
  Crosshair,
  Eraser,
  FileWarning,
  Film,
  Flame,
  ImagePlus,
  Images,
  Lock,
  Maximize2,
  MessageSquare,
  Search,
  Send,
  Skull,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "@/components/fast/toast";
import { REDUCED_MOTION, ScreenShell, pressFeedback } from "@/components/fast/motion";
import { FastButton, FastInput, FastModal } from "@/components/fast/primitives";
import {
  decryptWantedComment,
  decryptWantedContent,
  decryptWantedMedia,
  encryptWantedCase,
  encryptWantedComment,
  MAX_MEDIA_CIPHER_CHARS,
  resetWantedKey,
  wantedCreatorTag,
  type MediaDraft,
  type WantedComment,
  type WantedContent,
  type WantedStatus,
  type WantedWire,
} from "@/lib/crypto/wanted-crypto";
import { clearVault, loadVault, saveVault, upsertWire } from "@/lib/crypto/wanted-vault";
import { getGatePasscode } from "@/lib/crypto/keyvault";
import {
  forgetCase,
  getCommentCap,
  getManageCap,
  newHolderNonce,
  storeCommentCap,
  storeManageCap,
} from "@/lib/fast/wanted-caps";
import {
  WANTED_ADD_MEDIA,
  WANTED_CASE_COUNT,
  WANTED_CASE_EMPTY,
  WANTED_CASE_NO,
  WANTED_COMMENTS_SUB,
  WANTED_COMMENTS_TITLE,
  WANTED_COMMENT_EMPTY,
  WANTED_COMMENT_PLACEHOLDER,
  WANTED_COMMENT_POST,
  WANTED_COMMENT_POSTED,
  WANTED_COMPOSE_SUB,
  WANTED_COMPOSE_TITLE,
  WANTED_EMPTY,
  WANTED_MEDIA_LABEL,
  WANTED_MEDIA_LIMIT,
  WANTED_MEDIA_TOO_BIG,
  WANTED_MEDIA_TOO_MANY,
  WANTED_MEDIA_UNREADABLE,
  WANTED_RETENTION_LAW,
  WANTED_SEALED_META,
  WANTED_SORT_EVIDENCE,
  WANTED_SORT_NEWEST,
  WANTED_SORT_THREAT,
  WANTED_SUB,
  WANTED_TTL_LEFT,
  WANTED_VARADOS_JAB,
  WANTED_WIPE_CTA,
  WANTED_WIPE_CONFIRM,
  WANTED_WIPE_GO,
  WANTED_WIPED,
  WANTED_ZERO_PREMADE,
  pick,
} from "@/lib/fast/copy";
import type { Role } from "@/lib/fast/identity-store";

gsap.registerPlugin(useGSAP);

// ------------------------------------------------------------------ consts

const LIST_URL = "/api/wanted";
const REFRESH_MS = 60_000;
const MAX_MEDIA = 8;
const MAX_VIDEO_BYTES = 2_600_000;
const STATUS_ALL = "ALL";
type StatusFilter = typeof STATUS_ALL | WantedStatus;
type SortMode = "newest" | "threat" | "evidence";
const SORTS: { id: SortMode; label: string }[] = [
  { id: "newest", label: WANTED_SORT_NEWEST },
  { id: "threat", label: WANTED_SORT_THREAT },
  { id: "evidence", label: WANTED_SORT_EVIDENCE },
];

/** Stable case stamp: first 4 hex of the id — same stamp on every device. */
function caseNo(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h.toString(16).toUpperCase().padStart(4, "0").slice(-4);
}

/** Time left before the board's 7-day retention burns this case. */
function ttlLeft(createdAtIso: string): string {
  const at = Date.parse(createdAtIso) + 7 * 24 * 60 * 60 * 1000;
  const ms = Math.max(0, at - Date.now());
  const d = Math.floor(ms / (24 * 3_600_000));
  const h = Math.floor((ms % (24 * 3_600_000)) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return WANTED_TTL_LEFT(d, h, m);
}

/** ONLY two categories exist on this board: WANTED and ELIMINATED. */
const STATUSES: WantedStatus[] = ["WANTED", "ELIMINATED"];

const STATUS_ICON: Record<WantedStatus, typeof Skull> = {
  WANTED: Crosshair,
  ELIMINATED: Skull,
};

function threatLabel(threat: number): string {
  return ["MINIMAL", "LOW", "ELEVATED", "HIGH", "CRITICAL"][Math.min(4, Math.max(0, threat - 1))];
}

function timeAgo(iso: string): string {
  const ms = Date.now() - (Date.parse(iso) || Date.now());
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "JUST NOW";
  if (m < 60) return `${m}M AGO`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}H AGO`;
  return `${Math.floor(h / 24)}D AGO`;
}

/** Compose state kept in RAM until encrypted and posted. */
type Draft = {
  title: string;
  description: string;
  alias: string;
  lastSeen: string;
  bounty: string;
  threat: 1 | 2 | 3 | 4 | 5;
  status: WantedStatus;
};

const EMPTY_DRAFT: Draft = {
  title: "",
  description: "",
  alias: "",
  lastSeen: "",
  bounty: "",
  threat: 3,
  status: "WANTED",
};

/** A staged exhibit: raw sealed-later bytes + a RAM preview URL. */
type StagedMedia = MediaDraft & { previewUrl: string };

// ------------------------------------------------------- media pre-processing

/** Downscale + re-encode to JPEG in-memory. Returns null if unreadable/too big. */
async function prepareImage(file: File): Promise<Uint8Array | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const max = 1280;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.72));
    if (!blob || blob.size > MAX_VIDEO_BYTES) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

/** Stage one picked file into the case (image → JPEG downscale, video → raw). */
async function stageFile(file: File): Promise<StagedMedia | null> {
  const isVideo = file.type.startsWith("video/");
  if (isVideo) {
    if (file.size > MAX_VIDEO_BYTES) return null;
    if (!/^(video\/mp4|video\/webm|video\/quicktime)$/.test(file.type)) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    return {
      bytes,
      mime: file.type === "video/webm" ? "video/webm" : "video/mp4",
      previewUrl: URL.createObjectURL(file),
    };
  }
  const bytes = await prepareImage(file);
  if (!bytes) return null;
  return {
    bytes,
    mime: "image/jpeg",
    previewUrl: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" })),
  };
}

// -------------------------------------------------------------------- types

type BoardEntry = {
  wire: WantedWire;
  content: WantedContent | null; // null = sealed (key not held / tampered)
  mine: boolean;
};

type WantedScreenProps = {
  open: boolean;
  onClose: () => void;
  myFp: string;
  myNickname: string;
  myRole: Role;
  /** Signed callsign attestation — lets the BOSS burn any case. */
  myToken: string;
};

// --------------------------------------------------------------- component

export function WantedScreen({ open, onClose, myFp, myNickname, myRole, myToken }: WantedScreenProps) {
  /* Task 19: mounted starts at `open` — see map-screen note. The shell
     mounts this board only while its tab is active, so the board fetches
     the moment it appears. */
  const [mounted, setMounted] = useState(open);
  const [shownOpen, setShownOpen] = useState(open);
  const [entries, setEntries] = useState<BoardEntry[]>([]);
  const [filter, setFilter] = useState<StatusFilter>(STATUS_ALL);
  const [sort, setSort] = useState<SortMode>("newest");
  const [query, setQuery] = useState("");
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [netError, setNetError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [sub] = useState(() => pick(WANTED_SUB));
  const [emptyLine] = useState(() => pick(WANTED_EMPTY));
  const [varadosJab] = useState(() => pick(WANTED_VARADOS_JAB));
  /** One-way creator tag for "mine" detection — never leaves this tab. */
  const [myTag, setMyTag] = useState("");

  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [staged, setStaged] = useState<StagedMedia[]>([]);
  const [posting, setPosting] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inflight = useRef(false);
  /** RAM blob-URL cache for decrypted exhibits — revoked on unmount. */
  const exhibitUrls = useRef<Map<string, string>>(new Map());

  // derive-during-render (React-sanctioned) — no cascading effect
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) setMounted(true);
  }

  useEffect(() => {
    let dead = false;
    void (async () => {
      const tag = await wantedCreatorTag(myFp);
      if (!dead) setMyTag(tag);
    })();
    return () => {
      dead = true;
    };
  }, [myFp]);

  const detail = useMemo(
    () => entries.find((e) => e.wire.id === detailId) ?? null,
    [entries, detailId]
  );

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (composeOpen) setComposeOpen(false);
        else if (detailId) setDetailId(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, onClose, composeOpen, detailId]);

  // ------------------------------------------------------------- data flow

  /** Fetch one sealed exhibit from the server. */
  const fetchExhibit = useCallback(
    async (postId: string, index: number): Promise<{ iv: string; ciphertext: string; mime: string } | null> => {
      try {
        const res = await fetch(`${LIST_URL}?id=${encodeURIComponent(postId)}&media=${index}`, {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          iv?: string;
          ciphertext?: string;
          mime?: string;
        };
        if (!res.ok || data.ok !== true || !data.iv || !data.ciphertext || !data.mime) return null;
        return { iv: data.iv, ciphertext: data.ciphertext, mime: data.mime };
      } catch {
        return null;
      }
    },
    []
  );

  const fetchBoard = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setFetching(true);
    try {
      const res = await fetch(LIST_URL, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        posts?: WantedWire[];
        error?: string;
      };
      if (!res.ok || data.ok !== true || !Array.isArray(data.posts)) {
        setNetError(typeof data.error === "string" ? data.error : "Die blad is weg — probeer weer");
        return;
      }
      setNetError(null);
      setUpdatedAt(new Date().toISOString());

      let posts = data.posts;

      // cold-start self-heal: a wiped board gets its ciphertext re-uploaded
      // from the local vault (still zero-knowledge — blobs only, no identity)
      if (posts.length === 0) {
        const cached = await loadVault();
        if (cached.length > 0) {
          try {
            await fetch(LIST_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "reseed",
                posts: cached.slice(0, 30).map((p) => ({
                  id: p.id,
                  iv: p.iv,
                  ciphertext: p.ciphertext,
                  media: (p.media ?? []).slice(0, 4).map((m) => ({
                    iv: m.iv,
                    ciphertext: m.ciphertext,
                    mime: m.mime,
                  })),
                  comments: (p.comments ?? []).slice(0, 60).map((c) => ({
                    id: c.id,
                    iv: c.iv,
                    ciphertext: c.ciphertext,
                    createdAt: c.createdAt,
                  })),
                  createdAt: p.createdAt,
                })),
              }),
              cache: "no-store",
            });
            const again = await fetch(LIST_URL, { cache: "no-store" });
            const againData = (await again.json().catch(() => ({}))) as { posts?: WantedWire[] };
            if (again.ok && Array.isArray(againData.posts) && againData.posts.length > 0) {
              posts = againData.posts;
              toast.info(`Board restored — ${posts.length} encrypted cases`);
            }
          } catch {
            /* reseed is best-effort */
          }
        }
      }

      void saveVault(posts);

      // decrypt everything we can hold a key for (null content = sealed);
      // "mine" rides the sealed creator tag — the wire itself carries fokol
      const decrypted = await Promise.all(
        posts.map(async (wire) => {
          const content = await decryptWantedContent(wire);
          return {
            wire,
            content,
            mine: content !== null && myTag.length > 0 && content.tag === myTag,
          };
        })
      );
      setEntries(decrypted);
    } catch {
      setNetError("Netwerk onbereikbaar");
    } finally {
      setFetching(false);
      inflight.current = false;
    }
  }, [myTag]);

  // open -> refresh key material + fetch; poll every 60s while open
  useEffect(() => {
    if (!open || !mounted) return;
    resetWantedKey(); // re-derive from the RAM passcode on every open
    if (!getGatePasscode()) {
      toast.error("Board key unavailable — re-enter the gate");
      onClose();
      return;
    }
    void fetchBoard();
    refreshTimer.current = setInterval(() => void fetchBoard(), REFRESH_MS);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
      refreshTimer.current = null;
    };
  }, [open, mounted, fetchBoard, onClose]);

  // unmount -> revoke every RAM blob URL (exhibits + staged previews)
  useEffect(() => {
    if (!mounted) return;
    return () => {
      for (const url of exhibitUrls.current.values()) URL.revokeObjectURL(url);
      exhibitUrls.current.clear();
    };
  }, [mounted]);

  // GSAP: card stagger on entries change
  useGSAP(
    () => {
      if (REDUCED_MOTION || !gridRef.current) return;
      const cards = gridRef.current.querySelectorAll("[data-wcard]");
      gsap.fromTo(
        cards,
        { opacity: 0, y: 16, scale: 0.98 },
        { opacity: 1, y: 0, scale: 1, duration: 0.45, stagger: 0.05, ease: "power3.out", overwrite: "auto" }
      );
    },
    { scope: gridRef, dependencies: [entries.length, filter, query] }
  );

  // ------------------------------------------------------------- mutations

  const unstageAll = useCallback(() => {
    for (const s of staged) URL.revokeObjectURL(s.previewUrl);
    setStaged([]);
  }, [staged]);

  const stageFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const room = MAX_MEDIA - staged.length;
      if (room <= 0) {
        toast.error(WANTED_MEDIA_TOO_MANY);
        return;
      }
      const picked = [...files].slice(0, room);
      if (picked.length < files.length) toast.error(WANTED_MEDIA_TOO_MANY);
      const next: StagedMedia[] = [];
      for (const file of picked) {
        const item = await stageFile(file);
        if (!item) {
          toast.error(WANTED_MEDIA_UNREADABLE);
          continue;
        }
        next.push(item);
      }
      if (next.length > 0) setStaged((s) => [...s, ...next]);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    },
    [staged.length]
  );

  const unstageAt = useCallback((index: number) => {
    setStaged((s) => {
      const item = s[index];
      if (item) URL.revokeObjectURL(item.previewUrl);
      return s.filter((_, i) => i !== index);
    });
  }, []);

  const publish = useCallback(async () => {
    if (posting) return;
    const title = draft.title.trim();
    const description = draft.description.trim();
    if (!title) {
      toast.error("’n WANTED case sonder titel? Voetsek.");
      return;
    }
    setPosting(true);
    try {
      const sealed = await encryptWantedCase(
        {
          title: title.slice(0, 80),
          description: description.slice(0, 4000),
          alias: draft.alias.trim().slice(0, 60),
          lastSeen: draft.lastSeen.trim().slice(0, 60),
          bounty: draft.bounty.trim().slice(0, 60),
          threat: draft.threat,
          status: draft.status,
          by: myNickname,
          byRole: myRole,
          tag: await wantedCreatorTag(myFp), // sealed INSIDE — never on the wire
        },
        staged.map((s) => ({ bytes: s.bytes, mime: s.mime }))
      );
      const id = crypto.randomUUID();
      // random per-case holder nonce — the ONLY identity the board ever sees
      const holder = newHolderNonce();
      const res = await fetch(LIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          holder,
          post: { id, iv: sealed.iv, ciphertext: sealed.ciphertext },
        }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        cap?: string;
      };
      if (!res.ok || data.ok !== true) {
        toast.error(typeof data.error === "string" ? data.error : "Die merk wou nie hang nie — vuur weer");
        return;
      }
      // the MANAGE capability + holder nonce is this device's only
      // delete/attach authority — stored together, NOWHERE else
      if (typeof data.cap === "string") storeManageCap(id, data.cap, holder);
      // exhibits ride one per request (serverless body limits)
      let exhibitsDropped = 0;
      const manage = getManageCap(id);
      for (let i = 0; i < sealed.media.length; i++) {
        const item = sealed.media[i];
        if (item.ciphertext.length > MAX_MEDIA_CIPHER_CHARS) {
          exhibitsDropped += 1;
          continue;
        }
        try {
          const attachRes = await fetch(LIST_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "attach",
              holder: manage?.holder ?? holder,
              id,
              index: i,
              cap: manage?.cap,
              item: { iv: item.iv, ciphertext: item.ciphertext, mime: item.mime },
            }),
            cache: "no-store",
          });
          if (!attachRes.ok) exhibitsDropped += 1;
        } catch {
          exhibitsDropped += 1;
        }
      }
      toast.success(
        exhibitsDropped > 0
          ? "Die saak hang — sommige bewysstukke was te vet vir die pyplyn"
          : "Die saak hang. Laat hulle kom skrik."
      );
      setComposeOpen(false);
      setDraft(EMPTY_DRAFT);
      unstageAll();
      await fetchBoard();
    } catch (err) {
      if (err instanceof Error && err.message === "media-too-big") {
        toast.error(WANTED_MEDIA_TOO_BIG);
      } else {
        toast.error("Network unreachable — case not posted");
      }
    } finally {
      setPosting(false);
    }
  }, [draft, fetchBoard, myFp, myNickname, myRole, posting, staged, unstageAll]);

  const burn = useCallback(
    async (entry: BoardEntry) => {
      try {
        const manage = getManageCap(entry.wire.id);
        const res = await fetch(LIST_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "delete",
              holder: manage?.holder,
              id: entry.wire.id,
              cap: manage?.cap,
              token: myToken || undefined,
            }),
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || data.ok !== true) {
          toast.error(typeof data.error === "string" ? data.error : "Brand het gemors — probeer weer");
          return;
        }
        forgetCase(entry.wire.id);
        toast.success("Afgehaal — vir almal, vir goed");
        setDetailId(null);
        await fetchBoard();
      } catch {
        toast.error("Netwerk onbereikbaar");
      }
    },
    [fetchBoard, myToken]
  );

  const addComment = useCallback(
    async (entry: BoardEntry, text: string) => {
      const clean = text.trim().slice(0, 400);
      if (!clean) return;
      try {
        const sealed = await encryptWantedComment({
          text: clean,
          by: myNickname,
          byRole: myRole,
          tag: await wantedCreatorTag(myFp), // sealed authorship — wire sees fokol
        } satisfies WantedComment);
      const bodyCommentId = crypto.randomUUID();
      // per-comment holder nonce — even my own comments don't link to each other
      const holder = newHolderNonce();
        const res = await fetch(LIST_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "comment",
            holder,
            id: entry.wire.id,
            comment: { id: bodyCommentId, ...sealed },
          }),
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; cap?: string };
        if (!res.ok || data.ok !== true) {
          toast.error(typeof data.error === "string" ? data.error : "Die sakboek is toe — probeer weer");
          return;
        }
        if (typeof data.cap === "string" && typeof bodyCommentId === "string") {
          storeCommentCap(bodyCommentId, data.cap, holder);
        }
        toast.success(WANTED_COMMENT_POSTED);
        await fetchBoard();
      } catch {
        toast.error("Netwerk onbereikbaar");
      }
    },
    [fetchBoard, myFp, myNickname, myRole]
  );

  const removeComment = useCallback(
    async (entry: BoardEntry, commentId: string) => {
      try {
        const cap = getCommentCap(commentId);
        await fetch(LIST_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "uncomment",
            holder: cap?.holder,
            id: entry.wire.id,
            commentId,
            cap: cap?.cap,
            token: myToken || undefined,
          }),
          cache: "no-store",
        });
        await fetchBoard();
      } catch {
        toast.error("Netwerk onbereikbaar");
      }
    },
    [fetchBoard, myToken]
  );

  /** BOSS purge: burn the WHOLE board server-side (tombstoned) + the local vault. */
  const wipeBoard = useCallback(async () => {
    if (wiping || myRole !== "boss") return;
    setWiping(true);
    try {
      const res = await fetch(LIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "wipe",
          fingerprint: myFp,
          token: myToken,
        }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; wiped?: number };
      if (!res.ok || data.ok !== true) {
        toast.error(typeof data.error === "string" ? data.error : "Die blad wou nie brand nie");
        return;
      }
      await clearVault(); // this device's cached ciphertext dies too
      setDetailId(null);
      setWipeOpen(false);
      toast.success(WANTED_WIPED);
      await fetchBoard();
    } catch {
      toast.error("Netwerk onbereikbaar");
    } finally {
      setWiping(false);
    }
  }, [fetchBoard, myFp, myRole, myToken, wiping]);

  // ------------------------------------------------------------- derived

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = entries.filter((e) => {
      if (e.content === null) return q.length === 0 && filter === STATUS_ALL;
      if (filter !== STATUS_ALL && e.content.status !== filter) return false;
      if (q.length === 0) return true;
      return (
        e.content.title.toLowerCase().includes(q) ||
        e.content.description.toLowerCase().includes(q) ||
        e.content.alias.toLowerCase().includes(q) ||
        e.content.by.toLowerCase().includes(q)
      );
    });
    if (sort === "threat") {
      list.sort((a, b) => (b.content?.threat ?? 0) - (a.content?.threat ?? 0));
    } else if (sort === "evidence") {
      const weight = (e: BoardEntry) => (e.wire.mediaList?.length ?? 0) + (e.wire.imgIv ? 1 : 0);
      list.sort((a, b) => weight(b) - weight(a));
    } else {
      list.sort((a, b) => Date.parse(b.wire.createdAt) - Date.parse(a.wire.createdAt));
    }
    return list;
  }, [entries, filter, query, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: entries.length };
    for (const s of STATUSES) c[s] = 0;
    for (const e of entries) if (e.content) c[e.content.status] += 1;
    return c;
  }, [entries]);

  if (!open || !mounted) return null;

  /* Task 19: shell tab view — full screen on phones, pane panel on desktop
     (the desktop rail stays visible beside it). No portal: the content pane
     is the positioning ancestor on desktop. */
  return (
    <div
      className="fixed inset-0 z-[92] bg-black lg:absolute lg:inset-0 lg:z-auto"
      role="region"
      aria-label="WANTED board"
    >
      <ScreenShell as="div" className="flex h-dvh flex-col lg:h-full">
        {/* ---------------------------------------------------------- header */}
        {/* safe-area top: PWA standalone must clear the notch/status bar */}
        <header className="sticky top-0 z-20 border-b border-neutral-900 bg-black/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-3 sm:px-4">
            <button
              onClick={onClose}
              aria-label="Close WANTED board"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-neutral-400 outline-none transition-colors hover:bg-neutral-900 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
            >
              <ArrowLeft className="size-5" aria-hidden />
            </button>
            <Image
              src="/fast-logo.png"
              alt="FAST GUNS"
              width={256}
              height={256}
              draggable={false}
              className="h-8 w-8 shrink-0 mix-blend-screen"
            />
            <div className="flex min-w-0 flex-col">
              <span className="gang-font text-2xl leading-none text-white">WANTED</span>
              <span className="truncate font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500">
                {sub} · {counts.ALL} OP DIE BLAD
              </span>
            </div>
            <div className="flex-1" />
            {myRole === "boss" && counts.ALL > 0 && (
              <FastButton
                variant="danger"
                size="sm"
                onClick={() => setWipeOpen(true)}
                className="min-h-[40px] shrink-0 font-mono text-[10px] uppercase tracking-[0.16em]"
                aria-label={WANTED_WIPE_CTA}
              >
                <Eraser className="size-4" aria-hidden />
                <span className="hidden sm:inline">{WANTED_WIPE_CTA}</span>
              </FastButton>
            )}
            <FastButton
              size="sm"
              onClick={() => {
                setDraft(EMPTY_DRAFT);
                setStaged([]);
                setComposeOpen(true);
              }}
              className="min-h-[40px] shrink-0 font-mono text-xs uppercase tracking-[0.18em]"
            >
              <ImagePlus className="size-4" aria-hidden />
              BOU ‘N SAAK
            </FastButton>
          </div>

          {/* search + filters */}
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-3 pb-3 sm:px-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-neutral-600" aria-hidden />
              <FastInput
                value={query}
                onChange={(e) => setQuery(e.target.value.slice(0, 60))}
                placeholder="SOEK DIE DOODSLYS"
                aria-label="Search wanted cases"
                className="h-12 pl-10 font-mono text-sm font-bold tracking-[0.1em]"
              />
            </div>
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="Status filter">
              {([STATUS_ALL, ...STATUSES] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  role="tab"
                  aria-selected={filter === s}
                  onClick={() => setFilter(s)}
                  className={`flex min-h-[44px] shrink-0 items-center rounded-full border px-4 font-mono text-[11px] font-bold uppercase tracking-[0.18em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 ${
                    filter === s
                      ? "border-white bg-white text-black"
                      : "border-neutral-800 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
                  }`}
                >
                  {s} {counts[s] > 0 && `· ${counts[s]}`}
                </button>
              ))}
            </div>
            {/* sort — how the dead-list reads */}
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-neutral-600">SORT</span>
              <div className="flex gap-1" role="radiogroup" aria-label="Sort cases">
                {SORTS.map((s) => (
                  <button
                    key={s.id}
                    role="radio"
                    aria-checked={sort === s.id}
                    onClick={() => setSort(s.id)}
                    className={`flex min-h-[36px] items-center rounded-lg border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.16em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 ${
                      sort === s.id
                        ? "border-neutral-400 bg-neutral-950 text-white"
                        : "border-neutral-900 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>

        {/* ------------------------------------------------------------ grid */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {netError ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <FileWarning className="size-7 text-neutral-600" aria-hidden />
              <p className="text-sm text-neutral-300">{netError}</p>
              <FastButton variant="outline" onClick={() => void fetchBoard()} className="font-mono text-[10px] uppercase tracking-[0.2em]">
                Retry
              </FastButton>
            </div>
          ) : filtered.length === 0 && !fetching ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <Lock className="size-8 text-neutral-600" aria-hidden />
              <p className="max-w-sm text-base font-bold text-neutral-200">{emptyLine}</p>
              <p className="max-w-[320px] font-mono text-[10px] font-bold uppercase leading-relaxed tracking-[0.16em] text-neutral-500">
                {WANTED_ZERO_PREMADE}
              </p>
              <p className="max-w-[300px] text-[13px] font-semibold leading-relaxed text-neutral-500">
                {varadosJab}
              </p>
            </div>
          ) : (
            <div ref={gridRef} className="mx-auto grid w-full max-w-6xl gap-3 px-3 pb-[calc(var(--fast-dock-clear)+3rem)] pt-1 sm:grid-cols-2 sm:gap-4 sm:px-4 lg:grid-cols-3 lg:pb-10">
              {filtered.map((entry) => (
                <WantedCard
                  key={entry.wire.id}
                  entry={entry}
                  exhibitUrls={exhibitUrls.current}
                  fetchExhibit={fetchExhibit}
                  onOpen={() => setDetailId(entry.wire.id)}
                />
              ))}
              {fetching && entries.length === 0 && (
                <div className="col-span-full py-10 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-600">
                  Ontsleutel die blad…
                </div>
              )}
            </div>
          )}
        </div>

        {/* --------------------------------------------------------- footer */}
        <footer className="sticky bottom-0 border-t border-neutral-900 bg-black/85 px-3 pb-[calc(var(--fast-dock-clear)-0.5rem)] pt-2 backdrop-blur-md lg:pb-2">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-1 sm:px-4">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500">
              {updatedAt ? `Gesink ${timeAgo(updatedAt)}` : "Wag vir eerste sink"} · outo 60s
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500">
              <Flame className="size-3.5 shrink-0" aria-hidden />
              <span className="hidden sm:inline">{WANTED_RETENTION_LAW}</span>
              <span className="sm:hidden">7 DAE · SPOORLOOS</span>
            </span>
          </div>
        </footer>
      </ScreenShell>

      {/* ------------------------------------------------------- compose modal */}
      <FastModal open={composeOpen} onClose={() => setComposeOpen(false)} label="Build a WANTED case" wide>
        <div className="flex max-h-[80dvh] flex-col gap-4 overflow-y-auto">
          <div className="text-center">
            <h2 className="gang-font text-3xl text-white">{WANTED_COMPOSE_TITLE}</h2>
            <p className="mt-1.5 text-[13px] font-semibold leading-relaxed text-neutral-400">
              {WANTED_COMPOSE_SUB}
            </p>
          </div>

          {/* case builder — exhibits */}
          <div>
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*,video/mp4,video/webm"
              multiple
              onChange={(e) => void stageFiles(e.target.files)}
              className="sr-only"
              aria-label="Attach images or videos"
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => void stageFiles(e.target.files)}
              className="sr-only"
              aria-label="Take a photo"
            />
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">
                {WANTED_MEDIA_LABEL}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-neutral-600">
                {WANTED_CASE_COUNT(staged.length)} / {MAX_MEDIA}
              </span>
            </div>
            {staged.length === 0 ? (
              <p className="mt-2 text-[11px] font-semibold text-neutral-600">{WANTED_CASE_EMPTY}</p>
            ) : (
              <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
                {staged.map((item, i) => (
                  <div
                    key={item.previewUrl}
                    className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-neutral-800"
                  >
                    {item.mime.startsWith("video/") ? (
                      <span className="flex h-full w-full items-center justify-center bg-neutral-950">
                        <Film className="size-6 text-neutral-500" aria-hidden />
                      </span>
                    ) : (
                       
                      <img src={item.previewUrl} alt={`Exhibit ${i + 1}`} className="h-full w-full object-cover" />
                    )}
                    <button
                      onClick={() => unstageAt(i)}
                      aria-label={`Remove exhibit ${i + 1}`}
                      className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full border border-neutral-700 bg-black/85 text-neutral-300 outline-none hover:border-neutral-400 hover:text-white"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <FastButton
                variant="outline"
                size="sm"
                disabled={staged.length >= MAX_MEDIA}
                onClick={(e) => {
                  pressFeedback(e.currentTarget);
                  galleryInputRef.current?.click();
                }}
                className="font-mono text-[10px] uppercase tracking-[0.16em]"
              >
                <Images className="size-4" aria-hidden />
                {WANTED_ADD_MEDIA}
              </FastButton>
              <FastButton
                variant="outline"
                size="sm"
                disabled={staged.length >= MAX_MEDIA}
                onClick={(e) => {
                  pressFeedback(e.currentTarget);
                  cameraInputRef.current?.click();
                }}
                className="font-mono text-[10px] uppercase tracking-[0.16em]"
              >
                <Camera className="size-4" aria-hidden />
                KAMERA
              </FastButton>
            </div>
            <p className="mt-1.5 text-center font-mono text-[9px] uppercase tracking-[0.16em] text-neutral-700">
              {WANTED_MEDIA_LIMIT}
            </p>
          </div>

          <FastInput
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value.slice(0, 80) }))}
            placeholder="NAAM / TITEL *"
            aria-label="Title"
            maxLength={80}
            className="font-mono tracking-[0.08em] uppercase"
          />

          <textarea
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value.slice(0, 4000) }))}
            placeholder="DIE SAAK — wie, wat, waar…"
            aria-label="Description"
            rows={5}
            className="w-full resize-none rounded-xl border border-neutral-800 bg-black px-4 py-3 text-[15px] font-semibold leading-relaxed text-neutral-100 outline-none transition-colors placeholder:font-semibold placeholder:text-neutral-600 focus:border-neutral-400"
          />

          <div className="grid grid-cols-2 gap-2">
            <FastInput
              value={draft.alias}
              onChange={(e) => setDraft((d) => ({ ...d, alias: e.target.value.slice(0, 60) }))}
              placeholder="ALIAS"
              aria-label="Alias"
              maxLength={60}
            />
            <FastInput
              value={draft.lastSeen}
              onChange={(e) => setDraft((d) => ({ ...d, lastSeen: e.target.value.slice(0, 60) }))}
              placeholder="LAAS GESEN"
              aria-label="Last seen"
              maxLength={60}
            />
            <FastInput
              value={draft.bounty}
              onChange={(e) => setDraft((d) => ({ ...d, bounty: e.target.value.slice(0, 60) }))}
              placeholder="WYLDEPRYS (KEUSE)"
              aria-label="Bounty"
              maxLength={60}
            />
            <div className="flex items-center justify-between rounded-xl border border-neutral-800 bg-black px-3" aria-label="Threat level">
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-neutral-400">
                GEVAAR
              </span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setDraft((d) => ({ ...d, threat: n as Draft["threat"] }))}
                    aria-label={`Threat level ${n}`}
                    aria-pressed={draft.threat === n}
                    className="h-7 w-4 rounded-[3px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500"
                    style={{ background: n <= draft.threat ? "#ffffff" : undefined }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* category segmented control — WANTED or ELIMINATED, nothing else */}
          <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Category">
            {STATUSES.map((s) => {
              const Icon = STATUS_ICON[s];
              const active = draft.status === s;
              return (
                <button
                  key={s}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setDraft((d) => ({ ...d, status: s }))}
                  className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl border font-mono text-[11px] font-bold uppercase tracking-[0.14em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 ${
                    active
                      ? "border-white bg-white text-black"
                      : "border-neutral-800 text-neutral-400 hover:border-neutral-500"
                  }`}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {s}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2">
            <FastButton
              disabled={posting || draft.title.trim().length === 0}
              onClick={() => void publish()}
              className="w-full font-mono text-sm uppercase tracking-[0.24em]"
            >
              {posting ? "Word toegepin…" : "SEËL & PLAAS DIE SAAK"}
            </FastButton>
            <FastButton
              variant="ghost"
              className="w-full"
              onClick={() => {
                setComposeOpen(false);
                unstageAll();
              }}
            >
              Bly maar
            </FastButton>
          </div>
        </div>
      </FastModal>

      {/* ------------------------------------------------ boss wipe confirm */}
      <FastModal open={wipeOpen} onClose={() => setWipeOpen(false)} label="Burn the whole board">
        <div className="flex flex-col gap-5">
          <div className="text-center">
            <h2 className="flex items-center justify-center gap-2 text-base font-bold text-neutral-100">
              <Eraser className="size-5 text-neutral-300" aria-hidden />
              {WANTED_WIPE_CTA}
            </h2>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-neutral-400">{WANTED_WIPE_CONFIRM}</p>
            <p className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">
              Afgebrande sake kan NIE deur enige toestel se kluis teruglaai word nie.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <FastButton
              variant="danger"
              disabled={wiping}
              onClick={() => void wipeBoard()}
              className="w-full font-mono text-sm uppercase tracking-[0.22em]"
            >
              {wiping ? "DIT BRAND…" : WANTED_WIPE_GO}
            </FastButton>
            <FastButton variant="ghost" className="w-full" onClick={() => setWipeOpen(false)}>
              Bly maar
            </FastButton>
          </div>
        </div>
      </FastModal>

      {/* ---------------------------------------------------- case file view */}
      {detail && (
        <CaseFile
          entry={detail}
          myTag={myTag}
          isBoss={myRole === "boss"}
          exhibitUrls={exhibitUrls.current}
          fetchExhibit={fetchExhibit}
          onBurn={() => void burn(detail)}
          onComment={(text) => void addComment(detail, text)}
          onUncomment={(commentId) => void removeComment(detail, commentId)}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ pieces

/** Exhibit count + comment count off the light wire. */
function mediaTally(wire: WantedWire): { images: number; videos: number } {
  let images = 0;
  let videos = 0;
  for (const m of wire.mediaList ?? []) {
    if (m.mime.startsWith("video/")) videos += 1;
    else images += 1;
  }
  return { images, videos };
}

/**
 * Decrypt + decrypt one exhibit into a cached RAM URL. Shared by the board
 * thumbnails and the case gallery so nothing ever decrypts twice.
 */
async function exhibitUrl(
  wire: WantedWire,
  index: number,
  cache: Map<string, string>,
  fetchExhibit: (postId: string, index: number) => Promise<{ iv: string; ciphertext: string; mime: string } | null>
): Promise<string | null> {
  const key = `${wire.id}:${index}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let sealed: { iv: string; ciphertext: string; mime: string } | null = null;
  // legacy v1 wire: single inline image fields
  if (index === 0 && wire.imgIv && wire.imgCiphertext) {
    sealed = { iv: wire.imgIv, ciphertext: wire.imgCiphertext, mime: "image/jpeg" };
  } else if (wire.media && wire.media[index]) {
    sealed = wire.media[index];
  } else {
    sealed = await fetchExhibit(wire.id, index);
  }
  if (!sealed) return null;

  const blob = await decryptWantedMedia(sealed);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  cache.set(key, url);
  // mirror the exhibit into the local ciphertext vault so the case can
  // reseed with its evidence after a cold restart (still zero-knowledge)
  void upsertWire(wire, sealed, index);
  return url;
}

/** Board card thumbnail — decrypts exhibit 0 (images only) into RAM. */
function CaseThumb({
  wire,
  cache,
  fetchExhibit,
  className,
}: {
  wire: WantedWire;
  cache: Map<string, string>;
  fetchExhibit: (postId: string, index: number) => Promise<{ iv: string; ciphertext: string; mime: string } | null>;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(() => cache.get(`${wire.id}:0`) ?? null);
  const tally = mediaTally(wire);
  const hasMedia = (wire.mediaList?.length ?? 0) > 0 || Boolean(wire.imgIv);

  useEffect(() => {
    if (url || !hasMedia) return;
    const list = wire.mediaList ?? [];
    if (list.length > 0 && list[0].mime.startsWith("video/")) return; // no video thumnnails
    let dead = false;
    void (async () => {
      const u = await exhibitUrl(wire, 0, cache, fetchExhibit);
      if (!dead && u) setUrl(u);
    })();
    return () => {
      dead = true;
    };
     
  }, [wire.id]);

  if (!hasMedia || (tally.images === 0 && tally.videos > 0)) {
    return (
      <div className={`flex items-center justify-center bg-neutral-950 ${className ?? ""}`}>
        <Film className="size-6 text-neutral-800" aria-hidden />
      </div>
    );
  }
  if (!url) {
    return (
      <div className={`flex items-center justify-center bg-neutral-950 ${className ?? ""}`}>
        <Lock className="size-5 text-neutral-800" aria-hidden />
      </div>
    );
  }
   
  return <img src={url} alt="" className={className} draggable={false} />;
}

function ThreatMeter({ threat }: { threat: number }) {
  return (
    <span className="flex items-center gap-1" title={`Threat ${threat}/5 — ${threatLabel(threat)}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          aria-hidden
          className={`h-2.5 w-1.5 rounded-[2px] ${n <= threat ? "bg-white" : "bg-neutral-800"}`}
        />
      ))}
      <span className="ml-1 font-mono text-[8px] uppercase tracking-[0.18em] text-neutral-500">
        {threatLabel(threat)}
      </span>
    </span>
  );
}

function WantedCard({
  entry,
  exhibitUrls,
  fetchExhibit,
  onOpen,
}: {
  entry: BoardEntry;
  exhibitUrls: Map<string, string>;
  fetchExhibit: (postId: string, index: number) => Promise<{ iv: string; ciphertext: string; mime: string } | null>;
  onOpen: () => void;
}) {
  const { content, wire, mine } = entry;
  const tally = mediaTally(wire);
  const noteCount = wire.comments?.length ?? 0;

  if (!content) {
    // sealed: this device cannot decrypt this blob (foreign key generation)
    return (
      <div
        data-wcard
        className="flex flex-col gap-2 rounded-2xl border border-dashed border-neutral-800 bg-neutral-950 p-4"
      >
        <div className="flex items-center gap-2">
          <Lock className="size-3.5 text-neutral-600" aria-hidden />
          <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-neutral-500">
            Sealed case
          </span>
          <span className="flex-1" />
          <span className="fast-stamp" aria-hidden>
            {WANTED_CASE_NO(caseNo(wire.id))}
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-neutral-600">
          Hierdie saak is toegemaak met ‘n sleutel wat hierdie toestel nie kan aflei nie. Die ciphertext bly op die blad, onleesbaar.
        </p>
        <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-neutral-700">
          {timeAgo(wire.createdAt)}
        </span>
      </div>
    );
  }

  const StatusIcon = STATUS_ICON[content.status];
  const boss = content.byRole === "boss";

  return (
    <button
      data-wcard
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 text-left outline-none transition-all duration-200 focus-visible:border-neutral-400 hover:border-neutral-600 hover:bg-neutral-900 active:scale-[0.99]"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        <CaseThumb
          wire={wire}
          cache={exhibitUrls}
          fetchExhibit={fetchExhibit}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <span
          className={`absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.18em] backdrop-blur-sm ${
            content.status === "WANTED"
              ? "border-white/70 bg-black/70 text-white"
              : "border-neutral-600 bg-black/70 text-neutral-400 line-through"
          }`}
        >
          <StatusIcon className="size-3" aria-hidden />
          {content.status}
        </span>
        {/* case stamp — the file number that follows this case everywhere */}
        <span
          aria-hidden
          className="fast-stamp absolute right-2.5 top-2.5 origin-top-right"
        >
          {WANTED_CASE_NO(caseNo(wire.id))}
        </span>
        <span className="absolute bottom-2.5 left-2.5 flex items-center gap-2 rounded-full border border-neutral-800 bg-black/75 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.16em] text-neutral-300 backdrop-blur-sm">
          <span className="flex items-center gap-1">
            <Images className="size-3" aria-hidden />
            {tally.images + tally.videos}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="size-3" aria-hidden />
            {noteCount}
          </span>
        </span>
      </div>
      <div className="flex flex-col gap-2 p-4">
        <span className="font-mono text-sm font-bold uppercase tracking-[0.06em] text-white">
          {content.title}
        </span>
        {content.description && (
          <span className="line-clamp-2 text-xs font-semibold leading-relaxed text-neutral-500">
            {content.description}
          </span>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ThreatMeter threat={content.threat} />
          <span className="flex items-center gap-1 font-mono text-[8px] font-bold uppercase tracking-[0.16em] text-neutral-500">
            <Flame className="size-3" aria-hidden />
            {ttlLeft(wire.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-2 border-t border-neutral-900 pt-3">
          <span className={`truncate font-mono text-[10px] tracking-[0.14em] text-neutral-400 ${boss ? "drach-font text-xs tracking-[0.08em] text-white" : "uppercase"}`}>
            {boss ? content.by : `BY ${content.by}`}
          </span>
          {mine && (
            <span className="rounded-full border border-neutral-700 px-1.5 py-0.5 font-mono text-[7px] uppercase tracking-[0.14em] text-neutral-400">
              jou saak
            </span>
          )}
          <span className="flex-1" />
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-neutral-600">
            {timeAgo(wire.createdAt)}
          </span>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------- case file

type CaseFileProps = {
  entry: BoardEntry;
  /** This device's one-way creator tag — for "my note" burn rights. */
  myTag: string;
  /** The DRACH callsign may burn any case on the board. */
  isBoss: boolean;
  exhibitUrls: Map<string, string>;
  fetchExhibit: (postId: string, index: number) => Promise<{ iv: string; ciphertext: string; mime: string } | null>;
  onBurn: () => void;
  onComment: (text: string) => void;
  onUncomment: (commentId: string) => void;
  onClose: () => void;
};

/**
 * THE CASE FILE — the evidence DOMINATES THE RIGHT (scaled huge, lightbox on
 * tap), paperwork + sakboek sit on the LEFT. Full-screen on phones (stacked,
 * gallery on top), a wide two-column file on desktop.
 */
function CaseFile({
  entry,
  myTag,
  isBoss,
  exhibitUrls,
  fetchExhibit,
  onBurn,
  onComment,
  onUncomment,
  onClose,
}: CaseFileProps) {
  const { content, wire, mine } = entry;
  const [commentDraft, setCommentDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (REDUCED_MOTION) return;
      gsap.fromTo(
        galleryRef.current,
        { opacity: 0, x: 14 },
        { opacity: 1, x: 0, duration: 0.4, ease: "power3.out" }
      );
      gsap.fromTo(
        scrollRef.current,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power3.out", delay: 0.05 }
      );
    },
    { scope: galleryRef, dependencies: [wire.id] }
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!content) {
    return (
      <div className="fixed inset-0 z-[94] flex items-center justify-center bg-black/95 p-6" role="dialog" aria-label="Sealed case">
        <div className="flex flex-col items-center gap-3 text-center">
          <Lock className="size-6 text-neutral-600" aria-hidden />
          <p className="text-sm font-semibold text-neutral-400">Gesluit — hierdie toestel kom nie in die saak nie.</p>
          <FastButton variant="outline" onClick={onClose} className="font-mono text-[10px] uppercase tracking-[0.2em]">
            Terug
          </FastButton>
        </div>
      </div>
    );
  }

  const StatusIcon = STATUS_ICON[content.status];
  const boss = content.byRole === "boss";
  const exhibitCount = (wire.mediaList?.length ?? 0) + (wire.imgIv ? 1 : 0);
  const notes = wire.comments ?? [];

  return (
    <div className="fixed inset-0 z-[94] overflow-y-auto bg-black/97" role="dialog" aria-label="WANTED case file">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-4 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:p-6 lg:max-w-6xl">
        {/* top bar */}
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            aria-label="Back to the board"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-neutral-900 text-neutral-300 outline-none transition-colors hover:border-neutral-600 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
          <div className="flex min-w-0 flex-col">
            <span className="gang-font truncate text-2xl leading-tight text-white sm:text-3xl">{content.title}</span>
            <span className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500">
              <StatusIcon className="size-3.5" aria-hidden />
              {content.status} · {timeAgo(wire.createdAt)} · {exhibitCount} STUKKE · {notes.length} NOTES
            </span>
            <span className="fast-stamp mt-1.5 self-start" aria-hidden>
              {WANTED_CASE_NO(caseNo(wire.id))}
            </span>
          </div>
          <span className="flex-1" />
          {(mine || isBoss) && (
            <FastButton
              variant="danger"
              size="sm"
              onClick={onBurn}
              className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em]"
            >
              <Trash2 className="size-3.5" aria-hidden />
              {mine ? "BRAND" : "BOSS BRAND"}
            </FastButton>
          )}
        </div>

        {/* two-column case file — the HUGE exhibit takes the RIGHT, paperwork
            + sakboek the LEFT. DOM keeps the gallery first so phones get the
            media on top; on desktop order-2 throws it to the right column. */}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)]">
          {/* --------------------------------------- RIGHT: the evidence, scaled HUGE */}
          <section
            ref={galleryRef}
            aria-label="Case exhibits"
            className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 lg:order-2"
          >
            <ExhibitGallery
              wire={wire}
              cache={exhibitUrls}
              fetchExhibit={fetchExhibit}
            />
          </section>

          {/* -------------------------------- LEFT: info + sakboek comments */}
          <section
            ref={scrollRef}
            aria-label="Case info and comments"
            className="order-2 flex flex-col gap-4 lg:order-1"
          >
            {/* paperwork */}
            <div className="flex flex-col gap-3 rounded-2xl border border-neutral-800 bg-neutral-950 p-4 sm:p-5">
              {/* sealed-metadata strip — the file's own forensic row */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border border-dashed border-neutral-800 bg-black px-3 py-2">
                <span className="flex items-center gap-1.5 font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-neutral-400">
                  <Lock className="size-3" aria-hidden />
                  {WANTED_SEALED_META}
                </span>
                <span className="flex-1" />
                <span className="flex items-center gap-1 font-mono text-[8px] font-bold uppercase tracking-[0.16em] text-neutral-500">
                  <Flame className="size-3" aria-hidden />
                  {ttlLeft(wire.createdAt)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {content.alias && (
                  <p className="text-xs font-semibold text-neutral-300">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">ALIAS · </span>
                    {content.alias}
                  </p>
                )}
                {content.lastSeen && (
                  <p className="text-xs font-semibold text-neutral-300">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">LAAS GESEN · </span>
                    {content.lastSeen}
                  </p>
                )}
                {content.bounty && (
                  <p className="text-xs font-semibold text-neutral-200">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">WYLDEPRYS · </span>
                    {content.bounty}
                  </p>
                )}
              </div>
              <ThreatMeter threat={content.threat} />
              {content.description && (
                <p className="whitespace-pre-wrap border-t border-neutral-900 pt-3 text-sm font-semibold leading-relaxed text-neutral-200">
                  {content.description}
                </p>
              )}
              <div className="flex items-center gap-2 border-t border-neutral-900 pt-3">
                <span className={`truncate text-sm text-neutral-300 ${boss ? "drach-font text-base text-white" : "font-mono text-xs uppercase tracking-[0.14em]"}`}>
                  {content.by}
                </span>
                <span className="flex-1" />
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-neutral-600">
                  AES-256-GCM · RAM ONLY
                </span>
              </div>
            </div>

            {/* sakboek */}
            <div className="flex flex-col rounded-2xl border border-neutral-800 bg-neutral-950">
              <div className="flex items-center gap-2 border-b border-neutral-900 px-4 py-3 sm:px-5">
                <MessageSquare className="size-4 text-neutral-500" aria-hidden />
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-300">
                  {WANTED_COMMENTS_TITLE}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-neutral-600">
                  · {notes.length}
                </span>
              </div>
              <div className="max-h-[340px] min-h-[120px] overflow-y-auto overscroll-contain px-4 py-3 sm:px-5">
                {notes.length === 0 ? (
                  <p className="py-6 text-center text-xs font-semibold text-neutral-600">
                    {WANTED_COMMENT_EMPTY}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {notes.map((note) => (
                      <SakboekNote
                        key={note.id}
                        note={note}
                        myTag={myTag}
                        onBurn={() => onUncomment(note.id)}
                      />
                    ))}
                  </ul>
                )}
              </div>
              <form
                className="flex items-center gap-2 border-t border-neutral-900 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!commentDraft.trim()) return;
                  onComment(commentDraft);
                  setCommentDraft("");
                }}
              >
                <FastInput
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value.slice(0, 400))}
                  placeholder={WANTED_COMMENT_PLACEHOLDER}
                  aria-label="Write in the sakboek"
                  maxLength={400}
                  enterKeyHint="send"
                  className="flex-1"
                />
                <FastButton
                  size="icon"
                  type="submit"
                  aria-label={WANTED_COMMENT_POST}
                  disabled={commentDraft.trim().length === 0}
                  className="shrink-0"
                >
                  <Send className="size-5" aria-hidden />
                </FastButton>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** One decrypted sakboek note (author + time + burn when mine). */
function SakboekNote({
  note,
  myTag,
  onBurn,
}: {
  note: { id: string; iv: string; ciphertext: string; createdAt: string };
  myTag: string;
  onBurn: () => void;
}) {
  const [note_, setNote_] = useState<WantedComment | null>(null);
  useEffect(() => {
    let dead = false;
    void (async () => {
      const c = await decryptWantedComment(note);
      if (!dead) setNote_(c);
    })();
    return () => {
      dead = true;
    };
  }, [note]);

  // authorship rides the SEALED tag — the wire itself carries fokol
  const mine = note_?.tag !== undefined && note_.tag.length > 0 && note_.tag === myTag;
  const boss = note_?.byRole === "boss";

  return (
    <li className="flex flex-col gap-1 rounded-xl border border-neutral-900 bg-black px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`truncate font-mono text-[10px] tracking-[0.14em] text-neutral-400 ${boss ? "drach-font text-xs tracking-[0.08em] text-white" : "uppercase"}`}>
          {note_?.by ?? "…"}
        </span>
        <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-neutral-600">
          {timeAgo(note.createdAt)}
        </span>
        <span className="flex-1" />
        {mine && (
          <button
            onClick={onBurn}
            aria-label="Remove your note"
            className="flex size-7 items-center justify-center rounded-lg text-neutral-600 outline-none transition-colors hover:bg-neutral-900 hover:text-neutral-200"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      <p className="text-[13px] font-semibold leading-relaxed text-neutral-200">
        {note_?.text ?? "…"}
      </p>
    </li>
  );
}

/** Main exhibit viewer + thumbnail strip. Decrypts lazily, caches in RAM.
 *  The viewer is the star of the case file: scaled huge, fullscreen on tap. */
function ExhibitGallery({
  wire,
  cache,
  fetchExhibit,
}: {
  wire: WantedWire;
  cache: Map<string, string>;
  fetchExhibit: (postId: string, index: number) => Promise<{ iv: string; ciphertext: string; mime: string } | null>;
}) {
  const list = useMemo(() => {
    // legacy fold: v1 inline image becomes exhibit 0
    const items: Array<{ mime: string }> = [];
    if (wire.imgIv) items.push({ mime: "image/jpeg" });
    for (const m of wire.mediaList ?? []) items.push({ mime: m.mime });
    return items;
  }, [wire]);

  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [view, setView] = useState<{ wireId: string; index: number; url: string | null; failed: boolean }>(() => ({
    wireId: wire.id,
    index: 0,
    url: cache.get(`${wire.id}:0`) ?? null,
    failed: false,
  }));

  // derive-during-render: a new case (or exhibit) resets the viewer — the
  // React-sanctioned pattern, no cascading effect
  if (view.wireId !== wire.id || view.index !== active) {
    setView({
      wireId: wire.id,
      index: active,
      url: cache.get(`${wire.id}:${active}`) ?? null,
      failed: false,
    });
  }

  // decrypt-on-demand: only when the viewer holds nothing for this exhibit
  useEffect(() => {
    if (view.wireId !== wire.id || view.index !== active || view.url || view.failed) return;
    let dead = false;
    void (async () => {
      const u = await exhibitUrl(wire, active, cache, fetchExhibit);
      if (dead) return;
      setView((v) =>
        v.wireId === wire.id && v.index === active ? { ...v, url: u, failed: !u } : v
      );
    })();
    return () => {
      dead = true;
    };
  }, [wire, active, view.wireId, view.index, view.url, view.failed, cache, fetchExhibit]);

  // lightbox: Escape closes, switching exhibits while zoomed re-renders in place
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  const url = view.url;
  const failed = view.failed;

  const isVideo = (list[active]?.mime ?? "").startsWith("video/");

  if (list.length === 0) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 p-8 text-center">
        <Images className="size-6 text-neutral-700" aria-hidden />
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-600">
          {WANTED_CASE_EMPTY}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* main viewer — the evidence, scaled HUGE */}
      <div className="relative flex min-h-[240px] items-center justify-center bg-black sm:min-h-[420px] lg:min-h-[68dvh]">
        {!url && !failed && (
          <div className="flex items-center gap-2 py-16 font-mono text-[10px] uppercase tracking-[0.24em] text-neutral-600">
            <Lock className="size-4" aria-hidden />
            Ontsleutel bewysstuk {active + 1}…
          </div>
        )}
        {failed && !url && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Lock className="size-5 text-neutral-700" aria-hidden />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-600">
              Bewysstuk onleesbaar op hierdie toestel
            </span>
          </div>
        )}
        {url && !isVideo && (

          <img
            src={url}
            alt={`Case exhibit ${active + 1}`}
            draggable={false}
            onClick={() => setZoom(true)}
            className="max-h-[62dvh] w-full cursor-zoom-in object-contain lg:max-h-[80dvh]"
          />
        )}
        {url && isVideo && (
          <video
            src={url}
            controls
            playsInline
            preload="metadata"
            className="max-h-[62dvh] w-full bg-black object-contain lg:max-h-[80dvh]"
          />
        )}
        {url && isVideo && (
          <button
            onClick={() => setZoom(true)}
            aria-label="Blow the exhibit up fullscreen"
            className="absolute bottom-3 right-3 flex size-11 items-center justify-center rounded-xl border border-neutral-700 bg-black/80 text-neutral-200 outline-none backdrop-blur-sm transition-colors hover:border-white hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
          >
            <Maximize2 className="size-4" aria-hidden />
          </button>
        )}
        {url && !isVideo && (
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full border border-neutral-800 bg-black/80 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.18em] text-neutral-400 backdrop-blur-sm"
          >
            <Maximize2 className="size-3" />
            VOLL SKERM
          </span>
        )}
        {list.length > 1 && (
          <span className="absolute right-3 top-3 rounded-full border border-neutral-800 bg-black/80 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-neutral-300 backdrop-blur-sm">
            {active + 1} / {list.length}
          </span>
        )}
      </div>

      {/* exhibit strip */}
      {list.length > 1 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto border-t border-neutral-900 p-2.5">
          {list.map((m, i) => {
            const isActive = i === active;
            return (
              <button
                key={`${wire.id}-exhibit-${i}`}
                onClick={() => setActive(i)}
                aria-label={`Exhibit ${i + 1}`}
                aria-current={isActive}
                className={`relative h-[4.5rem] w-[4.5rem] shrink-0 overflow-hidden rounded-lg border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 ${
                  isActive ? "border-white" : "border-neutral-800 hover:border-neutral-600"
                }`}
              >
                <ThumbTile wire={wire} index={i} mime={m.mime} cache={cache} fetchExhibit={fetchExhibit} />
              </button>
            );
          })}
        </div>
      )}

      {/* fullscreen lightbox — the exhibit, nothing else, edge to edge */}
      {zoom && url && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/[0.985] p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Fullscreen exhibit"
          onClick={() => setZoom(false)}
        >
          <button
            onClick={() => setZoom(false)}
            aria-label="Close fullscreen exhibit"
            className="absolute right-4 top-4 z-10 flex size-11 items-center justify-center rounded-xl border border-neutral-800 bg-black/80 text-neutral-300 outline-none transition-colors hover:border-neutral-400 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
          >
            <X className="size-5" aria-hidden />
          </button>
          {isVideo ? (
            <video
              src={url}
              controls
              autoPlay
              playsInline
              onClick={(e) => e.stopPropagation()}
              className="max-h-[90dvh] max-w-full bg-black object-contain"
            />
          ) : (
            <img
              src={url}
              alt={`Case exhibit ${active + 1}, fullscreen`}
              draggable={false}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[90dvh] max-w-full object-contain"
            />
          )}
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-neutral-500">
            {list.length > 1 ? `${active + 1} / ${list.length} · ` : ""}AES-256-GCM · SLEUTEL OP JOU TOESTEL
          </span>
        </div>
      )}
    </div>
  );
}

/** Tiny tile inside the strip: image thumb or video chip. */
function ThumbTile({
  wire,
  index,
  mime,
  cache,
  fetchExhibit,
}: {
  wire: WantedWire;
  index: number;
  mime: string;
  cache: Map<string, string>;
  fetchExhibit: (postId: string, index: number) => Promise<{ iv: string; ciphertext: string; mime: string } | null>;
}) {
  const isVideo = mime.startsWith("video/");
  const [url, setUrl] = useState<string | null>(() => cache.get(`${wire.id}:${index}`) ?? null);

  useEffect(() => {
    if (isVideo || url) return;
    let dead = false;
    void (async () => {
      const u = await exhibitUrl(wire, index, cache, fetchExhibit);
      if (!dead && u) setUrl(u);
    })();
    return () => {
      dead = true;
    };
     
  }, [wire.id, index]);

  if (isVideo) {
    return (
      <span className="flex h-full w-full items-center justify-center bg-neutral-950">
        <Film className="size-4 text-neutral-500" aria-hidden />
      </span>
    );
  }
  if (!url) {
    return (
      <span className="flex h-full w-full items-center justify-center bg-neutral-950">
        <Lock className="size-3.5 text-neutral-700" aria-hidden />
      </span>
    );
  }
   
  return <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />;
}
