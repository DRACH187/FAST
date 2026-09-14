"use client";

import { useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/**
 * Splash — the FAST GUNS front door.
 * Black letterbox frame, a muzzle-flash glow, the logo SLAMMING dead-center
 * (clamp 190px→330px) with a micro camera-shake, the wordmark + 187 mark
 * stamping in underneath, the house tagline, and the maker credit. Film
 * grain + vignette keep it cinema. No progress bars — the block doesn't ask,
 * it announces. Click / tap / Enter to skip.
 */

const LOGO_CLAMP = "clamp(190px, 58vw, 330px)";

const CREDIT_LINE_1 = "MADE BY";
const CREDIT_LINE_2 = "DRACH — GUNS BO SKIET N SMOGGLE";
const WORDMARK = "FAST GUNS";
const SYMBOL = "187";
const TAGLINE = "GEEN SAGTES HIER";

export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const logo = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const credit = useRef<HTMLDivElement>(null);
  const wordmark = useRef<HTMLDivElement>(null);
  const tagline = useRef<HTMLDivElement>(null);
  const barTop = useRef<HTMLDivElement>(null);
  const barBottom = useRef<HTMLDivElement>(null);
  const vignette = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    const rootEl = root.current;
    if (!rootEl) {
      onComplete();
      return;
    }
    gsap.killTweensOf(rootEl.querySelectorAll("*"));
    gsap
      .timeline({ onComplete })
      .to(
        [logo.current, wordmark.current, tagline.current, credit.current],
        { scale: 1.06, opacity: 0, filter: "blur(12px)", duration: 0.5, ease: "power2.in", stagger: 0.04 },
        0
      )
      .to([barTop.current, barBottom.current], { scaleX: 0, duration: 0.35, ease: "power3.in" }, 0)
      .to([glow.current, vignette.current], { opacity: 0, duration: 0.3, ease: "power1.in" }, 0)
      .to(rootEl, { opacity: 0, duration: 0.42, ease: "power2.in" }, 0.12);
  }, [onComplete]);

  useGSAP(
    () => {
      if (!root.current || !logo.current) return;
      const reduced =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) return;

      // letterbox bars snap in
      gsap.fromTo(barTop.current, { yPercent: -100 }, { yPercent: 0, duration: 0.45, ease: "power4.out" });
      gsap.fromTo(barBottom.current, { yPercent: 100 }, { yPercent: 0, duration: 0.45, ease: "power4.out" });

      // vignette breathes open
      gsap.fromTo(vignette.current, { opacity: 0 }, { opacity: 1, duration: 1.2, ease: "power2.out" });

      // the slam — logo drops in hard with overshoot, then a 2-frame shake
      const tl = gsap.timeline();
      tl.fromTo(
        logo.current,
        { opacity: 0, scale: 2.4, filter: "blur(18px)" },
        { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.55, ease: "power4.in" }
      );
      tl.to(logo.current, {
        keyframes: [
          { x: -7, y: 3, duration: 0.05 },
          { x: 6, y: -2, duration: 0.05 },
          { x: -4, y: 1, duration: 0.05 },
          { x: 2, y: -1, duration: 0.05 },
          { x: 0, y: 0, duration: 0.05 },
        ],
      });

      // muzzle-flash glow — pops with the slam, then flickers low
      gsap.fromTo(
        glow.current,
        { opacity: 0, scale: 0.4 },
        { opacity: 0.85, scale: 1, duration: 0.18, ease: "power2.out", delay: 0.5 }
      );
      gsap.to(glow.current, {
        opacity: 0.28,
        duration: 1.6,
        delay: 0.75,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });

      // wordmark stamps in with a punch
      tl.fromTo(
        wordmark.current,
        { opacity: 0, scale: 1.6, letterSpacing: "1.1em", filter: "blur(6px)" },
        { opacity: 1, scale: 1, letterSpacing: "0.42em", filter: "blur(0px)", duration: 0.42, ease: "power4.out" },
        0.62
      );

      // 187 symbol + tagline
      gsap.fromTo(
        tagline.current,
        { opacity: 0, y: 10, letterSpacing: "0.7em" },
        { opacity: 1, y: 0, letterSpacing: "0.44em", duration: 0.7, ease: "power3.out", delay: 1.05 }
      );

      // maker credit — rises in last, the signature
      gsap.fromTo(
        credit.current,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.9, ease: "power3.out", delay: 1.45 }
      );

      // hairline pulse rings — twice, then rest
      gsap.fromTo(
        root.current.querySelector("[data-ring-a]"),
        { scale: 0.55, opacity: 0.5 },
        { scale: 1.3, opacity: 0, duration: 1.6, ease: "power2.out", repeat: 1, delay: 0.7 }
      );
      gsap.fromTo(
        root.current.querySelector("[data-ring-b]"),
        { scale: 0.55, opacity: 0.35 },
        { scale: 1.3, opacity: 0, duration: 1.6, ease: "power2.out", delay: 1.5 }
      );

      // breathing hold once the entrance settles
      gsap.to(logo.current, {
        scale: 1.035,
        duration: 1.7,
        delay: 1.35,
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut",
      });
    },
    { scope: root }
  );

  useEffect(() => {
    const hold = window.setTimeout(finish, 3600);
    return () => window.clearTimeout(hold);
  }, [finish]);

  return (
    <div
      ref={root}
      role="button"
      aria-label="FAST GUNS — loading"
      tabIndex={0}
      onClick={finish}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") finish();
      }}
      className="fast-grain fixed inset-0 z-[100] cursor-pointer select-none overflow-hidden bg-black outline-none"
    >
      {/* vignette — cinema edges */}
      <div
        ref={vignette}
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0"
        style={{ background: "radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,0.9) 100%)" }}
      />

      {/* muzzle-flash glow behind the logo */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
        <div
          ref={glow}
          className="size-[72vmin] rounded-full opacity-0 will-change-transform"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.05) 38%, transparent 68%)" }}
        />
      </div>

      {/* pulse rings — decorative only */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
        <div data-ring-a className="absolute size-[46vmin] rounded-full border border-neutral-800 opacity-0" />
        <div data-ring-b className="absolute size-[46vmin] rounded-full border border-neutral-900 opacity-0" />
      </div>

      {/* letterbox bars */}
      <div ref={barTop} aria-hidden className="absolute inset-x-0 top-0 z-10 h-[max(4vh,28px)] bg-black" style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.07)" }} />
      <div ref={barBottom} aria-hidden className="absolute inset-x-0 bottom-0 z-10 h-[max(4vh,28px)] bg-black" style={{ boxShadow: "0 -1px 0 rgba(255,255,255,0.07)" }} />

      {/* the logo — dead-center, brand stacked beneath it */}
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center will-change-transform">
          <div ref={logo} className="will-change-transform">
            <Image
              src="/fast-logo.png"
              alt="FAST GUNS logo"
              width={1254}
              height={1254}
              priority
              draggable={false}
              className="h-auto mix-blend-screen"
              style={{ width: LOGO_CLAMP }}
              sizes={`${LOGO_CLAMP}`}
            />
          </div>
          <div ref={wordmark} className="mt-5 flex flex-col items-center gap-2.5 px-6 text-center opacity-0">
            <h1 className="text-2xl font-black uppercase text-white sm:text-3xl" style={{ letterSpacing: "0.42em", paddingLeft: "0.42em", textShadow: "0 0 26px rgba(255,255,255,0.22)" }}>
              {WORDMARK}
            </h1>
            <span className="flex items-center gap-2.5 text-neutral-400" aria-label="187">
              <span className="h-px w-9 bg-neutral-700" aria-hidden />
              <span className="font-mono text-xs font-bold tracking-[0.5em] text-neutral-200" style={{ paddingLeft: "0.5em" }}>
                {SYMBOL}
              </span>
              <span className="h-px w-9 bg-neutral-700" aria-hidden />
            </span>
          </div>
          <div ref={tagline} className="mt-3 px-6 text-center opacity-0">
            <span className="font-mono text-[9px] uppercase tracking-[0.44em] text-neutral-500 sm:text-[10px]" style={{ paddingLeft: "0.44em" }}>
              {TAGLINE}
            </span>
          </div>
          <div ref={credit} className="mt-4 flex flex-col items-center gap-1.5 px-6 text-center opacity-0">
            <span className="font-mono text-[9px] uppercase text-neutral-500 sm:text-[10px]">{CREDIT_LINE_1}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.34em] text-neutral-300 sm:text-xs">
              {CREDIT_LINE_2}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
