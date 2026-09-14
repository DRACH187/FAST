"use client";

import { useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/**
 * Splash — the FAST logo and its maker credit. Nothing else.
 * Logo perfectly centered at a confident scale (clamp 190px→330px), a GSAP
 * blur/scale entrance, two hairline pulse rings, the maker line fading in
 * underneath, and a cinematic exit. No progress bars. Click / tap / Enter to
 * skip.
 */

const LOGO_CLAMP = "clamp(190px, 58vw, 330px)";

const CREDIT_LINE_1 = "MADE BY";
const CREDIT_LINE_2 = "DRACH — GUNS BO SKIET N SMOGGLE";

export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const logo = useRef<HTMLDivElement>(null);
  const credit = useRef<HTMLDivElement>(null);
  const ringA = useRef<HTMLDivElement>(null);
  const ringB = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    const rootEl = root.current;
    const logoEl = logo.current;
    if (!rootEl || !logoEl) {
      onComplete();
      return;
    }
    gsap.killTweensOf([logoEl, rootEl, credit.current, ringA.current, ringB.current]);
    gsap
      .timeline({ onComplete })
      .to([logoEl, credit.current], { scale: 1.06, opacity: 0, filter: "blur(10px)", duration: 0.5, ease: "power2.in", stagger: 0.04 }, 0)
      .to([ringA.current, ringB.current], { opacity: 0, duration: 0.3, ease: "power2.in" }, 0)
      .to(rootEl, { opacity: 0, duration: 0.42, ease: "power2.in" }, 0.1);
  }, [onComplete]);

  useGSAP(
    () => {
      if (!root.current || !logo.current) return;
      const reduced =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) return;

      const tl = gsap.timeline();
      tl.fromTo(
        logo.current,
        { opacity: 0, scale: 0.7, filter: "blur(16px)" },
        { opacity: 1, scale: 1, filter: "blur(0px)", duration: 1.15, ease: "expo.out" }
      );

      // maker credit — rises in under the logo once it settles
      tl.fromTo(
        credit.current,
        { opacity: 0, y: 14, letterSpacing: "0.55em" },
        { opacity: 1, y: 0, letterSpacing: "0.34em", duration: 0.9, ease: "power3.out" },
        1.05
      );

      // hairline pulse rings — twice, then rest
      gsap.fromTo(
        ringA.current,
        { scale: 0.55, opacity: 0.5 },
        { scale: 1.3, opacity: 0, duration: 1.6, ease: "power2.out", repeat: 1, delay: 0.55 }
      );
      gsap.fromTo(
        ringB.current,
        { scale: 0.55, opacity: 0.35 },
        { scale: 1.3, opacity: 0, duration: 1.6, ease: "power2.out", delay: 1.35 }
      );

      // breathing hold once the entrance settles
      gsap.to(logo.current, {
        scale: 1.035,
        duration: 1.7,
        delay: 1.2,
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut",
      });
    },
    { scope: root }
  );

  useEffect(() => {
    const hold = window.setTimeout(finish, 3400);
    return () => window.clearTimeout(hold);
  }, [finish]);

  return (
    <div
      ref={root}
      role="button"
      aria-label="FAST — loading"
      tabIndex={0}
      onClick={finish}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") finish();
      }}
      className="fixed inset-0 z-[100] cursor-pointer select-none bg-black outline-none"
    >
      {/* pulse rings — decorative only */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
        <div ref={ringA} className="absolute size-[46vmin] rounded-full border border-neutral-800 opacity-0" />
        <div ref={ringB} className="absolute size-[46vmin] rounded-full border border-neutral-900 opacity-0" />
      </div>

      {/* the logo — dead-center, credit beneath it */}
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center will-change-transform">
          <div ref={logo} className="will-change-transform">
            <Image
              src="/fast-logo.png"
              alt="FAST logo"
              width={1254}
              height={1254}
              priority
              draggable={false}
              className="h-auto mix-blend-screen"
              style={{ width: LOGO_CLAMP }}
              sizes={`${LOGO_CLAMP}`}
            />
          </div>
          <div ref={credit} className="mt-7 flex flex-col items-center gap-1.5 px-6 text-center opacity-0">
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
