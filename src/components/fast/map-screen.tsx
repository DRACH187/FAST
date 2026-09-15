"use client";

/**
 * FAST — SURROUNDINGS: THE HOUSE MAP (v2).
 * ========================================
 * A real, normal Google Map (pan, pinch, zoom — exactly like google.com/maps)
 * wearing the house colours through a monochrome theme filter — now wrapped
 * in the brand: the FAST GUNS logo rides the title bar AND the map itself as
 * a collapsible territory card with rotating house hype. Three moods (DARK
 * STREETS / RAW SAT / BLOOD NIGHT), one-tap city jumps, zoom, country reset.
 *
 * The user drives everything with their own fingers — no geolocation, no
 * tracking, no intel feeds. Ever.
 *
 * Mobile: every control ≥44px, thumb-reachable clusters, safe-area padded,
 * bottom controls clear the floating dock (--fast-dock-clear). Reduced-motion
 * respected.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  Flame,
  Globe2,
  MapPin,
  Minus,
  Plus,
  Satellite,
  WifiOff,
} from "lucide-react";
import { ScreenShell } from "@/components/fast/motion";
import {
  FAST_HYPE,
  MAP_CITIES,
  MAP_JUMP_LABEL,
  MAP_OFFLINE_NOTE,
  MAP_PICK_COUNTRY,
  MAP_PROMO_TITLE,
  MAP_SUB,
  MAP_TERRITORY_TAG,
  MAP_THEME_BLOOD,
  MAP_THEME_DARK,
  MAP_THEME_SAT,
  MAP_TITLE,
  MAP_ZOOM_IN,
  MAP_ZOOM_OUT,
  pick,
  pickDiff,
} from "@/lib/fast/copy";

// -------------------------------------------------------------------- consts

const SA_CENTER = { lat: -29.1, lng: 24.5 };
const SA_ZOOM = 5;
const ZOOM_MIN = 4;
const ZOOM_MAX = 17;
const HYPE_MS = 9000;

/** Custom Google Maps themes — the house palette, three moods. */
const MAP_FILTERS = {
  // roads theme pressed into black/white/grey (classic embed dark-inversion)
  dark: "grayscale(1) invert(0.91) contrast(1.08) brightness(0.9)",
  // satellite left raw but moody
  sat: "grayscale(0.4) contrast(1.12) brightness(0.82)",
  // blood night — the country drowned in the house colour
  blood: "grayscale(1) invert(0.92) sepia(1) hue-rotate(-45deg) saturate(4.5) contrast(1.06) brightness(0.72)",
} as const;

type Mood = keyof typeof MAP_FILTERS;

const MOOD_LABEL: Record<Mood, string> = {
  dark: MAP_THEME_DARK,
  sat: MAP_THEME_SAT,
  blood: MAP_THEME_BLOOD,
};
const MOOD_ICON = { dark: Globe2, sat: Satellite, blood: Flame } as const;

type View = { lat: number; lng: number; zoom: number };

/** Shared chip skin — city jumps + country reset. */
const CHIP_CLS =
  "flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-neutral-700 bg-black/80 px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-300 backdrop-blur-sm outline-none transition-colors hover:border-neutral-400 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500";

// --------------------------------------------------------------- component

