"use client";

/**
 * FAST — SURROUNDINGS: plain Google Maps, house-themed.
 * =====================================================
 * The basemap is a REAL interactive Google Map (the normal embed — pan,
 * pinch, zoom all work like google.com/maps) pushed through a custom
 * monochrome theme filter so it stays black/white/grey like the house.
 * One tap flips it to RAW SAT (satellite, moody). The viewport follows the
 * intel feed: tap an area and the map drives there. "WYS HEEL SA" pulls
 * back to the whole country. No geolocation anywhere, ever.
 *
 * Intel: Gemini free flash via /api/map/hotspots (curated offline fallback
 * built in). Auto-sync every 10 minutes while open; a NEXT SYNC chip ticks
 * down in the header. Areas carry real sub-neighbourhood BLOCK rows with
 * allegiance chips (FAST GUNS = home solid white, AMERICANS = ally, VARADOS
 * + BRITISH = rival struck through, documented gangs = grey) and the WAR
 * BOARD counts turf per crew with a rotating disrespect ticker.
 *
 * Layout: phone = map up top, intel feed scrolling under it. Desktop =
 * map parked left (full height), intel rail on the right. GSAP entrances,
 * reduced-motion respected, zero default map chrome.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  ArrowLeft,
  BarChart3,
  ChevronDown,
  Globe2,
  MapPin,
  RadioTower,
  RefreshCw,
  Satellite,
  WifiOff,
} from "lucide-react";
import { REDUCED_MOTION, ScreenShell } from "@/components/fast/motion";
import {
  MAP_ANALYTICS_TITLE,
  MAP_INTENSITY,
  MAP_OFFLINE_NOTE,
  MAP_PICK_COUNTRY,
  MAP_REFRESH_NOTE,
  MAP_SOURCE_FALLBACK,
  MAP_SOURCE_GEMINI,
  MAP_SUB,
  MAP_TAP_AREA,
  MAP_THEME_DARK,
  MAP_THEME_SAT,
  MAP_TITLE,
  MAP_TURF_NOTE,
  pick,
} from "@/lib/fast/copy";
import {
  BLOCK_CHIP_CLASS,
  countTurf,
  WAR_BOARD_TAGLINES,
  type BlockAllegiance,
  type TurfBlock,
} from "@/lib/fast/gang-turf";

gsap.registerPlugin(useGSAP);

// -------------------------------------------------------------------- types

type Threat = "MODERATE" | "HIGH" | "SEVERE";
type Gang = { name: string; threat: Threat; notes: string };

type Hotspot = {
  area: string;
  province: string;
  lat: number;
  lng: number;
  intensity: number;
  summary: string;
  gangs: Gang[];
  blocks: TurfBlock[];
};

type FeedSource = "gemini" | "fallback" | "cache";

type Feed = { hotspots: Hotspot[]; source: FeedSource; updatedAt: string; reason?: string };

const FEED_URL = "/api/map/hotspots";
const SYNC_MS = 10 * 60 * 1000; // server TTL mirror

const SA_CENTER = { lat: -29.1, lng: 24.5 };
const AREA_ZOOM = 13;
const SA_ZOOM = 5;

const PROVINCE_ORDER = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
];

const SOURCE_BADGE: Record<FeedSource, string> = {
  gemini: MAP_SOURCE_GEMINI,
  cache: "GEKAS · VORIGE SINK",
  fallback: MAP_SOURCE_FALLBACK,
};

const ALLEGIANCES: readonly BlockAllegiance[] = ["home", "ally", "rival", "documented"];

/** Custom Google Maps themes — the house palette, two moods. */
const MAP_FILTERS: Record<"dark" | "sat", string> = {
  // roads theme pressed into black/white/grey (classic embed dark-inversion)
  dark: "grayscale(1) invert(0.91) contrast(1.08) brightness(0.9)",
  // satellite left raw but moody
  sat: "grayscale(0.4) contrast(1.12) brightness(0.82)",
};

