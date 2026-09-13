"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";

type MessageListProps = {
  messages: ChatMessage[];
  user: string;
  loading: boolean;
  channelName: string;
};

type MessageRow = {
  m: ChatMessage;
  dayKey: string;
  showDay: boolean;
  dayLabelText: string;
  showHeader: boolean;
  own: boolean;
  timeText: string;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function MessageList({ messages, user, loading, channelName }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = containerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  };

  // Auto-scroll on new messages if we're near the bottom
  useEffect(() => {
    if (atBottom) scrollToBottom(messages.length > 2 ? "smooth" : "auto");
  }, [messages.length, loading, atBottom]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 130);
  };

  // Compute grouping metadata (day dividers + consecutive-author grouping)
  const rows: MessageRow[] = useMemo(() => {
    return messages.reduce<MessageRow[]>((acc, m) => {
      const created = new Date(m.createdAt).getTime();
      const day = new Date(m.createdAt).toDateString();
      const prev = acc[acc.length - 1];
      const showDay = !prev || prev.dayKey !== day;
      const showHeader =
        showDay ||
        !prev ||
        prev.m.author !== m.author ||
        created - new Date(prev.m.createdAt).getTime() > 5 * 60 * 1000;
      acc.push({
        m,
        dayKey: day,
        showDay,
        dayLabelText: dayLabel(m.createdAt),
        showHeader,
        own: m.author === user,
        timeText: formatTime(m.createdAt),
      });
      return acc;
    }, []);
  }, [messages, user]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        role="log"
        aria-label={`Messages in ${channelName}`}
        className="chat-scroll h-full overflow-y-auto pb-5 pt-2"
      >
        {loading && messages.length === 0 ? (
          <div className="space-y-5 px-4 py-8 md:px-6">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="h-9 w-9 shrink-0 animate-pulse border border-[#222222] bg-[#141414]" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-3 w-28 animate-pulse bg-[#1a1a1a]" />
                  <div className="h-3 w-2/3 animate-pulse bg-[#161616]" />
                </div>
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <img
              src="/textures/outlaw-mascot-inv.png"
              alt="Hooded skeleton outlaw — Chicano tattoo mascot"
              className="w-44 opacity-70 mix-blend-screen md:w-52"
            />
            <p className="mt-6 font-script text-4xl text-neutral-200">
              wall&apos;s clean…
            </p>
            <p className="mt-2 font-street text-[10px] uppercase tracking-[0.35em] text-neutral-600">
              put the first line on the wall
            </p>
          </div>
        ) : (
          <div className="px-4 md:px-6">
            {rows.map(({ m, showDay, dayLabelText, showHeader, own, timeText }) => (
              <div key={m.id}>
                {showDay && (
                  <div className="my-5 flex items-center gap-3" aria-hidden="true">
                    <span className="h-px flex-1 bg-[#1f1f1f]" />
                    <span className="font-street text-[9px] uppercase tracking-[0.4em] text-neutral-600">
                      {dayLabelText}
                    </span>
                    <span className="h-px flex-1 bg-[#1f1f1f]" />
                  </div>
                )}
                <div
                  className={cn(
                    "group flex gap-3",
                    showHeader ? "msg-in mt-4" : "mt-0.5"
                  )}
                >
                  <div className="w-9 shrink-0">
                    {showHeader && (
                      <div className="flex h-9 w-9 items-center justify-center border border-[#333333] bg-[#131313]">
                        <span className="font-blackletter text-base text-neutral-300">
                          {m.author.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {showHeader && (
                      <div className="flex items-baseline gap-2.5">
                        <span
                          className={cn(
                            "font-script text-[1.4rem] leading-none",
                            own ? "text-white" : "text-neutral-300"
                          )}
                        >
                          {m.author}
                        </span>
                        {own && (
                          <span className="border border-blood/50 px-1 py-px font-street text-[8px] uppercase tracking-[0.25em] leading-none text-blood">
                            you
                          </span>
                        )}
                        <span className="font-street text-[10px] tracking-wider text-neutral-600 opacity-0 transition-opacity group-hover:opacity-100">
                          {timeText}
                        </span>
                      </div>
                    )}
                    <p
                      className={cn(
                        "whitespace-pre-wrap break-words text-[15px] leading-relaxed text-neutral-200",
                        !showHeader && "text-neutral-300/90"
                      )}
                    >
                      {m.content}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* jump to newest */}
      {!atBottom && messages.length > 0 && (
        <button
          onClick={() => scrollToBottom()}
          className="absolute bottom-4 right-5 flex items-center gap-2 border border-[#333333] bg-[#101010]/95 px-3 py-2 font-street text-[10px] uppercase tracking-[0.25em] text-neutral-300 shadow-lg backdrop-blur transition-colors hover:border-blood hover:text-blood"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          fresh ink
        </button>
      )}
    </div>
  );
}
