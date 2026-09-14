"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { toast } from "@/components/fast/toast";
import { ScreenShell, shakeElement } from "@/components/fast/motion";

gsap.registerPlugin(useGSAP);

const LEN = 3;

/**
 * Front door (Layer 3 slice). Constant-time verified access code.
 * Fully bespoke OTP cells (no stock components): auto-advance, backspace
 * navigation, arrow navigation, paste support, GSAP stagger entrance and
 * shake-on-reject. Deliberately discreet: a small wordmark, one neutral
 * line of copy, three cells — nothing else.
 */
export function GateScreen({ onUnlock }: { onUnlock: (passcode: string) => Promise<void> }) {
  const [digits, setDigits] = useState<string[]>(Array(LEN).fill(""));
  const [busy, setBusy] = useState(false);
  const digitsRef = useRef<string[]>(Array(LEN).fill(""));
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const cellsWrap = useRef<HTMLDivElement>(null);
  const inflight = useRef(false);

  // GSAP: staggered cell entrance
  useGSAP(
    () => {
      const cells = cellsWrap.current?.querySelectorAll("[data-cell]");
      if (!cells || cells.length === 0) return;
      gsap.fromTo(
        cells,
        { opacity: 0, y: 18, scale: 0.92 },
        { opacity: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.08, delay: 0.15, ease: "power3.out" }
      );
    },
    { scope: cellsWrap }
  );

  const submit = useCallback(
    async (code: string) => {
      if (inflight.current) return;
      inflight.current = true;
      setBusy(true);
      try {
        await onUnlock(code);
      } catch (err) {
        if (cellsWrap.current) shakeElement(cellsWrap.current);
        gsap.fromTo(
          cellsWrap.current?.querySelectorAll("[data-cell]") ?? [],
          { borderColor: "#e5e5e5", color: "#fafafa" },
          { borderColor: "#262626", color: "#fafafa", duration: 0.7, ease: "power2.out" }
        );
        setDigits(Array(LEN).fill(""));
        digitsRef.current = Array(LEN).fill("");
        inputs.current[0]?.focus();
        toast.error(err instanceof Error ? err.message : "Access denied");
      } finally {
        setBusy(false);
        inflight.current = false;
      }
    },
    [onUnlock]
  );

  const setDigit = useCallback(
    (index: number, raw: string) => {
      const d = raw.replace(/\D/g, "").slice(-1);
      const next = [...digitsRef.current];
      next[index] = d;
      digitsRef.current = next;
      setDigits(next);
      if (d && index < LEN - 1) inputs.current[index + 1]?.focus();
      if (d && !next.includes("")) void submit(next.join(""));
    },
    [submit]
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && !digitsRef.current[index] && index > 0) {
        e.preventDefault();
        const next = [...digitsRef.current];
        next[index - 1] = "";
        digitsRef.current = next;
        setDigits(next);
        inputs.current[index - 1]?.focus();
      } else if (e.key === "ArrowLeft" && index > 0) {
        e.preventDefault();
        inputs.current[index - 1]?.focus();
      } else if (e.key === "ArrowRight" && index < LEN - 1) {
        e.preventDefault();
        inputs.current[index + 1]?.focus();
      }
    },
    []
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LEN);
      if (!pasted) return;
      e.preventDefault();
      const next = Array(LEN).fill("");
      pasted.split("").forEach((d, i) => (next[i] = d));
      digitsRef.current = next;
      setDigits(next);
      if (!next.includes("")) void submit(next.join(""));
    },
    [submit]
  );

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

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
          className="h-auto w-12 mix-blend-screen opacity-70"
        />

        <div ref={cellsWrap} className="flex flex-col items-center gap-7">
          <h1 className="font-mono text-[11px] uppercase tracking-[0.42em] text-neutral-500">
            Enter access code
          </h1>

          <div className="flex items-center gap-3 sm:gap-4" role="group" aria-label="Access code input">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                data-cell
                value={d}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onPaste={i === 0 ? handlePaste : undefined}
                inputMode="numeric"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                maxLength={1}
                disabled={busy}
                aria-label={`Digit ${i + 1} of ${LEN}`}
                className="size-14 rounded-xl border border-neutral-800 bg-neutral-950 text-center font-mono text-2xl text-neutral-100 caret-transparent outline-none transition-colors focus:border-neutral-300 disabled:opacity-50 sm:size-16"
              />
            ))}
          </div>
        </div>

        <div className="flex h-4 items-center font-mono text-[10px] tracking-[0.3em] text-neutral-700" aria-live="polite">
          {busy ? (
            <span className="animate-fast-pulse uppercase">Verifying</span>
          ) : (
            <span className="uppercase">{LEN} digits</span>
          )}
        </div>
      </div>
    </ScreenShell>
  );
}
