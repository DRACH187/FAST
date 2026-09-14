"use client";

/**
 * FAST — SURROUNDINGS: South Africa community-safety map.
 *
 * Bespoke full-screen Leaflet experience (OSM basemap re-graded monochrome, custom div-icon
 * markers, custom panels/controls — zero default Leaflet chrome). Strictly
 * monochrome; threat levels are expressed with grey shades, borders and
 * weight only. Geolocation is intentionally NOT used anywhere — the view is
 * informational "surroundings" awareness.
 *
 * Motion is GSAP-driven and respects prefers-reduced-motion.
 */

import "leaflet/dist/leaflet.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Crosshair,
  MapPinOff,
  Minus,
  Plus,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type * as LeafletNS from "leaflet";
import { REDUCED_MOTION } from "@/components/fast/motion";

gsap.registerPlugin(useGSAP);

// ------------------------------------------------------------------- types

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
};

type FeedSource = "gemini" | "fallback" | "cache";

type Feed = { hotspots: Hotspot[]; source: FeedSource; updatedAt: string };

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
  gemini: "GEMINI INTEL",
  cache: "CACHED",
  fallback: "OFFLINE DATASET",
};

const SA_CENTER: LeafletNS.LatLngExpression = [-29.5, 25];

function hotspotKey(h: Hotspot): string {
  return `${h.province}|${h.area.toLowerCase()}`;
}

// --------------------------------------------------- marker styles (once)

function injectHotspotStyles() {
  if (document.getElementById("fast-hotspot-styles")) return;
  const style = document.createElement("style");
  style.id = "fast-hotspot-styles";
  style.textContent = `
.fast-map-tiles { filter: grayscale(1) invert(1) brightness(0.82) contrast(1.08); }
.fast-hotspot-wrap { background: transparent !important; border: none !important; }
.fast-hotspot {
  position: relative; display: flex; align-items: center; justify-content: center;
  cursor: pointer; will-change: transform;
}
.fast-hotspot-ring {
  position: absolute; inset: 0; border-radius: 9999px;
  border: 1px solid #ffffff; pointer-events: none;
}
.fast-hotspot-dot {
  width: 5px; height: 5px; border-radius: 9999px; background: #ffffff;
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.55);
}
.fast-hotspot-active .fast-hotspot-dot { box-shadow: 0 0 12px rgba(255,255,255,0.95); transform: scale(1.35); }
.fast-hotspot-active .fast-hotspot-ring { border-width: 2px; opacity: 1 !important; }
@keyframes fast-hotspot-ping {
  0% { transform: scale(1); opacity: 0.7; }
  100% { transform: scale(1.85); opacity: 0; }
}
.fast-hotspot-pulse::after {
  content: ""; position: absolute; inset: 0; border-radius: 9999px;
  border: 1px solid #ffffff; animation: fast-hotspot-ping 1.9s ease-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .fast-hotspot-pulse::after { animation: none; opacity: 0; }
}
`;
  document.head.appendChild(style);
}

// ------------------------------------------------------------------ screen

