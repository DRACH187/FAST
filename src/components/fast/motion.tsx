"use client";

/**
 * FAST — motion primitives (GSAP).
 * ScreenShell drives screen-level entrances; every bespoke component can
 * scope its own useGSAP animations. Reduced-motion is respected globally.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { pick } from "@/lib/fast/copy";

gsap.registerPlugin(useGSAP);

/**
 * House-voice line for screens that render on the SERVER (splash, gate,
 * callsign, hub): deterministic first paint so SSR and hydration agree —
 * then a fresh random flavour lands right after mount. Client-only screens
 * can keep useState(() => pick(...)) since they never server-render.
 */
export function useHouseLine<T>(list: readonly T[]): T {
  const [line, setLine] = useState<T>(list[0]);
  useEffect(() => {
    // deferred one tick: post-hydration flavour swap without a cascading
    // render inside the effect body itself
    const t = window.setTimeout(() => {
      setLine((prev) => {
        let next = pick(list);
        let guard = 0;
        while (next === prev && guard < 5) {
          next = pick(list);
          guard += 1;
        }
        return next;
      });
    }, 0);
    return () => window.clearTimeout(t);
  }, []);
  return line;
}

export const REDUCED_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type ShellTag = "div" | "main" | "section" | "header" | "footer" | "aside";

/**
 * Full-screen shell with a GSAP fade+rise entrance.
 * Replaces CSS animation classes — all screen motion goes through GSAP.
 */
export function ScreenShell({
  as = "div",
  className = "",
  children,
  anim = true,
}: {
  as?: ShellTag;
  className?: string;
  children: ReactNode;
  anim?: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useGSAP(
    () => {
      if (!anim || REDUCED_MOTION || !ref.current) return;
      gsap.fromTo(
        ref.current,
        { opacity: 0, y: 10 },
        {
          opacity: 1,
          y: 0,
          duration: 0.5,
          ease: "power3.out",
          // CRITICAL: strip the inline transform when done. A leftover
          // transform (even identity) turns the shell into the containing
          // block for position:fixed descendants — which pins the bottom
          // nav to the end of the document instead of the viewport.
          clearProps: "transform",
        }
      );
    },
    { scope: ref }
  );

  const Tag = as as "div";
  return (
    <Tag ref={ref as React.RefObject<HTMLDivElement>} className={className}>
      {children}
    </Tag>
  );
}

/** Stagger every [data-anim] descendant into view. */
export function staggerAnimChildren(scope: HTMLElement | null, opts?: { delay?: number }) {
  if (REDUCED_MOTION || !scope) return;
  const targets = scope.querySelectorAll("[data-anim]");
  if (targets.length === 0) return;
  gsap.fromTo(
    targets,
    { opacity: 0, y: 16 },
    {
      opacity: 1,
      y: 0,
      duration: 0.55,
      stagger: 0.07,
      delay: opts?.delay ?? 0.05,
      ease: "power3.out",
      overwrite: "auto",
      // never leave residual transforms behind (breaks position:fixed)
      clearProps: "transform",
    }
  );
}

/** Shake + flash feedback (wrong passcode, invalid input). */
export function shakeElement(el: HTMLElement) {
  if (REDUCED_MOTION) return;
  gsap.fromTo(
    el,
    { x: 0 },
    { keyframes: { x: [-9, 7, -5, 3, 0] }, duration: 0.42, ease: "power2.out", overwrite: "auto" }
  );
}

/** Soft press-down used on bespoke buttons/cards. */
export function pressFeedback(el: HTMLElement) {
  if (REDUCED_MOTION) return;
  gsap.fromTo(el, { scale: 1 }, { scale: 0.97, duration: 0.09, yoyo: true, repeat: 1, ease: "power2.out", overwrite: "auto" });
}
