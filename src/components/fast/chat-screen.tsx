"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  ArrowDown,
  ArrowLeft,
  Camera,
  Copy,
  Crosshair,
  Crown,
  EyeOff,
  Flame,
  KeyRound,
  Lock,
  Map as MapIcon,
  MoreVertical,
  Radio,
  SendHorizontal,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "@/components/fast/toast";
import { REDUCED_MOTION, ScreenShell, pressFeedback } from "@/components/fast/motion";
import { FastButton, FastModal, FastMenuItem, FastPopover, WipeChip } from "@/components/fast/primitives";
import { CameraCapture } from "@/components/fast/camera-capture";
import { clearDraft, loadDraft, saveDraft } from "@/lib/fast/vault-db";
import { burnPhoto, peekPhoto } from "@/lib/crypto/keyvault";
import { CHAT_EMPTY, CHAT_MEDIA_SEALED, CHAT_PLACEHOLDER, CHAT_TTL_TICKER, pick } from "@/lib/fast/copy";
import type { CallsignIdentity } from "@/lib/fast/identity";
import type { SessionView } from "@/lib/fast/session-manager";
import type { DecryptedMessage } from "@/lib/crypto/keyvault";

gsap.registerPlugin(useGSAP);

/** 1–2 letter monochrome tag for a sender chip (nickname initials). */
function senderTag(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9]/g, "");
  return (clean.slice(0, 2) || "??").toUpperCase();
}

const clockFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayFmt = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short" });

/** HH:MM, 24h — rendered inside every text bubble. */
function formatClock(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "";
  return clockFmt.format(new Date(ms));
}

/** "TODAY" / "YESTERDAY" / "12 JUN" — transcript date separators. */
function dayLabel(d: Date): string {
  const n = new Date();
  const startToday = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const t = d.getTime();
  if (t >= startToday) return "VANDAG";
  if (t >= startToday - 86_400_000) return "GISTER";
  return dayFmt.format(d).toUpperCase();
}

type ChatProps = {
  session: SessionView;
  myFp: string;
  callsign: CallsignIdentity | null;
  onBack: () => void;
  onSend: (text: string) => Promise<void>;
  onSendPhoto: (bytes: Uint8Array) => Promise<void>;
  onOpenMap: () => void;
  onOpenWanted: () => void;
  onOpenLive: () => void;
  onDelete: (code: string) => Promise<void>;
};

