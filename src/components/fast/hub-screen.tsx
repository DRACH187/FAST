"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  ArrowRight,
  ChevronRight,
  Copy,
  Crown,
  Flame,
  KeyRound,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "@/components/fast/toast";
import { REDUCED_MOTION, ScreenShell, pressFeedback, staggerAnimChildren, useHouseLine } from "@/components/fast/motion";
import { FastButton, FastInput, FastModal, WipeChip } from "@/components/fast/primitives";
import { BossDirectory } from "@/components/fast/boss-directory";
import { looksLikeInvite, redeemInvite } from "@/lib/fast/invite-client";
import { useLivePresence } from "@/lib/fast/live";
import { cachedMemberTotal, fetchMemberTotal } from "@/lib/fast/member-ledger";
import {
  DIR_ROW_HINT,
  DIR_ROW_LABEL,
  HUB_ROW_BURN,
  HUB_CODE_LABEL,
  HUB_EMPTY,
  HUB_FOOTER,
  HUB_JOIN,
  HUB_SESSION_CREATED,
  HUB_SESSION_JOINED,
  HUB_START,
  HUB_TAGLINES,
  HUB_WIPE_CONFIRM_GO,
  HUB_WIPE_DEAD,
  HUB_WIPE_META,
  HUB_WIPE_NONE,
  HUB_WIPE_PICK,
  HUB_WIPE_SUB,
  HUB_WIPE_TITLE,
  HUB_WIPE_TYPE_TOGGLE,
  INVITE_HINT,
  INVITE_REDEEMED,
  PANEL_TITLE,
  PUBLIC_CARD_CTA,
  PUBLIC_CARD_LAW,
  PUBLIC_CARD_TITLE,
  PUBLIC_ROOM_NAME,
  PUBLIC_SUB,
  pick,
} from "@/lib/fast/copy";
import { isPublicRoom } from "@/lib/fast/public-room";
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
  onOpenLive: () => void;
  /** BOSS move — conscription: doorbell the target fps into a session.
   *  `opts.room` = throw them into THAT open werf (whenever — the bell
   *  hangs up to 2h for offline members); omitted = open a fresh one.
   *  `opts.private` = a 1:1 DRACH invite in a brand-new room. */
  onBossSummon: (targets: string[], opts?: { private?: boolean; room?: string }) => Promise<string>;
  /** Open the profile sheet (owned by the shell since task 19). */
  onOpenProfile: () => void;
  /** Open the BOSS COMMAND PANEL — every ouen, every werf, every count. */
  onOpenBossPanel: () => void;
  /** Walk into OPEN VUUR — the house's fully public, rotating-key werf. */
  onOpenPublicRoom: () => Promise<void>;
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
  onOpenBossPanel,
  onOpenPublicRoom,
  onOpenLive,
  onBossSummon,
}: HubProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [joinCode, setJoinCode] = useState("");
  const [publicCta] = useState(() => pick(PUBLIC_CARD_CTA));
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteCode, setDeleteCode] = useState("");
  // wipe v2: pick the victim werf off a list, or type a remote code
  const [wipeSel, setWipeSel] = useState<string | null>(null);
  const [wipeTypedOpen, setWipeTypedOpen] = useState(false);
  const [leaveCode, setLeaveCode] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  // DIE GRIP — boss directory: profiles, one-tap private werwe, nooi-strings
  const [dirOpen, setDirOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  // one war cry per visit — fresh from the house voice
  const warCry = useHouseLine(HUB_TAGLINES);
  const startLabel = useHouseLine(HUB_START);
  const joinLabel = useHouseLine(HUB_JOIN);
  const wipeTitle = useHouseLine(HUB_WIPE_TITLE);
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
    async (raw: string) => {
      const trimmed = raw.trim();

      // NOOI-STRING — a signed invite rides the same field: redeem it, then
      // join the room it opens. CASE MATTERS: base64url payloads and HMAC
      // signatures are case-sensitive, so the string is used verbatim. The
      // key still comes from a member, never from the string.
      if (looksLikeInvite(trimmed)) {
        if (!callsign || inviteBusy) return;
        setInviteBusy(true);
        try {
          const result = await redeemInvite(identityFp, callsign.token, trimmed);
          if (!result.ok) {
            toast.error(result.message);
            return;
          }
          toast.success(INVITE_REDEEMED(result.code));
          await onJoin(result.code);
          setJoinCode("");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Die string wou nie oopmaak nie");
        } finally {
          setInviteBusy(false);
        }
        return;
      }

      const code = trimmed.toUpperCase().replace(/[^A-Z]/g, "");
      if (!CODE_RE.test(code)) return;
      try {
        await onJoin(code);
        setJoinCode("");
        toast.success(HUB_SESSION_JOINED);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Die werf wil jou nie in hê nie — probeer weer");
      }
    },
    [onJoin, callsign, inviteBusy, identityFp]
  );

  const onJoinInput = useCallback(
    (v: string) => {
      // letters/digits/dots/dashes/underscores, CASE PRESERVED — base64url
      // in a nooi-string dies if it is uppercased. Codes are uppercased at
      // the submit gate, never in state.
      const cleaned = v.replace(/[^A-Za-z0-9._\-]/g, "").slice(0, 240);
      setJoinCode(cleaned);
      const bare = cleaned.toUpperCase().replace(/[^A-Z]/g, "");
      if (bare.length === 6 && !cleaned.includes(".")) void submitJoin(bare);
      if (looksLikeInvite(cleaned)) void submitJoin(cleaned);
    },
    [submitJoin]
  );

  const submitDelete = useCallback(async () => {
    // wipe v2 — the victim comes from the list (wipeSel) or the typed code
    const code = (wipeSel ?? deleteCode).trim().toUpperCase();
    if (!CODE_RE.test(code)) return;
    try {
      await onDelete(code);
      setDeleteOpen(false);
      setDeleteCode("");
      setWipeSel(null);
      setWipeTypedOpen(false);
      toast.success(HUB_WIPE_DEAD(code));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Uitmoer het gemors — vuur weer");
    }
  }, [deleteCode, onDelete, wipeSel]);

  const copyCode = useCallback((code: string) => {
    void navigator.clipboard.writeText(code);
    toast.success("Gekopieer. Stuur dit.");
  }, []);

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
                onChange={(e) => onJoinInput(e.target.value)}
                placeholder="MOER DIE KODE IN"
                aria-label="6-letter session code or FG187 invite string"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={240}
                className="min-h-[56px] flex-1 rounded-xl text-center font-mono text-lg font-black tracking-[0.35em] uppercase placeholder:text-sm placeholder:tracking-[0.3em]"
              />
              <FastButton
                type="submit"
                variant="outline"
                size="lg"
                disabled={busy || inviteBusy || (!CODE_RE.test(joinCode) && !looksLikeInvite(joinCode))}
                className="min-h-[56px] font-mono text-sm uppercase tracking-[0.28em] sm:w-40"
              >
                {joinLabel}
              </FastButton>
            </form>
            <p className="text-center font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-neutral-600">
              {HUB_CODE_LABEL} · {INVITE_HINT}
            </p>
          </section>

          {/* OPEN VUUR — the house's fully public werf: one tap, no code,
              every ouen in, E2EE with a rotating key, wiped every 5h */}
          <section data-anim aria-label="Open Vuur public room" className="flex flex-col gap-2">
            <button
              onClick={(e) => {
                pressFeedback(e.currentTarget);
                void onOpenPublicRoom();
              }}
              disabled={busy}
              aria-label={`${PUBLIC_CARD_TITLE} — ${PUBLIC_SUB}`}
              className="group w-full rounded-2xl border border-neutral-700 bg-neutral-950 px-5 py-5 text-left outline-none transition-all duration-200 hover:border-white focus-visible:border-white active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="flex items-center gap-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-neutral-700 bg-black transition-colors group-hover:border-white">
                  <Flame className="size-6 text-white" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="gang-font text-2xl leading-none text-white">{PUBLIC_CARD_TITLE}</span>
                  <span className="mt-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-neutral-500">
                    {PUBLIC_SUB}
                  </span>
                </span>
                <ArrowRight
                  className="size-5 shrink-0 text-neutral-500 transition-transform duration-200 group-hover:translate-x-0.5"
                  aria-hidden
                />
              </span>
              <span className="mt-3 block text-xs font-semibold leading-relaxed text-neutral-400">
                {PUBLIC_CARD_LAW}
              </span>
              <span className="mt-2.5 block font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-neutral-200">
                {publicCta}
              </span>
            </button>
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
                    onBurn={() => {
                      setWipeSel(s.code);
                      setDeleteOpen(true);
                    }}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* quieter utilities */}
          <section data-anim aria-label="More" className="flex flex-col gap-2">
            {callsign?.role === "boss" && (
              <ActionRow
                icon={Crown}
                label={PANEL_TITLE}
                hint="Die hele fokken werf in een glas — elke ouen, elke werf, elke syfer"
                onClick={onOpenBossPanel}
              />
            )}
            {callsign?.role === "boss" && (
              <ActionRow
                icon={Users}
                label={DIR_ROW_LABEL}
                hint={DIR_ROW_HINT}
                onClick={() => setDirOpen(true)}
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

      {/* wipe v2 — pick the victim off a list, see exactly what dies, or type
          a remote code to burn a werf this device is not even standing in */}
      <FastModal
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setDeleteCode("");
          setWipeSel(null);
          setWipeTypedOpen(false);
        }}
        label="Wipe a session for everyone"
      >
        <div className="flex flex-col gap-4">
          <div className="text-center">
            <h2 className="flex items-center justify-center gap-2 text-base font-bold text-neutral-100">
              <Flame className="size-5 text-neutral-200" aria-hidden />
              {wipeTitle}
            </h2>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-neutral-400">{HUB_WIPE_SUB}</p>
          </div>

          {sessions.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-neutral-300">
                {HUB_WIPE_PICK}
              </span>
              <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                {sessions.filter((s) => !isPublicRoom(s.code)).map((s) => (
                  <li key={s.code}>
                    <button
                      type="button"
                      onClick={() => setWipeSel((cur) => (cur === s.code ? null : s.code))}
                      aria-pressed={wipeSel === s.code}
                      aria-label={`Select ${s.code} to wipe for everyone`}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left outline-none transition-colors ${
                        wipeSel === s.code
                          ? "border-white bg-neutral-900"
                          : "border-neutral-800 bg-black hover:border-neutral-600"
                      }`}
                    >
                      <Flame
                        className={`size-4 shrink-0 ${wipeSel === s.code ? "text-white" : "text-neutral-500"}`}
                        aria-hidden
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-mono text-base font-black tracking-[0.24em] text-white">{s.code}</span>
                        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-neutral-500">
                          {HUB_WIPE_META(s.presence.length, s.messages.length)}
                        </span>
                      </span>
                      <WipeChip expiresAt={s.expiresAt} now={now} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-neutral-800 px-3.5 py-3 text-center text-xs font-semibold text-neutral-500">
              {HUB_WIPE_NONE}
            </p>
          )}

          {wipeTypedOpen ? (
            <FastInput
              value={deleteCode}
              onChange={(e) => {
                setDeleteCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6));
                setWipeSel(null);
              }}
              placeholder="KODE"
              aria-label="Session code to wipe"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
              className="text-center font-mono text-xl font-black tracking-[0.4em] uppercase"
            />
          ) : (
            <button
              type="button"
              onClick={() => setWipeTypedOpen(true)}
              className="text-center font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500 underline-offset-4 outline-none transition-colors hover:text-neutral-300 hover:underline"
            >
              {HUB_WIPE_TYPE_TOGGLE}
            </button>
          )}

          <div className="flex flex-col gap-2">
            <FastButton
              disabled={!CODE_RE.test((wipeSel ?? deleteCode).trim())}
              onClick={() => void submitDelete()}
              className="w-full font-mono text-sm uppercase tracking-[0.24em]"
            >
              {HUB_WIPE_CONFIRM_GO}
            </FastButton>
            <FastButton
              variant="ghost"
              className="w-full"
              onClick={() => {
                setDeleteOpen(false);
                setDeleteCode("");
                setWipeSel(null);
                setWipeTypedOpen(false);
              }}
            >
              Bly maar
            </FastButton>
          </div>
        </div>
      </FastModal>

      {/* DIE GRIP — boss directory (task 23): every ouen as a profile card,
          one tap = private werf, nooi-strings minted per member */}
      <BossDirectory
        open={dirOpen}
        onClose={() => setDirOpen(false)}
        identityFp={identityFp}
        callsign={callsign}
        sessions={sessions}
        onOpen={onOpen}
        onBossSummon={onBossSummon}
      />

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
  onBurn,
}: {
  session: SessionView;
  now: number;
  onOpen: () => void;
  onClose: () => void;
  onBurn: () => void;
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
            {isPublicRoom(session.code) ? PUBLIC_ROOM_NAME : session.code}
          </span>
          {isPublicRoom(session.code) && (
            <Flame className="size-4 shrink-0 text-neutral-300" aria-hidden />
          )}
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
      {/* burn for everyone — jumps straight into the wipe modal with this
          werf pre-picked (server still enforces creator/boss authority);
          OPEN VUUR has no burn-from-the-row: the square never dies */}
      {!isPublicRoom(session.code) && (
        <button
          onClick={onBurn}
          aria-label={HUB_ROW_BURN(session.code)}
          className="absolute -left-1.5 -top-1.5 flex size-7 items-center justify-center rounded-full border border-neutral-700 bg-black text-neutral-400 outline-none transition-colors after:absolute after:-inset-2.5 after:rounded-full after:content-[''] hover:border-white hover:text-white focus-visible:border-neutral-300 focus-visible:text-white"
        >
          <Flame className="size-4" aria-hidden />
        </button>
      )}
    </li>
  );
}
