"use client";

import { useRef, useState } from "react";
import { SendHorizontal, SprayCan } from "lucide-react";
import { cn } from "@/lib/utils";

type MessageInputProps = {
  onSend: (content: string) => Promise<void>;
  onTyping: (isTyping: boolean) => void;
};

export function MessageInput({ onSend, onTyping }: MessageInputProps) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const idleTimer = useRef<number | null>(null);

  const resize = () => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };

  const handleChange = (v: string) => {
    setValue(v);
    resize();
    onTyping(true);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => onTyping(false), 1600);
  };

  const submit = async () => {
    const content = value.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      await onSend(content);
      setValue("");
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      onTyping(false);
      requestAnimationFrame(resize);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="relative z-10 border-t border-[#1f1f1f] bg-[#0b0b0b]/90 px-3 py-3 backdrop-blur md:px-6 md:py-4"
    >
      <div
        className={cn(
          "flex items-end gap-2 border border-[#2a2a2a] bg-[#101010] p-2 transition-colors",
          "focus-within:border-[#4d4d4d]"
        )}
      >
        <SprayCan
          className="mb-2.5 ml-1.5 h-5 w-5 shrink-0 text-neutral-700"
          aria-hidden="true"
        />
        <textarea
          ref={areaRef}
          rows={1}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Drop a line for the set…"
          aria-label="Message"
          maxLength={2000}
          className="max-h-32 flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-snug text-neutral-100 placeholder:text-neutral-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!value.trim() || sending}
          aria-label="Send message"
          className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center bg-neutral-100 text-black transition-colors hover:bg-blood hover:text-white disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-neutral-100 disabled:hover:text-black"
        >
          <SendHorizontal className="h-5 w-5" />
        </button>
      </div>
      <div className="mt-1.5 hidden px-1 font-street text-[9px] uppercase tracking-[0.3em] text-neutral-700 sm:block">
        enter to send · shift + enter for a new line
      </div>
    </form>
  );
}
