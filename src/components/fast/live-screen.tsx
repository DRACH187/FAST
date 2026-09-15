"use client";

/**
 * FAST — LIVE board: everyone on the site right now.
 * Heartbeats every ~8s via /api/presence (see lib/fast/live.ts); entries
 * expire 25 seconds after their last beat. Callsigns render in the boss
 * blackletter when the role is boss. Strictly read-only display material.
 */

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Radio, ShieldCheck, SignalHigh, UserRound, Users, Wifi, WifiOff } from "lucide-react";
import { REDUCED_MOTION, ScreenShell } from "@/components/fast/motion";
import { useLivePresence } from "@/lib/fast/live";
import { cachedMemberTotal, fetchMemberTotal } from "@/lib/fast/member-ledger";
import { LIVE_EMPTY, LIVE_NO_GPS, LIVE_ROLE_BOSS, LIVE_ROLE_MEMBER, LIVE_SUB, LIVE_TITLE, pick } from "@/lib/fast/copy";
import type { Role } from "@/lib/fast/identity-store";

gsap.registerPlugin(useGSAP);

function sinceLabel(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

/** ALL-TIME member total — the permanent roll of the 187. */
function EverTotal() {
  const [total, setTotal] = useState(cachedMemberTotal);
  useEffect(() => {
    let alive = true;
    void fetchMemberTotal().then((t) => {
      if (alive && typeof t === "number") setTotal(t);
    });
    return () => {
      alive = false;
    };
  }, []);
  return <span>{total > 0 ? total : "—"}</span>;
}

export function LiveScreen({
  open,
  onClose,
  myFp,
}: {
  open: boolean;
  onClose: () => void;
  myFp: string;
}) {
  /* Task 19: mounted starts at `open` — see map-screen note. The shell
     mounts this board only while its tab is active. */
  const [mounted, setMounted] = useState(open);
  const { online, count, error } = useLivePresence();
  const listRef = useRef<HTMLUListElement>(null);
  // 5s re-render so the "online Xs" labels stay honest
  const [, setTick] = useState(0);
  const [shownOpen, setShownOpen] = useState(open);
  const [sub] = useState(() => pick(LIVE_SUB));
  const [emptyLine] = useState(() => pick(LIVE_EMPTY));

  // derive-during-render pattern (React-sanctioned, no cascading effect)
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) setMounted(true);
  }

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const id = window.setInterval(() => setTick((t) => t + 1), 5000);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearInterval(id);
    };
  }, [mounted, onClose]);

  useGSAP(
    () => {
      if (REDUCED_MOTION || !listRef.current) return;
      const rows = listRef.current.querySelectorAll("[data-live-row]");
      gsap.fromTo(
        rows,
        { opacity: 0, x: 14 },
        { opacity: 1, x: 0, duration: 0.4, stagger: 0.05, ease: "power3.out", overwrite: "auto" }
      );
    },
    { scope: listRef, dependencies: [count] }
  );

  if (!open || !mounted) return null;

  const sorted = [...online].sort((a, b) => {
    if (a.role !== b.role) return a.role === "boss" ? -1 : 1;
    if (a.fp === myFp) return -1;
    if (b.fp === myFp) return 1;
    return a.since - b.since;
  });

  /* Task 19: shell tab view — full screen on phones, pane panel on desktop. */
  return (
    <div
      className="fixed inset-0 z-[92] bg-black lg:absolute lg:inset-0 lg:z-auto"
      role="region"
      aria-label="Live operatives"
    >
      <ScreenShell as="div" className="flex h-dvh flex-col lg:h-full">
        <header className="sticky top-0 z-20 border-b border-neutral-900 bg-black/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="flex h-14 items-center gap-2 px-3">
            <button
              onClick={onClose}
              aria-label="Close live board"
              className="flex size-11 items-center justify-center rounded-xl text-neutral-400 outline-none transition-colors hover:bg-neutral-900 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
            >
              <Radio className="size-5" aria-hidden />
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
              <span className="gang-font text-2xl leading-none text-white">{LIVE_TITLE}</span>
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-neutral-500">
                {sub}
              </span>
            </div>
            <div className="flex-1" />
            <span
              title="Total members ever — the permanent roll of the 187"
              className="hidden items-center gap-1.5 rounded-full border border-neutral-900 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-neutral-500 sm:flex"
            >
              <Users className="size-3 text-neutral-600" aria-hidden />
              <EverTotal />
            </span>
            <span
              title={error ? "Last heartbeat failed — retrying" : "Heartbeat healthy"}
              className="flex items-center gap-1.5 rounded-full border border-neutral-800 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-neutral-400"
            >
              {error ? <WifiOff className="size-3" aria-hidden /> : <Wifi className="size-3" aria-hidden />}
              {count} on
            </span>
          </div>
        </header>

        <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto px-3 pb-[calc(var(--fast-dock-clear)+3.5rem)] pt-3 sm:max-w-xl lg:max-w-2xl lg:pb-6">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <SignalHigh className="size-8 text-neutral-600" aria-hidden />
              <p className="text-base font-bold text-neutral-200">{emptyLine}</p>
              <p className="max-w-[280px] text-[13px] font-semibold leading-relaxed text-neutral-500">
                Heartbeats land hier binne sekondes van enige ouen wat FAST GUNS oopmaak —
                ook jy.
              </p>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-600">
                All-time rol: <EverTotal />
              </p>
            </div>
          ) : (
            <ul ref={listRef} className="grid gap-2">
              {sorted.map((u) => {
                const boss = u.role === "boss";
                const me = u.fp === myFp;
                return (
                  <li
                    key={u.fp}
                    data-live-row
                    className={`flex min-h-[56px] items-center gap-3 rounded-2xl border px-4 py-3 ${
                      boss
                        ? "border-neutral-500 bg-neutral-900"
                        : me
                          ? "border-neutral-800 bg-neutral-950"
                          : "border-neutral-900 bg-neutral-950/60"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`size-2 shrink-0 rounded-full ${
                        boss ? "animate-fast-pulse bg-white" : me ? "bg-neutral-300" : "bg-neutral-600"
                      }`}
                    />
                    <UserRound
                      className={`size-4 shrink-0 ${boss ? "text-neutral-300" : "text-neutral-600"}`}
                      aria-hidden
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        className={`truncate ${
                          boss
                            ? "drach-font text-2xl leading-tight text-white"
                            : "font-mono text-base font-black uppercase tracking-[0.12em] text-neutral-100"
                        }`}
                      >
                        {u.nickname}
                      </span>
                      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">
                        {boss ? LIVE_ROLE_BOSS : LIVE_ROLE_MEMBER}
                        {me ? " · hierdie toestel" : ""} · aanlyn {sinceLabel(u.since)}
                      </span>
                    </span>
                    {boss && <ShieldCheck className="size-4 shrink-0 text-neutral-400" aria-hidden />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="sticky bottom-0 border-t border-neutral-900 bg-black/85 px-3 pb-[calc(var(--fast-dock-clear)-0.5rem)] pt-2 backdrop-blur-md lg:pb-2">
          <p className="text-center font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500">
            naam is publiek · {LIVE_NO_GPS}
          </p>
        </footer>
      </ScreenShell>
    </div>
  );
}