function intensityChipClass(intensity: number): string {
  if (intensity >= 5) return "border-white bg-white text-black";
  if (intensity >= 4) return "border-neutral-400 text-neutral-100";
  if (intensity >= 3) return "border-neutral-600 text-neutral-300";
  return "border-neutral-700 text-neutral-500";
}

/** Chip text for a block row: crew names for the house, gang name otherwise. */
function blockChipLabel(b: TurfBlock): string {
  if (b.allegiance === "home") return "FAST GUNS";
  if (b.allegiance === "ally") return "AMERICANS";
  return b.gang.toUpperCase() || "GEDOKUMENTEERD";
}

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// --------------------------------------------------------------- component

export function MapScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [shownOpen, setShownOpen] = useState(open);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [theme, setTheme] = useState<"dark" | "sat">("dark");
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [tagline, setTagline] = useState(() => pick(WAR_BOARD_TAGLINES));
  const [sub] = useState(() => pick(MAP_SUB));
  const [turfNote] = useState(() => pick(MAP_TURF_NOTE));

  const listRef = useRef<HTMLDivElement>(null);
  const inflight = useRef(false);

  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) setMounted(true);
  }

  // ------------------------------------------------------------- data flow

  const sync = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setSyncing(true);
    try {
      const res = await fetch(FEED_URL, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as Partial<Feed> & { ok?: boolean; error?: string };
      if (!res.ok || data.ok !== true || !Array.isArray(data.hotspots)) {
        setFeedError(typeof data.error === "string" ? data.error : "Intel-bron weg — probeer weer");
        return;
      }
      setFeedError(null);
      setFeed({
        hotspots: data.hotspots as Hotspot[],
        source: (data.source as FeedSource) ?? "fallback",
        updatedAt: data.updatedAt ?? new Date().toISOString(),
        reason: data.reason,
      });
    } catch {
      setFeedError("Netwerk onbereikbaar — HUIS INTEL dra die kaart");
    } finally {
      setSyncing(false);
      inflight.current = false;
    }
  }, []);

  // sync on open + every TTL while open + 1s housekeeping tick
  useEffect(() => {
    if (!open || !mounted) return;
    void sync();
    const syncTimer = setInterval(() => void sync(), SYNC_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const onOnline = () => setOnline(navigator.onLine);
    const onOffline = () => setOnline(navigator.onLine);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    setOnline(navigator.onLine);
    return () => {
      clearInterval(syncTimer);
      clearInterval(tick);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [open, mounted, sync]);

  // war-board ticker — fresh disrespect every 10s
  useEffect(() => {
    if (!open || !mounted) return;
    const t = setInterval(() => setTagline((prev) => {
      let next = pick(WAR_BOARD_TAGLINES);
      let guard = 0;
      while (next === prev && guard < 5) {
        next = pick(WAR_BOARD_TAGLINES);
        guard += 1;
      }
      return next;
    }), 10_000);
    return () => clearInterval(t);
  }, [open, mounted]);

  // ------------------------------------------------------------- derived

  const hotspots = feed?.hotspots ?? [];

  const sorted = useMemo(() => {
    return [...hotspots].sort((a, b) => {
      const pa = PROVINCE_ORDER.indexOf(a.province);
      const pb = PROVINCE_ORDER.indexOf(b.province);
      if (pa !== pb) return pa - pb;
      return b.intensity - a.intensity;
    });
  }, [hotspots]);

  const selected = selectedIdx !== null ? (sorted[selectedIdx] ?? null) : null;

  const nextSyncAt = useMemo(() => {
    if (!feed) return null;
    const at = Date.parse(feed.updatedAt);
    return Number.isFinite(at) ? at + SYNC_MS : null;
  }, [feed]);

  const countdown = nextSyncAt ? fmtCountdown(nextSyncAt - now) : "—";

  const turf = useMemo(() => countTurf(hotspots), [hotspots]);

  const analytics = useMemo(() => {
    const provinces = new Set(hotspots.map((h) => h.province)).size;
    const perProvince = PROVINCE_ORDER.map((p) => ({
      province: p,
      count: hotspots.filter((h) => h.province === p).length,
    })).filter((r) => r.count > 0);
    const hottest = hotspots.reduce<Hotspot | null>(
      (best, h) => (best === null || h.intensity > best.intensity ? h : best),
      null
    );
    const threatTally = { MODERATE: 0, HIGH: 0, SEVERE: 0 } as Record<Threat, number>;
    for (const h of hotspots) for (const g of h.gangs ?? []) threatTally[g.threat] += 1;
    return { provinces, perProvince, hottest, threatTally };
  }, [hotspots]);

  /** The actual Google Map — a normal embed, themed by CSS filter. */
  const mapSrc = useMemo(() => {
    const c = selected ?? SA_CENTER;
    const z = selected ? AREA_ZOOM : SA_ZOOM;
    const t = theme === "sat" ? "k" : "m";
    return `https://maps.google.com/maps?ll=${c.lat},${c.lng}&q=${c.lat},${c.lng}&z=${z}&t=${t}&hl=en&output=embed`;
  }, [selected, theme]);

  // GSAP entrance for the intel rail
  useGSAP(
    () => {
      if (REDUCED_MOTION || !listRef.current) return;
      const rows = listRef.current.querySelectorAll("[data-area-row]");
      gsap.fromTo(
        rows,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.04, ease: "power3.out", overwrite: "auto" }
      );
    },
    { scope: listRef, dependencies: [sorted.length, selectedIdx] }
  );

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black" role="dialog" aria-label="Surroundings map">
      <ScreenShell as="div" className="flex h-dvh flex-col">
        {/* ---------------------------------------------------------- header */}
        <header className="sticky top-0 z-20 border-b border-neutral-900 bg-black/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
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
                {sub} · {hotspots.length} GEBIEDE · {turf.totalBlocks} BLOKKE
              </span>
            </div>
            <div className="flex-1" />
            <button
              onClick={() => setShowAnalytics((v) => !v)}
              aria-pressed={showAnalytics}
              aria-label="Toggle war analytics"
              className={`flex size-11 shrink-0 items-center justify-center rounded-xl border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 ${
                showAnalytics
                  ? "border-white bg-white text-black"
                  : "border-neutral-800 text-neutral-400 hover:border-neutral-500 hover:text-white"
              }`}
            >
              <BarChart3 className="size-5" aria-hidden />
            </button>
            <button
              onClick={() => void sync()}
              disabled={syncing}
              aria-label="Sync intel now"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-neutral-800 text-neutral-400 outline-none transition-colors hover:border-neutral-500 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:opacity-40"
            >
              <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} aria-hidden />
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 px-3 pb-2 sm:px-4">
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-neutral-500">
              {MAP_REFRESH_NOTE}
            </span>
            <span className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.18em]">
              <span className="rounded-full border border-neutral-800 px-2 py-0.5 tabular-nums text-neutral-300">
                NEXT SYNC {countdown}
              </span>
              {feed && (
                <span className="rounded-full border border-neutral-800 px-2 py-0.5 text-neutral-400">
                  {SOURCE_BADGE[feed.source]}
                </span>
              )}
            </span>
          </div>
        </header>

        {/* ------------------------------------------------------- body */}
        <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_420px]">
          {/* -------------------------------------------------- the map */}
          <section
            aria-label="Google map of South Africa"
            className="relative h-[46dvh] min-h-[280px] shrink-0 border-b border-neutral-900 lg:h-auto lg:min-h-0 lg:border-b-0 lg:border-r"
          >
            {online ? (
              <iframe
                key={mapSrc}
                title="Google Maps — South Africa"
                src={mapSrc}
                loading="lazy"
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

            {/* theme flip + country reset — above the map chrome */}
            <div className="absolute right-3 top-3 flex flex-col gap-1.5">
              <button
                onClick={() => setTheme("dark")}
                aria-pressed={theme === "dark"}
                className={`flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] backdrop-blur-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 ${
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
                className={`flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] backdrop-blur-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 ${
                  theme === "sat"
                    ? "border-white bg-black/85 text-white"
                    : "border-neutral-700 bg-black/70 text-neutral-400 hover:text-white"
                }`}
              >
                <Satellite className="size-3.5" aria-hidden />
                {MAP_THEME_SAT}
              </button>
            </div>

            {/* current pin + reset */}
            <div className="absolute bottom-3 left-3 flex max-w-[70%] flex-col gap-1.5">
              {selected && (
                <span className="pointer-events-none flex items-center gap-1.5 rounded-xl border border-neutral-700 bg-black/85 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white backdrop-blur-sm">
                  <MapPin className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{selected.area} · {selected.province}</span>
                </span>
              )}
              <button
                onClick={() => setSelectedIdx(null)}
                className="pointer-events-auto flex min-h-[38px] w-fit items-center gap-1.5 rounded-xl border border-neutral-700 bg-black/80 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-300 backdrop-blur-sm outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
              >
                {MAP_PICK_COUNTRY}
              </button>
            </div>
          </section>

          {/* ----------------------------------------------- intel rail */}
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-24 pt-3 sm:px-4 lg:pb-6">
            {feedError && (
              <div className="mb-3 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-center">
                <p className="text-xs font-bold text-neutral-300">{feedError}</p>
              </div>
            )}

            {/* war board */}
            <section aria-label="War board" className="mb-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="flex items-center gap-2">
                <RadioTower className="size-4 text-neutral-400" aria-hidden />
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-300">
                  WAR BOARD
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ScoreCell label="FAST GUNS" value={turf.home} solid />
                <ScoreCell label="AMERICANS" value={turf.ally} />
                <ScoreCell label="VARADOS" value={turf.varados} struck />
                <ScoreCell label="BRITISH" value={turf.british} struck />
              </div>
              <p className="mt-3 border-t border-neutral-900 pt-3 text-[13px] font-semibold leading-relaxed text-neutral-300">
                {tagline}
              </p>
              <p className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-600">
                {turfNote}
              </p>
            </section>

            {/* analytics */}
            {showAnalytics && (
              <section aria-label="War analytics" className="mb-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="size-4 text-neutral-400" aria-hidden />
                  <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-300">
                    {MAP_ANALYTICS_TITLE}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Kpi label="GEBIEDE" value={hotspots.length} />
                  <Kpi label="BLOKKE" value={turf.totalBlocks} />
                  <Kpi label="PROVINCES" value={analytics.provinces} />
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  {(["SEVERE", "HIGH", "MODERATE"] as Threat[]).map((t) => {
                    const total = Math.max(1, analytics.threatTally.SEVERE + analytics.threatTally.HIGH + analytics.threatTally.MODERATE);
                    const pct = Math.round((analytics.threatTally[t] / total) * 100);
                    return (
                      <div key={t} className="flex items-center gap-2">
                        <span className="w-20 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-neutral-500">{t}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-900">
                          <span className="block h-full rounded-full bg-neutral-300" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="w-8 text-right font-mono text-[9px] tabular-nums text-neutral-400">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
                {analytics.hottest && (
                  <p className="mt-4 border-t border-neutral-900 pt-3 text-[11px] font-semibold text-neutral-400">
                    HOTSTE GEBIED · <span className="text-white">{analytics.hottest.area}</span> ({analytics.hottest.province})
                  </p>
                )}
              </section>
            )}

            {/* hint */}
            <p className="mb-3 text-center font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-neutral-600">
              {MAP_TAP_AREA}
            </p>

            {/* area list */}
            {sorted.length === 0 && !feedError ? (
              <div className="rounded-2xl border border-dashed border-neutral-800 px-4 py-10 text-center">
                <p className="text-sm font-bold text-neutral-400">Intel laai nog, ouen…</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {sorted.map((h, i) => {
                  const isActive = selectedIdx === i;
                  const tally = countTurf([h]);
                  return (
                    <article
                      key={`${h.area}-${h.province}`}
                      data-area-row
                      className={`overflow-hidden rounded-2xl border bg-neutral-950 transition-colors ${
                        isActive ? "border-neutral-400" : "border-neutral-800 hover:border-neutral-600"
                      }`}
                    >
                      <button
                        onClick={() => setSelectedIdx(isActive ? null : i)}
                        aria-expanded={isActive}
                        className="flex w-full flex-col gap-1.5 px-4 py-3.5 text-left outline-none"
                      >
                        <div className="flex items-center gap-2">
                          <span className="gang-font text-lg leading-tight text-white">{h.area}</span>
                          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-neutral-500">
                            {h.province}
                          </span>
                          <span className="flex-1" />
                          <span
                            className={`rounded-full border px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.16em] ${intensityChipClass(h.intensity)}`}
                          >
                            {MAP_INTENSITY[(Math.min(5, Math.max(1, h.intensity)) as 1 | 2 | 3 | 4 | 5)] ?? "STIL"}
                          </span>
                          <ChevronDown
                            className={`size-4 shrink-0 text-neutral-600 transition-transform ${isActive ? "rotate-180" : ""}`}
                            aria-hidden
                          />
                        </div>
                        <p className="line-clamp-2 text-xs font-semibold leading-relaxed text-neutral-400">
                          {h.summary}
                        </p>
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {tally.home > 0 && <Chip label={`FAST GUNS · ${tally.home}`} cls={BLOCK_CHIP_CLASS.home} />}
                          {tally.ally > 0 && <Chip label={`AMERICANS · ${tally.ally}`} cls={BLOCK_CHIP_CLASS.ally} />}
                          {tally.rival > 0 && <Chip label={`VYAND · ${tally.rival}`} cls={BLOCK_CHIP_CLASS.rival} />}
                          {tally.documented > 0 && <Chip label={`GEDOKUMENTEERD · ${tally.documented}`} cls={BLOCK_CHIP_CLASS.documented} />}
                        </div>
                      </button>

                      {isActive && (
                        <div className="border-t border-neutral-900 px-4 pb-4 pt-3">
                          {(h.blocks ?? []).length > 0 && (
                            <ul className="mb-3 flex flex-col gap-2">
                              {(h.blocks ?? []).map((b) => (
                                <li key={b.name} className="rounded-xl border border-neutral-900 bg-black px-3 py-2.5">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[13px] font-bold text-neutral-100">{b.name}</span>
                                    <span className={`rounded-full border px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.14em] ${BLOCK_CHIP_CLASS[b.allegiance]}`}>
                                      {blockChipLabel(b)}
                                    </span>
                                  </div>
                                  {b.note && (
                                    <p className={`mt-1 text-[11px] font-semibold leading-relaxed ${b.allegiance === "rival" ? "italic text-neutral-500" : "text-neutral-500"}`}>
                                      {b.note}
                                    </p>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                          {(h.gangs ?? []).length > 0 && (
                            <div className="flex flex-col gap-1.5">
                              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-neutral-600">
                                GEDOKUMENTEERDE GROEPE
                              </span>
                              {(h.gangs ?? []).map((gang) => (
                                <div key={gang.name} className="flex items-baseline gap-2">
                                  <span className="text-xs font-bold text-neutral-200">{gang.name}</span>
                                  <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-neutral-600">
                                    {gang.threat}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </ScreenShell>
    </div>,
    document.body
  );
}

// ------------------------------------------------------------------ pieces

function ScoreCell({ label, value, solid = false, struck = false }: { label: string; value: number; solid?: boolean; struck?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-2.5 ${
        solid ? "border-white bg-white text-black" : struck ? "border-neutral-700 text-neutral-500" : "border-neutral-700 text-neutral-200"
      }`}
    >
      <span className={`text-xl font-black tabular-nums ${struck ? "line-through" : ""}`}>{value}</span>
      <span className={`text-center font-mono text-[8px] font-bold uppercase tracking-[0.16em] ${solid ? "text-black" : struck ? "text-neutral-600" : "text-neutral-500"}`}>
        {label}
      </span>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-xl border border-neutral-900 px-2 py-2.5">
      <span className="text-lg font-black tabular-nums text-white">{value}</span>
      <span className="font-mono text-[8px] font-bold uppercase tracking-[0.16em] text-neutral-500">{label}</span>
    </div>
  );
}

function Chip({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.14em] ${cls}`}>
      {label}
    </span>
  );
}
