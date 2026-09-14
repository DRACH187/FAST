"use client";

/**
 * FAST — LIVE board: everyone on the site right now.
 * Heartbeats every ~8s via /api/presence (see lib/fast/live.ts); entries
 * expire 25 seconds after their last beat. Callsigns render in the boss
 * blackletter when the role is boss. Strictly read-only display material.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Radio, ShieldCheck, SignalHigh, UserRound, Wifi, WifiOff } from "lucide-react";
import { REDUCED_MOTION, ScreenShell } from "@/components/fast/motion";
import { useLivePresence } from "@/lib/fast/live";
import type { Role } from "@/lib/fast/identity-store";

gsap.registerPlugin(useGSAP);

function sinceLabel(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
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
  const [mounted, setMounted] = useState(false);
  const { online, count, error } = useLivePresence();
  const listRef = useRef<HTMLUListElement>(null);
  // 5s re-render so the "online Xs" labels stay honest
  const [, setTick] = useState(0);
  const [shownOpen, setShownOpen] = useState(open);

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

  return createPortal(
    <div className="fixed inset-0 z-[92] bg-black" role="dialog" aria-label="Live operatives">
      <ScreenShell as="div" className="flex h-dvh flex-col">
        <header className="sticky top-0 z-20 border-b border-neutral-900 bg-black/85 backdrop-blur-md">
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
              alt="FAST"
              width={256}
              height={256}
              draggable={false}
              className="h-8 w-8 mix-blend-screen"
            />
            <div className="flex flex-col">
              <span className="font-mono text-xs font-bold uppercase tracking-[0.34em] text-white">
                Live
              </span>
              <span className="font-mono text-[8px] uppercase tracking-[0.22em] text-neutral-600">
                heartbeat refreshed every 8s
              </span>
            </div>
            <div className="flex-1" />
            <span
              title={error ? "Last heartbeat failed — retrying" : "Heartbeat healthy"}
              className="flex items-center gap-1.5 rounded-full border border-neutral-800 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-neutral-400"
            >
              {error ? <WifiOff className="size-3" aria-hidden /> : <Wifi className="size-3" aria-hidden />}
              {count} on
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-3 pb-24 pt-3">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <SignalHigh className="size-7 text-neutral-700" aria-hidden />
              <p className="text-sm text-neutral-300">Nobody on the board yet.</p>
              <p className="max-w-[260px] text-[11px] leading-relaxed text-neutral-600">
                Heartbeats land here within seconds of anyone opening FAST —
                including you.
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
                            ? "drach-font text-xl leading-tight text-white"
                            : "font-mono text-sm font-bold uppercase tracking-[0.14em] text-neutral-200"
                        }`}
                      >
                        {u.nickname}
                      </span>
                      <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-neutral-600">
                        {boss ? "BOSS" : "operative"}
                        {me ? " · this device" : ""} · online {sinceLabel(u.since)}
                      </span>
                    </span>
                    {boss && <ShieldCheck className="size-4 shrink-0 text-neutral-400" aria-hidden />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="sticky bottom-0 border-t border-neutral-900 bg-black/85 px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md">
          <p className="text-center font-mono text-[8px] uppercase tracking-[0.22em] text-neutral-700">
            callsigns are public display · no locations, no tracking, ever
          </p>
        </footer>
      </ScreenShell>
    </div>,
    document.body
  );
}
