"use client";

/**
 * FAST — SURROUNDINGS: South Africa community-safety map.
 *
 * Basemap: REAL Google Maps tiles (mt*.google.com raster endpoint — no API
 * key required) rendered through Leaflet and pushed through a grayscale
 * filter so the whole map stays strictly black/white/grey. A satellite
 * layer is one tap away, filtered the same way.
 *
 * Hotspot intel: Gemini free flash model via /api/map/hotspots (curated
 * offline fallback built in). Markers are bespoke divIcons; the detail
 * panel, filters and footer are hand-rolled — zero default Leaflet chrome.
 *
 * Geolocation is intentionally NOT used anywhere. Motion is GSAP-driven and
 * respects prefers-reduced-motion.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type * as LeafletNS from "leaflet";
import {
  ArrowLeft,
  Crosshair,
  Layers,
  MapPinOff,
  Minus,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { REDUCED_MOTION } from "@/components/fast/motion";
import "leaflet/dist/leaflet.css";

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

type Feed = { hotspots: Hotspot[]; source: FeedSource; updatedAt: string; reason?: string };

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

/** South Africa, with a little breathing room. */
const SA_BOUNDS: LeafletNS.LatLngBoundsExpression = [
  [-34.95, 16.3],
  [-21.9, 33.3],
];
const FIT_PAD: LeafletNS.FitBoundsOptions = { padding: [24, 24], animate: !REDUCED_MOTION };

const GOOGLE_ROADMAP = "https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=en";
const GOOGLE_SATELLITE = "https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&hl=en";
const GOOGLE_SUBDOMAINS = ["mt0", "mt1", "mt2", "mt3"];

function hotspotKey(h: Hotspot): string {
  return `${h.province}|${h.area.toLowerCase()}`;
}

/** WeakMap so the zoom layer can rebind area labels without rebuilds. */
const markerHotspots = new WeakMap<LeafletNS.Marker, Hotspot>();

// --------------------------------------------------------- injected styles

