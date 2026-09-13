"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

/**
 * Splash — the FAST logo and nothing else.
 * No wordmark, no spinner, no copy. It breathes in, holds, fades.
 */
export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [exiting, setExiting] = useState(false);
  const done = useRef(false);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    setExiting(true);
    window.setTimeout(onComplete, 600);
  }, [onComplete]);

  useEffect(() => {
    const hold = window.setTimeout(finish, 2400);
    return () => window.clearTimeout(hold);
  }, [finish]);

  return (
    <div
      role="button"
      aria-label="FAST — loading"
      tabIndex={0}
      onClick={finish}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") finish();
      }}
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black cursor-pointer select-none outline-none ${
        exiting ? "splash-exit" : ""
      }`}
    >
      <div className="animate-fast-logo-in">
        <Image
          src="/fast-logo.png"
          alt="FAST logo"
          width={640}
          height={640}
          priority
          draggable={false}
          className="w-56 sm:w-72 h-auto mix-blend-screen"
        />
      </div>
    </div>
  );
}
