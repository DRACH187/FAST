"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { REDUCED_MOTION } from "@/components/fast/motion";
import { SPLASH_CREDIT, SPLASH_SKIP, SPLASH_TAGLINE, SPLASH_TICKER } from "@/lib/fast/copy";

gsap.registerPlugin(useGSAP);

/**
 * Splash — the FAST GUNS front door, cinema cut.
 * Black letterbox frame, scanline grit, a ghost 187 stamp slamming behind
 * the logo, double muzzle-flash, the FAST.png logo SLAMMING dead-center
 * with a micro camera-shake, the blackletter wordmark + 187 mark stamping
 * in, the house war cry, and the maker credit. Film grain + vignette keep
 * it theatre. No progress bars — the block doesn't ask, it announces.
 * Click / tap / Enter to skip.
 *
 * OWNER ORDER: the picture show runs a full SEVEN seconds — act 1 slams
 * the brand in (0–2.5s), act 2 holds the frame like the stares before a
 * hit: slow push-in, rotating war cries, a second muzzle volley and
 * another pulse of rings. The skip stays — confidence, not a cage.
 */

const LOGO_CLAMP = "clamp(190px, min(58vw, 40vh), 360px)";
/** Act 2 rotation cadence + total picture-show length (owner order: 7s). */
const CRY_ROTATE_MS = 2200;
const CRY_ROTATE_START_MS = 3000;
const SPLASH_HOLD_MS = 7000;

const CREDIT_LINE_1 = "MADE BY";
const WORDMARK = "FAST GUNS";
const SYMBOL = "187";

