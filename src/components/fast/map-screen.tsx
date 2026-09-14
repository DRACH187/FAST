"use client";

/**
 * FAST — SURROUNDINGS: South Africa community-safety map.
 *
 * Basemap: REAL Google Maps tiles (mt*.google.com raster endpoint — no API
 * key required) rendered through Leaflet and pushed through a grayscale
 * filter so the whole map stays strictly black/white/grey. A satellite
 * layer is one tap away, filtered the same way. The viewport is hard-locked
 * to South Africa (maxBoundsViscosity 1.0) and geolocation is intentionally
 * NOT used anywhere.
 *
 * Hotspot intel: Gemini free flash model via /api/map/hotspots (curated
 * offline fallback built in). While the map is open the feed auto-syncs
 * every 10 minutes (matching the server TTL); a NEXT SYNC countdown chip
 * ticks in the footer and resets after every fetch. Markers are bespoke
 * divIcons; the detail panel, analytics dashboard, filters and footer are
 * hand-rolled — zero default Leaflet chrome.
 *
 * Analytics: toggleable monochrome dashboard (KPI row, threat distribution,
 * province breakdown, top documented groups, trend vs last sync). Bottom
 * sheet on mobile, right card on sm+. Motion is GSAP-driven and respects
 * prefers-reduced-motion.
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
  BarChart3,
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

/** Previous feed snapshot kept in memory for the TREND VS LAST SYNC panel. */
type Snapshot = { hotspots: Hotspot[]; updatedAt: string };

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

const THREAT_RANK: Record<Threat, number> = { MODERATE: 0, HIGH: 1, SEVERE: 2 };

function threatChipClass(threat: Threat): string {
  if (threat === "SEVERE") return "border-white bg-white text-black";
  if (threat === "HIGH") return "border-neutral-400 text-neutral-200";
  return "border-neutral-700 text-neutral-400";
}

// ---------------------------------------------------------------- constants

/** Client auto-sync cadence — mirrors CACHE_TTL_MS on /api/map/hotspots. */
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
/** After a failed sync, back off before the next attempt. */
const ERROR_RETRY_MS = 30 * 1000;

/** South Africa, with a little breathing room — the fit/recentre target. */
const SA_BOUNDS: [[number, number], [number, number]] = [
  [-34.95, 16.3],
  [-21.9, 33.3],
];
/** Hard panning limit: South Africa plus a small margin. */
const SA_LIMITS: [[number, number], [number, number]] = [
  [-35.4, 15.7],
  [-21.5, 33.9],
];
const FIT_PAD: LeafletNS.FitBoundsOptions = { padding: [24, 24], animate: !REDUCED_MOTION };

const GOOGLE_ROADMAP = "https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=en";
const GOOGLE_SATELLITE = "https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&hl=en";
const GOOGLE_SUBDOMAINS = ["mt0", "mt1", "mt2", "mt3"];

function hotspotKey(h: Hotspot): string {
  return `${h.province}|${h.area.toLowerCase()}`;
}

