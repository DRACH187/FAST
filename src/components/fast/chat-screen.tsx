"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  ArrowDown,
  ArrowLeft,
  Camera,
  Copy,
  EyeOff,
  Flame,
  KeyRound,
  Lock,
  Map as MapIcon,
  MoreVertical,
  SendHorizontal,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "@/components/fast/toast";
import { ScreenShell } from "@/components/fast/motion";
import { FastButton, FastModal, FastMenuItem, FastPopover } from "@/components/fast/primitives";
import { CameraCapture } from "@/components/fast/camera-capture";
import { clearDraft, loadDraft, saveDraft } from "@/lib/fast/vault-db";
import { burnPhoto, peekPhoto } from "@/lib/crypto/keyvault";
import type { SessionView } from "@/lib/fast/session-manager";
import type { DecryptedMessage } from "@/lib/crypto/keyvault";

gsap.registerPlugin(useGSAP);

type ChatProps = {
  session: SessionView;
  myFp: string;
  onBack: () => void;
  onSend: (text: string) => Promise<void>;
  onSendPhoto: (bytes: Uint8Array) => Promise<void>;
  onOpenMap: () => void;
  onDelete: (code: string) => Promise<void>;
};

export function ChatScreen({ session, myFp, onBack, onSend, onSendPhoto, onOpenMap, onDelete }: ChatProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const kbRef = useRef<HTMLDivElement>(null);

  // Mobile keyboards: size the chat to the VISUAL viewport so the composer
  // always sits above the keyboard (iOS Safari keeps the layout viewport
  // full-height, which would otherwise hide the input).
  useEffect(() => {
    const vv = window.visualViewport;
    const el = kbRef.current;
    if (!vv || !el) return;
    const apply = () => {
      el.style.height = `${vv.height}px`;
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    scrollToBottom(false);
  }, [session.code, scrollToBottom]);

  useEffect(() => {
    if (atBottom) scrollToBottom(true);
  }, [session.messages.length, atBottom, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

  // data-saving: restore + persist the composer draft (tab-scoped)
  useEffect(() => {
    setDraft(loadDraft(session.code));
  }, [session.code]);

  useEffect(() => {
    const t = window.setTimeout(() => saveDraft(session.code, draft), 300);
    return () => window.clearTimeout(t);
  }, [draft, session.code]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !session.hasKey) return;
    setSending(true);
    try {
      await onSend(text);
      setDraft("");
      clearDraft(session.code);
      if (taRef.current) taRef.current.style.height = "auto";
      requestAnimationFrame(() => scrollToBottom(true));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Message not sent");
    } finally {
      setSending(false);
    }
  }, [draft, onSend, scrollToBottom, sending, session.hasKey, session.code]);

  const grouped = useMemo(() => {
    const groups: { senderFp: string; mine: boolean; items: DecryptedMessage[] }[] = [];
    for (const m of session.messages) {
      const last = groups[groups.length - 1];
      if (last && last.senderFp === m.senderFp && last.mine === m.mine) {
        last.items.push(m);
      } else {
        groups.push({ senderFp: m.senderFp, mine: m.mine, items: [m] });
      }
    }
    return groups;
  }, [session.messages]);

  const otherCount = useMemo(() => {
    const others = new Set(session.presence.filter((fp) => fp !== myFp));
    return others.size;
  }, [session.presence, myFp]);

  return (
    <div ref={kbRef} className="flex h-dvh flex-col overflow-hidden">
    <ScreenShell
      as="main"
      className="relative flex min-h-0 flex-1 flex-col bg-black"
    >
      {/* header */}
      <header className="sticky top-0 z-20 border-b border-neutral-900 bg-black/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="flex h-14 items-center gap-2 px-3">
          <button
            aria-label="Back to sessions"
            onClick={onBack}
            className="flex size-11 items-center justify-center rounded-full text-neutral-400 outline-none transition-colors hover:bg-neutral-900 hover:text-white"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="flex flex-col leading-tight">
              <span className="font-mono text-sm font-bold tracking-[0.22em] text-white">
                {session.code}
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
                <Users className="size-3" aria-hidden />
                {otherCount > 0 ? `${otherCount + 1} live` : "solo"}
                {session.hasKey ? (
                  <Lock className="size-3 text-neutral-400" aria-label="Session key active" />
                ) : (
                  <KeyRound
                    className="size-3 animate-fast-pulse text-neutral-300"
                    aria-label="Awaiting session key"
                  />
                )}
              </span>
            </div>
          </div>

          {session.hasKey && (
            <span
              className="hidden items-center gap-1 rounded-full border border-neutral-800 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-neutral-400 sm:flex"
              title="Messages are sealed with per-message keys in your browser"
            >
              <ShieldCheck className="size-3.5" aria-hidden />
              e2e
            </span>
          )}

          <FastPopover
            label="Session menu"
            button={({ toggle }) => (
              <button
                onClick={toggle}
                aria-label="Session menu"
                className="flex size-11 items-center justify-center rounded-full text-neutral-400 outline-none transition-colors hover:bg-neutral-900 hover:text-white"
              >
                <MoreVertical className="size-5" aria-hidden />
              </button>
            )}
          >
            {(close) => (
              <>
                <FastMenuItem
                  icon={Copy}
                  label="Copy code"
                  onSelect={() => {
                    close();
                    setCodeOpen(true);
                  }}
                />
                <FastMenuItem
                  icon={MapIcon}
                  label="Surroundings map"
                  onSelect={() => {
                    close();
                    onOpenMap();
                  }}
                />
                <div className="mx-1.5 my-1 h-px bg-neutral-800" />
                <FastMenuItem
                  icon={Trash2}
                  label="Delete for everyone"
                  onSelect={() => {
                    close();
                    setDeleteOpen(true);
                  }}
                />
              </>
            )}
          </FastPopover>
        </div>
      </header>

      {/* key pending banner */}
      {!session.hasKey && (
        <div className="flex items-center justify-center gap-2 border-b border-neutral-900 bg-neutral-950 px-4 py-2 text-[11px] text-neutral-400">
          <KeyRound className="size-3.5 animate-fast-pulse" aria-hidden />
          Awaiting session key from a member…
        </div>
      )}

      {/* transcript */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-x-hidden overflow-y-auto px-4 py-4"
        role="log"
        aria-label="Encrypted transcript"
      >
        {session.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950">
              <Lock className="size-6 text-neutral-500" aria-hidden />
            </div>
            <p className="max-w-[240px] text-xs leading-relaxed text-neutral-500">
              Sealed channel. Everything typed here is encrypted in your browser
              before it ever leaves. Photos burn after viewing — nothing is
              stored, anywhere.
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-md flex-col gap-1.5">
            {grouped.map((group, gi) => (
              <div
                key={`${group.senderFp}-${gi}`}
                className={`flex flex-col gap-1 ${group.mine ? "items-end" : "items-start"}`}
              >
                {!group.mine && (
                  <span className="px-1 font-mono text-[10px] tracking-wider text-neutral-600">
                    {group.senderFp.slice(0, 4)}·{group.senderFp.slice(4, 8)}
                  </span>
                )}
                {group.items.map((m) =>
                  m.kind === "photo" ? (
                    <PhotoBubble key={m.id} message={m} mine={group.mine} />
                  ) : (
                    <Bubble key={m.id} message={m} />
                  )
                )}
                <span className="px-1 font-mono text-[9px] text-neutral-700">
                  {formatTime(group.items[group.items.length - 1].ts)}
                </span>
              </div>
            ))}
            <div className="h-2" />
          </div>
        )}
      </div>

      {/* jump to latest */}
      {!atBottom && (
        <button
          onClick={() => scrollToBottom(true)}
          aria-label="Jump to latest message"
          className="absolute bottom-28 right-4 z-10 flex size-11 items-center justify-center rounded-full border border-neutral-700 bg-black text-neutral-300 shadow-lg outline-none transition-colors hover:text-white"
        >
          <ArrowDown className="size-4" aria-hidden />
        </button>
      )}

      {/* composer (sticky footer) */}
      <footer className="mt-auto border-t border-neutral-900 bg-black/90 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-md items-end gap-2">
          <button
            onClick={() => setCameraOpen(true)}
            disabled={!session.hasKey}
            aria-label="Take photo"
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-neutral-800 text-neutral-300 outline-none transition-colors hover:border-neutral-600 hover:text-white disabled:pointer-events-none disabled:opacity-30"
          >
            <Camera className="size-5" aria-hidden />
          </button>
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={session.hasKey ? "Message" : "Locked until key arrives"}
            disabled={!session.hasKey}
            rows={1}
            aria-label="Message"
            className="max-h-[120px] min-h-[44px] flex-1 resize-none rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-neutral-500 disabled:opacity-60"
          />
          <button
            onClick={() => void send()}
            disabled={!session.hasKey || !draft.trim() || sending}
            aria-label="Send message"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-black outline-none transition-all hover:bg-neutral-200 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
          >
            <SendHorizontal className="size-5" aria-hidden />
          </button>
        </div>
      </footer>

      {/* camera overlay — RAM-only capture */}
      {cameraOpen && (
        <CameraCapture
          onClose={() => setCameraOpen(false)}
          onCapture={(bytes) => {
            setCameraOpen(false);
            void onSendPhoto(bytes).catch((err) =>
              toast.error(err instanceof Error ? err.message : "Photo not sent")
            );
          }}
        />
      )}

      {/* code dialog */}
      <FastModal open={codeOpen} onClose={() => setCodeOpen(false)} label="Session code">
        <div className="flex flex-col items-center gap-4 text-center">
          <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-neutral-400">
            Session code
          </h2>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(session.code);
              toast.success("Code copied");
            }}
            className="flex min-h-[44px] w-full items-center justify-center gap-3 rounded-2xl border border-neutral-800 py-4 outline-none transition-colors hover:border-neutral-600"
          >
            <span className="font-mono text-2xl font-bold tracking-[0.3em] text-white">
              {session.code}
            </span>
            <Copy className="size-4 text-neutral-400" aria-hidden />
          </button>
        </div>
      </FastModal>

      {/* delete confirm */}
      <FastModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        label={`Delete ${session.code} for everyone`}
      >
        <div className="flex flex-col gap-4 text-center">
          <div>
            <h2 className="flex items-center justify-center gap-2 text-sm font-medium text-neutral-100">
              <ShieldAlert className="size-4 text-neutral-300" aria-hidden />
              Delete {session.code} for everyone?
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-neutral-500">
              Every member is ejected immediately and the ciphertext history is
              erased. There is no undo.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <FastButton
              onClick={() => {
                setDeleteOpen(false);
                void onDelete(session.code).catch((err) =>
                  toast.error(err instanceof Error ? err.message : "Delete failed")
                );
              }}
              className="w-full"
            >
              Delete for everyone
            </FastButton>
            <FastButton variant="ghost" className="w-full" onClick={() => setDeleteOpen(false)}>
              Cancel
            </FastButton>
          </div>
        </div>
      </FastModal>
    </ScreenShell>
    </div>
  );
}