export function MapScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [shownOpen, setShownOpen] = useState(open);

  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [query, setQuery] = useState("");
  const [province, setProvince] = useState<string>("ALL");
  const [selected, setSelected] = useState<Hotspot | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const markersRef = useRef<LeafletNS.LayerGroup | null>(null);
  const leafletRef = useRef<{ default?: typeof LeafletNS } & typeof LeafletNS | null>(null);

  // open/close mount dance (derive during render — the React-sanctioned
  // pattern, same as FastModal): Leaflet inits only on first open and dies
  // with the overlay. Reopening starts with a clean detail panel.
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) {
      setMounted(true);
      setSelected(null);
    }
  }

  // ------------------------------------------------------------ GSAP open
  useGSAP(
    () => {
      if (!mounted || !overlayRef.current) return;
      if (REDUCED_MOTION) {
        gsap.set(overlayRef.current, { opacity: 1, scale: 1 });
        return;
      }
      gsap.fromTo(
        overlayRef.current,
        { opacity: 0, scale: 0.98 },
        { opacity: 1, scale: 1, duration: 0.3, ease: "power2.out" }
      );
    },
    { dependencies: [mounted] }
  );

  // ----------------------------------------------------------- GSAP close
  useEffect(() => {
    if (open || !mounted) return;
    const el = overlayRef.current;
    if (!el) return;
    // unmount happens inside the tween callback (async — lint-safe);
    // reduced motion gets an instant (duration 0) fade
    gsap.to(el, {
      opacity: 0,
      duration: REDUCED_MOTION ? 0 : 0.18,
      ease: "power2.in",
      onComplete: () => setMounted(false),
    });
  }, [open, mounted]);

  // ------------------------------------------------- esc / scroll lock
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // ------------------------------------------------------- data fetch
  // Only the FIRST open hits the network (the feed is 24h server-cached;
  // refetching on every reopen would trip the 10s/IP rate limit for no gain).
  const haveFeedRef = useRef(false);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/map/hotspots", { signal });
      const data: unknown = await res.json().catch(() => null);
      const body = data as
        | { ok?: boolean; source?: FeedSource; updatedAt?: string; hotspots?: Hotspot[]; error?: string }
        | null;
      if (!res.ok || !body?.ok || !Array.isArray(body.hotspots)) {
        setError(body?.error ?? `Intel feed error (HTTP ${res.status})`);
        return;
      }
      haveFeedRef.current = true;
      setFeed({
        hotspots: body.hotspots,
        source: body.source ?? "fallback",
        updatedAt: body.updatedAt ?? new Date().toISOString(),
      });
    } catch (err) {
      if ((err as Error | null)?.name === "AbortError") return;
      setError("Network error — could not reach the intel feed.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!mounted || haveFeedRef.current) return;
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [mounted, attempt, load]);

  // ------------------------------------------------------- leaflet init
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;

    void (async () => {
      const mod = (await import("leaflet")) as unknown as {
        default?: typeof LeafletNS;
      } & typeof LeafletNS;
      const L = mod.default ?? mod;
      if (cancelled || !mapHostRef.current || mapRef.current) return;

      injectHotspotStyles();

      const map = L.map(mapHostRef.current, {
        center: SA_CENTER,
        zoom: 5,
        minZoom: 5,
        maxZoom: 15,
        zoomControl: false,
        attributionControl: false,
        maxBounds: [
          [-35.5, 16],
          [-21, 33.5],
        ],
        maxBoundsViscosity: 0.8,
      });

      // OpenStreetMap raster tiles, re-graded to strict monochrome via CSS
      // (grayscale + invert = dark grey map, zero API keys, no colour pixels)
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        className: "fast-map-tiles",
      }).addTo(map);

      mapRef.current = map;
      markersRef.current = L.layerGroup().addTo(map);
      leafletRef.current = mod;
      setMapReady(true);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current = null;
      leafletRef.current = null;
      setMapReady(false);
    };
  }, [mounted]);

  // ---------------------------------------------------------- filtering
  const provinces = useMemo(() => {
    const present = new Set(feed?.hotspots.map((h) => h.province) ?? []);
    return PROVINCE_ORDER.filter((p) => present.has(p));
  }, [feed]);

  const filtered = useMemo(() => {
    if (!feed) return [];
    const q = query.trim().toLowerCase();
    return feed.hotspots.filter((h) => {
      if (province !== "ALL" && h.province !== province) return false;
      if (!q) return true;
      if (h.area.toLowerCase().includes(q)) return true;
      return h.gangs.some((g) => g.name.toLowerCase().includes(q));
    });
  }, [feed, query, province]);

  // ----------------------------------------------------------- markers
  const selectedKey = selected ? hotspotKey(selected) : null;

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = markersRef.current;
    if (!mapReady || !L || !map || !layer) return;

    layer.clearLayers();
    for (const h of filtered) {
      const d = 14 + h.intensity * 4; // outer ring diameter scales with intensity
      const ringOpacity = Math.min(0.95, 0.38 + h.intensity * 0.115).toFixed(2);
      const isActive = hotspotKey(h) === selectedKey;
      const html = `
        <div class="fast-hotspot${h.intensity >= 4 ? " fast-hotspot-pulse" : ""}${isActive ? " fast-hotspot-active" : ""}" style="width:${d}px;height:${d}px">
          <span class="fast-hotspot-ring" style="opacity:${ringOpacity}"></span>
          <span class="fast-hotspot-dot"></span>
        </div>`;
      const icon = L.divIcon({
        className: "fast-hotspot-wrap",
        html,
        iconSize: [d, d],
        iconAnchor: [d / 2, d / 2],
      });
      const marker = L.marker([h.lat, h.lng], {
        icon,
        title: h.area,
        alt: `Documented hotspot: ${h.area}, ${h.province}`,
      });
      marker.on("click", () => setSelected(h));
      marker.addTo(layer);
    }
  }, [mapReady, filtered, selectedKey]);

  // ------------------------------------------------------ detail panel
  useGSAP(
    () => {
      if (selected && panelRef.current && !REDUCED_MOTION) {
        gsap.fromTo(
          panelRef.current,
          { opacity: 0, y: 16, scale: 0.985 },
          { opacity: 1, y: 0, scale: 1, duration: 0.28, ease: "power3.out", overwrite: "auto" }
        );
      }
    },
    { dependencies: [selected] }
  );

  // ----------------------------------------------------------- render
  if (!open && !mounted) return null;
  if (typeof window === "undefined") return null;

  const asOf = feed
    ? new Date(feed.updatedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : null;

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="South Africa safety map"
      className="fixed inset-0 z-[90] flex flex-col bg-black"
    >
      {/* ------------------------------------------------------- header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-900 px-3 sm:px-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close map"
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-900 hover:text-white"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-[10px] font-medium uppercase tracking-widest text-neutral-100 sm:text-xs">
            Surroundings — South Africa
          </h2>
          <p className="truncate text-[10px] text-neutral-500">
            Community safety intel · geolocation disabled by design
          </p>
        </div>
        {feed && (
          <span className="shrink-0 rounded-full border border-neutral-700 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-neutral-300">
            {SOURCE_BADGE[feed.source]}
          </span>
        )}
      </header>

      {/* ---------------------------------------------------------- map */}
      <div className="relative flex-1 overflow-hidden bg-black">
        <div
          ref={mapHostRef}
          role="application"
          aria-label="Interactive map of documented hotspot areas in South Africa"
          className="absolute inset-0"
        />

        {/* search + province chips */}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-[700] flex flex-col gap-2">
          <div className="pointer-events-auto relative sm:max-w-72">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-neutral-600"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search area or gang…"
              aria-label="Search area or gang"
              className="h-9 w-full rounded-full border border-neutral-800 bg-neutral-950 pl-8 pr-3 font-mono text-[11px] uppercase tracking-wider text-neutral-200 outline-none transition-colors placeholder:text-neutral-600 focus:border-neutral-600"
            />
          </div>
          {(provinces.length > 0 || !!feed) && (
            <div className="no-scrollbar pointer-events-auto flex gap-1.5 overflow-x-auto pb-0.5">
              {["ALL", ...provinces].map((p) => {
                const active = province === p;
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setProvince(p)}
                    className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest transition-colors ${
                      active
                        ? "border-white bg-white text-black"
                        : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-600 hover:text-white"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          )}
          {error && feed && (
            <div className="pointer-events-auto flex items-center gap-2 self-start rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1.5">
              <TriangleAlert className="size-3 text-neutral-500" aria-hidden />
              <span className="text-[10px] text-neutral-400">{error}</span>
              <button
                type="button"
                onClick={() => setAttempt((a) => a + 1)}
                className="font-mono text-[9px] uppercase tracking-widest text-neutral-200 underline-offset-2 hover:underline"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* zoom controls */}
        <div className="absolute bottom-3 right-3 z-[700] flex flex-col gap-1.5">
          {[
            { icon: Plus, label: "Zoom in", action: () => mapRef.current?.zoomIn() },
            { icon: Minus, label: "Zoom out", action: () => mapRef.current?.zoomOut() },
            {
              icon: Crosshair,
              label: "Recenter on South Africa",
              action: () => mapRef.current?.setView(SA_CENTER, 5),
            },
          ].map(({ icon: Icon, label, action }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              onClick={action}
              className="flex size-10 items-center justify-center rounded-xl border border-neutral-800 bg-black/90 text-neutral-300 transition-colors hover:text-white"
            >
              <Icon className="size-4" aria-hidden />
            </button>
          ))}
        </div>

        {/* loading state */}
        {loading && !feed && (
          <div className="absolute inset-0 z-[640] flex items-center justify-center bg-black/60">
            <span className="animate-fast-pulse font-mono text-[11px] tracking-[0.3em] text-neutral-300">
              PLOTTING INTEL…
            </span>
          </div>
        )}

        {/* hard error state (no data at all) */}
        {error && !feed && !loading && (
          <div className="absolute inset-0 z-[640] flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-neutral-300">
              Intel feed unavailable
            </span>
            <p className="max-w-xs text-xs text-neutral-500">{error}</p>
            <button
              type="button"
              onClick={() => setAttempt((a) => a + 1)}
              className="rounded-full border border-neutral-700 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-neutral-200 transition-colors hover:border-neutral-500 hover:bg-neutral-900"
            >
              Retry
            </button>
          </div>
        )}

        {/* empty search result */}
        {feed && !loading && filtered.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-[640] flex items-center justify-center">
            <span className="rounded-full border border-neutral-800 bg-neutral-950/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-neutral-500">
              No areas match
            </span>
          </div>
        )}

        {/* detail panel (bespoke — never a Leaflet popup) */}
        {selected && (
          <div
            ref={panelRef}
            className="absolute inset-x-0 bottom-0 z-[750] max-h-[62vh] overflow-y-auto rounded-t-2xl border-t border-neutral-800 bg-neutral-950/95 p-4 backdrop-blur-sm sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-16 sm:max-h-none sm:w-80 sm:rounded-2xl sm:border"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium text-neutral-100">{selected.area}</h3>
                <p className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-neutral-500">
                  {selected.province}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close details"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-white"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] uppercase tracking-widest text-neutral-500">
                  Documented intensity
                </span>
                <span className="font-mono text-[9px] text-neutral-400">{selected.intensity}/5</span>
              </div>
              <div className="mt-1.5 flex gap-1" aria-hidden>
                {[1, 2, 3, 4, 5].map((n) => (
                  <span
                    key={n}
                    className={`h-1.5 flex-1 rounded-full ${
                      n <= selected.intensity ? "bg-white" : "bg-neutral-800"
                    }`}
                  />
                ))}
              </div>
            </div>

            {selected.summary && (
              <p className="mt-3 text-xs leading-relaxed text-neutral-400">{selected.summary}</p>
            )}

            <div className="mt-3 space-y-2">
              <span className="font-mono text-[9px] uppercase tracking-widest text-neutral-500">
                Documented groups
              </span>
              <ul className="max-h-40 space-y-2 overflow-y-auto pr-1">
                {selected.gangs.map((g) => (
                  <li key={g.name} className="rounded-xl border border-neutral-900 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-neutral-200">{g.name}</span>
                      <span
                        className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                          g.threat === "SEVERE"
                            ? "border-white bg-white text-black"
                            : g.threat === "HIGH"
                              ? "border-neutral-400 text-neutral-200"
                              : "border-neutral-700 text-neutral-400"
                        }`}
                      >
                        {g.threat}
                      </span>
                    </div>
                    {g.notes && (
                      <p className="mt-1 text-[10px] leading-relaxed text-neutral-500">{g.notes}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------- footer */}
      <footer className="mt-auto flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-neutral-900 px-3 py-2 sm:px-4">
        <span className="text-[9px] text-neutral-600">© OpenStreetMap contributors</span>
        <span className="text-[9px] text-neutral-600">
          Area-level awareness info only. Not law enforcement guidance.
        </span>
        {asOf && <span className="text-[9px] text-neutral-600">AS OF {asOf}</span>}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-neutral-800 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-neutral-500">
          <MapPinOff className="size-3" aria-hidden />
          Geo: Off
        </span>
      </footer>
    </div>,
    document.body
  );
}
