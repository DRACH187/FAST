"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  ArrowRight,
  ChevronRight,
  Copy,
  Crosshair,
  KeyRound,
  Map as MapIcon,
  MessagesSquare,
  Plus,
  Radio,
  ShieldCheck,
  Swords,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "@/components/fast/toast";
import { REDUCED_MOTION, ScreenShell, pressFeedback, staggerAnimChildren, useHouseLine } from "@/components/fast/motion";
import { FastButton, FastInput, FastModal, WipeChip } from "@/components/fast/primitives";
import { ProfileSheet } from "@/components/fast/profile-sheet";
import { useLivePresence } from "@/lib/fast/live";
import { cachedMemberTotal, fetchMemberTotal } from "@/lib/fast/member-ledger";
import {
  HUB_CODE_LABEL,
  HUB_CONFIRM_DELETE,
  HUB_DELETE,
  HUB_EMPTY,
  HUB_FOOTER,
  HUB_JOIN,
  HUB_SESSION_CREATED,
  HUB_SESSION_DELETED,
  HUB_SESSION_JOINED,
  HUB_START,
  HUB_TAGLINES,
  pick,
} from "@/lib/fast/copy";
import type { CallsignIdentity } from "@/lib/fast/identity";
import type { SessionView } from "@/lib/fast/session-manager";

gsap.registerPlugin(useGSAP);

const CODE_RE = /^[A-Z]{6}$/;

const clockFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayFmt = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short" });

/** "14:32" today, "12 JUN" earlier, "NEW" when nothing has landed yet. */
function lastActivityLabel(s: SessionView): string {
  const last = s.messages[s.messages.length - 1];
  if (!last) return "NEW";
  const ts = last.ts || Date.parse(last.createdAt);
  if (!Number.isFinite(ts) || ts <= 0) return "NEW";
  const d = new Date(ts);
  const n = new Date();
  const sameDay =
    d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? clockFmt.format(d) : dayFmt.format(d).toUpperCase();
}

type HubProps = {
  identityFp: string;
  callsign: CallsignIdentity | null;
  sessions: SessionView[];
  busy: boolean;
  onOpen: (code: string) => void;
  onStart: () => Promise<string>;
  onJoin: (code: string) => Promise<void>;
  onDelete: (code: string) => Promise<void>;
  onClose: (code: string) => void;
  /** Delete/replace the saved nickname — returns to the callsign login. */
  onSwitchCallsign: () => void;
  onOpenMap: () => void;
  onOpenWanted: () => void;
  onOpenLive: () => void;
  onOpenIntel: () => void;
};