export function ChatScreen({
  session,
  myFp,
  callsign,
  onBack,
  onSend,
  onSendPhoto,
  onOpenMap,
  onOpenWanted,
  onOpenLive,
  onDelete,
}: ChatProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(false);
  const [emptyLine] = useState(() => pick(CHAT_EMPTY));
  const [placeholder] = useState(() => pick(CHAT_PLACEHOLDER));
  const [ttlTicker] = useState(() => pick(CHAT_TTL_TICKER));

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const kbRef = useRef<HTMLDivElement>(null);
  const newChipRef = useRef<HTMLButtonElement>(null);
  const prevCount = useRef(session.messages.length);

  // one 30s tick drives the header wipe chip
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

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
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(bottom);
    if (bottom) setNewBelow(false);
  }, []);

  // messages landed while the user was scrolled up -> raise the "▼ NEW" chip
  useEffect(() => {
    if (session.messages.length > prevCount.current && !atBottom) setNewBelow(true);
    prevCount.current = session.messages.length;
  }, [session.messages.length, atBottom]);

  // GSAP: the chip pops in when it appears
  useGSAP(
    () => {
      if (newBelow && !REDUCED_MOTION && newChipRef.current) {
        gsap.fromTo(
          newChipRef.current,
          { opacity: 0, y: 8, scale: 0.9 },
          { opacity: 1, y: 0, scale: 1, duration: 0.25, ease: "power3.out" }
        );
      }
    },
    { dependencies: [newBelow] }
  );

  const jumpToLatest = useCallback(() => {
    setNewBelow(false);
    scrollToBottom(true);
  }, [scrollToBottom]);

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
      toast.error(err instanceof Error ? err.message : "Boodskap geblok — vuur weer");
    } finally {
      setSending(false);
    }
  }, [draft, onSend, scrollToBottom, sending, session.hasKey, session.code]);

  // the boss strip: a boss-attested callsign in the room flips the header
  // band — driven entirely by the server-attested roster (unforgeable)
  const bossHere = useMemo(() => {
    const entry = Object.values(session.roster ?? {}).find((r) => r.role === "boss");
    return entry ? entry.nickname : null;
  }, [session.roster]);

  const senderName = useCallback(
    (fp: string): { name: string; boss: boolean } => {
      const entry = session.roster?.[fp];
      if (entry?.nickname) return { name: entry.nickname, boss: entry.role === "boss" };
      if (fp === myFp && callsign) return { name: callsign.nickname, boss: callsign.role === "boss" };
      return { name: `${fp.slice(0, 4)}·${fp.slice(4, 8)}`, boss: false };
    },
    [session.roster, myFp, callsign]
  );

  // transcript sections: day separators + consecutive-sender groups
  const sections = useMemo(() => {
    const out: { key: string; label: string; groups: { senderFp: string; mine: boolean; items: DecryptedMessage[] }[] }[] = [];
    for (const m of session.messages) {
      const d = new Date(m.createdAt);
      const valid = !Number.isNaN(d.getTime());
      const key = valid ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : "?";
      let sec = out[out.length - 1];
      if (!sec || sec.key !== key) {
        sec = { key, label: valid ? dayLabel(d) : "—", groups: [] };
        out.push(sec);
      }
      const g = sec.groups[sec.groups.length - 1];
      if (g && g.senderFp === m.senderFp && g.mine === m.mine) {
        g.items.push(m);
      } else {
        sec.groups.push({ senderFp: m.senderFp, mine: m.mine, items: [m] });
      }
    }
    return out;
  }, [session.messages]);

  const live = session.presence.length;

  return (
    <div ref={kbRef} className="flex h-full flex-col overflow-hidden">
    <ScreenShell
      as="main"
      className="fast-grain relative flex min-h-0 flex-1 flex-col bg-black"
    >
      {/* header */}
      <header className="sticky top-0 z-20 border-b border-neutral-900 bg-black/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="flex h-14 items-center gap-1.5 px-2.5">
          <button
            aria-label="Back to sessions"
            onClick={onBack}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-400 outline-none transition-colors hover:bg-neutral-900 hover:text-white"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Image
              src="/fast-logo.png"
              alt="FAST"
              width={256}
              height={256}
              priority
              draggable={false}
              className="h-8 w-8 shrink-0 mix-blend-screen"
            />
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate font-mono text-base font-black tracking-[0.22em] text-white">
                {session.code}
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">
                <span className="flex items-center gap-0.5" aria-hidden>
                  {Array.from({ length: Math.min(live, 3) }).map((_, i) => (
                    <span key={i} className="size-1 rounded-full bg-neutral-300" />
                  ))}
                </span>
                {live > 1 ? `${live} LIVE` : "SOLO"}
                {session.hasKey ? (
                  <Lock className="size-3.5 text-neutral-300" aria-label="Session key active" />
                ) : (
                  <KeyRound
                    className="size-3.5 animate-fast-pulse text-neutral-200"
                    aria-label="Awaiting session key"
                  />
                )}
              </span>
            </div>
            <WipeChip expiresAt={session.expiresAt} now={now} compact className="ml-auto" />
          </div>

          <FastPopover
            label="Session menu"
            button={({ toggle }) => (
              <button
                onClick={toggle}
                aria-label="Session menu"
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-400 outline-none transition-colors hover:bg-neutral-900 hover:text-white"
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
                  label="Kaart — wie loop wat"
                  onSelect={() => {
                    close();
                    onOpenMap();
                  }}
                />
                <FastMenuItem
                  icon={Crosshair}
                  label="Wanted blad"
                  onSelect={() => {
                    close();
                    onOpenWanted();
                  }}
                />
                <FastMenuItem
                  icon={Radio}
                  label="Live ouens"
                  onSelect={() => {
                    close();
                    onOpenLive();
                  }}
                />
                <div className="mx-1.5 my-1 h-px bg-neutral-800" />
                <FastMenuItem
                  icon={Trash2}
                  label="Verbrand vir almal"
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

      {/* BOSS PRESENT strip — attested, blackletter, unforgeable */}
      {bossHere && (
        <div className="relative z-10 flex items-center justify-center gap-2 border-b border-neutral-800 bg-neutral-950 py-2">
          <Crown className="size-4 text-neutral-200" aria-hidden />
          <span className="drach-font text-xl leading-none text-white">{bossHere}</span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">
            is in die werf
          </span>
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
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-neutral-900 bg-neutral-950">
              <Flame className="size-6 text-neutral-500" aria-hidden />
            </div>
            <p className="max-w-[260px] text-sm font-bold leading-relaxed text-neutral-300">{emptyLine}</p>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-600">
              {ttlTicker}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-md flex-col gap-3 sm:max-w-lg lg:max-w-2xl">
            {sections.map((sec) => (
              <Fragment key={sec.key}>
                <div className="my-2 flex items-center gap-3" role="separator" aria-label={sec.label}>
                  <span className="h-px flex-1 bg-neutral-900" aria-hidden />
                  <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-neutral-600">
                    {sec.label}
                  </span>
                  <span className="h-px flex-1 bg-neutral-900" aria-hidden />
                </div>
                {sec.groups.map((group, gi) => (
                  <div
                    key={`${group.senderFp}-${gi}`}
                    className={`flex flex-col gap-1.5 ${group.mine ? "items-end" : "items-start"}`}
                  >
                    {!group.mine &&
                      (() => {
                        const { name, boss } = senderName(group.senderFp);
                        return boss ? (
                          <span className="flex items-center gap-1.5 px-1.5">
                            <Crown className="size-3.5 text-neutral-300" aria-hidden />
                            <span className="drach-font text-lg leading-none text-white">{name}</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 px-1">
                            <span
                              aria-hidden
                              className="flex size-5 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950 font-mono text-[9px] font-black uppercase leading-none text-neutral-400"
                            >
                              {senderTag(name)}
                            </span>
                            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">
                              {name}
                            </span>
                          </span>
                        );
                      })()}
                    {group.items.map((m, mi) => {
                      const first = mi === 0;
                      const last = mi === group.items.length - 1;
                      return m.kind === "photo" ? (
                        <PhotoBubble key={m.id} message={m} mine={group.mine} />
                      ) : (
                        <Bubble key={m.id} message={m} first={first} last={last} />
                      );
                    })}
                  </div>
                ))}
              </Fragment>
            ))}
            <div className="h-2" />
          </div>
        )}
      </div>

      {/* jump to latest + "new" chip when messages land while scrolled up */}
      {(!atBottom || newBelow) && (
        <div className="absolute bottom-28 right-4 z-10 flex flex-col items-end gap-2">
          {newBelow && (
            <button
              ref={newChipRef}
              onClick={jumpToLatest}
              aria-label="New messages — jump to latest"
              className="flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 font-mono text-[11px] font-black uppercase tracking-[0.18em] text-black shadow-[0_8px_24px_rgba(0,0,0,0.7)] outline-none"
            >
              <ArrowDown className="size-3.5" aria-hidden />
              NUUT
            </button>
          )}
          {!atBottom && (
            <button
              onClick={jumpToLatest}
              aria-label="Jump to latest message"
              className="flex size-11 items-center justify-center rounded-full border border-neutral-700 bg-black text-neutral-300 shadow-lg outline-none transition-colors hover:text-white"
            >
              <ArrowDown className="size-4" aria-hidden />
            </button>
          )}
        </div>
      )}

      {/* composer (sticky footer) */}
      <footer className="mt-auto border-t border-neutral-900 bg-black/90 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-md">
        {!session.hasKey && (
          <div className="mb-2.5 flex justify-center">
            <span
              className="animate-fast-pulse rounded-full border border-neutral-800 bg-neutral-950 px-3.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-300"
              aria-live="polite"
            >
              Wag vir die sleutel…
            </span>
          </div>
        )}
        <div className="mx-auto flex max-w-md items-end gap-2 sm:max-w-lg lg:max-w-2xl">
          <button
            onClick={(e) => {
              pressFeedback(e.currentTarget);
              setCameraOpen(true);
            }}
            disabled={!session.hasKey}
            aria-label="Take photo"
            className="flex size-12 shrink-0 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 text-neutral-200 outline-none transition-colors hover:border-neutral-500 hover:text-white disabled:pointer-events-none disabled:opacity-30"
          >
            <Camera className="size-5" aria-hidden />
          </button>
          <div
            className={`flex flex-1 items-end gap-1.5 rounded-[24px] border bg-neutral-950 py-1 pl-4 pr-1 transition-colors ${
              session.hasKey ? "border-neutral-800 focus-within:border-neutral-500" : "border-neutral-900 opacity-70"
            }`}
          >
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
              placeholder={session.hasKey ? placeholder : "Gesluit"}
              disabled={!session.hasKey}
              rows={1}
              aria-label="Message"
              className="max-h-[120px] min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[16px] font-medium leading-snug text-neutral-100 outline-none placeholder:font-medium placeholder:text-neutral-600 disabled:cursor-not-allowed"
            />
            <button
              onClick={(e) => {
                pressFeedback(e.currentTarget);
                void send();
              }}
              disabled={!session.hasKey || !draft.trim() || sending}
              aria-label="Send message"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white text-black outline-none transition-all hover:bg-neutral-200 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
            >
              <SendHorizontal className="size-5" aria-hidden />
            </button>
          </div>
        </div>
      </footer>

      {/* camera overlay — RAM-only capture */}
      {cameraOpen && (
        <CameraCapture
          onClose={() => setCameraOpen(false)}
          onCapture={(bytes) => {
            setCameraOpen(false);
            void onSendPhoto(bytes).catch((err) =>
              toast.error(err instanceof Error ? err.message : "Foto geblok — laai en vuur weer")
            );
          }}
        />
      )}

      {/* code dialog */}
      <FastModal open={codeOpen} onClose={() => setCodeOpen(false)} label="Session code">
        <div className="flex flex-col items-center gap-5 text-center">
          <h2 className="gang-font text-3xl text-white">DIE KODE</h2>
          <button
            onClick={(e) => {
              pressFeedback(e.currentTarget);
              void navigator.clipboard.writeText(session.code);
              toast.success("Kode gekopieer. Stuur hom.");
            }}
            aria-label="Copy session code"
            className="flex min-h-[64px] w-full items-center justify-center gap-3 rounded-2xl border border-neutral-800 bg-black py-4 outline-none transition-all hover:border-neutral-400 active:scale-[0.98]"
          >
            <span className="font-mono text-3xl font-black tracking-[0.3em] text-white [padding-left:0.3em]">
              {session.code}
            </span>
            <Copy className="size-5 text-neutral-400" aria-hidden />
          </button>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold text-neutral-300">Wie die kode het, kom in. Wie nie, bly buite.</p>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-500">
              Hierdie werf vee homself uit ná 5 uur
            </p>
          </div>
        </div>
      </FastModal>

      {/* delete confirm */}
      <FastModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        label={`Wipe ${session.code} for everyone`}
      >
        <div className="flex flex-col gap-4 text-center">
          <div>
            <h2 className="flex items-center justify-center gap-2 text-base font-bold text-neutral-100">
              <ShieldAlert className="size-5 text-neutral-200" aria-hidden />
              Verbrand {session.code} vir almal?
            </h2>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-neutral-400">
              Elke ouen word op die slag uitgeskop en die geskiedenis word van elkeen se toestel geskop. Daar is geen undo nie.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <FastButton
              onClick={() => {
                setDeleteOpen(false);
                void onDelete(session.code).catch((err) =>
                  toast.error(err instanceof Error ? err.message : "Brand het gemors — probeer weer")
                );
              }}
              className="w-full font-mono text-sm uppercase tracking-[0.24em]"
            >
              VERBRAND VIR ALMAL
            </FastButton>
            <FastButton variant="ghost" className="w-full" onClick={() => setDeleteOpen(false)}>
              Bly maar
            </FastButton>
          </div>
        </div>
      </FastModal>
    </ScreenShell>
    </div>
  );
}

function Bubble({
  message,
  first = true,
  last = true,
}: {
  message: DecryptedMessage;
  first?: boolean;
  last?: boolean;
}) {
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
        className="flex max-w-[85%] items-center gap-2 rounded-[18px] rounded-bl-lg border border-neutral-700 bg-neutral-950 px-4 py-3 will-change-transform"
      >
        <ShieldAlert className="size-4 shrink-0 text-neutral-300" aria-hidden />
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-300">
          Onleesbaar — die pakkie is geknock
        </span>
      </div>
    );
  }
  if (message.auth === "invalid") {
    // M1: the signature does NOT verify — this blob claims another sender's
    // identity. The text is never rendered; the tamper attempt is.
    return (
      <div
        ref={ref}
        className="flex max-w-[85%] items-center gap-2 rounded-[18px] rounded-bl-lg border border-neutral-600 bg-neutral-950 px-4 py-3 will-change-transform"
      >
        <ShieldAlert className="size-4 shrink-0 text-neutral-300" aria-hidden />
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-300">
          Vervals — handtekening pas nie
        </span>
      </div>
    );
  }
  if (message.sealed) {
    return (
      <div
        ref={ref}
        className="flex max-w-[85%] items-center gap-2 rounded-[18px] rounded-bl-lg border border-dashed border-neutral-800 bg-transparent px-4 py-3 will-change-transform"
      >
        <Lock className="size-3.5 shrink-0 text-neutral-500" aria-hidden />
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-500">
          Gesluit — jy het nie die sleutel nie
        </span>
      </div>
    );
  }
  const clock = formatClock(message.ts || Date.parse(message.createdAt));
  const mine = message.mine;

  // grouped corners: the group-side edge stays tight while a run continues;
  // the FINAL bubble of the run carries the tail
  const shell = mine
    ? `relative max-w-[85%] whitespace-pre-wrap break-words rounded-[20px] rounded-br-lg ${!first ? "rounded-tr-lg" : ""} px-4 py-2.5 text-[15px] font-medium leading-[1.45] will-change-transform bg-white text-black shadow-[0_4px_18px_-2px_rgba(255,255,255,0.16)]`
    : `relative max-w-[85%] whitespace-pre-wrap break-words rounded-[20px] rounded-bl-lg ${!first ? "rounded-tl-lg" : ""} px-4 py-2.5 text-[15px] font-medium leading-[1.45] will-change-transform border border-neutral-800 bg-neutral-900 text-neutral-50 shadow-[0_5px_16px_-4px_rgba(0,0,0,0.75)]`;

  return (
    <div ref={ref} className={shell}>
      {message.text}
      {last && <Tail mine={mine} />}
      {clock && (
        <span
          className={`mt-1 flex items-center justify-end gap-2 font-mono text-[10px] tabular-nums ${
            mine ? "text-black/45" : "text-neutral-500"
          }`}
        >
          {!mine && message.auth === "unsigned" && (
            <span
              title="Onverifieer — geen handtekening van hierdie sender nie"
              className="font-bold uppercase tracking-[0.14em]"
            >
              ongeteken
            </span>
          )}
          {clock}
        </span>
      )}
    </div>
  );
}

