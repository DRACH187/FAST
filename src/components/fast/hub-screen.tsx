"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  ArrowRight,
  ChevronRight,
  Copy,
  KeyRound,
  Lock,
  Plus,
  Radio,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "@/components/fast/toast";
import { REDUCED_MOTION, ScreenShell, pressFeedback, staggerAnimChildren, useHouseLine } from "@/components/fast/motion";
import { FastButton, FastInput, FastModal, WipeChip } from "@/components/fast/primitives";
import { useLivePresence } from "@/lib/fast/live";
import { cachedMemberTotal, fetchMemberTotal } from "@/lib/fast/member-ledger";
import {
  ROSTER_ALLTIME,
  ROSTER_EMPTY,
  ROSTER_NOTE,
  ROSTER_OFFLINE,
  ROSTER_OFFLINE_HEAD,
  ROSTER_ONLINE,
  ROSTER_ONLINE_HEAD,
  ROSTER_SEARCH_PLACE,
  ROSTER_SUB,
  ROSTER_TITLE,
  ROSTER_TOTAL,
  SUMMON_ALL_CTA,
  SUMMON_BUSY,
  SUMMON_CANCEL,
  SUMMON_CONFIRM_ALL,
  SUMMON_DONE,
  SUMMON_GO,
  SUMMON_NOTE,
  SUMMON_OFFLINE_TAG,
  SUMMON_PRIVATE_CONFIRM,
  SUMMON_PRIVATE_CTA,
  SUMMON_PRIVATE_DONE,
  SUMMON_PRIVATE_NOTE,
  SUMMON_PRIVATE_SHORT,
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
const rosterFmt = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

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
  onOpenLive: () => void;
  /** BOSS move: open a fresh E2EE session and doorbell the target fps.
   *  `opts.private` = a 1:1 DRACH invite whose doorbell hangs up to 2h so
   *  even an OFFLINE member gets rung the moment they next surface. */
  onBossSummon: (targets: string[], opts?: { private?: boolean }) => Promise<string>;
  /** Open the profile sheet (owned by the shell since task 19). */
  onOpenProfile: () => void;
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
  onOpenProfile,
  onOpenLive,
  onBossSummon,
}: HubProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [joinCode, setJoinCode] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteCode, setDeleteCode] = useState("");
  const [leaveCode, setLeaveCode] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  // boss-only roll of every callsign that ever stepped in
  const [rosterOpen, setRosterOpen] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  type RosterRow = { nickname: string; role: "member" | "boss"; fp: string; online: boolean; firstSeen: string; lastSeen: string | null };
  const [rosterRows, setRosterRows] = useState<RosterRow[] | null>(null);
  const [rosterQuery, setRosterQuery] = useState("");
  const [rosterAllTime, setRosterAllTime] = useState<number | null>(null);
  // summon confirmation state — one private 1:1 invite, or the whole online roll
  const [summonPick, setSummonPick] = useState<{ mode: "one"; fp: string; nickname: string; online: boolean } | { mode: "all" } | null>(null);
  const [summonBusy, setSummonBusy] = useState(false);
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
      toast.error(err instanceof Error ? err.message : "Die deur sit vas — moer weer");
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
        toast.error(err instanceof Error ? err.message : "Die werf wil jou nie in hê nie — probeer weer");
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
      toast.error(err instanceof Error ? err.message : "Uitmoer het gemors — vuur weer");
    }
  }, [deleteCode, onDelete]);

  const copyCode = useCallback((code: string) => {
    void navigator.clipboard.writeText(code);
    toast.success("Gekopieer. Stuur dit.");
  }, []);

  const openRoster = useCallback(async () => {
    if (!callsign || callsign.role !== "boss") return;
    setRosterOpen(true);
    setRosterLoading(true);
    setRosterError(null);
    setSummonPick(null);
    setRosterQuery("");
    try {
      const res = await fetch("/api/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint: identityFp, token: callsign.token }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        roll?: RosterRow[];
        allTime?: number;
        error?: string;
      };
      if (!res.ok || data.ok !== true || !Array.isArray(data.roll)) {
        setRosterError(typeof data.error === "string" ? data.error : "Die rol is weg — probeer weer");
        setRosterRows(null);
      } else {
        setRosterRows(data.roll);
        setRosterAllTime(typeof data.allTime === "number" ? data.allTime : null);
      }
    } catch {
      setRosterError("Netwerk onbereikbaar");
      setRosterRows(null);
    } finally {
      setRosterLoading(false);
    }
  }, [callsign, identityFp]);

  /** THE BOSS MOVE: new E2EE room, doorbell the targets, step in and hold it.
   *  A private pick rings one doorbell with a 2h hang time — the invited
   *  member walks into a room that only he and the boss hold keys for. */
  const execSummon = useCallback(async () => {
    if (!summonPick || summonBusy) return;
    setSummonBusy(true);
    try {
      const targets =
        summonPick.mode === "one"
          ? [summonPick.fp]
          : (rosterRows ?? []).filter((r) => r.online && r.role !== "boss").map((r) => r.fp);
      const isPrivate = summonPick.mode === "one";
      const code = await onBossSummon(targets, isPrivate ? { private: true } : undefined);
      setSummonPick(null);
      setRosterOpen(false);
      toast.success(isPrivate ? SUMMON_PRIVATE_DONE(code) : SUMMON_DONE(code));
      onOpen(code); // boss holds the room — keys wrap out from this device
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ontbieding geblok — skree weer");
    } finally {
      setSummonBusy(false);
    }
  }, [onBossSummon, onOpen, rosterRows, summonBusy, summonPick]);

  return (
    <ScreenShell
      as="main"
      className="fast-grain flex h-full flex-col overflow-x-hidden overflow-y-auto"
    >
      <div ref={shellRef} className="contents">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-5 pb-[calc(var(--fast-dock-clear)+1rem)] pt-[max(1.5rem,calc(env(safe-area-inset-top)+1rem))] sm:max-w-2xl sm:gap-9 lg:max-w-4xl lg:pb-10">
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
                    onOpenProfile();
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
              <ul className="grid gap-2.5 lg:grid-cols-2">
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
            {callsign?.role === "boss" && (
              <ActionRow
                icon={Users}
                label={ROSTER_TITLE}
                hint="Elke callsign wat ooit ingestap het — net joune"
                onClick={() => void openRoster()}
              />
            )}
            <ActionRow
              icon={Trash2}
              label="MOER ’N WERF UIT"
              hint="Vee dit vir elke ouen uit — almal, alles, klaar, geen genade"
              onClick={() => setDeleteOpen(true)}
              disabled={busy}
            />
          </section>
        </div>

        {/* sticky footer — clearance synced to the floating dock on phones */}
        <footer data-anim className="mx-auto mt-auto w-full max-w-md px-5 pb-[calc(var(--fast-dock-clear)+1rem)] pt-2 sm:max-w-2xl lg:max-w-4xl lg:pb-6">
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

      {/* profile — owned by the shell since task 19 */}

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
            <p className="text-sm font-bold text-neutral-300">Wie die kode het, kom in. Wie nie, fokkof en kak af.</p>
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

      {/* boss-only roll + summons control room */}
      <FastModal open={rosterOpen} onClose={() => setRosterOpen(false)} label="Boss roll" wide>
        <div className="flex max-h-[80dvh] flex-col gap-4 overflow-y-auto">
          <div className="text-center">
            <h2 className="gang-font text-3xl text-white">{ROSTER_TITLE}</h2>
            <p className="mt-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">
              {ROSTER_SUB}
            </p>
          </div>

          {rosterLoading && (
            <p className="py-8 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-500">
              Haal die rol…
            </p>
          )}

          {rosterError && !rosterLoading && (
            <p className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-center text-sm font-bold text-neutral-300">
              {rosterError}
            </p>
          )}

          {rosterRows !== null && !rosterLoading && (
            rosterRows.length === 0 ? (
              <p className="py-8 text-center text-sm font-semibold text-neutral-500">{ROSTER_EMPTY}</p>
            ) : (
              (() => {
                const q = rosterQuery.trim().toLowerCase();
                const searched = q ? rosterRows.filter((r) => r.nickname.toLowerCase().includes(q)) : rosterRows;
                const onlineRows = searched.filter((r) => r.online);
                const offlineRows = searched.filter((r) => !r.online);
                const summonable = onlineRows.filter((r) => r.role !== "boss");
                return (
                  <>
                    <p className="text-center font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">
                      {ROSTER_TOTAL(rosterRows.length)} · {rosterRows.filter((r) => r.online).length} {ROSTER_ONLINE}
                      {rosterAllTime !== null && (
                        <>
                          {" · "}
                          <span className="text-neutral-500">{ROSTER_ALLTIME(rosterAllTime)}</span>
                        </>
                      )}
                    </p>

                    {/* search the roll */}
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-neutral-600" aria-hidden />
                      <FastInput
                        value={rosterQuery}
                        onChange={(e) => setRosterQuery(e.target.value.slice(0, 24))}
                        placeholder={ROSTER_SEARCH_PLACE}
                        aria-label="Search the roll"
                        className="h-11 pl-10 font-mono text-xs font-bold tracking-[0.1em]"
                      />
                    </div>

                    {/* ONLINE — summonable now */}
                    <div className="flex flex-col gap-2">
                      <span className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-neutral-300">
                        <span aria-hidden className="size-1.5 animate-fast-pulse rounded-full bg-white" />
                        {ROSTER_ONLINE_HEAD} · {onlineRows.length}
                      </span>
                      {onlineRows.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-neutral-800 px-3 py-4 text-center text-xs font-semibold text-neutral-500">
                          Niemand aanlyn nie — selfs Varados slaap.
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-2">
                          {onlineRows.map((r) => (
                            <RosterLine
                              key={r.nickname}
                              row={r}
                              inviteable={r.role !== "boss"}
                              summonBusy={summonBusy}
                              picked={summonPick?.mode === "one" && summonPick.fp === r.fp}
                              onSummon={() => setSummonPick({ mode: "one", fp: r.fp, nickname: r.nickname, online: true })}
                            />
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* OFFLINE — the private doorbell hangs: ring them anyway,
                        their phone lights up the moment they next surface */}
                    {offlineRows.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-neutral-600">
                          {ROSTER_OFFLINE_HEAD} · {offlineRows.length}
                        </span>
                        <ul className="flex flex-col gap-2">
                          {offlineRows.map((r) => (
                            <RosterLine
                              key={r.nickname}
                              row={r}
                              inviteable={r.role !== "boss"}
                              summonBusy={summonBusy}
                              picked={summonPick?.mode === "one" && summonPick.fp === r.fp}
                              onSummon={() => setSummonPick({ mode: "one", fp: r.fp, nickname: r.nickname, online: false })}
                            />
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* boss move — summon everyone online in one blast */}
                    {summonable.length > 0 && (
                      <FastButton
                        variant="outline"
                        disabled={summonBusy}
                        onClick={() => setSummonPick({ mode: "all" })}
                        className="w-full font-mono text-xs uppercase tracking-[0.2em]"
                      >
                        <Radio className="size-4" aria-hidden />
                        {SUMMON_ALL_CTA} · {summonable.length}
                      </FastButton>
                    )}

                    {/* summons doorbell mechanics — honest about the key law */}
                    <p className="rounded-xl border border-neutral-900 bg-black px-3.5 py-2.5 text-[11px] font-semibold leading-relaxed text-neutral-400">
                      {SUMMON_NOTE}
                    </p>
                    <p className="rounded-xl border border-neutral-900 bg-black px-3.5 py-2.5 text-[11px] font-semibold leading-relaxed text-neutral-400">
                      {SUMMON_PRIVATE_NOTE}
                    </p>
                  </>
                );
              })()
            )
          )}

          {/* confirm bar — the boss never fires by accident */}
          {summonPick && !summonBusy && (
            <div className="sticky bottom-0 flex flex-col gap-2 rounded-xl border border-neutral-700 bg-neutral-950 p-3">
              <p className="text-center text-sm font-bold text-neutral-100">
                {summonPick.mode === "one" ? SUMMON_PRIVATE_CONFIRM(summonPick.nickname) : SUMMON_CONFIRM_ALL((rosterRows ?? []).filter((r) => r.online && r.role !== "boss").length)}
              </p>
              {summonPick.mode === "one" && !summonPick.online && (
                <p className="text-center font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-neutral-500">
                  {SUMMON_OFFLINE_TAG}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <FastButton variant="ghost" onClick={() => setSummonPick(null)} className="w-full">
                  {SUMMON_CANCEL}
                </FastButton>
                <FastButton onClick={() => void execSummon()} className="w-full font-mono text-xs uppercase tracking-[0.18em]">
                  {summonPick.mode === "one" ? SUMMON_PRIVATE_CTA : SUMMON_GO}
                </FastButton>
              </div>
              {summonPick.mode === "one" && (
                <p className="text-[11px] font-semibold leading-relaxed text-neutral-500">{SUMMON_PRIVATE_NOTE}</p>
              )}
            </div>
          )}
          {summonBusy && (
            <p className="py-2 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-400">
              {SUMMON_BUSY}
            </p>
          )}

          <p className="border-t border-neutral-900 pt-3 text-center text-[11px] font-semibold leading-relaxed text-neutral-500">
            {ROSTER_NOTE}
          </p>
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

/** One line on the boss's roll — every member carries the PRIVAAT invite.
 *  Online rows ring now; offline rows hang a 2h doorbell that fires the
 *  moment the member next surfaces. The boss himself cannot be invited —
 *  he IS the house. */
function RosterLine({
  row,
  inviteable,
  summonBusy,
  picked,
  onSummon,
}: {
  row: { nickname: string; role: "member" | "boss"; online: boolean; firstSeen: string; lastSeen: string | null };
  inviteable: boolean;
  summonBusy: boolean;
  picked: boolean;
  onSummon: () => void;
}) {
  const boss = row.role === "boss";
  return (
    <li
      className={`flex items-center gap-2.5 rounded-xl border bg-black px-3 py-2.5 transition-colors ${
        picked ? "border-white" : "border-neutral-900"
      }`}
    >
      <span
        aria-hidden
        className={`size-2 shrink-0 ${row.online ? "animate-fast-pulse rounded-full bg-white" : "rounded-full bg-neutral-700"}`}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`truncate text-neutral-100 ${
            boss ? "drach-font text-lg leading-none text-white" : "font-mono text-sm font-bold uppercase tracking-[0.14em]"
          }`}
        >
          {row.nickname}
        </span>
        {!row.online && !boss && (
          <span className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-neutral-600">
            {SUMMON_OFFLINE_TAG}
          </span>
        )}
      </span>
      <span className="hidden font-mono text-[9px] uppercase tracking-[0.14em] text-neutral-600 sm:inline">
        {rosterFmt.format(new Date(row.firstSeen))}
      </span>
      {inviteable ? (
        <button
          onClick={onSummon}
          disabled={summonBusy}
          aria-label={`Invite ${row.nickname} to a private chat with DRACH`}
          className="flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg border border-neutral-700 px-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-200 outline-none transition-colors hover:border-white hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:opacity-40"
        >
          {row.online ? <Radio className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />}
          {SUMMON_PRIVATE_SHORT}
        </button>
      ) : (
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-neutral-500">
          {row.online ? ROSTER_ONLINE : ROSTER_OFFLINE}
        </span>
      )}
    </li>
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
