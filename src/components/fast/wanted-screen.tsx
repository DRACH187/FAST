"use client";

/**
 * FAST — WANTED BOARD
 * ===================
 * Encrypted bulletins: any operative can post a WANTED entry — an image, a
 * title and a full description (plus alias, last-seen, threat level, status
 * and bounty). EVERYTHING is sealed client-side with AES-256-GCM before it
 * leaves the tab; the server stores ciphertext only. Images decrypt into
 * RAM blob URLs that are revoked the moment their card unmounts — nothing
 * image-related ever touches disk.
 *
 * Board features: live filter tabs (status), search across decrypted
 * content, threat meters, poster attribution (callsign + boss styling),
 * creator-only burn, 60s auto-refresh, cold-start self-heal via client
 * reseed, 24h retention (server + client).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  ArrowLeft,
  Camera,
  Check,
  Crosshair,
  FileWarning,
  Flame,
  ImagePlus,
  Lock,
  Search,
  Skull,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "@/components/fast/toast";
import { REDUCED_MOTION, ScreenShell, pressFeedback } from "@/components/fast/motion";
import { FastButton, FastInput, FastModal } from "@/components/fast/primitives";
import {
  decryptWantedContent,
  decryptWantedImage,
  encryptWantedPost,
  resetWantedKey,
  type WantedContent,
  type WantedWire,
} from "@/lib/crypto/wanted-crypto";
import { getGatePasscode } from "@/lib/crypto/keyvault";
import type { Role } from "@/lib/fast/identity-store";

gsap.registerPlugin(useGSAP);

// ------------------------------------------------------------------ consts

const LIST_URL = "/api/wanted";
const CACHE_KEY = "fast_wanted_cache_v1";
const REFRESH_MS = 60_000;
const MAX_IMG_BYTES = 900_000; // post-encryption b64 cap (~1.2MB)
const STATUS_ALL = "ALL";
type StatusFilter = typeof STATUS_ALL | WantedContent["status"];

/** ONLY two categories exist on this board: WANTED and ELIMINATED. */
const STATUSES: WantedContent["status"][] = ["WANTED", "ELIMINATED"];

const STATUS_ICON: Record<WantedContent["status"], typeof Skull> = {
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
  status: WantedContent["status"];
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

// ------------------------------------------------------- image pre-processing

/** Downscale + re-encode to JPEG in-memory. Returns null if unreadable/too big. */
async function prepareImage(file: File): Promise<Uint8Array | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const max = 900;
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
    if (!blob || blob.size > MAX_IMG_BYTES) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- cached wire

/** Ciphertext-only cache used to reseed the board after a server cold start. */
function loadCache(): WantedWire[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WantedWire[];
    return Array.isArray(parsed) ? parsed.slice(0, 120) : [];
  } catch {
    return [];
  }
}

function saveCache(posts: WantedWire[]): void {
  try {
    // ciphertext-only persistence: no keys at rest, zero knowledge
    localStorage.setItem(CACHE_KEY, JSON.stringify(posts.slice(0, 120)));
  } catch {
    /* storage full/unavailable — cache is best-effort */
  }
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
};

// --------------------------------------------------------------- component

