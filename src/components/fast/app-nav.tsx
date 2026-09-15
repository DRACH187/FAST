"use client";

/**
 * FAST — APP NAVIGATION (task 19).
 * =================================
 * One navigation law, two bodies:
 *
 *  • PHONES  — DockNav: a floating pill dock pinned above the safe area,
 *    Mobbin-grade: icon + label per tab, the active tab floods white with
 *    black ink, springy press feedback, blur glass, 52px+ touch targets,
 *    never wider than 24rem so thumbs stay in reach on a 320px screen.
 *    The chat view deliberately hides it (a chat is a focused room with its
 *    own way out — same pattern iMessage/WhatsApp/Telegram ship).
 *
 *  • DESKTOP — SideRail: a fixed app rail that turns FAST GUNS into a real
 *    desktop layout: brand block up top, the four houses of the app as a
 *    vertical list, live counters, and the callsign pinned at the bottom.
 *    Content lives in the pane to its right; nothing covers the rail, ever.
 *
 * Both read the same AppTab — the shell (page.tsx) owns the state.
 */

import Image from "next/image";
import { Crown, Crosshair, Map as MapIcon, MessagesSquare, Radio, ShieldCheck } from "lucide-react";
import { pressFeedback } from "@/components/fast/motion";
import { useLivePresence } from "@/lib/fast/live";
import type { CallsignIdentity } from "@/lib/fast/identity";
import {
  NAV_LABEL,
  NAV_RAIL_LAW,
  NAV_RAIL_OPEN,
  NAV_RAIL_PANEL,
  NAV_RAIL_PANEL_HINT,
  NAV_RAIL_PROFILE,
  NAV_RAIL_TAG,
  NAV_TAB_LIVE,
  NAV_TAB_MAP,
  NAV_TAB_SESSIONS,
  NAV_TAB_WANTED,
} from "@/lib/fast/copy";

export type AppTab = "hub" | "wanted" | "map" | "live";

const NAV_ITEMS = [
  { id: "hub", icon: MessagesSquare, label: NAV_TAB_SESSIONS },
  { id: "wanted", icon: Crosshair, label: NAV_TAB_WANTED },
  { id: "map", icon: MapIcon, label: NAV_TAB_MAP },
  { id: "live", icon: Radio, label: NAV_TAB_LIVE },
] as const satisfies ReadonlyArray<{ id: AppTab; icon: typeof Radio; label: string }>;

// ------------------------------------------------------------------ dock

type DockNavProps = {
  tab: AppTab;
  onTab: (tab: AppTab) => void;
  /** Unread messages across every open session — painted on the Werwe tab. */
  unread?: number;
};

/**
 * The mobile dock. Fixed, floating, glass. Rendered by the shell whenever a
 * dock makes sense (hub or a tool tab) and hidden inside an open chat.
 */
