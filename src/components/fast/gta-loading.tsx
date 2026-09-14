"use client";

import { useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/**
 * GTA-style boot loading screen.
 * Two banner artworks, 6.0 seconds total (no more, no less):
 *   0.0s–3.0s  BANNER 1 (slow Ken Burns push-in)
 *   2.6s–3.4s  crossfade to BANNER 2 (continues push-in)
 *   5.45s–6.0s cinematic fade-out into the site
 * A thin progress hairline + percentage counter + rotating security tips run
 * underneath. Nothing is clickable — it is a fixed 6 second ritual.
 */

const TOTAL_MS = 6000;

const TIPS = [
  "Every message is sealed with a key that exists for that message only.",
  "Photos you take are never stored on any device — they burn after viewing.",
  "The server only ever touches ciphertext. Not even we can read your sessions.",
  "Your keys live in RAM and die the moment this tab closes.",
];

export function GtaLoading({ onComplete }: { onComplete: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const banner1 = useRef<HTMLDivElement>(null);
  const banner2 = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const pct = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLParagraphElement>(null);
  const done = useRef(false);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onComplete();
  }, [onComplete]);

  useGSAP(
    () => {
      const rootEl = root.current;
      if (!rootEl) return;
      const reduced =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const tl = gsap.timeline({ onComplete: finish });

      if (!reduced) {
        // banner 1 — quick reveal, then a slow cinematic push-in that keeps
        // running underneath the crossfade
        tl.fromTo(
          banner1.current,
          { opacity: 0, scale: 1.0 },
          { opacity: 1, duration: 0.55, ease: "power2.out" },
          0
        );
        tl.to(banner1.current, { scale: 1.09, duration: 5.45, ease: "none" }, 0.55);
        // crossfade to banner 2
        tl.fromTo(
          banner2.current,
          { opacity: 0, scale: 1.0 },
          { opacity: 1, duration: 0.8, ease: "power2.inOut" },
          2.6
        );
        tl.to(banner2.current, { scale: 1.09, duration: 3.4, ease: "none" }, 2.6);
        // cinematic exit at 5.45s — timeline ends at exactly 6.0s
        tl.to(rootEl, { opacity: 0, duration: 0.55, ease: "power2.in" }, 5.45);
      } else {
        // reduced motion: hard cuts, same 6s choreography
        tl.set(banner1.current, { opacity: 1 }, 0)
          .set(banner1.current, { opacity: 0 }, 3)
          .set(banner2.current, { opacity: 1 }, 3)
          .to(rootEl, { opacity: 0, duration: 0.3, ease: "none" }, 5.7);
      }

      // progress hairline + counter — 6s, linear
      const counter = { v: 0 };
      tl.to(
        bar.current,
        {
          scaleX: 1,
          duration: reduced ? 6 : 5.45,
          ease: reduced ? "none" : "power1.inOut",
          onUpdate: () => {
            if (pct.current) {
              const shown = Math.round(counter.v * 100);
              pct.current.textContent = `${shown}%`;
            }
          },
        },
        0
      );
      // counter tracks the same window as the bar
      gsap.to(counter, {
        v: 1,
        duration: reduced ? 6 : 5.45,
        ease: reduced ? "none" : "power1.inOut",
        onUpdate: () => {
          if (pct.current) pct.current.textContent = `${Math.round(counter.v * 100)}%`;
        },
      });
    },
    { scope: root }
  );

  // rotating tips — one every 2 seconds
  useEffect(() => {
    if (!tip.current) return;
    let i = 0;
    tip.current.textContent = TIPS[0];
    const id = window.setInterval(() => {
      i = (i + 1) % TIPS.length;
      const el = tip.current;
      if (!el) return;
      gsap.fromTo(
        el,
        { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.45, ease: "power2.out", onStart: () => (el.textContent = TIPS[i]) }
      );
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  // hard safety net: even if rAF is throttled, the ritual ends at 6s
  useEffect(() => {
    const id = window.setTimeout(finish, TOTAL_MS + 150);
    return () => window.clearTimeout(id);
  }, [finish]);

  return (
    <div
      ref={root}
      role="img"
      aria-label="FAST — booting secure environment"
      className="fixed inset-0 z-[95] select-none overflow-hidden bg-black"
    >
      {/* banner artworks */}
      <div ref={banner1} className="absolute inset-0 opacity-0 will-change-transform">
        <Image
          src="/banner1.jpg"
          alt="FAST — Westbury, City of Fast Guns 187"
          fill
          priority
          draggable={false}
          sizes="100vw"
          className="object-cover"
        />
      </div>
      <div ref={banner2} className="absolute inset-0 opacity-0 will-change-transform">
        <Image
          src="/banner2.jpg"
          alt="FAST — Eldorado Park"
          fill
          draggable={false}
          sizes="100vw"
          className="object-cover"
        />
      </div>

      {/* cinematic vignette + top/bottom scrims (pure greys) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,0.55) 82%, rgba(0,0,0,0.9) 100%)",
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/80 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/95 via-black/60 to-transparent" />

      {/* top chrome — logo left, wordmark right */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[max(0.9rem,env(safe-area-inset-top))] sm:px-6">
        <Image
          src="/fast-logo.png"
          alt="FAST logo"
          width={1254}
          height={1254}
          priority
          draggable={false}
          className="h-11 w-auto mix-blend-screen sm:h-14"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.35em] text-neutral-400">
          secure sessions
        </span>
      </div>

      {/* bottom chrome — GTA-style tip + big percentage + progress hairline */}
      <div className="absolute inset-x-0 bottom-0 px-4 pb-[max(1.4rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end justify-between gap-6">
            <p
              ref={tip}
              className="max-w-md text-[11px] leading-relaxed text-neutral-400 sm:text-xs"
              aria-live="polite"
            />
            <span
              ref={pct}
              className="shrink-0 font-mono text-4xl font-bold tabular-nums leading-none text-white sm:text-6xl"
            >
              0%
            </span>
          </div>
          <div className="mt-4 h-px w-full bg-neutral-800">
            <div ref={bar} className="h-px w-full origin-left bg-white" style={{ transform: "scaleX(0)" }} />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-neutral-600">
              loading environment
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-neutral-600">
              end-to-end encrypted
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
