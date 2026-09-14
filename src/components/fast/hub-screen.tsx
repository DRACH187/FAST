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
  Fingerprint,
  KeyRound,
  Map as MapIcon,
  MessagesSquare,
  Plus,
  Radio,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "@/components/fast/toast";
import { REDUCED_MOTION, ScreenShell, pressFeedback, staggerAnimChildren } from "@/components/fast/motion";
import { FastButton, FastInput, FastModal, WipeChip } from "@/components/fast/primitives";
import { ProfileSheet } from "@/components/fast/profile-sheet";
import { useLivePresence } from "@/lib/fast/live";
import { cachedMemberTotal, fetchMemberTotal } from "@/lib/fast/member-ledger";
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
};

export function HubScreen({
  identityFp,
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
}: HubProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [joinCode, setJoinCode] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteCode, setDeleteCode] = useState("");
  const [leaveCode, setLeaveCode] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

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
      toast.error(err instanceof Error ? err.message : "Kon die ses nie skop nie");
    }
  }, [onStart]);

  const submitJoin = useCallback(
    async (code: string) => {
      if (!CODE_RE.test(code)) return;
      try {
        await onJoin(code);
        setJoinCode("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Kon nie by die ses intrek nie");
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
      toast.success(`Session ${code} terminated for all users`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kon die ses nie moer nie");
    }
  }, [deleteCode, onDelete]);

  const copyCode = useCallback((code: string) => {
    void navigator.clipboard.writeText(code);
    toast.success("Code copied");
  }, []);

  return (
    <ScreenShell as="main" className="fast-grain flex min-h-dvh flex-col">
      <div ref={shellRef} className="contents">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-7 px-5 pb-28 pt-[max(1.5rem,calc(env(safe-area-inset-top)+1rem))]">
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
                className="h-14 w-14 shrink-0 mix-blend-screen"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-mono text-lg font-black uppercase text-white" style={{ letterSpacing: '0.3em', textShadow: '0 0 22px rgba(255,255,255,0.2)' }}>
                  FAST GUNS
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.3em] text-neutral-600">
                  <span className="font-bold tracking-[0.4em] text-neutral-400">187</span>
                  <span aria-hidden>·</span>
                  encrypted sessions
                </span>
              </div>
              <span
                title="This device's fingerprint — public material only"
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-900 px-2.5 py-1 font-mono text-[9px] tracking-[0.18em] text-neutral-500"
              >
                <Fingerprint className="size-3 text-neutral-600" aria-hidden />
                {identityFp.slice(0, 4)}·{identityFp.slice(4, 8)}
              </span>
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
                  className="flex min-w-0 items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1.5 outline-none transition-colors hover:border-neutral-500"
                >
                  <ShieldCheck className="size-3.5 shrink-0 text-neutral-500" aria-hidden />
                  <span
                    className={`truncate text-neutral-200 ${
                      callsign.role === "boss"
                        ? "drach-font text-base leading-none text-white"
                        : "font-mono text-[10px] font-bold uppercase tracking-[0.2em]"
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
                className="group flex min-h-[34px] items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1.5 outline-none transition-colors hover:border-neutral-600"
              >
                <span
                  aria-hidden
                  className="size-1.5 animate-fast-pulse rounded-full bg-white"
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-300">
                  <OnlineCount />
                </span>
              </button>
              <span
                title="Total members ever — the permanent roll of the 187"
                className="flex min-h-[34px] items-center gap-1.5 rounded-full border border-neutral-900 bg-neutral-950/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-500"
              >
                <Users className="size-3 text-neutral-600" aria-hidden />
                <EverCount />
              </span>
              <span className="flex-1" />
              <button
                onClick={(e) => {
                  pressFeedback(e.currentTarget);
                  onOpenLive();
                }}
                aria-label="Who is live right now"
                className="flex min-h-[34px] items-center gap-1.5 rounded-full border border-neutral-900 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-neutral-500 outline-none transition-colors hover:border-neutral-600 hover:text-neutral-300"
              >
                <Radio className="size-3" aria-hidden />
                Live
              </button>
            </div>
          </header>

          {/* actions: start / join */}
          <section data-anim aria-label="Session actions" className="flex flex-col gap-2.5">
            <FastButton
              size="lg"
              onClick={handleStart}
              disabled={busy}
              className="min-h-[52px] w-full font-mono text-[11px] uppercase tracking-[0.28em]"
            >
              <Plus className="size-4" aria-hidden />
              Start new session
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
                placeholder="SKRYF DIE KODE"
                aria-label="6-letter session code"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={6}
                className="min-h-[52px] flex-1 rounded-xl text-center font-mono text-base font-bold tracking-[0.35em] uppercase placeholder:font-normal placeholder:tracking-[0.3em]"
              />
              <FastButton
                type="submit"
                variant="outline"
                size="lg"
                disabled={busy || !CODE_RE.test(joinCode)}
                className="min-h-[52px] font-mono text-[11px] uppercase tracking-[0.28em] sm:w-32"
              >
                Join
              </FastButton>
            </form>
          </section>

          {/* open sessions */}
          <section data-anim aria-label="Open sessions" className="flex flex-col gap-3">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.32em] text-neutral-600">
              Open sessions {sessions.length > 0 && `· ${sessions.length}`}
            </h2>

            {sessions.length === 0 ? (
              <EmptyState />
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
              label="Moer ’n ses uit"
              hint="Vee dit vir elke deelnemer uit"
              onClick={() => setDeleteOpen(true)}
              disabled={busy}
            />
          </section>
        </div>

        {/* sticky footer */}
        <footer data-anim className="mx-auto mt-auto w-full max-w-md px-5 pb-24 pt-2">
          <div className="flex flex-col items-center gap-1.5 border-t border-neutral-900 pt-4 text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-neutral-600">
              Sleutels bly net in dié tab — nooit op ’n server nie
            </p>
            <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-neutral-700">
              Elke geselsie moer homself ná 5 uur · 187
            </p>
          </div>
        </footer>
      </div>

      {/* bottom tab bar — thumb-reachable, 44px+ targets, always visible */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-900 bg-black/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
      >
        <div className="mx-auto grid max-w-md grid-cols-4">
          <TabButton icon={MessagesSquare} label="Sessions" active onClick={() => undefined} />
          <TabButton icon={Crosshair} label="Wanted" onClick={onOpenWanted} />
          <TabButton icon={MapIcon} label="Map" onClick={onOpenMap} />
          <TabButton icon={Radio} label="Live" onClick={onOpenLive} />
        </div>
      </nav>

      {/* created code — share it while it lives */}
      {/* profile — callsign save/delete */}
      <ProfileSheet
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        callsign={callsign}
        identityFp={identityFp}
        onSwitch={onSwitchCallsign}
      />

      <FastModal open={created !== null} onClose={() => setCreated(null)} label="Session created">
        <div className="flex flex-col items-center gap-5 text-center">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.35em] text-neutral-500">
            Session created
          </h2>
          <button
            aria-label="Copy session code"
            onClick={(e) => {
              pressFeedback(e.currentTarget);
              if (created) copyCode(created);
            }}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border border-neutral-800 bg-black py-6 outline-none transition-all hover:border-neutral-500 active:scale-[0.98]"
          >
            <span className="font-mono text-[2rem] font-bold leading-none tracking-[0.28em] text-white [padding-left:0.28em]">
              {created}
            </span>
            <Copy className="size-4 shrink-0 text-neutral-500" aria-hidden />
          </button>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-neutral-400">Anyone with this code can join while it lives.</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-neutral-600">
              This session wipes itself after 5 hours
            </p>
          </div>
          <FastButton
            className="w-full font-mono text-[11px] uppercase tracking-[0.24em]"
            onClick={() => {
              const code = created;
              setCreated(null);
              if (code) onOpen(code);
            }}
          >
            Enter session
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
            <h2 className="flex items-center justify-center gap-2 text-sm font-medium text-neutral-100">
              <Trash2 className="size-4 text-neutral-300" aria-hidden />
              Wipe a session
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-neutral-500">
              The code, its roster and the full ciphertext history are erased
              for <span className="text-neutral-300">every</span> participant —
              immediately, irreversibly.
            </p>
          </div>
          <FastInput
            value={deleteCode}
            onChange={(e) => setDeleteCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6))}
            placeholder="CODE"
            aria-label="Session code to wipe"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={6}
            className="text-center font-mono text-lg font-bold tracking-[0.4em] uppercase"
          />
          <div className="flex flex-col gap-2">
            <FastButton
              disabled={!CODE_RE.test(deleteCode.trim())}
              onClick={() => void submitDelete()}
              className="w-full font-mono text-[11px] uppercase tracking-[0.24em]"
            >
              Wipe for everyone
            </FastButton>
            <FastButton
              variant="ghost"
              className="w-full"
              onClick={() => {
                setDeleteOpen(false);
                setDeleteCode("");
              }}
            >
              Cancel
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
            <h2 className="text-sm font-medium text-neutral-100">Close {leaveCode} here?</h2>
            <p className="mt-2 text-xs leading-relaxed text-neutral-500">
              This device destroys its key material for the session. Everyone
              else keeps talking — to return you will need a fresh key
              hand-off from a member.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <FastButton
              className="w-full font-mono text-[11px] uppercase tracking-[0.24em]"
              onClick={() => {
                if (leaveCode) onClose(leaveCode);
                setLeaveCode(null);
              }}
            >
              Close & discard key
            </FastButton>
            <FastButton variant="ghost" className="w-full" onClick={() => setLeaveCode(null)}>
              Stay
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
    <span title={error ? "Heartbeat retrying" : "Operatives online right now"}>
      {count} on
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
  return <span>{total > 0 ? `${total} ever` : "ever"}</span>;
}

/** Bottom-nav tab — icon over label, 44px+ hit target, hairline active state. */
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
      className={`flex min-h-[56px] flex-col items-center justify-center gap-1 outline-none transition-colors focus-visible:bg-neutral-900 ${
        active ? "text-white" : "text-neutral-600 hover:text-neutral-300"
      }`}
    >
      <Icon className="size-5" aria-hidden />
      <span className="font-mono text-[8px] uppercase tracking-[0.22em]">{label}</span>
      <span
        aria-hidden
        className={`h-0.5 w-6 rounded-full ${active ? "bg-white" : "bg-transparent"}`}
      />
    </button>
  );
}

/** Quiet utility row (map, wipe). */
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
      className="group flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-neutral-900 px-3.5 py-2.5 text-left outline-none transition-colors duration-200 focus-visible:border-neutral-600 hover:border-neutral-700 disabled:pointer-events-none disabled:opacity-50"
    >
      <Icon className="size-4 shrink-0 text-neutral-500 transition-colors group-hover:text-neutral-300" aria-hidden />
      <span className="flex-1">
        <span className="block text-xs font-medium text-neutral-300">{label}</span>
        <span className="block text-[10px] text-neutral-600">{hint}</span>
      </span>
      <ChevronRight
        className="size-3.5 text-neutral-700 transition-transform duration-200 group-hover:translate-x-0.5"
        aria-hidden
      />
    </button>
  );
}

/** Ghosted six-cell code motif for the empty state. */
function EmptyState() {
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
        {"FAST26".split("").map((ch, i) => (
          <span
            key={i}
            data-ghost-cell
            className="flex size-8 items-center justify-center rounded-lg border border-neutral-800/60 bg-neutral-950/60 font-mono text-[11px] text-neutral-700"
          >
            {ch}
          </span>
        ))}
      </div>
      <p className="mt-5 text-center text-xs text-neutral-500">Geen ses oop nie, ouen.</p>
      <p className="mx-auto mt-1.5 max-w-[250px] text-center text-[11px] leading-relaxed text-neutral-600">
        Skop een hierbo op en deel die ses-letter kode. ’n Klomp kan gelyktydig
        loop — elke een moer homself ná vyf uur.
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
        className="group flex w-full flex-col gap-2.5 rounded-2xl border border-neutral-800/80 bg-neutral-950 px-4 py-3.5 text-left outline-none transition-colors duration-200 focus-visible:border-neutral-500 hover:border-neutral-600 hover:bg-neutral-900"
      >
        <span className="flex items-center gap-3">
          <span className="font-mono text-lg font-bold tracking-[0.26em] text-white">
            {session.code}
          </span>
          <span className="flex-1" />
          {session.unread > 0 && (
            <span className="flex min-w-5 items-center justify-center rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-black">
              {session.unread > 99 ? "99+" : session.unread}
            </span>
          )}
          <ArrowRight
            className="size-4 text-neutral-600 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
        <span className="flex items-center gap-2.5">
          <span
            className="flex items-center gap-1.5"
            title={solo ? "Only you are here right now" : `${live} participants syncing live`}
          >
            <span className="flex items-center gap-1" aria-hidden>
              {Array.from({ length: Math.min(live, 4) }).map((_, i) => (
                <span key={i} className="size-1.5 rounded-full bg-neutral-200" />
              ))}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-neutral-400">
              {solo ? "SOLO" : `${live} LIVE`}
            </span>
          </span>
          <span aria-hidden className="size-0.5 rounded-full bg-neutral-700" />
          <span className="font-mono text-[9px] tabular-nums tracking-[0.12em] text-neutral-600" title="Last activity">
            {lastActivityLabel(session)}
          </span>
          {!session.hasKey && (
            <span
              className="flex animate-fast-pulse items-center gap-1 font-mono text-[9px] uppercase tracking-[0.2em] text-neutral-500"
              title="Waiting for a member to hand you the session key"
            >
              <KeyRound className="size-3" aria-hidden />
              key
            </span>
          )}
          <span className="flex-1" />
          <WipeChip expiresAt={session.expiresAt} now={now} />
        </span>
      </button>
      <button
        onClick={onClose}
        aria-label={`Close session ${session.code} on this device`}
        className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-neutral-700 bg-black text-neutral-500 outline-none transition-colors after:absolute after:-inset-2.5 after:rounded-full after:content-[''] hover:border-neutral-500 hover:text-white focus-visible:border-neutral-400 focus-visible:text-white"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}