export function DockNav({ tab, onTab, unread = 0 }: DockNavProps) {
  return (
    <nav
      aria-label={NAV_LABEL}
      className="fixed inset-x-0 bottom-0 z-[100] lg:hidden"
    >
      {/* bottom fade — the dock never floats over naked content edges */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[calc(100%+3rem)] bg-gradient-to-t from-black via-black/70 to-transparent"
      />
      <div className="relative mx-auto flex w-[min(24rem,calc(100%-1.75rem))] items-stretch justify-between gap-1 rounded-[28px] border border-neutral-800 bg-black/90 p-1.5 shadow-[0_24px_64px_rgba(0,0,0,0.9)] backdrop-blur-xl mb-[max(0.9rem,calc(env(safe-area-inset-bottom)+0.6rem))]">
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={(e) => {
                pressFeedback(e.currentTarget);
                onTab(id);
              }}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-[54px] flex-1 flex-col items-center justify-center gap-1 rounded-[22px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-neutral-500 ${
                active ? "bg-white text-black" : "text-neutral-500 hover:text-neutral-200"
              }`}
            >
              <span className="relative">
                <Icon className="size-5" aria-hidden />
                {id === "hub" && unread > 0 && (
                  <span
                    aria-hidden
                    className={`absolute -right-2.5 -top-1.5 flex min-w-[18px] items-center justify-center rounded-full px-1 py-px font-mono text-[9px] font-black leading-none ${
                      active ? "bg-black text-white" : "bg-white text-black"
                    }`}
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </span>
              <span className="whitespace-nowrap font-mono text-[9px] font-bold uppercase tracking-[0.14em]">
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ------------------------------------------------------------------ rail

type SideRailProps = {
  tab: AppTab;
  onTab: (tab: AppTab) => void;
  callsign: CallsignIdentity | null;
  onOpenProfile: () => void;
  /** Open the BOSS COMMAND PANEL (boss-only; ignored otherwise). */
  onOpenBossPanel?: () => void;
  /** Open session count — painted next to the Werwe row. */
  openSessions?: number;
  unread?: number;
};

/**
 * The desktop rail — the custom desktop layout's spine. Hidden under lg;
 * from lg up it is always mounted and the content pane obeys it.
 */
export function SideRail({ tab, onTab, callsign, onOpenProfile, onOpenBossPanel, openSessions = 0, unread = 0 }: SideRailProps) {
  const boss = callsign?.role === "boss";
  return (
    <aside
      aria-label={NAV_LABEL}
      className="fast-grain relative hidden h-full w-[248px] shrink-0 flex-col border-r border-neutral-900 bg-black xl:w-[276px] lg:flex"
    >
      {/* brand block */}
      <div className="flex items-center gap-3 px-5 pb-6 pt-[max(1.25rem,calc(env(safe-area-inset-top)+1rem))]">
        <Image
          src="/fast-logo.png"
          alt="FAST GUNS"
          width={256}
          height={256}
          priority
          draggable={false}
          className="size-12 shrink-0 mix-blend-screen"
        />
        <div className="flex min-w-0 flex-col">
          <span className="gang-font text-2xl leading-none text-white [text-shadow:0_0_26px_rgba(255,255,255,0.25)]">
            FAST GUNS
          </span>
          <span className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-neutral-500">
            {NAV_RAIL_TAG}
          </span>
        </div>
      </div>

      {/* the four houses */}
      <nav aria-label={NAV_LABEL} className="flex flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => onTab(id)}
              aria-current={active ? "page" : undefined}
              className={`group relative flex min-h-[46px] items-center gap-3 rounded-xl px-3.5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-neutral-500 ${
                active ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-950 hover:text-neutral-200"
              }`}
            >
              {/* active edge marker — a white slit on the rail's left lip */}
              <span
                aria-hidden
                className={`absolute -left-3 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-white transition-opacity duration-150 ${
                  active ? "opacity-100" : "opacity-0"
                }`}
              />
              <Icon className="size-[18px] shrink-0" aria-hidden />
              <span className="flex-1 text-left font-mono text-xs font-bold uppercase tracking-[0.2em]">
                {label}
              </span>
              {id === "hub" && openSessions > 0 && (
                <span
                  title={NAV_RAIL_OPEN}
                  className={`flex min-w-6 items-center justify-center rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-black tabular-nums ${
                    unread > 0
                      ? "border-white bg-white text-black"
                      : "border-neutral-800 text-neutral-400 group-hover:border-neutral-600"
                  }`}
                >
                  {unread > 0 ? (unread > 99 ? "99+" : unread) : openSessions}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* boss ground — DRACH's command room, one row, always visible */}
      {boss && onOpenBossPanel && (
        <div className="mt-1 px-3">
          <span className="mb-1.5 block px-2.5 font-mono text-[8px] font-bold uppercase tracking-[0.3em] text-neutral-600">
            BOSS GROND
          </span>
          <button
            onClick={(e) => {
              pressFeedback(e.currentTarget);
              onOpenBossPanel();
            }}
            aria-label={NAV_RAIL_PANEL}
            title={NAV_RAIL_PANEL_HINT}
            className="group flex min-h-[50px] w-full items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 outline-none transition-colors duration-150 hover:border-white focus-visible:ring-2 focus-visible:ring-neutral-500"
          >
            <Crown className="size-[18px] shrink-0 text-white" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="drach-font text-lg leading-tight text-white">{NAV_RAIL_PANEL}</span>
              <span className="mt-0.5 truncate font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-neutral-500">
                {NAV_RAIL_PANEL_HINT}
              </span>
            </span>
          </button>
        </div>
      )}

      {/* bottom block — who you are + the house law */}
      <div className="mt-auto flex flex-col gap-3 px-3 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+1rem))] pt-4">
        <div className="mx-2 flex items-center gap-2 border-t border-neutral-900 pt-4 font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-neutral-600">
          <OnlineCount />
        </div>
        {callsign ? (
          <button
            onClick={onOpenProfile}
            aria-label={NAV_RAIL_PROFILE(callsign.nickname)}
            className="flex min-h-[52px] items-center gap-3 rounded-xl border border-neutral-900 bg-neutral-950 px-3.5 py-2 text-left outline-none transition-colors hover:border-neutral-600 focus-visible:ring-2 focus-visible:ring-neutral-500"
          >
            <ShieldCheck className="size-4 shrink-0 text-neutral-400" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={`truncate leading-tight ${
                  boss
                    ? "drach-font text-xl text-white"
                    : "font-mono text-xs font-bold uppercase tracking-[0.16em] text-neutral-200"
                }`}
              >
                {callsign.nickname}
              </span>
              <span className="mt-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.24em] text-neutral-500">
                {boss ? "BOSS · 187" : "OUEN · 187"}
              </span>
            </span>
          </button>
        ) : null}
        <p className="px-2 font-mono text-[8px] font-bold uppercase leading-relaxed tracking-[0.22em] text-neutral-700">
          {NAV_RAIL_LAW}
        </p>
      </div>
    </aside>
  );
}

/** Live online count for the rail — same heartbeat store the hub chip uses. */
function OnlineCount() {
  const { count } = useLivePresence();
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="size-1.5 animate-fast-pulse rounded-full bg-white" />
      {count} AAN
    </span>
  );
}
