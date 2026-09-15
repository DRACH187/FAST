"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { toast } from "@/components/fast/toast";
import { useHouseLine, ScreenShell, shakeElement } from "@/components/fast/motion";
import { GATE_BUSY, GATE_HINT, GATE_TITLE, pick } from "@/lib/fast/copy";

gsap.registerPlugin(useGSAP);

/**
 * Front door — the house mark "187" (Layer 3 slice, spec §5).
 * ==========================================================
 * OWNER DECISION: the gate code is the three-digit mark 187. The gate is
 * friction + abuse control (server-side rate limits, escalating lockouts,
 * constant-time compare, 350ms delay) — not the root of message secrecy;
 * E2EE session keys and server attestations carry that.
 *
 * UX: ONE real <input> (mobile keypads, paste, autofill all keep working)
 * stretched invisibly over three visual cells that mirror the value. The
 * third digit auto-submits. GSAP entrance + shake-on-reject are kept.
 */
const CODE_LEN = 3;

export function GateScreen({ onUnlock }: { onUnlock: (passcode: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inflight = useRef(false);
  const title = useHouseLine(GATE_TITLE);
  const hint = useHouseLine(GATE_HINT);
  const busyLine = useHouseLine(GATE_BUSY);

  // GSAP: cell entrance
  useGSAP(
    () => {
      const cells = wrapRef.current?.querySelectorAll("[data-cell]");
      if (!cells || cells.length === 0) return;
      gsap.fromTo(
        cells,
        { opacity: 0, y: 18, scale: 0.92 },
        { opacity: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.08, delay: 0.15, ease: "power3.out" }
      );
    },
    { scope: wrapRef }
  );

  const submit = useCallback(
    async (code: string) => {
      if (inflight.current) return;
      if (code.length < CODE_LEN) {
        fieldRef.current?.focus();
        return;
      }
      inflight.current = true;
      setBusy(true);
      try {
        await onUnlock(code);
      } catch (err) {
        if (wrapRef.current) shakeElement(wrapRef.current);
        gsap.fromTo(
          wrapRef.current?.querySelectorAll("[data-cell]") ?? [],
          { borderColor: "#e5e5e5", color: "#fafafa" },
          { borderColor: "#262626", color: "#fafafa", duration: 0.7, ease: "power2.out" }
        );
        setValue("");
        fieldRef.current?.focus();
        toast.error(err instanceof Error ? err.message : "Access denied");
      } finally {
        setBusy(false);
        inflight.current = false;
      }
    },
    [onUnlock]
  );

  const handleInput = useCallback(
    (raw: string) => {
      const next = raw.replace(/\D/g, "").slice(0, CODE_LEN);
      setValue(next);
      if (next.length === CODE_LEN) void submit(next); // third digit = knock
    },
    [submit]
  );

  return (
    <ScreenShell as="main" className="fast-grain flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-xs flex-col items-center gap-10">
        {/* small wordmark — deliberately discreet */}
        <Image
          src="/fast-logo.png"
          alt="FAST GUNS"
          width={256}
          height={256}
          priority
          draggable={false}
          className="h-auto w-16 mix-blend-screen opacity-80"
        />

        <div ref={wrapRef} className="flex w-full flex-col items-center gap-8">
          <h1 className="gang-font text-3xl text-neutral-100">{title}</h1>

          <form
            className="flex w-full flex-col items-center gap-6"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(value);
            }}
          >
            {/* three cells + one invisible real input stretched over them */}
            <div className="relative w-full" data-cell>
              <div className="pointer-events-none flex items-center justify-center gap-3" aria-hidden>
                {Array.from({ length: CODE_LEN }).map((_, i) => {
                  const filled = i < value.length;
                  const active = i === value.length && !busy;
                  return (
                    <span
                      key={i}
                      className={`flex h-16 w-14 items-center justify-center rounded-xl border font-mono text-3xl font-black tabular-nums transition-colors duration-150 sm:h-[72px] sm:w-16 ${
                        filled
                          ? "border-neutral-300 bg-neutral-950 text-white"
                          : active
                            ? "border-neutral-400 bg-neutral-950 text-neutral-700"
                            : "border-neutral-800 bg-neutral-950 text-neutral-700"
                      }`}
                    >
                      {filled ? value[i] : "·"}
                    </span>
                  );
                })}
              </div>
              <input
                ref={fieldRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                value={value}
                onChange={(e) => handleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit(value);
                  }
                }}
                autoFocus
                disabled={busy}
                aria-label="Access code"
                className="absolute inset-0 h-full w-full cursor-pointer bg-transparent text-center font-mono text-3xl text-transparent caret-transparent outline-none disabled:cursor-default"
              />
            </div>
            <button
              type="submit"
              disabled={busy || value.length < CODE_LEN}
              data-cell
              className="w-full rounded-xl border border-neutral-700 bg-neutral-100 py-4 font-mono text-sm font-black uppercase tracking-[0.3em] text-black transition-all hover:bg-white active:scale-[0.98] disabled:opacity-40"
            >
              {busy ? "···" : "KOM IN"}
            </button>
          </form>
        </div>

        <div className="flex h-5 items-center font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-neutral-500" aria-live="polite">
          {busy ? (
            <span className="animate-fast-pulse uppercase">{busyLine}</span>
          ) : (
            <span className="uppercase">{hint}</span>
          )}
        </div>
      </div>
    </ScreenShell>
  );
}
