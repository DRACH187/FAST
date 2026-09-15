"use client";

/**
 * DIE GRIP — DRACH's live directory (task 23).
 * ===========================================
 * "Get any user online, click on their profile, chat with them — it makes a
 * session." Every ouen the house ever saw becomes a profile card: callsign,
 * role, live status, which werwe they stand in right now. Tap a card and the
 * profile sheet opens with the boss moves:
 *
 *   PRAAT NOU       — one tap: a fresh private E2EE werf opens, the target's
 *                     doorbell hangs up to 2h (now, or the moment they
 *                     surface), and DRACH steps straight in.
 *   GOOI IN 'N WERF — conscription into any open werf he holds the key for.
 *   NOOI MET STRING — mint a signed, expiring, burn-on-use invite string.
 *
 * Data rides /api/boss/directory (boss attestation only, pseudonymous
 * metadata: names, roles, times, room codes — never a single word of chat).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  ChevronRight,
  Copy,
  Crown,
  KeyRound,
  Plus,
  Radio,
  Search,
  Ticket,
  Zap,
} from "lucide-react";
import { toast } from "@/components/fast/toast";
import { REDUCED_MOTION, pressFeedback, staggerAnimChildren } from "@/components/fast/motion";
import { FastButton, FastInput, FastModal } from "@/components/fast/primitives";
import { mintInvite, revokeInvites, type MintedInvite } from "@/lib/fast/invite-client";
import type { CallsignIdentity } from "@/lib/fast/identity";
import type { SessionView } from "@/lib/fast/session-manager";
import {
  DIR_BOSS_TAG,
  DIR_CLOSE_PROFILE,
  DIR_CONSCRIPT_CTA,
  DIR_EMPTY,
  DIR_INVITE_CTA,
  DIR_LAW,
  DIR_OFFLINE_LAST,
  DIR_OFFLINE_NONE,
  DIR_ONLINE_SINCE,
  DIR_PROFILE_STATUS,
  DIR_SEARCH_PLACE,
  DIR_SELF_TAG,
  DIR_SEEN_FIRST,
  DIR_SEEN_LAST,
  DIR_STANDING_IN,
  DIR_STANDING_NONE,
  DIR_SUB,
  DIR_TITLE,
  DIR_TALK_CTA,
  DIR_TALK_NOTE,
  INVITE_DONE,
  INVITE_LAW,
  INVITE_MINT_FAIL,
  INVITE_PICK_ROOM,
  INVITE_REVOKED,
  INVITE_REVOKE,
  INVITE_SELF_ROOM,
  INVITE_TTL_LABEL,
  INVITE_USES_CHIP,
  INVITE_USES_LABEL,
  ROSTER_ONLINE,
  ROSTER_ONLINE_HEAD,
  ROSTER_OFFLINE_HEAD,
  ROSTER_SEARCH_PLACE,
  ROSTER_TOTAL,
  SUMMON_CONFIRM,
  SUMMON_CONFIRM_ALL,
  SUMMON_DONE,
  SUMMON_GO,
  SUMMON_INTO_ALL_CONFIRM,
  SUMMON_INTO_CONFIRM,
  SUMMON_INTO_DONE,
  SUMMON_OFFLINE_TAG,
  SUMMON_PRIVATE_DONE,
  SUMMON_ROOM_HINT,
  SUMMON_ROOM_LABEL,
  SUMMON_ROOM_NEW,
} from "@/lib/fast/copy";

gsap.registerPlugin(useGSAP);

export type DirRow = {
  nickname: string;
  role: "member" | "boss";
  fp: string;
  online: boolean;
  firstSeen: string;
  lastSeen: string | null;
  rooms: string[];
};

const rosterFmt = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "AANLYN VANAF 14:32" / "WEG · LAAS GEKLOP 12 JUN 09:14" status lines. */
function statusLabel(row: DirRow): string {
  const t = row.online && row.lastSeen
    ? rosterFmt.format(new Date(row.lastSeen))
    : row.lastSeen
      ? rosterFmt.format(new Date(row.lastSeen))
      : "—";
  return row.online ? DIR_ONLINE_SINCE(t) : DIR_OFFLINE_LAST(t);
}

type BossDirectoryProps = {
  open: boolean;
  onClose: () => void;
  identityFp: string;
  callsign: CallsignIdentity | null;
  /** open sessions on this device — the conscription / invite pickers */
  sessions: SessionView[];
  onOpen: (code: string) => void;
  onBossSummon: (targets: string[], opts?: { private?: boolean; room?: string }) => Promise<string>;
};