function Bubble({ message }: { message: DecryptedMessage }) {
  const ref = useRef<HTMLDivElement>(null);

  // GSAP: every bubble pops in on mount
  useGSAP(
    () => {
      gsap.fromTo(
        ref.current,
        { opacity: 0, y: 8, scale: 0.98 },
        { opacity: 1, y: 0, scale: 1, duration: 0.28, ease: "power3.out" }
      );
    },
    { scope: ref }
  );

  if (message.failed) {
    return (
      <div
        ref={ref}
        className="flex max-w-[85%] items-center gap-2 rounded-2xl border border-dashed border-neutral-700 bg-neutral-950 px-3.5 py-2.5 will-change-transform"
      >
        <ShieldAlert className="size-3.5 shrink-0 text-neutral-500" aria-hidden />
        <span className="text-xs italic text-neutral-500">Undecryptable — integrity check failed</span>
      </div>
    );
  }
  if (message.sealed) {
    return (
      <div
        ref={ref}
        className="flex max-w-[85%] items-center gap-2 rounded-2xl border border-dashed border-neutral-800 bg-transparent px-3.5 py-2.5 will-change-transform"
      >
        <Lock className="size-3 shrink-0 text-neutral-600" aria-hidden />
        <span className="text-xs italic text-neutral-600">Sealed — arrived before your key</span>
      </div>
    );
  }
  return (
    <div
      ref={ref}
      className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed will-change-transform ${
        message.mine
          ? "rounded-br-md bg-white text-black"
          : "rounded-bl-md border border-neutral-800 bg-neutral-900 text-neutral-100"
      }`}
    >
      {message.text}
    </div>
  );
}

const PHOTO_HARD_TTL_MS = 60_000; // bytes burn 60s after arrival
const PHOTO_VIEW_MS = 20_000; // ...or 20s after you chose to look

/**
 * Ephemeral photo bullet. The pixels exist ONLY in RAM:
 *  - rendered into a <canvas> (no <img>, no blob: URL kept, nothing to save)
 *  - received photos need a tap; once opened they burn after 20 seconds
 *  - after the hard TTL (or the view window) the bytes are literally zeroed
 */
function PhotoBubble({ message, mine }: { message: DecryptedMessage; mine: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoId = message.photoId ?? "";
  const [state, setState] = useState<"armed" | "revealed" | "burned">(() => {
    if (!photoId || !peekPhoto(photoId)) return "burned";
    return mine ? "revealed" : "armed"; // your own shots show instantly
  });
  const [left, setLeft] = useState(0);

  // GSAP pop-in like every other bubble
  useGSAP(
    () => {
      gsap.fromTo(
        ref.current,
        { opacity: 0, y: 8, scale: 0.98 },
        { opacity: 1, y: 0, scale: 1, duration: 0.28, ease: "power3.out" }
      );
    },
    { scope: ref }
  );

  // paint the RAM bytes into the canvas whenever the revealed state mounts —
  // covers both sender auto-reveal and tap-to-view
  useEffect(() => {
    if (state !== "revealed") return;
    const bytes = peekPhoto(photoId);
    const canvas = canvasRef.current;
    if (!bytes || !canvas) return;
    const blob = new Blob([bytes as unknown as BlobPart], { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);
    const img = new window.Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")?.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      gsap.fromTo(canvas, { opacity: 0, scale: 0.985 }, { opacity: 1, scale: 1, duration: 0.3, ease: "power2.out" });
    };
    img.src = url;
  }, [state, photoId]);

  // burn: zero the bytes + clear the canvas
  const burn = useCallback(() => {
    burnPhoto(photoId);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setState("burned");
  }, [photoId]);

  // countdown driver — hard TTL from arrival, shorter once revealed
  useEffect(() => {
    if (state === "burned") return;
    const arrival = Date.parse(message.createdAt) || message.ts || Date.now();
    const deadline = state === "revealed" && !mine ? Date.now() + PHOTO_VIEW_MS : arrival + PHOTO_HARD_TTL_MS;
    const tick = () => {
      const remain = deadline - Date.now();
      if (remain <= 0) {
        burn();
        return;
      }
      setLeft(Math.ceil(remain / 1000));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [state, mine, message.createdAt, message.ts, burn]);

  const reveal = useCallback(() => {
    if (state !== "armed") return;
    if (!peekPhoto(photoId)) {
      setState("burned");
      return;
    }
    setState("revealed"); // the paint effect handles drawing once mounted
  }, [photoId, state]);

  if (state === "burned") {
    return (
      <div
        ref={ref}
        className="flex max-w-[85%] items-center gap-2 rounded-2xl border border-dashed border-neutral-800 px-3.5 py-2.5 will-change-transform"
      >
        <Flame className="size-3.5 shrink-0 text-neutral-600" aria-hidden />
        <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-600">burned · zeroed</span>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`relative max-w-[85%] overflow-hidden rounded-2xl border will-change-transform ${
        mine ? "rounded-br-md border-neutral-700 bg-neutral-950" : "rounded-bl-md border-neutral-800 bg-neutral-950"
      }`}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state === "revealed" ? (
        <canvas
          ref={canvasRef}
          aria-label={mine ? "Photo you sent (ephemeral)" : "Received ephemeral photo"}
          className="block max-h-[300px] w-auto max-w-full select-none"
          draggable={false}
        />
      ) : (
        <button
          onClick={reveal}
          aria-label="Tap to view photo — it burns afterwards"
          className="flex min-h-[96px] w-44 flex-col items-center justify-center gap-2 px-4 py-6 outline-none sm:w-52"
        >
          <EyeOff className="size-5 text-neutral-500" aria-hidden />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-neutral-400">
            tap to view
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-neutral-600">
            burns after viewing
          </span>
        </button>
      )}

      {/* burn countdown */}
      <span
        className="pointer-events-none absolute right-2 top-2 rounded-full border border-neutral-700 bg-black/70 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-neutral-300"
        aria-hidden
      >
        {left}s
      </span>
    </div>
  );
}

function formatTime(ts: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
