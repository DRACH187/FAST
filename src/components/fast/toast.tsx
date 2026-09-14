"use client";

/**
 * FAST — custom toast system.
 * Fully bespoke: module store + useSyncExternalStore + GSAP motion.
 * Monochrome only — white icon chip on near-black glass.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { Check, Info, X } from "lucide-react";

export type ToastKind = "success" | "error" | "info";

export type ToastItem = {
  id: number;
  kind: ToastKind;
  text: string;
  leaving: boolean;
};

const TIMEOUT = 3200;
const EXIT_MS = 220;

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function notify() {
  for (const l of listeners) l();
}

function remove(id: number) {
  items = items.filter((t) => t.id !== id);
  notify();
}

function markLeaving(id: number) {
  const item = items.find((t) => t.id === id);
  if (!item || item.leaving) return;
  items = items.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  notify();
  window.setTimeout(() => remove(id), EXIT_MS);
}

function push(kind: ToastKind, text: string) {
  const id = nextId++;
  if (items.length >= 4) markLeaving(items[0].id); // cap stack depth
  items = [...items, { id, kind, text, leaving: false }];
  notify();
  window.setTimeout(() => markLeaving(id), TIMEOUT);
}

export const toast = {
  success: (text: string) => push("success", text),
  error: (text: string) => push("error", text),
  info: (text: string) => push("info", text),
};

const ICONS: Record<ToastKind, typeof Check> = { success: Check, error: X, info: Info };

function ToastRow({ item }: { item: ToastItem }) {
  const ref = useRef<HTMLDivElement>(null);
  const Icon = ICONS[item.kind];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (item.leaving) {
      gsap.to(el, { y: -10, opacity: 0, scale: 0.98, duration: EXIT_MS / 1000, ease: "power2.in" });
    } else {
      gsap.fromTo(
        el,
        { y: -14, opacity: 0, scale: 0.97 },
        { y: 0, opacity: 1, scale: 1, duration: 0.38, ease: "power3.out" }
      );
    }
  }, [item.leaving]);

  return (
    <div
      ref={ref}
      role="status"
      className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-950/95 py-3 pl-3.5 pr-4 shadow-[0_10px_34px_rgba(0,0,0,0.65)] backdrop-blur-md will-change-transform"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-black">
        <Icon className="size-3.5" strokeWidth={2.5} aria-hidden />
      </span>
      <p className="text-xs font-medium text-neutral-100">{item.text}</p>
    </div>
  );
}

const EMPTY: ToastItem[] = [];

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): ToastItem[] {
  return items;
}

function getServerSnapshot(): ToastItem[] {
  return EMPTY;
}

export function FastToaster() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // the store only ever fills after hydration (user interactions), so a
  // portal render implies a mounted document — no extra ready state needed
  if (current.length === 0) return null;

  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[200] flex flex-col items-center gap-2 px-4"
    >
      {current.map((t) => (
        <ToastRow key={t.id} item={t} />
      ))}
    </div>,
    document.body
  );
}
