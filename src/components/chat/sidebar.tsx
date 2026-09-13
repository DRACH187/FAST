"use client";

import {
  Car,
  Flame,
  Hash,
  MapPin,
  Moon,
  Repeat,
  SprayCan,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChannelInfo } from "@/lib/types";

const CHANNEL_ICONS: Record<string, LucideIcon> = {
  "the-yard": Flame,
  "east-side": MapPin,
  "tag-wall": SprayCan,
  "lowrider-lounge": Car,
  "smoke-signals": Moon,
};

function iconFor(slug: string): LucideIcon {
  return CHANNEL_ICONS[slug] ?? Hash;
}

type SidebarProps = {
  channels: ChannelInfo[];
  activeSlug: string;
  unread: Record<string, number>;
  user: string;
  online: number;
  connected: boolean;
  open: boolean;
  onClose: () => void;
  onSelect: (slug: string) => void;
  onResetTag: () => void;
};

export function Sidebar({
  channels,
  activeSlug,
  unread,
  user,
  online,
  connected,
  open,
  onClose,
  onSelect,
  onResetTag,
}: SidebarProps) {
  return (
    <>
      {/* mobile backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-black/70 backdrop-blur-sm transition-opacity duration-300 md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />

      <aside
        className={cn(
          "concrete-bg fixed inset-y-0 left-0 z-40 flex w-[292px] shrink-0 flex-col border-r border-[#1f1f1f] bg-[#0a0a0a] transition-transform duration-300 ease-out md:relative md:z-auto md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* brand */}
        <div className="relative z-10 flex items-center gap-3 border-b border-[#1f1f1f] px-5 py-5">
          <img
            src="/fast-logo.png"
            alt="Fast Guns 26 logo"
            className="h-[52px] w-[52px] object-contain mix-blend-screen"
          />
          <div className="min-w-0">
            <div className="font-script text-[1.75rem] leading-none text-white">
              Fast Guns
            </div>
            <div className="mt-1.5 font-street text-[9px] uppercase tracking-[0.42em] text-neutral-500">
              26 · street network
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="ml-auto rounded-none p-1 text-neutral-500 hover:text-white md:hidden"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* channels */}
        <nav className="chat-scroll relative z-10 flex-1 overflow-y-auto px-3 py-4" aria-label="Channels">
          <div className="flex items-center gap-2 px-2 pb-3 font-street text-[10px] uppercase tracking-[0.35em] text-neutral-600">
            <span className="h-px flex-1 bg-[#1f1f1f]" />
            the sets
            <span className="h-px flex-1 bg-[#1f1f1f]" />
          </div>

          <ul className="space-y-1">
            {channels.map((ch) => {
              const Icon = iconFor(ch.slug);
              const active = ch.slug === activeSlug;
              const count = unread[ch.slug] ?? 0;
              return (
                <li key={ch.slug}>
                  <button
                    onClick={() => onSelect(ch.slug)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative w-full border-l-2 px-3 py-2.5 text-left transition-all duration-150",
                      active
                        ? "border-blood bg-[#161616]"
                        : "border-transparent hover:border-[#3a3a3a] hover:bg-[#101010]"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          active ? "text-blood" : "text-neutral-600 group-hover:text-neutral-400"
                        )}
                      />
                      <span
                        className={cn(
                          "font-blackletter text-lg leading-none",
                          active ? "text-white" : "text-neutral-300 group-hover:text-white"
                        )}
                      >
                        {ch.name}
                      </span>
                      {count > 0 && !active && (
                        <span className="ml-auto bg-blood px-1.5 py-0.5 font-street text-[9px] font-semibold leading-none text-white">
                          {count > 99 ? "99+" : count}
                        </span>
                      )}
                      {active && (
                        <span className="ml-auto font-street text-[9px] uppercase tracking-[0.2em] text-blood">
                          live
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 truncate pl-[26px] text-xs text-neutral-600">
                      {ch.lastMessage
                        ? `${ch.lastMessage.author}: ${ch.lastMessage.content}`
                        : ch.tagline}
                    </div>
                  </button>
                </li>
              );
            })}
            {channels.length === 0 && (
              <li className="px-3 py-8 text-center font-street text-[10px] uppercase tracking-[0.3em] text-neutral-700">
                loading the sets…
              </li>
            )}
          </ul>

          <img
            src="/textures/spray-splatter.png"
            alt=""
            aria-hidden="true"
            className="splatter mx-auto mt-8 w-40 opacity-15"
          />
        </nav>

        {/* user panel */}
        <div className="relative z-10 border-t border-[#1f1f1f] px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center border border-[#333333] bg-[#141414]">
              <span className="font-blackletter text-lg text-white">
                {user.charAt(0).toUpperCase()}
              </span>
              <span className="live-dot absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 border-2 border-[#0a0a0a] bg-blood" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-script text-[1.35rem] leading-none text-neutral-100">
                {user}
              </div>
              <div className="mt-1 font-street text-[9px] uppercase tracking-[0.28em] text-neutral-500">
                {connected ? `${online} on the block` : "reconnecting…"}
              </div>
            </div>
            <button
              onClick={onResetTag}
              title="Switch tag"
              aria-label="Switch tag"
              className="p-1.5 text-neutral-600 transition-colors hover:text-blood"
            >
              <Repeat className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