export function HubScreen({
  callsign,
  sessions,
  busy,
  onOpen,
  onStart,
  onJoin,
  onDelete,
  onClose,
  onSwitchCallsign,
  onOpenMap,
  onOpenWanted,
  onOpenLive,
  onOpenIntel,
}: HubProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [joinCode, setJoinCode] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteCode, setDeleteCode] = useState("");
  const [leaveCode, setLeaveCode] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  // one war cry per visit — fresh from the house voice
  const warCry = useHouseLine(HUB_TAGLINES);
  const startLabel = useHouseLine(HUB_START);
  const joinLabel = useHouseLine(HUB_JOIN);
  const deleteLabel = useHouseLine(HUB_DELETE);
  const deleteConfirm = useHouseLine(HUB_CONFIRM_DELETE);
  const emptyLine = useHouseLine(HUB_EMPTY);
  const footerLine = useHouseLine(HUB_FOOTER);

  // one 30s tick drives every wipe-countdown chip — rows never run timers
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // GSAP: staggered hub entrance
  useGSAP(
    () => staggerAnimChildren(shellRef.current),
    { scope: shellRef }
  );

  const handleStart = useCallback(async () => {
    try {
      const code = await onStart();
      setCreated(code);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kon die werf nie oopmaak nie");
    }
  }, [onStart]);

  const submitJoin = useCallback(
    async (code: string) => {
      if (!CODE_RE.test(code)) return;
      try {
        await onJoin(code);
        setJoinCode("");
        toast.success(HUB_SESSION_JOINED);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Kon nie by die werf intrek nie");
      }
    },
    [onJoin]
  );

  const onJoinInput = useCallback(
    (v: string) => {
      setJoinCode(v);
      if (v.length === 6) void submitJoin(v);
    },
    [submitJoin]
  );

  const submitDelete = useCallback(async () => {
    const code = deleteCode.trim().toUpperCase();
    if (!CODE_RE.test(code)) return;
    try {
      await onDelete(code);
      setDeleteOpen(false);
      setDeleteCode("");
      toast.success(HUB_SESSION_DELETED);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kon die werf nie moer nie");
    }
  }, [deleteCode, onDelete]);

  const copyCode = useCallback((code: string) => {
    void navigator.clipboard.writeText(code);
    toast.success("Gekopieer. Stuur dit.");
  }, []);

  return (
    <ScreenShell as="main" className="fast-grain flex min-h-dvh flex-col">
      <div ref={shellRef} className="contents">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-5 pb-32 pt-[max(1.5rem,calc(env(safe-area-inset-top)+1rem))] sm:max-w-2xl sm:gap-9 lg:max-w-3xl">
          {/* BRAND — sticky: the logo rides at the top of the hub at all times */}
          <header
            data-anim
            className="sticky top-0 z-20 -mx-5 flex flex-col gap-3 border-b border-neutral-900/80 bg-black/85 px-5 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md"
          >
            <div className="flex items-center gap-4 pt-1">
              <Image
                src="/fast-logo.png"
                alt="FAST GUNS"
                width={256}
                height={256}
                priority
                draggable={false}
                className="h-16 w-16 shrink-0 mix-blend-screen"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="gang-font text-3xl leading-none text-white [text-shadow:0_0_26px_rgba(255,255,255,0.25)]">
                  FAST GUNS
                </span>
                <span className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-neutral-500">
                  <span className="font-bold tracking-[0.4em] text-neutral-300">187</span>
                  <span aria-hidden>·</span>
                  {warCry}
                </span>
              </div>
            </div>

            {/* callsign + live counter row */}
            <div className="flex items-center gap-2">
              {callsign ? (
                <button
                  onClick={(e) => {
                    pressFeedback(e.currentTarget);
                    setProfileOpen(true);
                  }}
                  aria-label={`Profile — signed in as ${callsign.nickname}`}
                  className="flex min-h-[38px] min-w-0 items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1.5 outline-none transition-colors hover:border-neutral-500"
                >
                  <ShieldCheck className="size-4 shrink-0 text-neutral-400" aria-hidden />
                  <span
                    className={`truncate text-neutral-200 ${
                      callsign.role === "boss"
                        ? "drach-font text-lg leading-none text-white"
                        : "font-mono text-xs font-bold uppercase tracking-[0.18em]"
                    }`}
                  >
                    {callsign.nickname}
                  </span>
                </button>
              ) : null}
              <button
                onClick={(e) => {
                  pressFeedback(e.currentTarget);
                  onOpenLive();
                }}
                aria-label="Open the live board"
                className="group flex min-h-[38px] items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1.5 outline-none transition-colors hover:border-neutral-600"
              >
                <span
                  aria-hidden
                  className="size-1.5 animate-fast-pulse rounded-full bg-white"
                />
                <span className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-neutral-200">
                  <OnlineCount />
                </span>
              </button>
              <span
                title="Total members ever — the permanent roll of the 187"
                className="flex min-h-[38px] items-center gap-1.5 rounded-full border border-neutral-900 bg-neutral-950/60 px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-[0.18em] text-neutral-400"
              >
                <Users className="size-3.5 text-neutral-500" aria-hidden />
                <EverCount />
              </span>
            </div>
          </header>

          {/* actions: start / join */}
          <section data-anim aria-label="Session actions" className="flex flex-col gap-2.5">
            <FastButton
              size="lg"
              onClick={handleStart}
              disabled={busy}
              className="min-h-[56px] w-full font-mono text-sm uppercase tracking-[0.28em]"
            >
              <Plus className="size-5" aria-hidden />
              {startLabel}
            </FastButton>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitJoin(joinCode);
              }}
              className="flex flex-col gap-2.5 sm:flex-row"
            >
              <FastInput
                value={joinCode}
                onChange={(e) => onJoinInput(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6))}
                placeholder="MOER DIE KODE IN"
                aria-label="6-letter session code"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={6}
                className="min-h-[56px] flex-1 rounded-xl text-center font-mono text-lg font-black tracking-[0.35em] uppercase placeholder:text-sm placeholder:tracking-[0.3em]"
              />
              <FastButton
                type="submit"
                variant="outline"
                size="lg"
                disabled={busy || !CODE_RE.test(joinCode)}
                className="min-h-[56px] font-mono text-sm uppercase tracking-[0.28em] sm:w-32"
              >
                {joinLabel}
              </FastButton>
            </form>
            <p className="text-center font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-neutral-600">
              {HUB_CODE_LABEL}
            </p>
          </section>

          {/* open sessions */}
          <section data-anim aria-label="Open sessions" className="flex flex-col gap-3">
            <h2 className="font-mono text-xs font-bold uppercase tracking-[0.32em] text-neutral-400">
              OOP WERWE {sessions.length > 0 && `· ${sessions.length}`}
            </h2>

            {sessions.length === 0 ? (
              <EmptyState line={emptyLine} />
            ) : (
              <ul className="grid gap-2.5">
                {sessions.map((s) => (
                  <SessionRow
                    key={s.code}
                    session={s}
                    now={now}
                    onOpen={() => onOpen(s.code)}
                    onClose={() => setLeaveCode(s.code)}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* quieter utilities */}
          <section data-anim aria-label="More" className="flex flex-col gap-2">
            <ActionRow
              icon={Trash2}
              label="MOER ’N WERF UIT"
              hint="Vee dit vir elke ouen uit — almal, alles, klaar"
              onClick={() => setDeleteOpen(true)}
              disabled={busy}
            />
          </section>
        </div>

        {/* sticky footer */}
        <footer data-anim className="mx-auto mt-auto w-full max-w-md px-5 pb-28 pt-2 sm:max-w-2xl lg:max-w-3xl">
          <div className="flex flex-col items-center gap-1.5 border-t border-neutral-900 pt-4 text-center">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-neutral-500">
              {footerLine}
            </p>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-neutral-600">
              Elke werf vee homself uit ná 5 uur · niks bly staan nie
            </p>
          </div>
        </footer>
      </div>

      {/* bottom tab bar — thumb-reachable, 44px+ targets, always visible */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-900 bg-black/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
      >
        <div className="mx-auto grid max-w-md grid-cols-5 sm:max-w-2xl lg:max-w-3xl">
          <TabButton icon={MessagesSquare} label="Werwe" active onClick={() => undefined} />
          <TabButton icon={Swords} label="War Room" onClick={onOpenIntel} />
          <TabButton icon={Crosshair} label="Wanted" onClick={onOpenWanted} />
          <TabButton icon={MapIcon} label="Kaart" onClick={onOpenMap} />
          <TabButton icon={Radio} label="Live" onClick={onOpenLive} />
        </div>
      </nav>

      {/* created code — share it while it lives */}
      {/* profile — callsign save/delete */}
      <ProfileSheet
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        callsign={callsign}
        onSwitch={onSwitchCallsign}
      />

      <FastModal open={created !== null} onClose={() => setCreated(null)} label="Session created">
        <div className="flex flex-col items-center gap-5 text-center">
          <h2 className="gang-font text-3xl text-white">{HUB_SESSION_CREATED}</h2>
          <button
            aria-label="Copy session code"
            onClick={(e) => {
              pressFeedback(e.currentTarget);
              if (created) copyCode(created);
            }}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border border-neutral-800 bg-black py-7 outline-none transition-all hover:border-neutral-500 active:scale-[0.98]"
          >
            <span className="font-mono text-[2.4rem] font-black leading-none tracking-[0.28em] text-white [padding-left:0.28em]">
              {created}
            </span>
            <Copy className="size-5 shrink-0 text-neutral-400" aria-hidden />
          </button>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold text-neutral-300">Wie die kode het, kom in. Wie nie, bly buite.</p>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-neutral-500">
              Hierdie werf vee homself uit ná 5 uur
            </p>
          </div>
          <FastButton
            className="w-full font-mono text-sm uppercase tracking-[0.24em]"
            onClick={() => {
              const code = created;
              setCreated(null);
              if (code) onOpen(code);
            }}
          >
            Moer in
          </FastButton>
        </div>
      </FastModal>

      {/* wipe for everyone */}
      <FastModal
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setDeleteCode("");
        }}
        label="Wipe a session for everyone"
      >
        <div className="flex flex-col gap-4">
          <div className="text-center">
            <h2 className="flex items-center justify-center gap-2 text-base font-bold text-neutral-100">
              <Trash2 className="size-5 text-neutral-300" aria-hidden />
              {deleteLabel}
            </h2>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-neutral-400">
              {deleteConfirm} Die kode, die rol en die geskiedenis — <span className="text-neutral-100">vir almal</span>, dadelik, onomkeerbaar.
            </p>
          </div>
          <FastInput
            value={deleteCode}
            onChange={(e) => setDeleteCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6))}
            placeholder="KODE"
            aria-label="Session code to wipe"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={6}
            className="text-center font-mono text-xl font-black tracking-[0.4em] uppercase"
          />
          <div className="flex flex-col gap-2">
            <FastButton
              disabled={!CODE_RE.test(deleteCode.trim())}
              onClick={() => void submitDelete()}
              className="w-full font-mono text-sm uppercase tracking-[0.24em]"
            >
              VERBRAND ALLES
            </FastButton>
            <FastButton
              variant="ghost"
              className="w-full"
              onClick={() => {
                setDeleteOpen(false);
                setDeleteCode("");
              }}
            >
              Bly maar
            </FastButton>
          </div>
        </div>
      </FastModal>

      {/* leave (local close) */}
      <FastModal
        open={leaveCode !== null}
        onClose={() => setLeaveCode(null)}
        label="Close session on this device"
      >
        <div className="flex flex-col gap-5">
          <div className="text-center">
            <h2 className="text-base font-bold text-neutral-100">Klap {leaveCode} hier toe?</h2>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-neutral-400">
              Hierdie toestel verbrand sy sleutels vir die werf. Die res bly praat — om terug te kom moet iemand jou weer die sleutel gee.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <FastButton
              className="w-full font-mono text-sm uppercase tracking-[0.24em]"
              onClick={() => {
                if (leaveCode) onClose(leaveCode);
                setLeaveCode(null);
              }}
            >
              TOE & VEE UIT
            </FastButton>
            <FastButton variant="ghost" className="w-full" onClick={() => setLeaveCode(null)}>
              Bly
            </FastButton>
          </div>
        </div>
      </FastModal>
    </ScreenShell>
  );
}

