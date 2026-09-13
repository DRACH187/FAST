"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Splash screen — the FAST.png logo and nothing else.
 * Big, no background (black blends away via mix-blend-screen).
 * Auto fades out; tap to skip.
 */
export function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t1 = window.setTimeout(() => setLeaving(true), 2300);
    const t2 = window.setTimeout(onFinish, 3050);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [onFinish]);

  return (
    <div
      aria-hidden="true"
      onClick={onFinish}
      role="presentation"
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center bg-black transition-opacity duration-700 ease-out",
        leaving ? "pointer-events-none opacity-0" : "opacity-100"
      )}
    >
      {/* The logo — nothing else */}
      <img
        src="/fast-logo.png"
        alt="Fast Guns 26"
        draggable={false}
        className="splash-logo pointer-events-none h-auto w-[min(90vw,680px)] max-h-[88vh] select-none object-contain mix-blend-screen"
      />
    </div>
  );
}
