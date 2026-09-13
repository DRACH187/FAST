"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { SplashScreen } from "@/components/splash-screen";
import { TagEntry } from "@/components/tag-entry";
import { ChatApp } from "@/components/chat/chat-app";

const TAG_KEY = "fg26-tag";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getTagSnapshot(): string | null {
  return window.localStorage.getItem(TAG_KEY);
}

function getTagServerSnapshot(): string | null {
  return null;
}

export default function Page() {
  const [splashDone, setSplashDone] = useState(false);

  // Tag persisted in localStorage — re-renders on cross-tab storage events too
  const storedTag = useSyncExternalStore(
    subscribe,
    getTagSnapshot,
    getTagServerSnapshot
  );

  const enter = useCallback((t: string) => {
    try {
      window.localStorage.setItem(TAG_KEY, t);
    } catch {
      /* private mode — tag lives for this session only */
    }
    window.dispatchEvent(new Event("storage"));
  }, []);

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(TAG_KEY);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event("storage"));
  }, []);

  return (
    <div className="min-h-dvh bg-[#070707] text-neutral-100">
      {/* Splash — logo only, overlays everything while the chat preloads */}
      {!splashDone && <SplashScreen onFinish={() => setSplashDone(true)} />}

      {storedTag ? (
        <ChatApp user={storedTag} onResetTag={reset} />
      ) : (
        <TagEntry onEnter={enter} />
      )}

      {/* film grain over everything */}
      <div className="grain" aria-hidden="true" />
    </div>
  );
}