export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const stack = useRef<HTMLDivElement>(null);
  const logo = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const stamp = useRef<HTMLDivElement>(null);
  const credit = useRef<HTMLDivElement>(null);
  const wordmark = useRef<HTMLDivElement>(null);
  const tagline = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const barTop = useRef<HTMLDivElement>(null);
  const barBottom = useRef<HTMLDivElement>(null);
  const vignette = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  // act 2: the war cry rotates every beat — one cry per look, never a repeat
  const [cryIdx, setCryIdx] = useState(0);
  const rotateIv = useRef<number | null>(null);

  useEffect(() => {
    const start = window.setTimeout(() => {
      rotateIv.current = window.setInterval(() => {
        setCryIdx((i) => (i + 1 + Math.floor(Math.random() * (SPLASH_TICKER.length - 1))) % SPLASH_TICKER.length);
      }, CRY_ROTATE_MS);
    }, CRY_ROTATE_START_MS);
    return () => {
      window.clearTimeout(start);
      if (rotateIv.current) window.clearInterval(rotateIv.current);
    };
  }, []);

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
        [stack.current, stamp.current],
        { scale: 1.06, opacity: 0, filter: "blur(12px)", duration: 0.5, ease: "power2.in", stagger: 0.04 },
        0
      )
      .to([barTop.current, barBottom.current], { scaleX: 0, duration: 0.35, ease: "power3.in" }, 0)
      .to([glow.current, vignette.current, hint.current], { opacity: 0, duration: 0.3, ease: "power1.in" }, 0)
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

      // ghost 187 stamp — slams in behind everything one beat before the logo
      gsap.fromTo(
        stamp.current,
        { opacity: 0, scale: 2.6, rotate: -6 },
        { opacity: 0.08, scale: 1, rotate: -3, duration: 0.5, ease: "power4.in" }
      );

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

      // double muzzle-flash — pop, pop, then flicker low
      gsap.fromTo(
        glow.current,
        { opacity: 0, scale: 0.4 },
        { opacity: 0.85, scale: 1, duration: 0.14, ease: "power2.out", delay: 0.5 }
      );
      gsap.fromTo(
        glow.current,
        { opacity: 0.15, scale: 0.8 },
        { opacity: 0.65, scale: 1.12, duration: 0.12, ease: "power2.out", delay: 0.68 }
      );
      gsap.to(glow.current, {
        opacity: 0.26,
        duration: 1.5,
        delay: 0.85,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });

      // wordmark stamps in with a punch — blackletter house face
      tl.fromTo(
        wordmark.current,
        { opacity: 0, scale: 1.6, letterSpacing: "0.5em", filter: "blur(6px)" },
        { opacity: 1, scale: 1, letterSpacing: "0.08em", filter: "blur(0px)", duration: 0.42, ease: "power4.out" },
        0.62
      );

      // 187 symbol + war cry
      gsap.fromTo(
        tagline.current,
        { opacity: 0, y: 10, letterSpacing: "0.7em" },
        { opacity: 1, y: 0, letterSpacing: "0.3em", duration: 0.7, ease: "power3.out", delay: 1.05 }
      );

      // maker credit — rises in last, the signature
      gsap.fromTo(
        credit.current,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.9, ease: "power3.out", delay: 1.45 }
      );

      // skip hint — the door is open, take it
      gsap.fromTo(
        hint.current,
        { opacity: 0 },
        { opacity: 0.6, duration: 0.6, ease: "power2.out", delay: 2.5 }
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

      // ------------------------------ ACT 2 — the hold (2.5s → 7s) ------
      // the whole stack creeps closer, like the block leaning in
      gsap.to(stack.current, {
        scale: 1.07,
        y: -6,
        duration: 4.4,
        delay: 2.4,
        ease: "sine.inOut",
      });

      // second muzzle volley mid-hold — the piece is still hot
      gsap.fromTo(
        glow.current,
        { opacity: 0.18, scale: 0.85 },
        { opacity: 0.7, scale: 1.1, duration: 0.12, ease: "power2.out", delay: 4.3 }
      );
      gsap.fromTo(
        glow.current,
        { opacity: 0.2, scale: 0.9 },
        { opacity: 0.55, scale: 1.08, duration: 0.12, ease: "power2.out", delay: 4.52 }
      );

      // another pair of shock rings late in the hold
      gsap.fromTo(
        root.current.querySelector("[data-ring-a]"),
        { scale: 0.55, opacity: 0.45 },
        { scale: 1.35, opacity: 0, duration: 1.8, ease: "power2.out", repeat: 1, delay: 3.3 }
      );
      gsap.fromTo(
        root.current.querySelector("[data-ring-b]"),
        { scale: 0.55, opacity: 0.3 },
        { scale: 1.35, opacity: 0, duration: 1.8, ease: "power2.out", delay: 4.7 }
      );

      // the ghost 187 stamp exhales — barely, once, like something alive
      gsap.to(stamp.current, {
        scale: 1.04,
        duration: 2.6,
        delay: 2.6,
        yoyo: true,
        repeat: 1,
        ease: "sine.inOut",
      });
    },
    { scope: root }
  );

  // war-cry swaps flicker the tagline like a struck neon sign
  useEffect(() => {
    if (cryIdx === 0) return;
    const el = tagline.current;
    if (!el || REDUCED_MOTION) return;
    gsap.fromTo(
      el,
      { opacity: 0, y: 6, filter: "blur(4px)" },
      { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.5, ease: "power2.out" }
    );
  }, [cryIdx]);

  useEffect(() => {
    const hold = window.setTimeout(finish, SPLASH_HOLD_MS);
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

      {/* ghost 187 stamp — the mark behind the mark */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
        <div
          ref={stamp}
          className="gang-font select-none text-[62vmin] leading-none text-white opacity-0 will-change-transform"
          style={{ textShadow: "0 0 80px rgba(255,255,255,0.08)" }}
        >
          {SYMBOL}
        </div>
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
        <div ref={stack} className="flex flex-col items-center will-change-transform">
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
            <h1 className="gang-font text-5xl leading-none text-white sm:text-6xl lg:text-7xl [text-shadow:0_0_30px_rgba(255,255,255,0.28)]">
              {WORDMARK}
            </h1>
            <span className="flex items-center gap-2.5 text-neutral-400" aria-label="187">
              <span className="h-px w-9 bg-neutral-700" aria-hidden />
              <span className="font-mono text-sm font-black tracking-[0.5em] text-neutral-200" style={{ paddingLeft: "0.5em" }}>
                {SYMBOL}
              </span>
              <span className="h-px w-9 bg-neutral-700" aria-hidden />
            </span>
          </div>
          <div ref={tagline} className="mt-3 px-6 text-center opacity-0">
            <span className="font-mono text-[10px] font-black uppercase text-neutral-400 sm:text-[11px]">
              {SPLASH_TAGLINE} · {SPLASH_TICKER[cryIdx]}
            </span>
          </div>
          <div ref={credit} className="mt-4 flex flex-col items-center gap-1.5 px-6 text-center opacity-0">
            <span className="font-mono text-[9px] font-bold uppercase text-neutral-500 sm:text-[10px]">{CREDIT_LINE_1}</span>
            <span className="gang-font text-xl text-neutral-100 sm:text-2xl">
              {SPLASH_CREDIT}
            </span>
          </div>
        </div>
      </div>

      {/* skip hint — bottom of the frame, above the letterbox bar */}
      <div
        ref={hint}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-[max(4.8vh,36px)] z-10 text-center opacity-0"
      >
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.4em] text-neutral-400">
          {SPLASH_SKIP}
        </span>
      </div>
    </div>
  );
}