/**
 * The bubble tail — a small filled wedge tucked under the FINAL bubble of a
 * run, flush with the group side, nudged 1px up so it fuses with the shell.
 * Filled to match the bubble surface (white for yours, edge-grey for theirs)
 * so it reads as part of the bubble, not a decoration.
 */
function Tail({ mine }: { mine: boolean }) {
  return (
    <svg
      viewBox="0 0 10 10"
      aria-hidden
      className={`absolute top-full h-2.5 w-2.5 -translate-y-px ${mine ? "right-0" : "left-0"}`}
    >
      {mine ? <path d="M0 0 H10 V10 Z" fill="#ffffff" /> : <path d="M10 0 H0 V10 Z" fill="#262626" />}
    </svg>
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
        className="flex max-w-[85%] items-center gap-2 rounded-[18px] rounded-bl-lg border border-dashed border-neutral-800 px-3.5 py-2.5 will-change-transform"
      >
        <Flame className="size-4 shrink-0 text-neutral-500" aria-hidden />
        <span className="font-mono text-[12px] font-bold uppercase tracking-wider text-neutral-500">gebrand · genulifieer</span>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`relative max-w-[85%] overflow-hidden rounded-[18px] border shadow-[0_6px_22px_-4px_rgba(0,0,0,0.75)] will-change-transform ${
        mine ? "rounded-br-lg border-neutral-700 bg-neutral-950" : "rounded-bl-lg border-neutral-800 bg-neutral-950"
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
          className="flex min-h-[104px] w-48 flex-col items-center justify-center gap-2 px-4 py-6 outline-none sm:w-56"
        >
          <EyeOff className="size-5 text-neutral-400" aria-hidden />
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-300">
            tap om te sien
          </span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            brand daarna weg
          </span>
        </button>
      )}

      {/* encryption proof — the pixels rode here sealed, AES-256-GCM, and the
          server held nothing but noise the whole way */}
      <span
        className="flex items-center justify-center gap-1.5 border-t border-neutral-900 bg-black/80 px-3 py-1.5 font-mono text-[8px] font-bold uppercase tracking-[0.22em] text-neutral-500"
        aria-hidden
      >
        <Lock className="size-2.5" aria-hidden />
        {CHAT_MEDIA_SEALED}
      </span>

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
