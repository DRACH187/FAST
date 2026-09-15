"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { toast } from "@/components/fast/toast";
import { useHouseLine } from "@/components/fast/motion";
import { ScreenShell, shakeElement } from "@/components/fast/motion";
import { GATE_BUSY, GATE_HINT, GATE_TITLE, pick } from "@/lib/fast/copy";

gsap.registerPlugin(useGSAP);

/**
 * Front door (Layer 3 slice — Tier B authentication, spec §5).
 * A high-entropy passphrase from the validated GATE_PASSCODE env — the old
 * public 3-digit code is retired. Constant-time verified server-side.
 * Bespoke masked input: show/hide toggle, Enter to submit, GSAP entrance
 * and shake-on-reject. Deliberately discreet: wordmark, one neutral line,
 * one field — nothing else.
 */
export function GateScreen({ onUnlock }: { onUnlock: (passcode: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inflight = useRef(false);
  const title = useHouseLine(GATE_TITLE);
  const hint = useHouseLine(GATE_HINT);
  const busyLine = useHouseLine(GATE_BUSY);

  // GSAP: field entrance
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
      if (!code) {
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
            className="flex w-full flex-col items-center gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(value);
            }}
          >
            <div className="relative w-full" data-cell>
              <input
                ref={fieldRef}
                type={reveal ? "text" : "password"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit(value);
                  }
                }}
                autoComplete="current-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={busy}
                aria-label="Access passphrase"
                className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-4 pr-14 text-center font-mono text-lg font-black tracking-[0.18em] text-neutral-100 outline-none transition-colors focus:border-neutral-300 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setReveal((r) => !r)}
                aria-label={reveal ? "Hide passphrase" : "Show passphrase"}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-2 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500 transition-colors hover:text-neutral-200"
              >
                {reveal ? "HIDE" : "SHOW"}
              </button>
            </div>
            <button
              type="submit"
              disabled={busy || value.length === 0}
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
