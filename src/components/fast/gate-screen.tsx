"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { toast } from "@/components/fast/toast";
import { REDUCED_MOTION, useHouseLine, ScreenShell, shakeElement } from "@/components/fast/motion";
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
 * Cinema cut (splash-screen language): ghost 187 stamp behind the frame,
 * scanline grit + vignette, muzzle glow behind the wordmark, pulse rings
 * breathing behind the code cells, letterbox-weight title that stamps in,
 * and code cells that POP as each digit lands. The third digit knocks —
 * auto-submit, no button needed (KOM IN stays for the patient).
 *
 * UX: ONE real <input> (mobile keypads, paste, autofill all keep working)
 * stretched invisibly over three visual cells that mirror the value.
 */
const CODE_LEN = 3;

export function GateScreen({ onUnlock }: { onUnlock: (passcode: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const cellsRef = useRef<HTMLDivElement | null>(null);
  const stampRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const brandRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const inflight = useRef(false);
  const title = useHouseLine(GATE_TITLE);
  const hint = useHouseLine(GATE_HINT);
  const busyLine = useHouseLine(GATE_BUSY);

  // ---------------------------------------------------------- cinema cut
  useGSAP(
    () => {
      if (!stageRef.current || REDUCED_MOTION) return;

      // ghost 187 stamp — the mark behind the mark
      gsap.fromTo(
        stampRef.current,
        { opacity: 0, scale: 2.4, rotate: -6 },
        { opacity: 0.07, scale: 1, rotate: -3, duration: 0.55, ease: "power4.in", delay: 0.1 }
      );

      // muzzle glow — pop, flicker low, then breathe forever
      gsap.fromTo(
        glowRef.current,
        { opacity: 0, scale: 0.5 },
        { opacity: 0.7, scale: 1, duration: 0.16, ease: "power2.out", delay: 0.34 }
      );
      gsap.to(glowRef.current, {
        opacity: 0.22,
        scale: 1.08,
        duration: 1.8,
        delay: 0.9,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });

      // logo slam with micro camera-shake
      const tl = gsap.timeline();
      tl.fromTo(
        brandRef.current,
        { opacity: 0, scale: 2.1, filter: "blur(14px)" },
        { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.5, ease: "power4.in", delay: 0.18 }
      );
      tl.to(brandRef.current, {
        keyframes: [
          { x: -6, y: 2, duration: 0.05 },
          { x: 5, y: -2, duration: 0.05 },
          { x: -3, y: 1, duration: 0.05 },
          { x: 0, y: 0, duration: 0.05 },
        ],
      });

      // title stamps in — letterSpacing squeeze, the house punch
      tl.fromTo(
        titleRef.current,
        { opacity: 0, scale: 1.5, letterSpacing: "0.45em", filter: "blur(5px)" },
        { opacity: 1, scale: 1, letterSpacing: "0.02em", filter: "blur(0px)", duration: 0.42, ease: "power4.out" },
        0.72
      );

      // pulse rings behind the cells — twice, then rest
      gsap.fromTo(
        stageRef.current.querySelector("[data-ring-a]"),
        { scale: 0.55, opacity: 0.45 },
        { scale: 1.25, opacity: 0, duration: 1.6, ease: "power2.out", repeat: 1, delay: 0.7 }
      );
      gsap.fromTo(
        stageRef.current.querySelector("[data-ring-b]"),
        { scale: 0.55, opacity: 0.3 },
        { scale: 1.25, opacity: 0, duration: 1.6, ease: "power2.out", delay: 1.5 }
      );

      // cells rise in after the title lands
      const cells = cellsRef.current?.querySelectorAll("[data-cell]") ?? [];
      gsap.fromTo(
        cells,
        { opacity: 0, y: 22, scale: 0.9 },
        { opacity: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.09, delay: 0.92, ease: "power3.out" }
      );
    },
    { scope: stageRef }
  );

  // digit pop — every keystroke lands with a bounce on the cell it filled
  useEffect(() => {
    if (REDUCED_MOTION || value.length === 0) return;
    const el = cellsRef.current?.querySelector(`[data-cell="${value.length - 1}"]`);
    if (el) gsap.fromTo(el, { scale: 1.13 }, { scale: 1, duration: 0.3, ease: "back.out(2.4)" });
  }, [value]);

  // active-cell underline breathes while waiting for the next digit
  useEffect(() => {
    if (REDUCED_MOTION) return;
    const bar = cellsRef.current?.querySelector("[data-caret]");
    if (bar) gsap.fromTo(bar, { opacity: 0.9 }, { opacity: 0.25, duration: 0.7, ease: "sine.inOut", yoyo: true, repeat: -1 });
    return () => {
      if (bar) gsap.killTweensOf(bar);
    };
  }, [value.length, busy]);

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
        if (stageRef.current) shakeElement(stageRef.current.querySelector("[data-cells]") as HTMLElement);
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
    <ScreenShell as="main" className="fast-grain relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6">
      {/* scanline grit — pure CSS, barely there */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          background:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 1px, transparent 1px, transparent 4px)",
        }}
      />
      {/* vignette — cinema edges */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.88) 100%)" }}
      />

      <div ref={stageRef} className="relative flex w-full max-w-xs flex-col items-center gap-9">
        {/* ghost 187 stamp — behind everything */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
          <div ref={stampRef} className="gang-font select-none text-[70vmin] leading-none text-white opacity-0 will-change-transform">
            187
          </div>
        </div>

        {/* pulse rings — behind the cells */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
          <div data-ring-a className="absolute mt-16 size-[64vmin] rounded-full border border-neutral-800 opacity-0" />
          <div data-ring-b className="absolute mt-16 size-[64vmin] rounded-full border border-neutral-900 opacity-0" />
        </div>

        {/* brand — slammed in with the house shake */}
        <div ref={brandRef} className="relative flex flex-col items-center gap-3 will-change-transform">
          <Image
            src="/fast-logo.png"
            alt="FAST GUNS"
            width={256}
            height={256}
            priority
            draggable={false}
            className="h-auto w-16 mix-blend-screen opacity-90"
          />
          {/* muzzle glow behind the mark */}
          <div
            ref={glowRef}
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 size-40 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0"
            style={{ background: "radial-gradient(circle, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.05) 42%, transparent 70%)" }}
          />
        </div>

        <div className="relative flex w-full flex-col items-center gap-8">
          <h1 ref={titleRef} className="gang-font text-3xl text-neutral-100 opacity-0">
            {title}
          </h1>

          <form
            className="flex w-full flex-col items-center gap-6"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(value);
            }}
          >
            {/* three premium cells + one invisible real input stretched over them */}
            <div ref={cellsRef} data-cells className="relative w-full" >
              <div className="pointer-events-none flex items-center justify-center gap-3.5" aria-hidden>
                {Array.from({ length: CODE_LEN }).map((_, i) => {
                  const filled = i < value.length;
                  const active = i === value.length && !busy;
                  return (
                    <span
                      key={i}
                      data-cell={i}
                      className={`relative flex h-20 w-[74px] flex-col items-center justify-center rounded-2xl border font-mono text-4xl font-black tabular-nums transition-all duration-200 sm:h-[88px] sm:w-20 ${
                        filled
                          ? "border-neutral-200 bg-neutral-900 text-white shadow-[0_0_28px_rgba(255,255,255,0.14)]"
                          : active
                            ? "border-neutral-400 bg-neutral-950 text-neutral-700"
                            : "border-neutral-800 bg-neutral-950 text-neutral-700"
                      }`}
                    >
                      {filled ? value[i] : "·"}
                      {active && (
                        <span
                          data-caret
                          className="absolute bottom-3 h-[3px] w-7 rounded-full bg-neutral-300"
                        />
                      )}
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
              className="w-full rounded-xl border border-neutral-700 bg-neutral-100 py-4 font-mono text-sm font-black uppercase tracking-[0.3em] text-black transition-all hover:bg-white active:scale-[0.98] disabled:opacity-40"
            >
              {busy ? "···" : "KOM IN"}
            </button>
          </form>
        </div>

        <div className="relative flex h-5 items-center font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-neutral-500" aria-live="polite">
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
