"use client";

/**
 * WAR ROOM — "DIE BOETIE", the house oracle.
 * Talks to POST /api/ai (Gemini, free tier, key stays server-side).
 * Persona: FAST GUNS-loyal, AMERICANS-hyping, VARADOS/BRITISH-roasting
 * street talker. Conversation lives in RAM only — reload and it's dust.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { KeyRound, Send, Swords } from "lucide-react";
import { REDUCED_MOTION, ScreenShell } from "@/components/fast/motion";
import { FastButton, FastInput } from "@/components/fast/primitives";
import { toast } from "@/components/fast/toast";
import {
  AI_BLOCKED,
  AI_FAILED,
  AI_GREETING,
  AI_NO_KEY,
  AI_PLACEHOLDER,
  AI_QUICK_CHIPS,
  AI_SUB,
  AI_THINKING,
  AI_TITLE,
  pick,
} from "@/lib/fast/copy";

gsap.registerPlugin(useGSAP);

type Turn = { role: "user" | "assistant"; content: string };

export function IntelScreen({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [shownOpen, setShownOpen] = useState(open);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [noKey, setNoKey] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) setMounted(true);
  }

  // first paint of the board gets the greeting
  useEffect(() => {
    if (mounted && turns.length === 0) {
      setTurns([{ role: "assistant", content: pick(AI_GREETING) }]);
    }
  }, [mounted, turns.length]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, onClose]);

  // keep the newest turn on screen
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  useGSAP(
    () => {
      if (REDUCED_MOTION || !listRef.current) return;
      const rows = listRef.current.querySelectorAll("[data-turn]:last-child");
      gsap.fromTo(
        rows,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.35, ease: "power3.out", overwrite: "auto" }
      );
    },
    { scope: listRef, dependencies: [turns.length, busy] }
  );

  const send = useCallback(
    async (text: string) => {
      const content = text.trim().slice(0, 1200);
      if (!content || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      const history = [...turns, { role: "user" as const, content }];
      setTurns(history);
      setDraft("");
      try {
        // Gemini requires the wire history to start on a user turn — the
        // local greeting (assistant) never rides along.
        const wire = (history[0]?.role === "assistant" ? history.slice(1) : history).slice(-14);
        const res = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: wire }),
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          reply?: string;
          reason?: string;
        };
        if (res.ok && data.ok && data.reply) {
          setTurns((t) => [...t, { role: "assistant", content: data.reply as string }]);
          setNoKey(false);
        } else if (data.reason === "no-key") {
          setNoKey(true);
          setTurns((t) => [...t.slice(0, -1)]);
        } else if (data.reason === "blocked") {
          toast.error(pick(AI_BLOCKED));
          setTurns((t) => [...t.slice(0, -1)]);
        } else {
          toast.error(pick(AI_FAILED));
          setTurns((t) => [...t.slice(0, -1)]);
        }
      } catch {
        toast.error(pick(AI_FAILED));
        setTurns((t) => [...t.slice(0, -1)]);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [turns]
  );

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[92] bg-black" role="dialog" aria-label="War room oracle">
      <ScreenShell as="div" className="flex h-dvh flex-col">
        <header className="sticky top-0 z-20 border-b border-neutral-900 bg-black/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="flex h-14 items-center gap-2 px-3">
            <button
              onClick={onClose}
              aria-label="Close war room"
              className="flex size-11 items-center justify-center rounded-xl text-neutral-400 outline-none transition-colors hover:bg-neutral-900 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
            >
              <Swords className="size-5" aria-hidden />
            </button>
            <div className="flex flex-col">
              <span className="gang-font text-2xl leading-none text-white">{AI_TITLE}</span>
              <span className="font-mono text-[8px] font-bold uppercase tracking-[0.22em] text-neutral-500">
                {pick(AI_SUB)}
              </span>
            </div>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 pb-6 pt-3">
          {noKey && (
            <div className="mx-auto mt-4 flex max-w-sm flex-col gap-3 rounded-2xl border border-neutral-800 bg-neutral-950 p-5 text-center sm:max-w-xl">
              <KeyRound className="mx-auto size-6 text-neutral-500" aria-hidden />
              <p className="text-sm font-bold leading-relaxed text-neutral-200">{pick(AI_NO_KEY)}</p>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-600">
                Vercel → Settings → Environment Variables → GEMINI_API_KEY
              </p>
            </div>
          )}

          <div ref={listRef} className="mx-auto flex max-w-md flex-col gap-3 sm:max-w-xl">
            {turns.map((t, i) => (
              <div
                key={i}
                data-turn
                className={`flex flex-col gap-1 ${t.role === "user" ? "items-end" : "items-start"}`}
              >
                <span className="px-1 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-neutral-600">
                  {t.role === "user" ? "JY" : "DIE BOETIE"}
                </span>
                <div
                  className={`max-w-[85%] rounded-2xl border px-4 py-3 ${
                    t.role === "user"
                      ? "rounded-br-sm border-neutral-800 bg-neutral-900 text-[15px] font-semibold leading-relaxed text-neutral-100"
                      : "rounded-bl-sm border-neutral-800 bg-neutral-950 text-[15px] font-semibold leading-relaxed text-neutral-200"
                  }`}
                >
                  {t.content}
                </div>
              </div>
            ))}
            {busy && (
              <div data-turn className="flex items-start flex-col gap-1">
                <span className="px-1 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-neutral-600">
                  DIE BOETIE
                </span>
                <div className="animate-fast-pulse rounded-2xl rounded-bl-sm border border-neutral-800 bg-neutral-950 px-4 py-3 text-[15px] font-semibold text-neutral-400">
                  {pick(AI_THINKING)}
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className="sticky bottom-0 border-t border-neutral-900 bg-black/85 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-md">
          <div className="mx-auto flex max-w-md flex-col gap-2 sm:max-w-xl">
            <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-0.5">
              {AI_QUICK_CHIPS.map((chip) => (
                <button
                  key={chip}
                  onClick={() => void send(chip)}
                  disabled={busy}
                  className="flex min-h-[44px] shrink-0 items-center rounded-full border border-neutral-800 bg-neutral-950 px-3.5 text-xs font-bold text-neutral-200 outline-none transition-colors hover:border-neutral-500 disabled:opacity-40"
                >
                  {chip}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <FastInput
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 1200))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
                placeholder={pick(AI_PLACEHOLDER)}
                aria-label="Ask the oracle"
                autoComplete="off"
                enterKeyHint="send"
                className="flex-1"
              />
              <FastButton
                size="icon"
                aria-label="Fire the question"
                disabled={busy || draft.trim().length === 0}
                onClick={() => void send(draft)}
                className="shrink-0"
              >
                <Send className="size-5" aria-hidden />
              </FastButton>
            </div>
          </div>
        </footer>
      </ScreenShell>
    </div>,
    document.body
  );
}
