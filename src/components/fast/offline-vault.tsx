"use client";

/**
 * OFFLINE VAULT registration + install plumbing.
 * - Registers /sw.js once per page load (idempotent, silent on failure).
 * - Captures the browser's beforeinstallprompt so the profile sheet can
 *   offer a real one-tap "DOWNLOAD APP" install.
 */

import { useEffect } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<(available: boolean) => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    listeners.forEach((fn) => fn(true));
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    listeners.forEach((fn) => fn(false));
  });
}

/** true while the app is already running as an installed PWA */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function canInstall(): boolean {
  return deferredPrompt !== null;
}

/** Fire the native install flow. Resolves to the user's choice. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  await deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  if (choice.outcome === "accepted") deferredPrompt = null;
  return choice.outcome;
}

export function onInstallAvailability(fn: (available: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Mounted once from the root layout — never renders anything. */
export function OfflineVaultRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    };
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);
  return null;
}