export function BossDirectory({
  open,
  onClose,
  identityFp,
  callsign,
  sessions,
  onOpen,
  onBossSummon,
}: BossDirectoryProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<DirRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // all-blast (everyone online in one cry) — global room picker, like the
  // old roll: null = a fresh werf, code = throw them into THAT open one
  const [blastRoom, setBlastRoom] = useState<string | null>(null);
  const [blastOpen, setBlastOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // profile sheet state
  const [sheet, setSheet] = useState<DirRow | null>(null);
  const [mode, setMode] = useState<"profile" | "summon" | "invite">("profile");
  const [summonSel, setSummonSel] = useState<string | null>(null);
  const [inviteSel, setInviteSel] = useState<string | null>(null);
  const [inviteUses, setInviteUses] = useState<number>(1);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteOut, setInviteOut] = useState<MintedInvite | null>(null);

  const load = useCallback(async () => {
    if (!callsign || callsign.role !== "boss") return;
    setLoading(true);
    try {
      const res = await fetch("/api/boss/directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint: identityFp, token: callsign.token }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; rows?: DirRow[]; error?: string };
      if (!res.ok || data.ok !== true || !Array.isArray(data.rows)) {
        setError(typeof data.error === "string" ? data.error : "Die grip is weg — probeer weer");
      } else {
        setError(null);
        setRows(data.rows);
        // keep an open profile card fresh — close it if the ouen vanished
        setSheet((cur) => (cur ? (data.rows?.find((r) => r.fp === cur.fp) ?? null) : null));
      }
    } catch {
      setError("Netwerk onbereikbaar");
    } finally {
      setLoading(false);
    }
  }, [callsign, identityFp]);

  // load on open + a slow 15s refresh while the grip stands open
  useEffect(() => {
    if (!open) {
      setRows(null);
      setSheet(null);
      setQuery("");
      setBlastRoom(null);
      setBlastOpen(false);
      setMode("profile");
      setInviteOut(null);
      return;
    }
    void load();
    const iv = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(iv);
  }, [open, load]);

  // GSAP: the grip rolls in with a stagger
  useGSAP(
    () => {
      if (REDUCED_MOTION || !rows) return;
      staggerAnimChildren(rootRef.current, { delay: 0.05 });
    },
    { scope: rootRef, dependencies: [rows !== null, open] }
  );

  const keyedRooms = sessions.filter((s) => s.hasKey);

  const execBlast = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const targets = (rows ?? []).filter((r) => r.online && r.role !== "boss" && r.fp !== identityFp).map((r) => r.fp);
      if (targets.length === 0) throw new Error("Niemand aanlyn om te ontbied nie.");
      const code = await onBossSummon(targets, blastRoom ? { room: blastRoom } : {});
      setBlastOpen(false);
      toast.success(blastRoom ? SUMMON_INTO_DONE(code) : SUMMON_DONE(code));
      if (!blastRoom) onOpen(code);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ontbieding geblok — skree weer");
    } finally {
      setBusy(false);
    }
  }, [blastRoom, busy, identityFp, onBossSummon, onOpen, rows]);

  /** ONE TAP — the whole ask: profile → PRAAT NOU → private session. */
  const talkNow = useCallback(
    async (row: DirRow) => {
      if (busy) return;
      setBusy(true);
      try {
        const code = await onBossSummon([row.fp], {});
        setSheet(null);
        setMode("profile");
        toast.success(SUMMON_PRIVATE_DONE(code, row.nickname));
        onOpen(code);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ontbieding geblok — skree weer");
      } finally {
        setBusy(false);
      }
    },
    [busy, onBossSummon, onOpen]
  );

  /** Conscript into the picked werf (null = fresh one). */
  const conscript = useCallback(
    async (row: DirRow) => {
      if (busy) return;
      setBusy(true);
      try {
        const code = await onBossSummon([row.fp], summonSel ? { room: summonSel } : {});
        setSheet(null);
        setMode("profile");
        toast.success(summonSel ? SUMMON_INTO_DONE(code) : SUMMON_DONE(code));
        if (!summonSel) onOpen(code);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ontbieding geblok — skree weer");
      } finally {
        setBusy(false);
      }
    },
    [busy, onBossSummon, onOpen, summonSel]
  );

  const mint = useCallback(
    async (row: DirRow) => {
      if (inviteBusy || !callsign) return;
      const code = inviteSel ?? keyedRooms[0]?.code ?? "";
      if (!code) {
        toast.error(INVITE_PICK_ROOM);
        return;
      }
      setInviteBusy(true);
      try {
        const out = await mintInvite(identityFp, callsign.token, code, {
          maxUses: inviteUses,
          ttlMinutes: 240,
        });
        setInviteOut(out);
        toast.success(INVITE_DONE);
      } catch {
        toast.error(INVITE_MINT_FAIL);
      } finally {
        setInviteBusy(false);
      }
    },
    [callsign, identityFp, inviteBusy, inviteSel, inviteUses, keyedRooms]
  );

  const revoke = useCallback(
    async (code: string) => {
      if (!callsign || inviteBusy) return;
      setInviteBusy(true);
      try {
        const killed = await revokeInvites(identityFp, callsign.token, code);
        toast.success(INVITE_REVOKED(killed));
      } catch {
        toast.error(INVITE_MINT_FAIL);
      } finally {
        setInviteBusy(false);
      }
    },
    [callsign, identityFp, inviteBusy]
  );

  const q = query.trim().toLowerCase();
  const searched = rows ? (q ? rows.filter((r) => r.nickname.toLowerCase().includes(q)) : rows) : null;
  const onlineRows = (searched ?? []).filter((r) => r.online);
  const offlineRows = (searched ?? []).filter((r) => !r.online);
  const summonable = onlineRows.filter((r) => r.role !== "boss" && r.fp !== identityFp);
  const blastCount = (rows ?? []).filter((r) => r.online && r.role !== "boss" && r.fp !== identityFp).length;
  const isSelf = sheet ? sheet.fp === identityFp : false;
  const sheetBoss = sheet ? sheet.role === "boss" : false;

  return (
    <FastModal open={open} onClose={onClose} label={DIR_TITLE} wide>
      <div ref={rootRef} className="flex max-h-[82dvh] flex-col gap-4 overflow-y-auto">
        <div className="text-center">
          <h2 className="gang-font text-3xl text-white">{DIR_TITLE}</h2>
          <p className="mt-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">
            {DIR_SUB}
          </p>
        </div>

        {loading && rows === null && (
          <p className="py-8 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-500">
            Trek die grip…
          </p>
        )}

        {error && !loading && (
          <p className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-center text-sm font-bold text-neutral-300">
            {error}
          </p>
        )}

        {rows !== null && !loading && (
          rows.length === 0 ? (
            <p className="py-8 text-center text-sm font-semibold text-neutral-500">{DIR_EMPTY}</p>
          ) : (
            <>
              <p className="text-center font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">
                {ROSTER_TOTAL(rows.length)} · {rows.filter((r) => r.online).length} {ROSTER_ONLINE}
              </p>

              {/* search the grip */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-neutral-600" aria-hidden />
                <FastInput
                  value={query}
                  onChange={(e) => setQuery(e.target.value.slice(0, 24))}
                  placeholder={ROSTER_SEARCH_PLACE}
                  aria-label={DIR_SEARCH_PLACE}
                  className="h-11 pl-10 font-mono text-xs font-bold tracking-[0.1em]"
                />
              </div>

              {/* ONLINE — profile cards, tap one to open the sheet */}
              <div data-anim className="flex flex-col gap-2">
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
                      <ProfileCard key={r.fp} row={r} onOpen={() => setSheet(r)} />
                    ))}
                  </ul>
                )}
              </div>

              {/* OFFLINE — same cards, dimmed; the doorbell hangs till they surface */}
              {offlineRows.length > 0 && (
                <div data-anim className="flex flex-col gap-2">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-neutral-600">
                    {ROSTER_OFFLINE_HEAD} · {offlineRows.length}
                  </span>
                  <ul className="flex flex-col gap-2">
                    {offlineRows.map((r) => (
                      <ProfileCard key={r.fp} row={r} onOpen={() => setSheet(r)} />
                    ))}
                  </ul>
                </div>
              )}
              {offlineRows.length === 0 && rows.length > 0 && (
                <p className="text-center font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-neutral-600">
                  {DIR_OFFLINE_NONE}
                </p>
              )}

              {/* boss move — the whole online roll in one cry */}
              {summonable.length > 0 && (
                <FastButton
                  variant="outline"
                  disabled={busy}
                  onClick={() => setBlastOpen((v) => !v)}
                  className="w-full font-mono text-xs uppercase tracking-[0.2em]"
                >
                  <Radio className="size-4" aria-hidden />
                  SKREE ALMAL AANLYN · {summonable.length}
                </FastButton>
              )}

              {/* all-blast room picker + confirm */}
              {blastOpen && (
                <div className="flex flex-col gap-2.5 rounded-xl border border-neutral-700 bg-neutral-950 p-3">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-neutral-300">
                    {SUMMON_ROOM_LABEL}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <RoomChip
                      selected={blastRoom === null}
                      disabled={busy}
                      onClick={() => setBlastRoom(null)}
                      icon={<Plus className="size-3.5" aria-hidden />}
                      label={SUMMON_ROOM_NEW}
                    />
                    {keyedRooms.map((s) => (
                      <RoomChip
                        key={s.code}
                        selected={blastRoom === s.code}
                        disabled={busy}
                        onClick={() => setBlastRoom(s.code)}
                        icon={<Radio className="size-3.5" aria-hidden />}
                        label={s.code}
                      />
                    ))}
                  </div>
                  <p className="text-center text-sm font-bold text-neutral-100">
                    {blastRoom
                      ? SUMMON_INTO_ALL_CONFIRM(blastCount, blastRoom)
                      : SUMMON_CONFIRM_ALL(blastCount)}
                  </p>
                  <p className="rounded-xl border border-neutral-900 bg-black px-3.5 py-2.5 text-[11px] font-semibold leading-relaxed text-neutral-400">
                    {SUMMON_ROOM_HINT}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <FastButton variant="ghost" onClick={() => setBlastOpen(false)} className="w-full">
                      Uit
                    </FastButton>
                    <FastButton
                      onClick={() => void execBlast()}
                      disabled={busy || blastCount === 0}
                      className="w-full font-mono text-xs uppercase tracking-[0.18em]"
                    >
                      {SUMMON_GO}
                    </FastButton>
                  </div>
                </div>
              )}

              <p className="rounded-xl border border-neutral-900 bg-black px-3.5 py-2.5 text-[11px] font-semibold leading-relaxed text-neutral-400">
                {DIR_LAW}
              </p>
              <p className="rounded-xl border border-neutral-900 bg-black px-3.5 py-2.5 text-[11px] font-semibold leading-relaxed text-neutral-400">
                {INVITE_LAW}
              </p>
            </>
          )
        )}

        {/* ------------------------------------------------ profile sheet */}
        {sheet && (
          <div className="flex flex-col gap-3 rounded-2xl border border-neutral-700 bg-neutral-950 p-4">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className={`size-2.5 shrink-0 ${sheet.online ? "animate-fast-pulse rounded-full bg-white" : "rounded-full bg-neutral-700"}`}
              />
              <span className="min-w-0 flex-1 truncate text-2xl text-white">
                {sheetBoss ? (
                  <span className="drach-font text-3xl leading-none">{sheet.nickname}</span>
                ) : (
                  <span className="gang-font">{sheet.nickname}</span>
                )}
              </span>
              {sheet.role === "boss" && (
                <span className="flex shrink-0 items-center gap-1 rounded-full border border-neutral-500 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-neutral-100">
                  <Crown className="size-3" aria-hidden />
                  boss
                </span>
              )}
            </div>

            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-300">
              {DIR_PROFILE_STATUS}: <span className={sheet.online ? "text-white" : "text-neutral-500"}>{statusLabel(sheet)}</span>
            </p>

            <ul className="flex flex-col gap-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-neutral-500">
              <li>{DIR_SEEN_FIRST}: {rosterFmt.format(new Date(sheet.firstSeen))}</li>
              <li>{DIR_SEEN_LAST}: {sheet.lastSeen ? rosterFmt.format(new Date(sheet.lastSeen)) : "—"}</li>
            </ul>

            {/* where they stand right now — codes only, never a word */}
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-neutral-500">
                {DIR_STANDING_IN}
              </span>
              {sheet.rooms.length === 0 ? (
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-600">
                  {DIR_STANDING_NONE}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {sheet.rooms.map((c) => (
                    <span
                      key={c}
                      className="rounded-md border border-neutral-800 bg-black px-2 py-1 font-mono text-[10px] font-black tracking-[0.2em] text-neutral-200"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* THE MOVES — profile / conscript / invite steps */}
            {isSelf ? (
              <p className="rounded-xl border border-neutral-800 bg-black px-3.5 py-3 text-center font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-400">
                {DIR_SELF_TAG}
              </p>
            ) : sheetBoss ? (
              <p className="rounded-xl border border-neutral-800 bg-black px-3.5 py-3 text-center font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-400">
                {DIR_BOSS_TAG}
              </p>
            ) : mode === "profile" ? (
              <div className="flex flex-col gap-2">
                <FastButton
                  disabled={busy}
                  onClick={() => void talkNow(sheet)}
                  className="min-h-[52px] w-full font-mono text-sm uppercase tracking-[0.2em]"
                >
                  <Zap className="size-5" aria-hidden />
                  {DIR_TALK_CTA}
                </FastButton>
                <p className="text-[11px] font-semibold leading-relaxed text-neutral-500">{DIR_TALK_NOTE}</p>
                <div className="grid grid-cols-2 gap-2">
                  <FastButton
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setSummonSel(keyedRooms[0]?.code ?? null);
                      setMode("summon");
                    }}
                    className="w-full font-mono text-[11px] uppercase tracking-[0.16em]"
                  >
                    <Radio className="size-4" aria-hidden />
                    {DIR_CONSCRIPT_CTA}
                  </FastButton>
                  <FastButton
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setInviteSel(keyedRooms[0]?.code ?? null);
                      setInviteOut(null);
                      setMode("invite");
                    }}
                    className="w-full font-mono text-[11px] uppercase tracking-[0.16em]"
                  >
                    <Ticket className="size-4" aria-hidden />
                    {DIR_INVITE_CTA}
                  </FastButton>
                </div>
                {sheet.online ? null : (
                  <p className="text-center font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-neutral-500">
                    {SUMMON_OFFLINE_TAG}
                  </p>
                )}
              </div>
            ) : mode === "summon" ? (
              <div className="flex flex-col gap-2.5">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-neutral-300">
                  {SUMMON_ROOM_LABEL}
                </span>
                <div className="flex flex-wrap gap-2">
                  <RoomChip
                    selected={summonSel === null}
                    disabled={busy}
                    onClick={() => setSummonSel(null)}
                    icon={<Plus className="size-3.5" aria-hidden />}
                    label={SUMMON_ROOM_NEW}
                  />
                  {keyedRooms.map((s) => (
                    <RoomChip
                      key={s.code}
                      selected={summonSel === s.code}
                      disabled={busy}
                      onClick={() => setSummonSel(s.code)}
                      icon={<Radio className="size-3.5" aria-hidden />}
                      label={s.code}
                    />
                  ))}
                </div>
                <p className="text-center text-sm font-bold text-neutral-100">
                  {summonSel ? SUMMON_INTO_CONFIRM(sheet.nickname, summonSel) : SUMMON_CONFIRM(sheet.nickname)}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <FastButton variant="ghost" onClick={() => setMode("profile")} className="w-full">
                    Terug
                  </FastButton>
                  <FastButton
                    disabled={busy}
                    onClick={() => void conscript(sheet)}
                    className="w-full font-mono text-xs uppercase tracking-[0.18em]"
                  >
                    {SUMMON_GO}
                  </FastButton>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-neutral-300">
                  {INVITE_PICK_ROOM}
                </span>
                {keyedRooms.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-neutral-800 px-3.5 py-3 text-center text-xs font-semibold text-neutral-500">
                    {INVITE_SELF_ROOM}: {INVITE_PICK_ROOM} — maak eers 'n werf oop.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {keyedRooms.map((s) => (
                        <RoomChip
                          key={s.code}
                          selected={(inviteSel ?? keyedRooms[0].code) === s.code}
                          disabled={inviteBusy}
                          onClick={() => {
                            setInviteSel(s.code);
                            setInviteOut(null);
                          }}
                          icon={<KeyRound className="size-3.5" aria-hidden />}
                          label={s.code}
                        />
                      ))}
                    </div>

                    {/* burn count — 1 use by default, up to a whole skinner */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-neutral-500">
                        {INVITE_USES_LABEL}
                      </span>
                      {[1, 5, 25].map((n) => (
                        <RoomChip
                          key={n}
                          selected={inviteUses === n}
                          disabled={inviteBusy}
                          onClick={() => {
                            setInviteUses(n);
                            setInviteOut(null);
                          }}
                          icon={null}
                          label={INVITE_USES_CHIP(n)}
                          small
                        />
                      ))}
                    </div>

                    {inviteOut ? (
                      <div className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-black p-3">
                        <p className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-neutral-500">
                          {INVITE_TTL_LABEL(
                            inviteOut.expiresAt
                              ? `${Math.max(1, Math.round((Date.parse(inviteOut.expiresAt) - Date.now()) / 60_000))} MIN`
                              : "—"
                          )}
                        </p>
                        <button
                          type="button"
                          onClick={(e) => {
                            pressFeedback(e.currentTarget);
                            void navigator.clipboard.writeText(inviteOut.invite);
                            toast.success("Gekopieer. Moer dit stuur.");
                          }}
                          aria-label="Copy the invite string"
                          className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-3 text-left outline-none transition-colors hover:border-neutral-500"
                        >
                          <span className="break-all font-mono text-[11px] font-bold leading-relaxed tracking-[0.06em] text-neutral-100">
                            {inviteOut.invite}
                          </span>
                          <Copy className="size-4 shrink-0 text-neutral-400" aria-hidden />
                        </button>
                        <FastButton
                          variant="ghost"
                          disabled={inviteBusy}
                          onClick={() => void revoke(inviteOut.code)}
                          className="w-full font-mono text-[10px] uppercase tracking-[0.18em]"
                        >
                          {INVITE_REVOKE}
                        </FastButton>
                      </div>
                    ) : (
                      <FastButton
                        disabled={inviteBusy}
                        onClick={() => void mint(sheet)}
                        className="w-full font-mono text-xs uppercase tracking-[0.18em]"
                      >
                        <Ticket className="size-4" aria-hidden />
                        {inviteBusy ? "SMEER…" : "SMEER DIE STRING"}
                      </FastButton>
                    )}
                  </>
                )}
                <FastButton variant="ghost" onClick={() => setMode("profile")} className="w-full">
                  Terug
                </FastButton>
              </div>
            )}

            <FastButton variant="ghost" onClick={() => setSheet(null)} className="w-full">
              {DIR_CLOSE_PROFILE}
            </FastButton>
          </div>
        )}

        <p className="border-t border-neutral-900 pt-3 text-center font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-neutral-600">
          {DIR_TALK_NOTE}
        </p>
      </div>
    </FastModal>
  );
}