export function MapScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
  /* Task 19: mounted starts at `open` — the shell mounts this view only
     while its tab is active, so `open` can be true from the very first
     render (the old overlay flow always entered with open=false). */
  const [mounted, setMounted] = useState(open);
  const [shownOpen, setShownOpen] = useState(open);
  const [mood, setMood] = useState<Mood>("dark");
  const [view, setView] = useState<View>({ lat: SA_CENTER.lat, lng: SA_CENTER.lng, zoom: SA_ZOOM });
  const [brandOpen, setBrandOpen] = useState(true);
  const [online, setOnline] = useState(true);
  const [hype, setHype] = useState(() => pick(FAST_HYPE));
  const [mapKey, setMapKey] = useState(0);

  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) {
      setMounted(true);
      setView({ lat: SA_CENTER.lat, lng: SA_CENTER.lng, zoom: SA_ZOOM });
      setBrandOpen(true);
    }
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

  // house hype rotates inside the territory card — the brand never sleeps
  useEffect(() => {
    if (!open || !mounted) return;
    const t = window.setInterval(() => {
      setHype((prev) => pickDiff(FAST_HYPE, prev));
    }, HYPE_MS);
    return () => window.clearInterval(t);
  }, [open, mounted]);

  /** One embed — the user drives. View/mood flips rebuild the URL. */
  const mapSrc = useMemo(() => {
    const t = mood === "sat" ? "k" : "m";
    return `https://maps.google.com/maps?ll=${view.lat},${view.lng}&q=${view.lat},${view.lng}&z=${view.zoom}&t=${t}&hl=en&output=embed`;
  }, [mood, view]);

  const remount = useCallback(() => setMapKey((k) => k + 1), []);
  const jump = useCallback(
    (lat: number, lng: number, zoom: number) => {
      setView({ lat, lng, zoom });
      remount();
    },
    [remount]
  );
  const resetCountry = useCallback(
    () => jump(SA_CENTER.lat, SA_CENTER.lng, SA_ZOOM),
    [jump]
  );
  const zoomBy = useCallback((delta: number) => {
    setView((v) => ({ ...v, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom + delta)) }));
  }, []);
  const cycleMood = useCallback(() => {
    setMood((m) => (m === "dark" ? "sat" : m === "sat" ? "blood" : "dark"));
  }, []);

  if (!open || !mounted) return null;

  const MoodIcon = MOOD_ICON[mood];

  /* Task 19: this is a shell tab view now — full screen on phones, a pane
     panel on desktop (the rail stays visible beside it). No portal: the
     content pane is the positioning ancestor on desktop. */
  return (
    <div
      className="fixed inset-0 z-[90] bg-black lg:absolute lg:inset-0 lg:z-auto"
      role="region"
      aria-label="Surroundings map"
    >
      <ScreenShell as="div" className="flex h-dvh flex-col lg:h-full">
        {/* ------------------------------------------------- branded header */}
        <header className="sticky top-0 z-20 shrink-0 border-b border-neutral-900 bg-black/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
            <button
              onClick={onClose}
              aria-label="Close map"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-neutral-400 outline-none transition-colors hover:bg-neutral-900 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
            >
              <ArrowLeft className="size-5" aria-hidden />
            </button>
            <Image
              src="/fast-logo.png"
              alt="FAST GUNS"
              width={256}
              height={256}
              priority
              draggable={false}
              className="size-8 shrink-0 mix-blend-screen"
            />
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
              style={{ filter: MAP_FILTERS[mood] }}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black px-6 text-center">
              <WifiOff className="size-7 text-neutral-700" aria-hidden />
              <p className="text-sm font-bold text-neutral-400">{MAP_OFFLINE_NOTE}</p>
            </div>
          )}

          {/* ------------------------------------------ territory card —
              the house logo + 187 tag + rotating hype, collapsible so it
              never eats the map on a small phone */}
          <div className="absolute left-3 top-3 max-w-[15rem] sm:max-w-xs">
            {brandOpen ? (
              <div className="rounded-2xl border border-neutral-800 bg-black/85 p-3 backdrop-blur-md">
                <div className="flex items-center gap-2.5">
                  <Image
                    src="/fast-logo.png"
                    alt="FAST GUNS"
                    width={256}
                    height={256}
                    draggable={false}
                    className="size-10 shrink-0 mix-blend-screen"
                  />
                  <div className="min-w-0">
                    <p className="gang-font text-xl leading-none text-white [text-shadow:0_0_26px_rgba(255,255,255,0.25)]">
                      {MAP_PROMO_TITLE}
                    </p>
                    <p className="mt-1 truncate font-mono text-[8px] font-bold uppercase tracking-[0.24em] text-neutral-400">
                      {MAP_TERRITORY_TAG}
                    </p>
                  </div>
                  <button
                    onClick={() => setBrandOpen(false)}
                    aria-label="Fold the house card away"
                    className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-lg text-neutral-500 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
                  >
                    <Minus className="size-4" aria-hidden />
                  </button>
                </div>
                <p className="mt-2 text-[11px] font-semibold leading-snug text-neutral-300">
                  &ldquo;{hype}&rdquo;
                </p>
              </div>
            ) : (
              <button
                onClick={() => setBrandOpen(true)}
                aria-label="Show the house card"
                className="flex size-11 items-center justify-center rounded-xl border border-neutral-800 bg-black/85 backdrop-blur-md outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
              >
                <Image
                  src="/fast-logo.png"
                  alt="FAST GUNS"
                  width={256}
                  height={256}
                  draggable={false}
                  className="size-6 mix-blend-screen"
                />
              </button>
            )}
          </div>

          {/* right thumb column — mood cycle + zoom, 44px+, glass */}
          <div className="absolute right-3 top-3 flex flex-col gap-1.5">
            <button
              onClick={cycleMood}
              aria-label={`Map mood: ${MOOD_LABEL[mood]} — tap to cycle`}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] backdrop-blur-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 border-white bg-black/85 text-white"
            >
              <MoodIcon className="size-3.5" aria-hidden />
              {MOOD_LABEL[mood]}
            </button>
            <div className="flex flex-col overflow-hidden rounded-xl border border-neutral-700 bg-black/80 backdrop-blur-sm">
              <button
                onClick={() => zoomBy(1)}
                aria-label={MAP_ZOOM_IN}
                className="flex size-11 items-center justify-center text-neutral-300 outline-none transition-colors hover:bg-neutral-900 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
              >
                <Plus className="size-4" aria-hidden />
              </button>
              <span aria-hidden className="h-px w-full bg-neutral-800" />
              <button
                onClick={() => zoomBy(-1)}
                aria-label={MAP_ZOOM_OUT}
                className="flex size-11 items-center justify-center text-neutral-300 outline-none transition-colors hover:bg-neutral-900 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
              >
                <Minus className="size-4" aria-hidden />
              </button>
            </div>
          </div>

          {/* bottom jump dock — city chips + country reset, thumb height,
              horizontally scrollable, clears the floating app dock */}
          <div className="absolute inset-x-3 bottom-[calc(var(--fast-dock-clear)+0.75rem)] lg:bottom-6 lg:right-auto lg:max-w-md">
            <p className="mb-1.5 px-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.3em] text-neutral-500">
              {MAP_JUMP_LABEL}
            </p>
            <div className="flex max-w-full gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
              <button onClick={resetCountry} className={CHIP_CLS}>
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                {MAP_PICK_COUNTRY}
              </button>
              {MAP_CITIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => jump(c.lat, c.lng, c.zoom)}
                  className={CHIP_CLS}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </ScreenShell>
    </div>
  );
}