// ---------------------------------------------------------------- pieces

/** Live online counter fed by the shared heartbeat store (no extra polling). */
function OnlineCount() {
  const { count, error } = useLivePresence();
  return (
    <span title={error ? "Heartbeat retrying" : "Ouens aanlyn reg nou"}>
      {count} AAN
    </span>
  );
}

/** ALL-TIME member total — the permanent roll. Paints the cached number
 *  instantly, then reconciles with the ledger every 5 minutes. */
function EverCount() {
  const [total, setTotal] = useState(cachedMemberTotal);
  useEffect(() => {
    let alive = true;
    const pull = () =>
      void fetchMemberTotal().then((t) => {
        if (alive && typeof t === "number") setTotal(t);
      });
    pull();
    const iv = window.setInterval(pull, 5 * 60_000);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, []);
  return <span>{total > 0 ? `${total} EVER` : "EVER"}</span>;
}

/** Bottom-nav tab — icon over label, 44px+ hit target, monochrome states. */
function TabButton({
  icon: Icon,
  label,
  active = false,
  onClick,
}: {
  icon: typeof Radio;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-[60px] flex-col items-center justify-center gap-1 outline-none transition-colors focus-visible:bg-neutral-900 ${
        active ? "text-white" : "text-neutral-500 hover:text-neutral-200"
      }`}
    >
      <Icon className="size-5" aria-hidden />
      {/* 320px worst case: 64px-wide tab — tighter tracking + nowrap keeps
          "WAR ROOM" on one line with ~10px slack, never clipped */}
      <span className="whitespace-nowrap font-mono text-[9px] font-bold uppercase tracking-[0.16em]">{label}</span>
      <span
        aria-hidden
        className={`h-0.5 w-6 rounded-full ${active ? "bg-white" : "bg-transparent"}`}
      />
    </button>
  );
}

/** Utility row (wipe). AMERICANS ring on, because it's interactive. */
type ActionRowProps = {
  icon: typeof Plus;
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
};

function ActionRow({ icon: Icon, label, hint, onClick, disabled }: ActionRowProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-neutral-900 px-4 py-3 text-left outline-none transition-colors duration-200 focus-visible:border-neutral-600 hover:border-neutral-700 disabled:pointer-events-none disabled:opacity-50"
    >
      <Icon className="size-5 shrink-0 text-neutral-400 transition-colors group-hover:text-neutral-200" aria-hidden />
      <span className="flex-1">
        <span className="block text-sm font-bold text-neutral-200">{label}</span>
        <span className="block text-xs font-semibold text-neutral-500">{hint}</span>
      </span>
      <ChevronRight
        className="size-4 text-neutral-600 transition-transform duration-200 group-hover:translate-x-0.5"
        aria-hidden
      />
    </button>
  );
}

/** Ghosted six-cell code motif for the empty state. */
function EmptyState({ line }: { line: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const cells = ref.current?.querySelectorAll("[data-ghost-cell]");
      if (REDUCED_MOTION || !cells || cells.length === 0) return;
      gsap.fromTo(
        cells,
        { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.55, stagger: 0.07, delay: 0.25, ease: "power2.out" }
      );
    },
    { scope: ref }
  );

  return (
    <div ref={ref} className="rounded-2xl border border-dashed border-neutral-900 px-6 py-8">
      <div aria-hidden className="flex items-center justify-center gap-1.5">
        {"GUNSUP".split("").map((ch, i) => (
          <span
            key={i}
            data-ghost-cell
            className="flex size-9 items-center justify-center rounded-lg border border-neutral-800/60 bg-neutral-950/60 font-mono text-sm font-bold text-neutral-500"
          >
            {ch}
          </span>
        ))}
      </div>
      <p className="mt-5 text-center text-sm font-bold text-neutral-300">{line}</p>
      <p className="mx-auto mt-1.5 max-w-[270px] text-center text-xs font-semibold leading-relaxed text-neutral-500">
        Skop een hierbo op en deel die ses-letter kode. ’n Klomp kan gelyktydig loop — elke een moer homself ná vyf uur.
      </p>
    </div>
  );
}

function SessionRow({
  session,
  now,
  onOpen,
  onClose,
}: {
  session: SessionView;
  now: number;
  onOpen: () => void;
  onClose: () => void;
}) {
  const rowRef = useRef<HTMLLIElement>(null);

  // GSAP: rows pop in as they appear (including restored sessions)
  useGSAP(
    () => {
      gsap.fromTo(
        rowRef.current,
        { opacity: 0, y: 12, scale: 0.98 },
        { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: "power3.out" }
      );
    },
    { scope: rowRef }
  );

  const live = session.presence.length;
  const solo = live <= 1;

  return (
    <li ref={rowRef} className="relative will-change-transform">
      <button
        onClick={onOpen}
        className="group flex w-full flex-col gap-2.5 rounded-2xl border border-neutral-800/80 bg-neutral-950 px-4 py-4 text-left outline-none transition-colors duration-200 focus-visible:border-neutral-500 hover:border-neutral-600 hover:bg-neutral-900"
      >
        <span className="flex items-center gap-3">
          <span className="font-mono text-xl font-black tracking-[0.26em] text-white">
            {session.code}
          </span>
          <span className="flex-1" />
          {session.unread > 0 && (
            <span className="flex min-w-6 items-center justify-center rounded-full bg-white px-2 py-0.5 text-xs font-black text-black">
              {session.unread > 99 ? "99+" : session.unread}
            </span>
          )}
          <ArrowRight
            className="size-5 text-neutral-500 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
        {/* meta line: wraps on 320px so the wipe chip never forces the row
            wider than the column (chip keeps ml-auto alignment when it wraps) */}
        <span className="flex flex-wrap items-center gap-2.5">
          <span
            className="flex items-center gap-1.5"
            title={solo ? "Net jy is hier" : `${live} ouens sink gelyktydig`}
          >
            <span className="flex items-center gap-1" aria-hidden>
              {Array.from({ length: Math.min(live, 4) }).map((_, i) => (
                <span key={i} className="size-1.5 rounded-full bg-neutral-200" />
              ))}
            </span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-300">
              {solo ? "SOLO" : `${live} LIVE`}
            </span>
          </span>
          <span aria-hidden className="size-0.5 rounded-full bg-neutral-700" />
          <span className="font-mono text-[10px] font-bold tabular-nums tracking-[0.1em] text-neutral-500" title="Last activity">
            {lastActivityLabel(session)}
          </span>
          {!session.hasKey && (
            <span
              className="flex animate-fast-pulse items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-400"
              title="Waiting for a member to hand you the session key"
            >
              <KeyRound className="size-3.5" aria-hidden />
              sleutel
            </span>
          )}
          <WipeChip expiresAt={session.expiresAt} now={now} className="ml-auto" />
        </span>
      </button>
      <button
        onClick={onClose}
        aria-label={`Close session ${session.code} on this device`}
        className="absolute -right-1.5 -top-1.5 flex size-7 items-center justify-center rounded-full border border-neutral-700 bg-black text-neutral-400 outline-none transition-colors after:absolute after:-inset-2.5 after:rounded-full after:content-[''] hover:border-neutral-400 hover:text-white focus-visible:border-neutral-300 focus-visible:text-white"
      >
        <X className="size-4" aria-hidden />
      </button>
    </li>
  );
}
