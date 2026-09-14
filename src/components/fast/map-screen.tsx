"use client";

/**
 * FAST — SURROUNDINGS: JUST A MAP.
 * ================================
 * Nothing else. A real, normal Google Map (pan, pinch, zoom — exactly like
 * google.com/maps) wearing the house colours through a monochrome theme
 * filter. One tap flips it to RAW SAT. One tap pulls it back to the whole
 * country. No intel feeds, no hotspots, no blocks, no sync — the user drives
 * everything themselves with their own fingers.
 *
 * Layout: the map owns the ENTIRE screen on every device — phone, tablet,
 * desktop. Safe-area padded, 44px+ touch targets, reduced-motion respected.
 * No geolocation anywhere, ever.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Globe2, MapPin, Satellite, WifiOff } from "lucide-react";
import { ScreenShell } from "@/components/fast/motion";
import {
  MAP_OFFLINE_NOTE,
  MAP_PICK_COUNTRY,
  MAP_SUB,
  MAP_THEME_DARK,
  MAP_THEME_SAT,
  MAP_TITLE,
} from "@/lib/fast/copy";

// -------------------------------------------------------------------- consts

const SA_CENTER = { lat: -29.1, lng: 24.5 };
const SA_ZOOM = 5;

/** Custom Google Maps themes — the house palette, two moods. */
const MAP_FILTERS: Record<"dark" | "sat", string> = {
  // roads theme pressed into black/white/grey (classic embed dark-inversion)
  dark: "grayscale(1) invert(0.91) contrast(1.08) brightness(0.9)",
  // satellite left raw but moody
  sat: "grayscale(0.4) contrast(1.12) brightness(0.82)",
};

// --------------------------------------------------------------- component

export function MapScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [shownOpen, setShownOpen] = useState(open);
  const [theme, setTheme] = useState<"dark" | "sat">("dark");
  const [online, setOnline] = useState(true);

  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) setMounted(true);
  }

  // track connectivity so the dead-air state can show itself honestly
  useEffect(() => {
    if (!open || !mounted) return;
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, onClose]);

  /** One static embed — the user drives. Theme flips swap the map type. */
  const mapSrc = useMemo(() => {
    const t = theme === "sat" ? "k" : "m";
    return `https://maps.google.com/maps?ll=${SA_CENTER.lat},${SA_CENTER.lng}&q=${SA_CENTER.lat},${SA_CENTER.lng}&z=${SA_ZOOM}&t=${t}&hl=en&output=embed`;
  }, [theme]);

  const [mapKey, setMapKey] = useState(0);
  const resetView = useCallback(() => {
    // remount the iframe at the country view — the only "reset" a plain map needs
    setMapKey((k) => k + 1);
  }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black" role="dialog" aria-label="Surroundings map">
      <ScreenShell as="div" className="flex h-dvh flex-col">
        {/* ---------------------------------------------------------- header */}
        <header className="sticky top-0 z-20 shrink-0 border-b border-neutral-900 bg-black/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
            <button
              onClick={onClose}
              aria-label="Close map"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-neutral-400 outline-none transition-colors hover:bg-neutral-900 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
            >
              <ArrowLeft className="size-5" aria-hidden />
            </button>
            <div className="flex min-w-0 flex-col">
              <span className="gang-font text-2xl leading-none text-white">{MAP_TITLE}</span>
              <span className="truncate font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-neutral-500">
                {MAP_SUB}
              </span>
            </div>
          </div>
        </header>

        {/* ----------------------------------------------- the map — full bleed */}
        <section
          aria-label="Google map of South Africa"
          className="relative min-h-0 flex-1"
        >
          {online ? (
            <iframe
              key={`${mapSrc}#${mapKey}`}
              title="Google Maps — South Africa"
              src={mapSrc}
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
              className="absolute inset-0 size-full border-0"
              style={{ filter: MAP_FILTERS[theme] }}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black px-6 text-center">
              <WifiOff className="size-7 text-neutral-700" aria-hidden />
              <p className="text-sm font-bold text-neutral-400">{MAP_OFFLINE_NOTE}</p>
            </div>
          )}

          {/* theme flip — above the map chrome, thumb-reachable */}
          <div className="absolute right-3 top-3 flex flex-col gap-1.5">
            <button
              onClick={() => setTheme("dark")}
              aria-pressed={theme === "dark"}
              className={`flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] backdrop-blur-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 ${
                theme === "dark"
                  ? "border-white bg-black/85 text-white"
                  : "border-neutral-700 bg-black/70 text-neutral-400 hover:text-white"
              }`}
            >
              <Globe2 className="size-3.5" aria-hidden />
              {MAP_THEME_DARK}
            </button>
            <button
              onClick={() => setTheme("sat")}
              aria-pressed={theme === "sat"}
              className={`flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] backdrop-blur-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 ${
                theme === "sat"
                  ? "border-white bg-black/85 text-white"
                  : "border-neutral-700 bg-black/70 text-neutral-400 hover:text-white"
              }`}
            >
              <Satellite className="size-3.5" aria-hidden />
              {MAP_THEME_SAT}
            </button>
          </div>

          {/* country reset */}
          <div className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 flex flex-col gap-1.5">
            <button
              onClick={resetView}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-neutral-700 bg-black/80 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-300 backdrop-blur-sm outline-none transition-colors hover:border-neutral-400 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
            >
              <MapPin className="size-3.5" aria-hidden />
              {MAP_PICK_COUNTRY}
            </button>
          </div>
        </section>
      </ScreenShell>
    </div>,
    document.body
  );
}
