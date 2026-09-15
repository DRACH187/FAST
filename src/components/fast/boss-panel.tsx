"use client";

/**
 * BOSS COMMAND PANEL — DRACH's admin room (task 20).
 * ==================================================
 * One glass, the whole site: every callsign that ever stepped through the
 * 187 door, every room the instance holds (codes, rosters, bullet counts —
 * NEVER a word of chat: E2EE is law), the WANTED board's sealed weight,
 * summons hanging in flight, and the warm instance's vitals including the
 * abuse-control counters.
 *
 * Access: boss attestation only — the endpoint answers 403 to anyone else,
 * and this panel is only ever rendered for role === "boss". Data refreshes
 * on open, every 30s while open, and on the VARS MAAK button.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Crosshair,
  Cpu,
  EyeOff,
  Flame,
  KeyRound,
  MessagesSquare,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  Timer,
  Users,
} from "lucide-react";
import { toast } from "@/components/fast/toast";
import { FastButton, FastModal, WipeChip } from "@/components/fast/primitives";
import { pick } from "@/lib/fast/copy";
import {
  PANEL_BOSS_TAG,
  PANEL_CREATOR_BOUND,
  PANEL_CREATOR_LOOSE,
  PANEL_DEAD_BADGE,
  PANEL_ERROR,
  PANEL_GENERATED,
  PANEL_LIVE_BADGE,
  PANEL_MEMBER_TAG,
  PANEL_REFRESH,
  PANEL_REFRESHING,
  PANEL_ROLL_ALLTIME,
  PANEL_ROLL_COUNT,
  PANEL_ROLL_EMPTY,
  PANEL_ROLL_LAST,
  PANEL_ROLL_ONLINE,
  PANEL_ROLL_SEEN,
  PANEL_SESSIONS_EMPTY,
  PANEL_SESSIONS_ENV,
  PANEL_SESSIONS_INROOMS,
  PANEL_SESSIONS_LIVE,
  PANEL_SYS_FORGED,
  PANEL_SYS_INVITES,
  PANEL_SESSIONS_MEMBERS,
  PANEL_SESSIONS_MSGS,
  PANEL_SESSIONS_PHOTOS,
  PANEL_STATUS_DEAD,
  PANEL_STATUS_EXPIRED,
  PANEL_STATUS_LIVE,
  PANEL_SUB,
  PANEL_SYS_CIRCUIT,
  PANEL_SYS_LAW,
  PANEL_SYS_LIVE,
  PANEL_SYS_LIMITERS,
  PANEL_SYS_LOCKS,
  PANEL_SYS_NODE,
  PANEL_SYS_PLATFORM,
  PANEL_SYS_PROBES,
  PANEL_SYS_RAM,
  PANEL_SYS_REPLAY,
  PANEL_SYS_STARTED,
  PANEL_SYS_SUMMONS,
  PANEL_SYS_TARPIT,
  PANEL_SYS_UPTIME,
  PANEL_TAB_ROLL,
  PANEL_TAB_SESSIONS,
  PANEL_TAB_SYSTEM,
  PANEL_TAB_WANTED,
  PANEL_TITLE,
  PANEL_WANTED_BYTES,
  PANEL_WANTED_COMMENTS,
  PANEL_WANTED_EMPTY,
  PANEL_WANTED_EXHIBITS,
  PANEL_WANTED_LAW,
  PANEL_WANTED_POSTS,
  PANEL_WANTED_TOMB,
  WANTED_TITLE,
} from "@/lib/fast/copy";
import type { CallsignIdentity } from "@/lib/fast/identity";

// ------------------------------------------------------------------- types

type PanelRollRow = {
  nickname: string;
  role: "member" | "boss";
  online: boolean;
  firstSeen: string;
  lastSeen: string | null;
};
type PanelLiveRow = { nickname: string; role: "member" | "boss"; since: string };
type PanelSessionRow = {
  code: string;
  createdAt: string;
  expiresAt: string;
  lastActivity: string;
  members: { nickname: string; role: string }[];
  memberCount: number;
  messages: number;
  envelopes: number;
  photos: number;
  status: "live" | "terminated" | "expired";
  creatorBound: boolean;
};
type PanelData = {
  generatedAt: string;
  members: {
    rollCount: number;
    onlineCount: number;
    allTime: number;
    roll: PanelRollRow[];
    live: PanelLiveRow[];
  };
  sessions: {
    total: number;
    live: number;
    membersInRooms: number;
    messages: number;
    list: PanelSessionRow[];
  };
  wanted: {
    posts: number;
    exhibits: number;
    comments: number;
    tombstones: number;
    bytes: number;
    freshestPostAt: string | null;
  };
  summons: { targets: number; pending: number };
  invites: { active: number; redemptions: number; forged: number };
  system: {
    uptimeSec: number;
    startedAt: string;
    rssMb: number;
    heapMb: number;
    node: string;
    platform: string;
    limiterBuckets: number;
    gateLocks: number;
    gateLockoutsLive: number;
    circuitCount: number;
    replayBlocks: number;
    probeWatch: number;
    probeTarpits: number;
  };
};

type PanelTab = "roll" | "sessions" | "wanted" | "system";

// ----------------------------------------------------------------- helpers

const stampFmt = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const clockFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** seconds -> "2U 14M" / "43M" */
function uptimeLabel(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}U ${String(m).padStart(2, "0")}M` : `${m}M`;
}

/** bytes -> "0.4" (MB, one decimal) */
function mbLabel(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

// ---------------------------------------------------------------- component

type BossPanelProps = {
  open: boolean;
  onClose: () => void;
  identityFp: string;
  callsign: CallsignIdentity | null;
};

export function BossPanel({ open, onClose, identityFp, callsign }: BossPanelProps) {
  const [tab, setTab] = useState<PanelTab>("roll");
  const [data, setData] = useState<PanelData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBoss = callsign?.role === "boss";

  const pull = useCallback(async () => {
    if (!isBoss || !callsign) return;
    setBusy(true);
    try {
      const res = await fetch("/api/boss/panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint: identityFp, token: callsign.token }),
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as
        | ({ ok?: boolean } & PanelData)
        | { ok?: boolean; error?: string };
      if (!res.ok || json.ok !== true || !("members" in json && "sessions" in json)) {
        setError(pick(PANEL_ERROR));
        setData(null);
      } else {
        setData(json as PanelData);
        setError(null);
      }
    } catch {
      setError(pick(PANEL_ERROR));
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [callsign, identityFp, isBoss]);

  // fresh on open + every 30s while the room is open — the war map never
  // goes stale in front of the boss
  useEffect(() => {
    if (!open || !isBoss) return;
    void pull();
    const iv = window.setInterval(() => void pull(), 30_000);
    return () => window.clearInterval(iv);
  }, [open, isBoss, pull]);

  return (
    <FastModal open={open} onClose={onClose} label={PANEL_TITLE} wide>
      <div className="flex flex-col gap-4">
        {/* head */}
        <div className="text-center">
          <h2 className="gang-font text-3xl text-white">{PANEL_TITLE}</h2>
          <p className="mt-1.5 font-mono text-[10px] font-bold uppercase leading-relaxed tracking-[0.18em] text-neutral-500">
            {PANEL_SUB}
          </p>
        </div>

        {/* tabs */}
        <div role="tablist" aria-label={PANEL_TITLE} className="grid grid-cols-4 gap-1 rounded-2xl border border-neutral-800 bg-black p-1">
          {(
            [
              { id: "roll", label: PANEL_TAB_ROLL, icon: Users },
              { id: "sessions", label: PANEL_TAB_SESSIONS, icon: MessagesSquare },
              { id: "wanted", label: PANEL_TAB_WANTED, icon: Crosshair },
              { id: "system", label: PANEL_TAB_SYSTEM, icon: Cpu },
            ] as const satisfies ReadonlyArray<{ id: PanelTab; label: string; icon: typeof Users }>
          ).map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(id)}
                className={`flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl px-1 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-neutral-500 ${
                  active ? "bg-white text-black" : "text-neutral-500 hover:text-neutral-200"
                }`}
              >
                <Icon className="size-4" aria-hidden />
                <span className="whitespace-nowrap font-mono text-[9px] font-bold uppercase tracking-[0.14em]">
                  {label}
                </span>
              </button>
            );
          })}
        </div>

        {/* refresh row */}
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-neutral-600">
            {data ? PANEL_GENERATED(clockFmt.format(new Date(data.generatedAt))) : ""}
          </span>
          <FastButton
            variant="outline"
            size="sm"
            disabled={busy || !isBoss}
            onClick={() => void pull()}
            className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em]"
          >
            <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden />
            {busy ? PANEL_REFRESHING : PANEL_REFRESH}
          </FastButton>
        </div>

        {/* error */}
        {error && !busy && (
          <p className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-center text-sm font-bold text-neutral-300">
            {error}
          </p>
        )}

        {/* loading first paint */}
        {busy && !data && (
          <p className="py-10 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-500">
            {PANEL_REFRESHING}
          </p>
        )}

        {/* body — one tab at a time */}
        {data && !error && (
          <div className="flex flex-col gap-3">
            {tab === "roll" && <RollTab data={data} />}
            {tab === "sessions" && <SessionsTab data={data} now={Date.now()} />}
            {tab === "wanted" && <WantedTab data={data} />}
            {tab === "system" && <SystemTab data={data} />}
          </div>
        )}

        {!isBoss && (
          <p className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-center text-sm font-bold text-neutral-300">
            Boss ground only.
          </p>
        )}
      </div>
    </FastModal>
  );
}

// -------------------------------------------------------------- shared bits

/** One hard number on the war map. */
function Stat({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Users;
  value: string;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-xl border border-neutral-900 bg-black px-3 py-2.5">
      <Icon className="size-3.5 shrink-0 text-neutral-500" aria-hidden />
      <span className="truncate font-mono text-sm font-black tabular-nums text-white">{value}</span>
      <span className="font-mono text-[8px] font-bold uppercase leading-tight tracking-[0.16em] text-neutral-500">
        {label}
      </span>
    </div>
  );
}

function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2">{children}</div>;
}

function LawNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-neutral-900 bg-black px-3.5 py-2.5 text-[11px] font-semibold leading-relaxed text-neutral-400">
      {children}
    </p>
  );
}

// ------------------------------------------------------------------ ROL tab

function RollTab({ data }: { data: PanelData }) {
  const { members } = data;
  return (
    <div className="flex flex-col gap-3">
      <StatRow>
        <Stat icon={Flame} value={String(members.allTime)} label={PANEL_ROLL_ALLTIME(members.allTime)} />
        <Stat icon={Users} value={String(members.rollCount)} label={PANEL_ROLL_COUNT(members.rollCount)} />
        <Stat icon={Radio} value={String(members.onlineCount)} label={PANEL_ROLL_ONLINE(members.onlineCount)} />
      </StatRow>

      {members.roll.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm font-semibold text-neutral-500">
          {PANEL_ROLL_EMPTY}
        </p>
      ) : (
        <div className="flex max-h-[34dvh] flex-col gap-2 overflow-y-auto pr-0.5">
          {members.roll.map((r, ri) => {
            const boss = r.role === "boss";
            return (
              <div
                key={`${r.nickname}-${ri}`}
                className="flex items-center gap-2.5 rounded-xl border border-neutral-900 bg-black px-3 py-2.5"
              >
                <span
                  aria-hidden
                  className={`size-2 shrink-0 ${r.online ? "animate-fast-pulse rounded-full bg-white" : "rounded-full bg-neutral-700"}`}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={`truncate leading-tight ${
                      boss ? "drach-font text-lg text-white" : "font-mono text-sm font-bold uppercase tracking-[0.14em] text-neutral-100"
                    }`}
                  >
                    {r.nickname}
                  </span>
                  <span className="mt-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-neutral-500">
                    {boss ? PANEL_BOSS_TAG : PANEL_MEMBER_TAG}
                    {" · "}
                    {PANEL_ROLL_SEEN}: {stampFmt.format(new Date(r.firstSeen))}
                  </span>
                </span>
                <span className="shrink-0 text-right font-mono text-[8px] font-bold uppercase leading-tight tracking-[0.14em] text-neutral-600">
                  {PANEL_ROLL_LAST}
                  <br />
                  {r.lastSeen ? stampFmt.format(new Date(r.lastSeen)) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {members.live.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-neutral-300">
            <span aria-hidden className="size-1.5 animate-fast-pulse rounded-full bg-white" />
            {PANEL_SYS_LIVE(members.live.length)}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {members.live.map((l, li) => (
              <span
                key={`${l.nickname}-${li}`}
                className="flex items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-200"
              >
                <span aria-hidden className="size-1 animate-fast-pulse rounded-full bg-white" />
                {l.nickname}
                <span className="text-neutral-500">{clockFmt.format(new Date(l.since))}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <LawNote>{PANEL_SUB}</LawNote>
    </div>
  );
}

// -------------------------------------------------------------- WERWE tab

function SessionsTab({ data, now }: { data: PanelData; now: number }) {
  const { sessions } = data;
  return (
    <div className="flex flex-col gap-3">
      <StatRow>
        <Stat icon={MessagesSquare} value={String(sessions.live)} label={PANEL_SESSIONS_LIVE(sessions.live)} />
        <Stat icon={Users} value={String(sessions.membersInRooms)} label={PANEL_SESSIONS_INROOMS(sessions.membersInRooms)} />
        <Stat icon={Flame} value={String(sessions.messages)} label={PANEL_SESSIONS_MSGS(sessions.messages)} />
      </StatRow>

      {sessions.list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm font-semibold text-neutral-500">
          {PANEL_SESSIONS_EMPTY}
        </p>
      ) : (
        <div className="flex max-h-[40dvh] flex-col gap-2 overflow-y-auto pr-0.5">
          {sessions.list.map((s) => (
            <SessionInspectCard key={s.code} row={s} now={now} />
          ))}
        </div>
      )}

      <LawNote>
        Die boss sien die vorm van elke gesprek — wie, hoeveel, hoe lank — en{" "}
        <span className="text-neutral-100">nooit een woord nie</span>. E2EE is wet.
      </LawNote>
    </div>
  );
}

function SessionInspectCard({ row, now }: { row: PanelSessionRow; now: number }) {
  const statusChip =
    row.status === "live" ? (
      <span className="flex items-center gap-1 rounded-full border border-neutral-700 px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.16em] text-neutral-100">
        <span aria-hidden className="size-1 animate-fast-pulse rounded-full bg-white" />
        {PANEL_STATUS_LIVE}
      </span>
    ) : row.status === "terminated" ? (
      <span className="rounded-full border border-neutral-800 px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.16em] text-neutral-500">
        {PANEL_STATUS_DEAD}
      </span>
    ) : (
      <span className="rounded-full border border-neutral-800 px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.16em] text-neutral-500">
        {PANEL_STATUS_EXPIRED}
      </span>
    );

  return (
    <div className="rounded-xl border border-neutral-900 bg-black px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-lg font-black tracking-[0.22em] text-white">{row.code}</span>
        <span className="flex-1" />
        {statusChip}
      </div>

      {row.members.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {row.members.map((m, mi) => (
            <span
              key={`${m.nickname}-${mi}`}
              className={`rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] ${
                m.role === "boss"
                  ? "drach-font border-neutral-600 text-[11px] normal-case tracking-normal text-white"
                  : "border-neutral-800 text-neutral-300"
              }`}
            >
              {m.nickname}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-500">
        <span>{PANEL_SESSIONS_MEMBERS(row.memberCount)}</span>
        <span>{PANEL_SESSIONS_MSGS(row.messages)}</span>
        <span>{PANEL_SESSIONS_ENV(row.envelopes)}</span>
        {row.photos > 0 && <span>{PANEL_SESSIONS_PHOTOS(row.photos)}</span>}
        <span className={row.creatorBound ? "text-neutral-400" : "text-neutral-700"}>
          {row.creatorBound ? PANEL_CREATOR_BOUND : PANEL_CREATOR_LOOSE}
        </span>
        {row.status === "live" && (
          <span className="ml-auto flex items-center gap-1.5">
            <KeyRound className="size-3" aria-hidden />
            <WipeChip expiresAt={row.expiresAt} now={now} compact />
          </span>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- WANTED tab

function WantedTab({ data }: { data: PanelData }) {
  const w = data.wanted;
  return (
    <div className="flex flex-col gap-3">
      <StatRow>
        <Stat icon={Crosshair} value={String(w.posts)} label={PANEL_WANTED_POSTS(w.posts)} />
        <Stat icon={ShieldCheck} value={String(w.exhibits)} label={PANEL_WANTED_EXHIBITS(w.exhibits)} />
        <Stat icon={Activity} value={String(w.comments)} label={PANEL_WANTED_COMMENTS(w.comments)} />
      </StatRow>
      <StatRow>
        <Stat icon={Flame} value={String(w.tombstones)} label={PANEL_WANTED_TOMB(w.tombstones)} />
        <Stat icon={Cpu} value={`${mbLabel(w.bytes)}MB`} label={PANEL_WANTED_BYTES(mbLabel(w.bytes))} />
      </StatRow>

      {w.posts === 0 && (
        <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm font-semibold text-neutral-500">
          {PANEL_WANTED_EMPTY}
        </p>
      )}

      {w.freshestPostAt && (
        <p className="text-center font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-neutral-500">
          {WANTED_TITLE} · LAASTE SAAK {stampFmt.format(new Date(w.freshestPostAt))}
        </p>
      )}

      <LawNote>{PANEL_WANTED_LAW}</LawNote>
    </div>
  );
}

// ----------------------------------------------------------- STELSEL tab

function SystemTab({ data }: { data: PanelData }) {
  const sys = data.system;
  return (
    <div className="flex flex-col gap-3">
      <StatRow>
        <Stat icon={Cpu} value={uptimeLabel(sys.uptimeSec)} label={PANEL_SYS_UPTIME(uptimeLabel(sys.uptimeSec))} />
        <Stat icon={Activity} value={`${sys.rssMb}MB`} label={PANEL_SYS_RAM(sys.rssMb)} />
        <Stat icon={Radio} value={String(data.members.live.length)} label={PANEL_SYS_LIVE(data.members.live.length)} />
      </StatRow>
      <StatRow>
        <Stat icon={Flame} value={String(data.summons.pending)} label={PANEL_SYS_SUMMONS(data.summons.pending)} />
        <Stat icon={ShieldCheck} value={String(sys.limiterBuckets)} label={PANEL_SYS_LIMITERS(sys.limiterBuckets)} />
        <Stat icon={KeyRound} value={String(sys.gateLockoutsLive)} label={PANEL_SYS_LOCKS(sys.gateLockoutsLive)} />
      </StatRow>
      <StatRow>
        <Stat icon={ShieldAlert} value={String(sys.replayBlocks)} label={PANEL_SYS_REPLAY(sys.replayBlocks)} />
        <Stat icon={EyeOff} value={String(sys.probeWatch)} label={PANEL_SYS_PROBES(sys.probeWatch)} />
        <Stat icon={Timer} value={`${sys.probeTarpits}ms`} label={PANEL_SYS_TARPIT(sys.probeTarpits)} />
        <Stat
          icon={Ticket}
          value={String(data.invites.active)}
          label={PANEL_SYS_INVITES(data.invites.active, data.invites.redemptions)}
        />
        <Stat icon={ShieldAlert} value={String(data.invites.forged)} label={PANEL_SYS_FORGED(data.invites.forged)} />
      </StatRow>

      <div className="flex flex-col gap-1.5 rounded-xl border border-neutral-900 bg-black px-3.5 py-3 font-mono text-[10px] font-bold uppercase leading-relaxed tracking-[0.16em] text-neutral-400">
        <span>{PANEL_SYS_STARTED(stampFmt.format(new Date(sys.startedAt)))}</span>
        <span>{PANEL_SYS_NODE(sys.node)}</span>
        <span>{PANEL_SYS_PLATFORM(sys.platform)}</span>
        <span>{PANEL_SYS_CIRCUIT(sys.circuitCount)}</span>
      </div>

      <LawNote>{PANEL_SYS_LAW}</LawNote>
    </div>
  );
}