export function WantedScreen({ open, onClose, myFp, myNickname, myRole }: WantedScreenProps) {
  const [mounted, setMounted] = useState(false);
  const [entries, setEntries] = useState<BoardEntry[]>([]);
  const [filter, setFilter] = useState<StatusFilter>(STATUS_ALL);
  const [query, setQuery] = useState("");
  const [fetching, setFetching] = useState(false);
  const [netError, setNetError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [imageBytes, setImageBytes] = useState<Uint8Array | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const [detail, setDetail] = useState<BoardEntry | null>(null);
  const [shownOpen, setShownOpen] = useState(open);

  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inflight = useRef(false);
  const objectUrls = useRef<Set<string>>(new Set());

  // derive-during-render (React-sanctioned) — no cascading effect
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) setMounted(true);
  }
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (composeOpen) setComposeOpen(false);
        else if (detail) setDetail(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, onClose, composeOpen, detail]);

  const revokeAll = useCallback(() => {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current.clear();
  }, []);

  // ------------------------------------------------------------- data flow

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
        setNetError(typeof data.error === "string" ? data.error : "Board unreachable");
        return;
      }
      setNetError(null);
      setUpdatedAt(new Date().toISOString());

      let posts = data.posts;

      // cold-start self-heal: a wiped board gets its ciphertext re-uploaded
      // from the local cache (still zero-knowledge — blobs only)
      if (posts.length === 0) {
        const cached = loadCache();
        if (cached.length > 0) {
          try {
            await fetch(LIST_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "reseed",
                fingerprint: myFp,
                posts: cached.slice(0, 30).map((p) => ({
                  id: p.id,
                  iv: p.iv,
                  ciphertext: p.ciphertext,
                  imgIv: p.imgIv,
                  imgCiphertext: p.imgCiphertext,
                  creatorFp: p.creatorFp,
                  createdAt: p.createdAt,
                })),
              }),
              cache: "no-store",
            });
            const again = await fetch(LIST_URL, { cache: "no-store" });
            const againData = (await again.json().catch(() => ({}))) as { posts?: WantedWire[] };
            if (again.ok && Array.isArray(againData.posts) && againData.posts.length > 0) {
              posts = againData.posts;
              toast.info(`Board restored — ${posts.length} encrypted entries`);
            }
          } catch {
            /* reseed is best-effort */
          }
        }
      }

      saveCache(posts);

      // decrypt everything we can hold a key for (null content = sealed)
      const decrypted = await Promise.all(
        posts.map(async (wire) => ({
          wire,
          content: await decryptWantedContent(wire),
          mine: wire.creatorFp === myFp,
        }))
      );
      setEntries(decrypted);
    } catch {
      setNetError("Network unreachable");
    } finally {
      setFetching(false);
      inflight.current = false;
    }
  }, [myFp]);

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

  // unmount -> revoke every RAM blob URL
  useEffect(() => {
    if (mounted) return () => revokeAll();
  }, [mounted, revokeAll]);

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

  const pickImage = useCallback(async (file: File | undefined) => {
    if (!file) return;
    const bytes = await prepareImage(file);
    if (!bytes) {
      toast.error("Image unreadable or too large");
      return;
    }
    setImageBytes(bytes);
    const prev = imageUrl;
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
    objectUrls.current.add(url);
    setImageUrl(url);
    if (prev) {
      URL.revokeObjectURL(prev);
      objectUrls.current.delete(prev);
    }
  }, [imageUrl]);

  const clearImage = useCallback(() => {
    if (imageUrl) {
      URL.revokeObjectURL(imageUrl);
      objectUrls.current.delete(imageUrl);
    }
    setImageBytes(null);
    setImageUrl(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [imageUrl]);

  const publish = useCallback(async () => {
    if (posting) return;
    const title = draft.title.trim();
    const description = draft.description.trim();
    if (!title) {
      toast.error("A WANTED entry needs a title");
      return;
    }
    setPosting(true);
    try {
      const blob = await encryptWantedPost(
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
        },
        imageBytes
      );
      const res = await fetch(LIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          fingerprint: myFp,
          post: { id: crypto.randomUUID(), ...blob },
        }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok !== true) {
        toast.error(typeof data.error === "string" ? data.error : "Publish failed");
        return;
      }
      toast.success("WANTED entry posted — sealed and live");
      setComposeOpen(false);
      setDraft(EMPTY_DRAFT);
      clearImage();
      await fetchBoard();
    } catch {
      toast.error("Network unreachable — entry not posted");
    } finally {
      setPosting(false);
    }
  }, [clearImage, draft, fetchBoard, imageBytes, myFp, myNickname, myRole, posting]);

  const burn = useCallback(
    async (entry: BoardEntry) => {
      try {
        const res = await fetch(LIST_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", fingerprint: myFp, id: entry.wire.id }),
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || data.ok !== true) {
          toast.error(typeof data.error === "string" ? data.error : "Burn failed");
          return;
        }
        toast.success("Entry burned for everyone");
        setDetail(null);
        await fetchBoard();
      } catch {
        toast.error("Network unreachable");
      }
    },
    [fetchBoard, myFp]
  );

  // ------------------------------------------------------------- derived

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (e.content === null) return q.length === 0 && filter === STATUS_ALL ? true : false;
      if (filter !== STATUS_ALL && e.content.status !== filter) return false;
      if (q.length === 0) return true;
      return (
        e.content.title.toLowerCase().includes(q) ||
        e.content.description.toLowerCase().includes(q) ||
        e.content.alias.toLowerCase().includes(q) ||
        e.content.by.toLowerCase().includes(q)
      );
    });
  }, [entries, filter, query]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: entries.length };
    for (const s of STATUSES) c[s] = 0;
    for (const e of entries) if (e.content) c[e.content.status] += 1;
    return c;
  }, [entries]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[92] bg-black" role="dialog" aria-label="WANTED board">
      <ScreenShell as="div" className="flex h-dvh flex-col">
        {/* ---------------------------------------------------------- header */}
        <header className="sticky top-0 z-20 border-b border-neutral-900 bg-black/85 backdrop-blur-md">
          <div className="flex h-14 items-center gap-2 px-3">
            <button
              onClick={onClose}
              aria-label="Close WANTED board"
              className="flex size-11 items-center justify-center rounded-xl text-neutral-400 outline-none transition-colors hover:bg-neutral-900 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
            >
              <ArrowLeft className="size-5" aria-hidden />
            </button>
            <Image
              src="/fast-logo.png"
              alt="FAST GUNS"
              width={256}
              height={256}
              draggable={false}
              className="h-8 w-8 mix-blend-screen"
            />
            <div className="flex flex-col">
              <span className="font-mono text-xs font-bold uppercase tracking-[0.34em] text-white">
                Wanted
              </span>
              <span className="font-mono text-[8px] uppercase tracking-[0.22em] text-neutral-600">
                {counts.ALL} entries · e2e sealed · 24h retention
              </span>
            </div>
            <div className="flex-1" />
            <FastButton
              size="sm"
              onClick={() => {
                setDraft(EMPTY_DRAFT);
                setComposeOpen(true);
              }}
              className="min-h-[36px] font-mono text-[10px] uppercase tracking-[0.18em]"
            >
              <ImagePlus className="size-3.5" aria-hidden />
              Post
            </FastButton>
          </div>

          {/* search + filters */}
          <div className="flex flex-col gap-2 px-3 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-neutral-600" aria-hidden />
              <FastInput
                value={query}
                onChange={(e) => setQuery(e.target.value.slice(0, 60))}
                placeholder="SEARCH DECRYPTED ENTRIES"
                aria-label="Search wanted entries"
                className="h-11 pl-10 font-mono text-[11px] tracking-[0.14em]"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="Status filter">
              {([STATUS_ALL, ...STATUSES] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  role="tab"
                  aria-selected={filter === s}
                  onClick={() => setFilter(s)}
                  className={`min-h-[34px] shrink-0 rounded-full border px-3.5 font-mono text-[9px] uppercase tracking-[0.2em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 ${
                    filter === s
                      ? "border-white bg-white text-black"
                      : "border-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300"
                  }`}
                >
                  {s} {counts[s] > 0 && `· ${counts[s]}`}
                </button>
              ))}
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
              <Lock className="size-7 text-neutral-700" aria-hidden />
              <p className="text-sm text-neutral-300">No entries here.</p>
              <p className="max-w-[260px] text-[11px] leading-relaxed text-neutral-600">
                Post the first WANTED bulletin — it is encrypted in this tab
                before it ever leaves the device.
              </p>
            </div>
          ) : (
            <div ref={gridRef} className="grid gap-3 px-3 pb-24 pt-1 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((entry) => (
                <WantedCard
                  key={entry.wire.id}
                  entry={entry}
                  onOpen={() => setDetail(entry)}
                />
              ))}
              {fetching && entries.length === 0 && (
                <div className="col-span-full py-10 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-600">
                  Decrypting board…
                </div>
              )}
            </div>
          )}
        </div>

        {/* --------------------------------------------------------- footer */}
        <footer className="sticky bottom-0 border-t border-neutral-900 bg-black/85 px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[8px] uppercase tracking-[0.22em] text-neutral-700">
              {updatedAt ? `Synced ${timeAgo(updatedAt)}` : "Awaiting first sync"} · auto 60s
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.22em] text-neutral-600">
              <Flame className="size-3" aria-hidden />
              images live in RAM only
            </span>
          </div>
        </footer>
      </ScreenShell>

      {/* ------------------------------------------------------- compose modal */}
      <FastModal open={composeOpen} onClose={() => setComposeOpen(false)} label="Post a WANTED entry">
        <div className="flex max-h-[80dvh] flex-col gap-4 overflow-y-auto">
          <div className="text-center">
            <h2 className="flex items-center justify-center gap-2 text-sm font-medium text-neutral-100">
              <ImagePlus className="size-4 text-neutral-300" aria-hidden />
              New WANTED entry
            </h2>
            <p className="mt-1.5 text-[11px] text-neutral-500">
              Sealed with AES-256-GCM in this tab — the server only ever
              holds ciphertext.
            </p>
          </div>

          {/* image picker */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={(e) => void pickImage(e.target.files?.[0])}
              className="sr-only"
              aria-label="Attach an image"
            />
            {imageUrl ? (
              <div className="relative overflow-hidden rounded-xl border border-neutral-800">
                <img src={imageUrl} alt="Attachment preview" className="max-h-52 w-full object-cover" />
                <button
                  onClick={clearImage}
                  aria-label="Remove image"
                  className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full border border-neutral-700 bg-black/85 text-neutral-300 outline-none hover:border-neutral-400 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => {
                  pressFeedback(e.currentTarget);
                  fileRef.current?.click();
                }}
                className="flex min-h-[92px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-neutral-800 text-neutral-500 outline-none transition-colors hover:border-neutral-600 hover:text-neutral-300"
              >
                <Camera className="size-5" aria-hidden />
                <span className="font-mono text-[9px] uppercase tracking-[0.24em]">Attach image</span>
              </button>
            )}
          </div>

          <FastInput
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value.slice(0, 80) }))}
            placeholder="TITLE *"
            aria-label="Title"
            maxLength={80}
            className="font-mono tracking-[0.08em] uppercase"
          />

          <textarea
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value.slice(0, 4000) }))}
            placeholder="DESCRIPTION — who, what, where…"
            aria-label="Description"
            rows={5}
            className="w-full resize-none rounded-xl border border-neutral-800 bg-black px-4 py-3 text-sm leading-relaxed text-neutral-100 outline-none transition-colors placeholder:text-neutral-700 focus:border-neutral-500"
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
              placeholder="LAST SEEN"
              aria-label="Last seen"
              maxLength={60}
            />
            <FastInput
              value={draft.bounty}
              onChange={(e) => setDraft((d) => ({ ...d, bounty: e.target.value.slice(0, 60) }))}
              placeholder="BOUNTY (OPTIONAL)"
              aria-label="Bounty"
              maxLength={60}
            />
            <div className="flex items-center justify-between rounded-xl border border-neutral-800 bg-black px-3" aria-label="Threat level">
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-neutral-500">
                Threat
              </span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setDraft((d) => ({ ...d, threat: n as Draft["threat"] }))}
                    aria-label={`Threat level ${n}`}
                    aria-pressed={draft.threat === n}
                    className={`h-6 w-3.5 rounded-[3px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 ${
                      n <= draft.threat ? "bg-white" : "bg-neutral-800 hover:bg-neutral-700"
                    }`}
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
                  className={`flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl border font-mono text-[8px] uppercase tracking-[0.14em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 ${
                    active
                      ? "border-white bg-white text-black"
                      : "border-neutral-800 text-neutral-500 hover:border-neutral-600"
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
              className="w-full font-mono text-[11px] uppercase tracking-[0.24em]"
            >
              {posting ? "Sealing…" : "Seal & post"}
            </FastButton>
            <FastButton
              variant="ghost"
              className="w-full"
              onClick={() => {
                setComposeOpen(false);
                clearImage();
              }}
            >
              Cancel
            </FastButton>
          </div>
        </div>
      </FastModal>

      {/* -------------------------------------------------------- detail modal */}
      <FastModal open={detail !== null} onClose={() => setDetail(null)} label="WANTED entry detail">
        {detail && (
          <DetailBody entry={detail} onBurn={() => void burn(detail)} />
        )}
      </FastModal>
    </div>,
    document.body
  );
}

// ------------------------------------------------------------------ pieces

/** Card image: decrypts into a RAM blob URL, revokes it on unmount. */
function CardImage({ wire, className }: { wire: WantedWire; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    let current: string | null = null;
    void (async () => {
      const blob = await decryptWantedImage(wire);
      if (dead || !blob) return;
      current = URL.createObjectURL(blob);
      setUrl(current);
    })();
    return () => {
      dead = true;
      if (current) URL.revokeObjectURL(current);
    };
  }, [wire]);

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

function WantedCard({ entry, onOpen }: { entry: BoardEntry; onOpen: () => void }) {
  const { content, wire, mine } = entry;

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
            Sealed entry
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-neutral-600">
          This bulletin was sealed under a key generation this device cannot
          derive. The ciphertext stays on the board, unreadable.
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
        <CardImage wire={wire} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
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
        {mine && (
          <span className="absolute right-2.5 top-2.5 rounded-full border border-neutral-700 bg-black/70 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.18em] text-neutral-400 backdrop-blur-sm">
            yours
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 p-3.5">
        <span className="font-mono text-sm font-bold tracking-[0.06em] text-white uppercase">
          {content.title}
        </span>
        {content.description && (
          <span className="line-clamp-2 text-[11px] leading-relaxed text-neutral-500">
            {content.description}
          </span>
        )}
        <ThreatMeter threat={content.threat} />
        <div className="flex items-center gap-2 border-t border-neutral-900 pt-2.5">
          <span className={`truncate font-mono text-[9px] tracking-[0.14em] text-neutral-400 ${boss ? "drach-font text-[11px] tracking-[0.08em] text-white" : "uppercase"}`}>
            {boss ? content.by : `BY ${content.by}`}
          </span>
          <span className="flex-1" />
          <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-neutral-600">
            {timeAgo(wire.createdAt)}
          </span>
        </div>
      </div>
    </button>
  );
}

function DetailBody({ entry, onBurn }: { entry: BoardEntry; onBurn: () => void }) {
  const { content, wire, mine } = entry;
  if (!content) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Lock className="size-6 text-neutral-600" aria-hidden />
        <p className="text-xs text-neutral-400">Sealed — this device cannot decrypt it.</p>
      </div>
    );
  }
  const StatusIcon = STATUS_ICON[content.status];
  const boss = content.byRole === "boss";
  return (
    <div className="flex max-h-[80dvh] flex-col gap-4 overflow-y-auto">
      <div className="overflow-hidden rounded-xl border border-neutral-800">
        <CardImage wire={wire} className="max-h-72 w-full object-cover" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <StatusIcon className="size-4 text-neutral-300" aria-hidden />
          <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-neutral-400">
            {content.status} · posted {timeAgo(wire.createdAt)}
          </span>
        </div>
        <h2 className="font-mono text-lg font-bold uppercase leading-tight tracking-[0.05em] text-white">
          {content.title}
        </h2>
        {content.alias && (
          <p className="text-xs text-neutral-400">
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-neutral-600">ALIAS · </span>
            {content.alias}
          </p>
        )}
        {content.lastSeen && (
          <p className="text-xs text-neutral-400">
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-neutral-600">LAST SEEN · </span>
            {content.lastSeen}
          </p>
        )}
        {content.bounty && (
          <p className="text-xs text-neutral-300">
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-neutral-600">BOUNTY · </span>
            {content.bounty}
          </p>
        )}
      </div>
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3.5">
        <ThreatMeter threat={content.threat} />
        {content.description && (
          <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-neutral-300">
            {content.description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-neutral-900 pt-3">
        <span className={`truncate text-xs text-neutral-400 ${boss ? "drach-font text-base text-white" : "font-mono uppercase tracking-[0.14em]"}`}>
          {content.by}
        </span>
        <span className="flex-1" />
        {mine && (
          <FastButton
            variant="danger"
            size="sm"
            onClick={onBurn}
            className="font-mono text-[10px] uppercase tracking-[0.18em]"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Burn
          </FastButton>
        )}
      </div>
    </div>
  );
}