function formatUtc(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function formatCountdown(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
.fast-hspot:focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }
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

// ------------------------------------------------------------ KPI card

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-neutral-900 bg-black/60 p-3">
      <span className="block font-mono text-lg leading-none tabular-nums text-white">{value}</span>
      <span className="mt-1.5 block font-mono text-[8px] uppercase tracking-widest text-neutral-500">
        {label}
      </span>
      {note && <span className="mt-0.5 block text-[9px] leading-snug text-neutral-600">{note}</span>}
    </div>
  );
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
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  const [tilesDown, setTilesDown] = useState(false);
  const [zoom, setZoom] = useState(6);
  const [satellite, setSatellite] = useState(false);
  /** bumped once the Leaflet map + marker layer exist — retriggers markers */
  const [mapReady, setMapReady] = useState(0);

  /** 1-second heartbeat while the map is open — drives the countdown. */
  const [nowSec, setNowSec] = useState(() => Date.now());
  /** epoch ms of the next scheduled intel sync (null until a fetch lands). */
  const [nextSyncAt, setNextSyncAt] = useState<number | null>(null);
  /** previous feed snapshot (state mirrors an in-memory ref for render). */
  const [prevSnapshot, setPrevSnapshot] = useState<Snapshot | null>(null);

  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const analyticsRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const layerRef = useRef<LeafletNS.LayerGroup | null>(null);
  const tileRef = useRef<LeafletNS.TileLayer | null>(null);
  const satelliteRef = useRef(false);
  const markerEls = useRef(new Map<string, HTMLElement>());
  const tileStats = useRef({ errored: 0, loaded: 0 });

  const haveFeedRef = useRef(false);
  const inflightRef = useRef(false);
  const lastFetchAtRef = useRef(0);
  const feedRef = useRef<Feed | null>(null);
  const prevSnapshotRef = useRef<Snapshot | null>(null);

  // open/close mount dance (derive during render — the React-sanctioned
  // pattern, same as FastModal): reopening starts with clean panels.
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) {
      setMounted(true);
      setSelected(null);
      setAnalyticsOpen(false);
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
        { opacity: 1, scale: 1, duration: 0.34, ease: "power3.out" }
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
      duration: REDUCED_MOTION ? 0 : 0.2,
      ease: "power2.in",
      onComplete: () => setMounted(false),
    });
  }, [open, mounted]);

  // ------------------------------------------------- esc / scroll lock
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // panels dismiss first, the map itself only on a second Esc
      if (selected) setSelected(null);
      else if (analyticsOpen) setAnalyticsOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, selected, analyticsOpen]);

  // ------------------------------------------------------- data fetch
  const load = useCallback(async (signal: AbortSignal, opts: { refresh?: boolean } = {}) => {
    if (inflightRef.current) return;
    inflightRef.current = true;
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
        // back off, then the scheduler retries automatically
        setNextSyncAt(Date.now() + ERROR_RETRY_MS);
        return;
      }
      haveFeedRef.current = true;
      const nextFeed: Feed = {
        hotspots: body.hotspots,
        source: body.source ?? "fallback",
        updatedAt: body.updatedAt ?? new Date().toISOString(),
        reason: typeof body.reason === "string" ? body.reason : undefined,
      };
      // keep the outgoing feed as the previous snapshot for TREND VS LAST SYNC
      const outgoing = feedRef.current;
      if (outgoing) {
        const snap: Snapshot = { hotspots: outgoing.hotspots, updatedAt: outgoing.updatedAt };
        prevSnapshotRef.current = snap;
        setPrevSnapshot(snap);
      }
      feedRef.current = nextFeed;
      lastFetchAtRef.current = Date.now();
      setFeed(nextFeed);
      setNextSyncAt(Date.now() + SYNC_INTERVAL_MS);
    } catch (err) {
      if ((err as Error | null)?.name === "AbortError") return;
      setError("Network error — could not reach the intel feed.");
      setNextSyncAt(Date.now() + ERROR_RETRY_MS);
    } finally {
      inflightRef.current = false;
      if (!signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // first open per mount: exactly one initial fetch
  useEffect(() => {
    if (!mounted || haveFeedRef.current) return;
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [mounted, attempt, load]);

  // reopening after the sync window elapsed: refresh immediately
  useEffect(() => {
    if (!open || !mounted) return;
    if (!haveFeedRef.current) return; // first open — the initial loader owns it
    if (lastFetchAtRef.current && Date.now() - lastFetchAtRef.current >= SYNC_INTERVAL_MS) {
      const ctrl = new AbortController();
      void load(ctrl.signal);
    }
  }, [open, mounted, load]);

  // 1s heartbeat while the map is open
  useEffect(() => {
    if (!open) return;
    setNowSec(Date.now());
    const id = window.setInterval(() => setNowSec(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  // scheduled 10-minute auto-sync (also fires the moment the countdown lapses)
  useEffect(() => {
    if (!open || !feed) return;
    if (nextSyncAt === null) {
      setNextSyncAt(Date.now() + SYNC_INTERVAL_MS);
      return;
    }
    if (nowSec >= nextSyncAt) {
      const ctrl = new AbortController();
      void load(ctrl.signal);
    }
  }, [nowSec, open, feed, nextSyncAt, load]);

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
        // South Africa ONLY: rigid bounds, no ocean-drifting
        maxBounds: L.latLngBounds(SA_LIMITS),
        maxBoundsViscosity: 1.0,
        zoomSnap: 0.5,
        worldCopyJump: false,
        keyboard: true,
      });
      map.fitBounds(L.latLngBounds(SA_BOUNDS), FIT_PAD);
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
        marker.on("click", () => {
          setAnalyticsOpen(false);
          setSelected(h);
        });
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
          { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: "power3.out", overwrite: "auto" }
        );
      }
    },
    { dependencies: [selected] }
  );

  // ---------------------------------------------- analytics panel motion
  useGSAP(
    () => {
      if (!analyticsOpen || !analyticsRef.current) return;
      if (REDUCED_MOTION) {
        gsap.set(analyticsRef.current, { opacity: 1, x: 0, y: 0 });
        return;
      }
      const desktop = window.matchMedia("(min-width: 640px)").matches;
      gsap.fromTo(
        analyticsRef.current,
        desktop ? { opacity: 0, x: 24 } : { opacity: 0, y: 28 },
        { opacity: 1, x: 0, y: 0, duration: 0.34, ease: "power3.out", overwrite: "auto" }
      );
    },
    { dependencies: [analyticsOpen] }
  );

  // marker highlight follows selection without rebuilding markers
  useEffect(() => {
    const activeKey = selected ? hotspotKey(selected) : null;
    for (const [key, el] of markerEls.current) {
      el.classList.toggle("fast-hspot-active", key === activeKey);
    }
  }, [selected, filtered]);

  // drop a stale selection if its area vanished after a refresh
  useEffect(() => {
    if (!selected || !feed) return;
    const key = hotspotKey(selected);
    if (!feed.hotspots.some((h) => hotspotKey(h) === key)) setSelected(null);
  }, [feed, selected]);

  const zoomStep = useCallback((dir: 1 | -1) => {
    const map = mapRef.current;
    if (!map) return;
    if (dir === 1) map.zoomIn(1, { animate: !REDUCED_MOTION });
    else map.zoomOut(1, { animate: !REDUCED_MOTION });
  }, []);

  const recenter = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.flyToBounds(SA_BOUNDS, { ...FIT_PAD, duration: REDUCED_MOTION ? 0 : 0.7 });
    setSelected(null);
  }, []);

  const manualRefresh = useCallback(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal, { refresh: true });
  }, [load]);

  // ----------------------------------------------- analytics computation
  const analytics = useMemo(() => {
    const hs = feed?.hotspots ?? [];
    const dist = [0, 0, 0, 0, 0]; // index 0 -> intensity 1
    const provMap = new Map<string, { count: number; max: number }>();
    const gangMap = new Map<string, { areas: string[]; threat: Threat }>();
    const provinceSet = new Set<string>();
    let intensitySum = 0;
    let severeAreas = 0;

    for (const h of hs) {
      provinceSet.add(h.province);
      const level = Math.min(5, Math.max(1, Math.round(h.intensity)));
      dist[level - 1] += 1;
      intensitySum += h.intensity;

      const p = provMap.get(h.province) ?? { count: 0, max: 0 };
      p.count += 1;
      p.max = Math.max(p.max, h.intensity);
      provMap.set(h.province, p);

      if (h.intensity === 5 || h.gangs.some((g) => g.threat === "SEVERE")) severeAreas += 1;

      for (const g of h.gangs) {
        const entry = gangMap.get(g.name) ?? { areas: [], threat: "MODERATE" as Threat };
        if (!entry.areas.includes(h.area)) entry.areas.push(h.area);
        if (THREAT_RANK[g.threat] > THREAT_RANK[entry.threat]) entry.threat = g.threat;
        gangMap.set(g.name, entry);
      }
    }

    const provinceRows = [...provMap.entries()]
      .map(([name, v]) => ({ name, count: v.count, max: v.max }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const topGroups = [...gangMap.entries()]
      .map(([name, v]) => ({ name, areas: v.areas, threat: v.threat }))
      .sort((a, b) => b.areas.length - a.areas.length || a.name.localeCompare(b.name))
      .slice(0, 6);

    return {
      areas: hs.length,
      groups: gangMap.size,
      provincesAffected: provinceSet.size,
      avgIntensity: hs.length ? Math.round((intensitySum / hs.length) * 10) / 10 : 0,
      severeAreas,
      dist,
      maxDist: Math.max(1, ...dist),
      provinces: provinceRows,
      topGroups,
    };
  }, [feed]);

  /** Deltas between the previous snapshot and the current feed. */
  const trend = useMemo(() => {
    if (!feed || !prevSnapshot) return null;
    const prevMap = new Map(prevSnapshot.hotspots.map((h) => [hotspotKey(h), h]));
    const curMap = new Map(feed.hotspots.map((h) => [hotspotKey(h), h]));
    const appeared: string[] = [];
    const gone: string[] = [];
    const changed: { area: string; from: number; to: number }[] = [];

    for (const h of feed.hotspots) {
      const prev = prevMap.get(hotspotKey(h));
      if (!prev) appeared.push(h.area);
      else if (prev.intensity !== h.intensity) {
        changed.push({ area: h.area, from: prev.intensity, to: h.intensity });
      }
    }
    for (const [key, h] of prevMap) {
      if (!curMap.has(key)) gone.push(h.area);
    }
    changed.sort(
      (a, b) =>
        Math.abs(b.to - b.from) - Math.abs(a.to - a.from) || a.area.localeCompare(b.area)
    );

    return {
      appeared,
      gone,
      changed: changed.slice(0, 5),
      changedTotal: changed.length,
      vsLabel: formatUtc(prevSnapshot.updatedAt),
    };
  }, [feed, prevSnapshot]);

  // countdown label (recomputed on every 1s heartbeat)
  const syncing = loading || refreshing;
  const countdownLabel = syncing
    ? "SYNCING"
    : nextSyncAt === null
      ? "--:--"
      : formatCountdown(Math.max(0, nextSyncAt - nowSec));

  // ----------------------------------------------------------- render
  if (!open && !mounted) return null;
  if (typeof window === "undefined") return null;

  const asOf = feed ? formatUtc(feed.updatedAt) : null;

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="South Africa safety map"
      className="fixed inset-0 z-[90] flex flex-col bg-black"
    >
      {/* ------------------------------------------------------- header */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-neutral-900 px-2 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close map"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-900 hover:text-white"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-[10px] font-medium uppercase tracking-widest text-neutral-100 sm:text-xs">
            Surroundings — South Africa
          </h2>
          <p className="truncate text-[10px] text-neutral-500">
            <span className="sm:hidden">Community safety intel</span>
            <span className="hidden sm:inline">
              Google Maps · community safety intel · geolocation disabled by design
            </span>
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
            setAnalyticsOpen((v) => !v);
            setSelected(null);
          }}
          aria-label="Toggle analytics"
          aria-expanded={analyticsOpen}
          aria-controls="map-analytics"
          className={`flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-neutral-900 hover:text-white ${
            analyticsOpen ? "bg-neutral-900 text-white" : "text-neutral-400"
          }`}
        >
          <BarChart3 className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={manualRefresh}
          disabled={refreshing || loading}
          aria-label="Refresh AI intel"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-900 hover:text-white disabled:opacity-40"
        >
          <RefreshCw className={`size-4${refreshing ? " animate-spin" : ""}`} aria-hidden />
        </button>
      </header>

      {/* ---------------------------------------------------------- map */}
      <div className="relative flex-1 overflow-hidden bg-black">
        <div
          ref={hostRef}
          className="absolute inset-0 z-0"
          aria-label="Interactive Google map of South Africa with documented hotspot areas"
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
              className="h-11 w-full rounded-full border border-neutral-800 bg-black/80 pl-9 pr-3 font-mono text-[11px] uppercase tracking-wider text-neutral-200 outline-none backdrop-blur-sm transition-colors placeholder:text-neutral-600 focus:border-neutral-600"
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
                    className={`min-h-[36px] shrink-0 rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest backdrop-blur-sm transition-colors ${
                      active
                        ? "border-white bg-white text-black"
                        : "border-neutral-800 bg-black/80 text-neutral-400 hover:border-neutral-600 hover:text-white"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          )}
          {error && feed && (
            <div className="pointer-events-auto flex items-center gap-2 self-start rounded-full border border-neutral-800 bg-black/80 px-3 py-1 backdrop-blur-sm">
              <TriangleAlert className="size-3 text-neutral-500" aria-hidden />
              <span className="text-[10px] text-neutral-400">{error}</span>
              <button
                type="button"
                onClick={() => setAttempt((a) => a + 1)}
                className="min-h-[44px] px-2 font-mono text-[9px] uppercase tracking-widest text-neutral-200 underline-offset-2 hover:underline"
              >
                Retry
              </button>
            </div>
          )}
          {tilesDown && !error && (
            <div className="pointer-events-none flex items-center gap-2 self-start rounded-full border border-neutral-800 bg-black/80 px-3 py-1.5 backdrop-blur-sm">
              <TriangleAlert className="size-3 text-neutral-500" aria-hidden />
              <span className="text-[10px] text-neutral-400">
                Google tiles unreachable — hotspots still plotted
              </span>
            </div>
          )}
          {feed?.source === "fallback" && (
            <div className="pointer-events-none flex max-w-full items-center gap-2 self-start rounded-full border border-neutral-800 bg-black/80 px-3 py-1.5 backdrop-blur-sm">
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
              className="flex size-11 items-center justify-center rounded-xl border border-neutral-800 bg-black/90 text-neutral-300 backdrop-blur-sm transition-colors hover:border-neutral-600 hover:text-white"
            >
              <Icon className="size-4" aria-hidden />
            </button>
          ))}
        </div>

        {/* hint — mobile users learn pinch/drag */}
        {zoom < 7 && !loading && !!feed && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-[690] -translate-x-1/2">
            <span className="whitespace-nowrap rounded-full border border-neutral-800 bg-black/80 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-neutral-500 backdrop-blur-sm">
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
          <div className="absolute inset-0 z-[640] flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center backdrop-blur-sm">
            <TriangleAlert className="size-5 text-neutral-500" aria-hidden />
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-neutral-300">
              Intel feed unavailable
            </span>
            <p className="max-w-xs text-xs text-neutral-500">{error}</p>
            <button
              type="button"
              onClick={() => setAttempt((a) => a + 1)}
              className="min-h-[44px] rounded-full border border-neutral-700 px-4 font-mono text-[10px] uppercase tracking-widest text-neutral-200 transition-colors hover:border-neutral-500 hover:bg-neutral-900"
            >
              Retry
            </button>
          </div>
        )}

        {/* empty search result */}
        {feed && !loading && filtered.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-[640] flex items-center justify-center">
            <span className="rounded-full border border-neutral-800 bg-black/85 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-neutral-500 backdrop-blur-sm">
              No areas match
            </span>
          </div>
        )}

        {/* --------------------------------------------- analytics panel */}
        {analyticsOpen && feed && (
          <div
            ref={analyticsRef}
            id="map-analytics"
            role="region"
            aria-label="Surroundings analytics"
            className="absolute inset-x-0 bottom-0 z-[760] max-h-[70dvh] overflow-y-auto rounded-t-2xl border-t border-neutral-800 bg-neutral-950/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-16 sm:max-h-[calc(100%-6rem)] sm:w-96 sm:rounded-2xl sm:border sm:pb-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="font-mono text-[10px] font-medium uppercase tracking-widest text-neutral-100">
                  Analytics
                </h3>
                <span className="shrink-0 rounded-full border border-neutral-700 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-neutral-400">
                  {SOURCE_BADGE[feed.source]}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAnalyticsOpen(false)}
                aria-label="Close analytics"
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-white"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            {/* KPI row */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Kpi label="Areas tracked" value={String(analytics.areas)} />
              <Kpi label="Documented groups" value={String(analytics.groups)} />
              <Kpi label="Provinces affected" value={`${analytics.provincesAffected}/9`} />
              <Kpi label="Avg intensity" value={analytics.avgIntensity.toFixed(1)} />
              <div className="col-span-2">
                <Kpi
                  label="Severe areas"
                  value={String(analytics.severeAreas)}
                  note="Intensity 5 or any SEVERE-documented group"
                />
              </div>
            </div>

            {/* threat distribution */}
            <section className="mt-4 border-t border-neutral-900 pt-3" aria-label="Threat distribution">
              <h4 className="font-mono text-[9px] uppercase tracking-widest text-neutral-500">
                Threat distribution
              </h4>
              <div className="mt-2 space-y-1.5">
                {[1, 2, 3, 4, 5].map((level) => {
                  const count = analytics.dist[level - 1];
                  const pct = Math.round((count / analytics.maxDist) * 100);
                  return (
                    <div key={level} className="flex items-center gap-2">
                      <span className="w-6 shrink-0 font-mono text-[9px] uppercase text-neutral-500">
                        L{level}
                      </span>
                      <div
                        className="h-2.5 flex-1 overflow-hidden rounded-full bg-neutral-800"
                        role="img"
                        aria-label={`Intensity ${level}: ${count} ${count === 1 ? "area" : "areas"}`}
                      >
                        <div
                          className="h-full rounded-full bg-white"
                          style={{ width: `${count === 0 ? 0 : Math.max(6, pct)}%` }}
                        />
                      </div>
                      <span className="w-5 shrink-0 text-right font-mono text-[10px] tabular-nums text-neutral-300">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* province breakdown */}
            <section className="mt-4 border-t border-neutral-900 pt-3" aria-label="Province breakdown">
              <h4 className="font-mono text-[9px] uppercase tracking-widest text-neutral-500">
                Province breakdown
              </h4>
              <ul className="mt-2 space-y-1.5">
                {analytics.provinces.map((p) => (
                  <li
                    key={p.name}
                    className="flex items-center gap-2"
                    aria-label={`${p.name}: ${p.count} ${p.count === 1 ? "area" : "areas"}, peak intensity ${p.max} of 5`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[10px] text-neutral-300">{p.name}</span>
                    <span className="shrink-0 font-mono text-[9px] tabular-nums text-neutral-500">
                      ×{p.count}
                    </span>
                    <span className="flex shrink-0 gap-0.5" aria-hidden>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span
                          key={n}
                          className={`h-1 w-2.5 rounded-full ${n <= p.max ? "bg-white" : "bg-neutral-800"}`}
                        />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {/* top documented groups */}
            <section className="mt-4 border-t border-neutral-900 pt-3" aria-label="Top documented groups">
              <h4 className="font-mono text-[9px] uppercase tracking-widest text-neutral-500">
                Top documented groups
              </h4>
              <ul className="mt-2 space-y-2">
                {analytics.topGroups.map((g, i) => (
                  <li key={g.name} className="rounded-xl border border-neutral-900 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 font-mono text-[9px] tabular-nums text-neutral-600">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="truncate text-xs text-neutral-200">{g.name}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded-full border border-neutral-800 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-neutral-400">
                          {g.areas.length} {g.areas.length === 1 ? "AREA" : "AREAS"}
                        </span>
                        <span
                          className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${threatChipClass(g.threat)}`}
                        >
                          {g.threat}
                        </span>
                      </div>
                    </div>
                    <p className="mt-1 truncate text-[10px] text-neutral-500" title={g.areas.join(" · ")}>
                      {g.areas.join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            {/* trend vs last sync */}
            <section className="mt-4 border-t border-neutral-900 pt-3" aria-label="Trend versus last sync">
              <h4 className="font-mono text-[9px] uppercase tracking-widest text-neutral-500">
                Trend vs last sync
              </h4>
              {!trend ? (
                <div className="mt-2 rounded-xl border border-dashed border-neutral-800 p-3 text-center">
                  <p className="font-mono text-[9px] uppercase tracking-widest text-neutral-400">
                    First snapshot — baseline stored
                  </p>
                  <p className="mt-1 text-[10px] text-neutral-600">
                    New, gone and shifted areas appear here after the next sync.
                  </p>
                </div>
              ) : (
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-neutral-900/60 px-2.5 py-2">
                    <span className="font-mono text-[9px] uppercase tracking-wider text-neutral-400">
                      New areas
                    </span>
                    <span
                      className="font-mono text-[10px] tabular-nums text-neutral-100"
                      title={trend.appeared.join(", ") || undefined}
                    >
                      +{trend.appeared.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-neutral-900/60 px-2.5 py-2">
                    <span className="font-mono text-[9px] uppercase tracking-wider text-neutral-400">
                      Areas gone
                    </span>
                    <span
                      className="font-mono text-[10px] tabular-nums text-neutral-100"
                      title={trend.gone.join(", ") || undefined}
                    >
                      -{trend.gone.length}
                    </span>
                  </div>
                  <div className="rounded-lg bg-neutral-900/60 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-neutral-400">
                        Intensity shifts
                      </span>
                      <span className="font-mono text-[10px] tabular-nums text-neutral-100">
                        {trend.changedTotal}
                      </span>
                    </div>
                    {trend.changed.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {trend.changed.map((c) => (
                          <li key={c.area} className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-[10px] text-neutral-300">{c.area}</span>
                            <span className="shrink-0 font-mono text-[10px] tabular-nums text-neutral-400">
                              {c.from}→{c.to}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <p className="text-[9px] text-neutral-600">vs snapshot {trend.vsLabel}</p>
                </div>
              )}
            </section>

            {asOf && (
              <p className="mt-4 border-t border-neutral-900 pt-2.5 text-[9px] text-neutral-600">
                Feed generated {asOf}
              </p>
            )}
          </div>
        )}

        {/* detail panel (bespoke bottom sheet / side card) */}
        {selected && (
          <div
            ref={panelRef}
            className="absolute inset-x-0 bottom-0 z-[750] max-h-[62vh] overflow-y-auto rounded-t-2xl border-t border-neutral-800 bg-neutral-950/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-16 sm:max-h-[calc(100%-6rem)] sm:w-80 sm:overflow-y-auto sm:rounded-2xl sm:border sm:pb-4"
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
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-white"
              >
                <X className="size-4" aria-hidden />
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
                        className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${threatChipClass(g.threat)}`}
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
        <span className="hidden text-[9px] text-neutral-600 md:inline">
          Area-level awareness info only. Not law enforcement guidance.
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {asOf && (
            <span className="hidden text-[9px] text-neutral-600 lg:inline">AS OF {asOf}</span>
          )}
          <span
            aria-label={
              syncing ? "Intel sync in progress" : "Time until the next intel sync"
            }
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-800 bg-black/80 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-neutral-400 backdrop-blur-sm"
          >
            {syncing ? (
              <span className="animate-fast-pulse tracking-widest">SYNCING</span>
            ) : (
              <>
                <span className="text-neutral-600">NEXT SYNC</span>
                <span className="tabular-nums text-neutral-200">{countdownLabel}</span>
              </>
            )}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-neutral-800 bg-black/80 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-neutral-500 backdrop-blur-sm">
            <MapPinOff className="size-3" aria-hidden />
            Geo: Off
          </span>
        </div>
      </footer>
    </div>,
    document.body
  );
}