// ------------------------------------------------------------------ pieces

/** One profile card on the grip — the whole row is the button. */
function ProfileCard({ row, onOpen }: { row: DirRow; onOpen: () => void }) {
  const boss = row.role === "boss";
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${row.nickname}'s profile`}
        className="group flex w-full items-center gap-2.5 rounded-xl border border-neutral-900 bg-black px-3 py-2.5 text-left outline-none transition-colors hover:border-neutral-500 focus-visible:border-neutral-400"
      >
        <span
          aria-hidden
          className={`size-2 shrink-0 ${row.online ? "animate-fast-pulse rounded-full bg-white" : "rounded-full bg-neutral-700"}`}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={`truncate text-neutral-100 ${
              boss
                ? "drach-font text-lg leading-none text-white"
                : "font-mono text-sm font-bold uppercase tracking-[0.14em]"
            }`}
          >
            {row.nickname}
          </span>
          {row.rooms.length > 0 && (
            <span className="mt-0.5 truncate font-mono text-[8px] font-bold uppercase tracking-[0.16em] text-neutral-500">
              IN: {row.rooms.join(" · ")}
            </span>
          )}
        </span>
        {boss && <Crown className="size-3.5 shrink-0 text-neutral-300" aria-hidden />}
        <ChevronRight
          className="size-4 shrink-0 text-neutral-600 transition-transform duration-200 group-hover:translate-x-0.5"
          aria-hidden
        />
      </button>
    </li>
  );
}

/** Selectable werf chip (room picker). */
function RoomChip({
  selected,
  disabled,
  onClick,
  icon,
  label,
  small = false,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`flex items-center gap-1.5 rounded-full border font-mono font-bold uppercase outline-none transition-colors disabled:opacity-40 ${
        small ? "min-h-[32px] px-2.5 text-[9px] tracking-[0.14em]" : "min-h-[38px] px-3.5 text-[11px] tracking-[0.16em]"
      } ${selected ? "border-white bg-white text-black" : "border-neutral-800 bg-black text-neutral-200 hover:border-neutral-500"}`}
    >
      {icon}
      {label}
    </button>
  );
}