function injectMapStyles() {
  if (document.getElementById("fast-map-styles")) return;
  const style = document.createElement("style");
  style.id = "fast-map-styles";
  style.textContent = `
/* monochrome enforcement on Google tiles — roadmap is inverted into a dark
   grey map so it matches the all-black app and white markers pop */
.fast-google-tiles { filter: grayscale(1) invert(1) brightness(0.82) contrast(1.12); }
.fast-google-tiles-sat { filter: grayscale(1) brightness(0.68) contrast(1.15); }

/* bespoke hotspot markers (constant screen size, Leaflet-anchored) */
.fast-hspot-icon { background: transparent !important; border: none !important; }
.fast-hspot {
  position: relative; display: flex; align-items: center; justify-content: center;
  border-radius: 9999px; cursor: pointer; background: transparent; border: none;
  padding: 0; outline: none;
}
.fast-hspot-ring {
  position: absolute; inset: 0; border-radius: 9999px;
  border: 1px solid #ffffff; pointer-events: none;
}
.fast-hspot-dot {
  width: 5px; height: 5px; border-radius: 9999px; background: #ffffff;
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.55);
}
.fast-hspot-active .fast-hspot-dot { box-shadow: 0 0 14px rgba(255,255,255,0.95); transform: scale(1.4); }
.fast-hspot-active .fast-hspot-ring { border-width: 2px; opacity: 1 !important; }
@keyframes fast-hspot-ping {
  0% { transform: scale(1); opacity: 0.7; }
  100% { transform: scale(1.9); opacity: 0; }
}
.fast-hspot-ping {
  position: absolute; inset: 0; border-radius: 9999px;
  border: 1px solid #ffffff; animation: fast-hspot-ping 1.9s ease-out infinite;
}
.fast-hspot-label {
  background: rgba(0,0,0,0.72); border: 1px solid #262626; color: #d4d4d4;
  font-family: var(--font-geist-mono), ui-monospace, monospace;
  font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
  padding: 1px 6px; border-radius: 9999px; box-shadow: none;
}
.fast-hspot-label::before { display: none; }

/* keep Leaflet chrome invisible — all controls are bespoke */
.leaflet-container { background: #000000; outline: none; font: inherit; }
.leaflet-control-container { display: none; }

@media (prefers-reduced-motion: reduce) {
  .fast-hspot-ping { animation: none; opacity: 0; }
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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [query, setQuery] = useState("");
  const [province, setProvince] = useState<string>("ALL");
  const [selected, setSelected] = useState<Hotspot | null>(null);

  const [tilesDown, setTilesDown] = useState(false);
  const [zoom, setZoom] = useState(6);
  const [satellite, setSatellite] = useState(false);
  /** bumped once the Leaflet map + marker layer exist — retriggers markers */
  const [mapReady, setMapReady] = useState(0);

  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const layerRef = useRef<LeafletNS.LayerGroup | null>(null);
  const tileRef = useRef<LeafletNS.TileLayer | null>(null);
  const satelliteRef = useRef(false);
  const markerEls = useRef(new Map<string, HTMLElement>());
  const tileStats = useRef({ errored: 0, loaded: 0 });

  // open/close mount dance (derive during render — the React-sanctioned
  // pattern, same as FastModal): reopening starts with a clean detail panel.
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) {
      setMounted(true);
      setSelected(null);
    }
  }

  // map styles are injected once per mount
  useEffect(() => {
    if (mounted) injectMapStyles();
  }, [mounted]);

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
  const haveFeedRef = useRef(false);

  const load = useCallback(async (signal: AbortSignal, opts: { refresh?: boolean } = {}) => {
    if (opts.refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/map/hotspots${opts.refresh ? "?refresh=1" : ""}`, { signal });
      const data: unknown = await res.json().catch(() => null);
      const body = data as
        | {
            ok?: boolean;
            source?: FeedSource;
            reason?: string;
            updatedAt?: string;
            hotspots?: Hotspot[];
            error?: string;
          }
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
        reason: typeof body.reason === "string" ? body.reason : undefined,
      });
    } catch (err) {
      if ((err as Error | null)?.name === "AbortError") return;
      setError("Network error — could not reach the intel feed.");
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!mounted || haveFeedRef.current) return;
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [mounted, attempt, load]);

  // ----------------------------------------------------- Leaflet lifecycle
  useEffect(() => {
    if (!mounted || !hostRef.current || mapRef.current) return;
    let cancelled = false;
    let map: LeafletNS.Map | null = null;

    void (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !hostRef.current) return;

      map = L.map(hostRef.current, {
        zoomControl: false,
        attributionControl: false,
        minZoom: 5,
        maxZoom: 16,
        maxBounds: L.latLngBounds([-36.5, 14.0], [-20.0, 35.8]),
        maxBoundsViscosity: 0.85,
        zoomSnap: 0.5,
        worldCopyJump: false,
        keyboard: true,
      });
      map.fitBounds(L.latLngBounds(SA_BOUNDS as unknown as [[number, number], [number, number]]), FIT_PAD);
      mapRef.current = map;

      tileStats.current = { errored: 0, loaded: 0 };
      const sat = satelliteRef.current;
      const tiles = L.tileLayer(sat ? GOOGLE_SATELLITE : GOOGLE_ROADMAP, {
        subdomains: GOOGLE_SUBDOMAINS,
        className: sat ? "fast-google-tiles-sat" : "fast-google-tiles",
        minZoom: 4,
        maxZoom: 19,
        maxNativeZoom: 19,
        crossOrigin: "anonymous",
      });
      tiles.on("tileerror", () => {
        tileStats.current.errored += 1;
        if (tileStats.current.errored > 10 && tileStats.current.loaded === 0) setTilesDown(true);
      });
      tiles.on("tileload", () => {
        tileStats.current.loaded += 1;
        if (tileStats.current.loaded >= 4) setTilesDown(false);
      });
      tiles.addTo(map);
      tileRef.current = tiles;

      layerRef.current = L.layerGroup().addTo(map);

      map.on("zoomend", () => setZoom(map!.getZoom()));
      setZoom(map.getZoom());
      setMapReady((n) => n + 1);
    })();

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      layerRef.current = null;
      tileRef.current = null;
      markerEls.current.clear();
    };
  }, [mounted]);

  // ------------------------------------------------ layer swap (map/sat)
  useEffect(() => {
    satelliteRef.current = satellite;
    const map = mapRef.current;
    const prev = tileRef.current;
    if (!map || !prev) return;
    let cancelled = false;
    void (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      prev.remove();
      tileStats.current = { errored: 0, loaded: 0 };
      const tiles = L.tileLayer(satellite ? GOOGLE_SATELLITE : GOOGLE_ROADMAP, {
        subdomains: GOOGLE_SUBDOMAINS,
        className: satellite ? "fast-google-tiles-sat" : "fast-google-tiles",
        minZoom: 4,
        maxZoom: 19,
        maxNativeZoom: 19,
        crossOrigin: "anonymous",
      });
      tiles.on("tileerror", () => {
        tileStats.current.errored += 1;
        if (tileStats.current.errored > 10 && tileStats.current.loaded === 0) setTilesDown(true);
      });
      tiles.on("tileload", () => {
        tileStats.current.loaded += 1;
        if (tileStats.current.loaded >= 4) setTilesDown(false);
      });
      tiles.addTo(mapRef.current);
      tileRef.current = tiles;
    })();
    return () => {
      cancelled = true;
    };
  }, [satellite]);

  // ---------------------------------------------------- hotspot markers
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

  const provinces = useMemo(() => {
    const present = new Set(feed?.hotspots.map((h) => h.province) ?? []);
    return PROVINCE_ORDER.filter((p) => present.has(p));
  }, [feed]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    let cancelled = false;

    void (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !layerRef.current || !mapRef.current) return;
      const currentZoom = mapRef.current.getZoom();
      layer.clearLayers();
      markerEls.current.clear();

      for (const h of filtered) {
        const d = 18 + h.intensity * 6;
        const ringOpacity = Math.min(0.95, 0.38 + h.intensity * 0.115);
        const active = selected ? hotspotKey(selected) === hotspotKey(h) : false;
        const html = `
          <button type="button" class="fast-hspot${active ? " fast-hspot-active" : ""}"
                  style="width:${d}px;height:${d}px"
                  aria-label="Documented hotspot: ${h.area}, ${h.province}">
            <span class="fast-hspot-ring" style="opacity:${ringOpacity};border-width:${h.intensity >= 5 ? 2 : 1}px"></span>
            ${h.intensity >= 4 ? '<span class="fast-hspot-ping" aria-hidden="true"></span>' : ""}
            <span class="fast-hspot-dot"></span>
          </button>`;
        const icon = L.divIcon({
          className: "fast-hspot-icon",
          html,
          iconSize: [d, d],
          iconAnchor: [d / 2, d / 2],
        });
        const marker = L.marker([h.lat, h.lng], { icon, keyboard: false });
        markerHotspots.set(marker, h);
        marker.on("click", () => setSelected(h));
        marker.addTo(layer);
        if (currentZoom >= 9) {
          marker.bindTooltip(h.area, {
            className: "fast-hspot-label",
            direction: "bottom",
            offset: [0, 6],
            permanent: true,
          });
        }
        const el = marker.getElement();
        if (el) markerEls.current.set(hotspotKey(h), el.firstElementChild as HTMLElement);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filtered, selected, mapReady]);

  // tooltip visibility on zoom (no marker rebuild)
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const markers = layer.getLayers() as LeafletNS.Marker[];
    for (const m of markers) {
      const label = m.getTooltip();
      const h = markerHotspots.get(m);
      if (zoom >= 9 && !label && h) {
        m.bindTooltip(h.area, {
          className: "fast-hspot-label",
          direction: "bottom",
          offset: [0, 6],
          permanent: true,
        });
      } else if (zoom < 9 && label) {
        m.unbindTooltip();
      }
    }
  }, [zoom]);

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

  // marker highlight follows selection without rebuilding markers
  useEffect(() => {
    const activeKey = selected ? hotspotKey(selected) : null;
    for (const [key, el] of markerEls.current) {
      el.classList.toggle("fast-hspot-active", key === activeKey);
    }
  }, [selected, filtered]);

  const zoomStep = useCallback((dir: 1 | -1) => {
    const map = mapRef.current;
    if (!map) return;
    if (dir === 1) map.zoomIn(1, { animate: !REDUCED_MOTION });
    else map.zoomOut(1, { animate: !REDUCED_MOTION });
  }, []);

  const recenter = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.flyToBounds(
      SA_BOUNDS as unknown as LeafletNS.LatLngBoundsLiteral,
      { ...FIT_PAD, duration: REDUCED_MOTION ? 0 : 0.7 }
    );
    setSelected(null);
  }, []);

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
            Google Maps · community safety intel · geolocation disabled by design
          </p>
        </div>
        {feed && (
          <span className="hidden shrink-0 rounded-full border border-neutral-700 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-neutral-300 sm:inline">
            {SOURCE_BADGE[feed.source]}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            const ctrl = new AbortController();
            void load(ctrl.signal, { refresh: true });
          }}
          disabled={refreshing || loading}
          aria-label="Refresh AI intel"
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-900 hover:text-white disabled:opacity-40"
        >
          <RefreshCw className={`size-4${refreshing ? " animate-spin" : ""}`} aria-hidden />
        </button>
      </header>

      {/* ---------------------------------------------------------- map */}
      <div className="relative flex-1 overflow-hidden bg-black">
        <div ref={hostRef} className="absolute inset-0 z-0" aria-label="Interactive Google map of South Africa with documented hotspot areas" />

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
              className="h-10 w-full rounded-full border border-neutral-800 bg-neutral-950 pl-9 pr-3 font-mono text-[11px] uppercase tracking-wider text-neutral-200 outline-none transition-colors placeholder:text-neutral-600 focus:border-neutral-600"
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
                    className={`min-h-[32px] shrink-0 rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest transition-colors ${
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
                className="min-h-[32px] font-mono text-[9px] uppercase tracking-widest text-neutral-200 underline-offset-2 hover:underline"
              >
                Retry
              </button>
            </div>
          )}
          {tilesDown && !error && (
            <div className="pointer-events-none flex items-center gap-2 self-start rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1.5">
              <TriangleAlert className="size-3 text-neutral-500" aria-hidden />
              <span className="text-[10px] text-neutral-400">
                Google tiles unreachable — hotspots still plotted
              </span>
            </div>
          )}
          {feed?.source === "fallback" && (
            <div className="pointer-events-none flex max-w-full items-center gap-2 self-start rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1.5">
              <TriangleAlert className="size-3 shrink-0 text-neutral-500" aria-hidden />
              <span className="truncate text-[10px] text-neutral-400">
                {feed.reason === "no-key"
                  ? "Curated dataset — set GEMINI_API_KEY on the server for live AI intel"
                  : "AI generation unavailable — serving curated dataset"}
              </span>
            </div>
          )}
        </div>

        {/* zoom + layer controls (44px touch targets) */}
        <div className="absolute bottom-3 right-3 z-[700] flex flex-col gap-1.5">
          {[
            { icon: Plus, label: "Zoom in", action: () => zoomStep(1) },
            { icon: Minus, label: "Zoom out", action: () => zoomStep(-1) },
            {
              icon: Layers,
              label: satellite ? "Switch to street map" : "Switch to satellite",
              action: () => setSatellite((s) => !s),
            },
            {
              icon: Crosshair,
              label: "Recenter on South Africa",
              action: recenter,
            },
          ].map(({ icon: Icon, label, action }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              onClick={action}
              className="flex size-11 items-center justify-center rounded-xl border border-neutral-800 bg-black/90 text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white"
            >
              <Icon className="size-4" aria-hidden />
            </button>
          ))}
        </div>

        {/* hint — mobile users learn pinch/drag */}
        {zoom < 7 && !loading && !!feed && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-[690] -translate-x-1/2">
            <span className="whitespace-nowrap rounded-full border border-neutral-800 bg-neutral-950/80 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-neutral-500">
              Drag · pinch or scroll to zoom
            </span>
          </div>
        )}

        {/* loading state (no bars — a pulse of text only) */}
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

        {/* detail panel (bespoke bottom sheet / side card) */}
        {selected && (
          <div
            ref={panelRef}
            className="absolute inset-x-0 bottom-0 z-[750] max-h-[62vh] overflow-y-auto rounded-t-2xl border-t border-neutral-800 bg-neutral-950/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-16 sm:max-h-none sm:w-80 sm:rounded-2xl sm:border sm:pb-4"
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
        <span className="text-[9px] text-neutral-600">Basemap © Google</span>
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
