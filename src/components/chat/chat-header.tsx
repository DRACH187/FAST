"use client";

import { Menu, Users, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChannelInfo } from "@/lib/types";
import { DripUnderline } from "./drip-underline";

type ChatHeaderProps = {
  channel: ChannelInfo | undefined;
  online: number;
  connected: boolean;
  onOpenSidebar: () => void;
};

export function ChatHeader({ channel, online, connected, onOpenSidebar }: ChatHeaderProps) {
  return (
    <header className="relative z-10 border-b border-[#1f1f1f] bg-[#0a0a0a]/85 px-4 py-4 backdrop-blur md:px-8">
      <div className="flex items-start gap-3">
        <button
          onClick={onOpenSidebar}
          aria-label="Open menu"
          className="mt-1 rounded-none p-1 text-neutral-400 hover:text-white md:hidden"
        >
          <Menu className="h-6 w-6" />
        </button>

        <img
          src="/fast-logo.png"
          alt="Fast Guns 26 logo"
          className="h-11 w-11 object-contain mix-blend-screen md:hidden"
        />

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-blackletter text-3xl leading-none text-white md:text-4xl">
              {channel?.name ?? "…"}
            </h1>
            <span className="font-street text-[10px] uppercase tracking-[0.35em] text-neutral-600">
              set · {channel?.slug ?? "—"}
            </span>
          </div>
          <p className="mt-1.5 font-script text-lg leading-none text-neutral-400">
            {channel?.tagline ?? "pull up and speak on it"}
          </p>
          <DripUnderline className="mt-2 h-6 w-44" />
        </div>

        <div className="ml-auto flex flex-col items-end gap-2 pt-1">
          <span
            className={cn(
              "flex items-center gap-1.5 font-street text-[10px] uppercase tracking-[0.3em]",
              connected ? "text-neutral-300" : "text-blood"
            )}
          >
            {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {connected ? "live" : "reconnecting"}
          </span>
          <span className="flex items-center gap-1.5 font-street text-[10px] uppercase tracking-[0.25em] text-neutral-500">
            <Users className="h-3.5 w-3.5" />
            {online} on the block
          </span>
        </div>
      </div>
    </header>
  );
}
