"use client";

/**
 * FAST — SURROUNDINGS: South Africa community-safety map.
 *
 * Fully self-contained vector map. The basemap (simplified province
 * boundaries) ships inside the bundle as `sa-geo.ts`, so this screen makes
 * ZERO external requests — no tile provider, no API key, nothing that can
 * 403, rate-limit or observe the user. Pan / drag / pinch-zoom / wheel-zoom
 * are hand-rolled pointer handlers; all chrome is bespoke.
 *
 * Strictly monochrome; threat levels are expressed with grey shades, borders
 * and weight only. Geolocation is intentionally NOT used anywhere.
 * Motion is GSAP-driven and respects prefers-reduced-motion.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
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
import { SA_CITIES, SA_PROVINCES } from "@/lib/fast/sa-geo";
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

type View = { k: number; x: number; y: number };

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

function hotspotKey(h: Hotspot): string {
  return `${h.province}|${h.area.toLowerCase()}`;
}

// --------------------------------------------------------- projection setup

/** Web-Mercator y (degrees) — screen y grows downward, so negate. */
function mercY(lat: number): number {
  const phi = (lat * Math.PI) / 180;
  return -(180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + phi / 2));
}

const PX = (lng: number) => lng;
const PY = (lat: number) => mercY(lat);

// viewBox: fit the country with a small margin
const BOUNDS = (() => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of SA_PROVINCES) {
    for (const ring of p.rings) {
      for (const [lng, lat] of ring) {
        const x = PX(lng);
        const y = PY(lat);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
})();

const PAD = 0.5;
const VB = {
  x: BOUNDS.minX - PAD,
  y: BOUNDS.minY - PAD,
  w: BOUNDS.maxX - BOUNDS.minX + 2 * PAD,
  h: BOUNDS.maxY - BOUNDS.minY + 2 * PAD,
};

const VIEW_BOX = `${VB.x} ${VB.y} ${VB.w} ${VB.h}`;
const MIN_K = 1;
const MAX_K = 26;

/** Province outline path (all rings merged, even-odd fill). */
function provincePath(rings: [number, number][][]): string {
  return rings
    .map(
      (ring) =>
        `M${ring.map(([lng, lat], i) => `${i === 0 ? "" : "L"}${PX(lng).toFixed(2)} ${PY(lat).toFixed(2)}`).join("")}Z`
    )
    .join(" ");
}

/** Rough visual centroid of the largest ring (for name labels). */
function ringCentroid(rings: [number, number][][]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const [lng, lat] of rings[0]) {
    sx += PX(lng);
    sy += PY(lat);
    n += 1;
  }
  return { x: sx / n, y: sy / n };
}

const PROVINCE_SHAPES = SA_PROVINCES.map((p) => ({
  name: p.name,
  d: provincePath(p.rings),
  centroid: ringCentroid(p.rings),
}));

const CITIES = SA_CITIES.map((c) => ({ name: c.name, x: PX(c.lng), y: PY(c.lat) }));

// graticule — light 2° grid for the tactical feel
const GRID_LINES = (() => {
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let lng = 16; lng <= 34; lng += 2) {
    lines.push({ x1: lng, y1: PY(-22), x2: lng, y2: PY(-36) });
  }
  for (let lat = -22; lat >= -36; lat -= 2) {
    lines.push({ x1: 16, y1: PY(lat), x2: 34, y2: PY(lat) });
  }
  return lines;
})();

// --------------------------------------------------- injected marker styles

function injectHotspotStyles() {
  if (document.getElementById("fast-hotspot-styles")) return;
  const style = document.createElement("style");
  style.id = "fast-hotspot-styles";
  style.textContent = `
.fast-hspot {
  position: absolute; display: flex; align-items: center; justify-content: center;
  transform: translate(-50%, -50%); border-radius: 9999px; cursor: pointer;
  background: transparent; border: none; padding: 0; outline: none;
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
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [query, setQuery] = useState("");
  const [province, setProvince] = useState<string>("ALL");
  const [selected, setSelected] = useState<Hotspot | null>(null);
  const [hoverProv, setHoverProv] = useState<string | null>(null);

  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });

  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef<View>(view);
  viewRef.current = view;

  // open/close mount dance (derive during render — the React-sanctioned
  // pattern, same as FastModal): reopening starts with a clean detail panel.
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) {
      setMounted(true);
      setSelected(null);
    }
  }

  // marker styles are injected once (they cover the HTML overlay markers)
  useEffect(() => {
    if (mounted) injectHotspotStyles();
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

  // ------------------------------------------------- host measurement
  useEffect(() => {
    if (!mounted || !hostRef.current) return;
    const el = hostRef.current;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [mounted]);

  // ----------------------------------------------------- pan/zoom engine
  // svg-user units per pixel ("meet" letterboxing included).
  // meet scales by min(w/VB.w, h/VB.h) px per unit -> units per px is MAX.
  const unitScale = useMemo(() => {
    if (size.w < 2 || size.h < 2) return 1;
    return Math.max(VB.w / size.w, VB.h / size.h);
  }, [size]);

  const offsets = useMemo(() => {
    if (size.w < 2 || size.h < 2) return { offX: 0, offY: 0 };
    const s = unitScale;
    return { offX: (size.w - VB.w / s) / 2, offY: (size.h - VB.h / s) / 2 };
  }, [size, unitScale]);

  /**
   * Keep the country sensibly framed: the visible svg-user window is the
   * element size / k (letterbox included). Its centre must stay within the
   * country bounds (+ a small slack). When the whole country already fits an
   * axis, that axis is centre-locked.
   */
  const clampView = useCallback(
    (v: View): View => {
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k));
      const cx = VB.x + VB.w / 2; // viewport centre in svg-user space (xMidYMid)
      const cy = VB.y + VB.h / 2;
      const wv = (size.w * unitScale) / k;
      const hv = (size.h * unitScale) / k;
      const SLACK = 2.2;
      const fix = (centre: number, lo: number, hi: number, win: number) => {
        if (win >= hi - lo) return (lo + hi) / 2;
        return Math.min(Math.max(centre, lo + win / 2 - SLACK), hi - win / 2 + SLACK);
      };
      const mx = fix((cx - v.x) / k, BOUNDS.minX, BOUNDS.maxX, wv);
      const my = fix((cy - v.y) / k, BOUNDS.minY, BOUNDS.maxY, hv);
      return { k, x: cx - k * mx, y: cy - k * my };
    },
    [size, unitScale]
  );

  /** client point -> svg-user coords (viewBox space, before pan/zoom) */
  const clientToSvg = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      return {
        x: (px - offsets.offX) / unitScale + VB.x,
        y: (py - offsets.offY) / unitScale + VB.y,
      };
    },
    [offsets, unitScale]
  );

  /** zoom keeping a fixed svg-user anchor point */
  const zoomAt = useCallback(
    (anchor: { x: number; y: number }, nextK: number): View => {
      const v = viewRef.current;
      const mx = (anchor.x - v.x) / v.k;
      const my = (anchor.y - v.y) / v.k;
      return clampView({ k: nextK, x: anchor.x - nextK * mx, y: anchor.y - nextK * my });
    },
    [clampView]
  );

  const setViewClamped = useCallback(
    (v: View) => {
      setView(clampView(v));
    },
    [clampView]
  );

  // wheel zoom (non-passive so we can preventDefault)
  useEffect(() => {
    const svg = svgRef.current;
    if (!mounted || !svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = clientToSvg(e.clientX, e.clientY);
      if (!p) return;
      const factor = Math.exp(-e.deltaY * 0.0016);
      setViewClamped(zoomAt(p, viewRef.current.k * factor));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [mounted, clientToSvg, zoomAt, setViewClamped]);

  // pointer pan + pinch
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; k0: number; anchor: { x: number; y: number } } | null>(null);
  const panLast = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 1) {
        panLast.current = { x: e.clientX, y: e.clientY };
      } else if (pointers.current.size === 2) {
        panLast.current = null;
        const [a, b] = [...pointers.current.values()];
        const pa = clientToSvg(a.x, a.y);
        const pb = clientToSvg(b.x, b.y);
        if (pa && pb) {
          pinch.current = {
            d0: Math.max(8, Math.hypot(pb.x - pa.x, pb.y - pa.y)),
            k0: viewRef.current.k,
            anchor: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
          };
        }
      }
    },
    [clientToSvg]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.current.size >= 2 && pinch.current) {
        const [a, b] = [...pointers.current.values()];
        const pa = clientToSvg(a.x, a.y);
        const pb = clientToSvg(b.x, b.y);
        if (!pa || !pb) return;
        const d = Math.max(8, Math.hypot(pb.x - pa.x, pb.y - pa.y));
        setViewClamped(zoomAt(pinch.current.anchor, pinch.current.k0 * (d / pinch.current.d0)));
        return;
      }

      if (panLast.current) {
        const dx = (e.clientX - panLast.current.x) / unitScale;
        const dy = (e.clientY - panLast.current.y) / unitScale;
        panLast.current = { x: e.clientX, y: e.clientY };
        const v = viewRef.current;
        setViewClamped({ ...v, x: v.x + dx, y: v.y + dy });
      }
    },
    [clientToSvg, setViewClamped, unitScale, zoomAt]
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1) {
      const [only] = [...pointers.current.values()];
      panLast.current = { x: only.x, y: only.y };
    } else if (pointers.current.size === 0) {
      panLast.current = null;
    }
  }, []);

  // animated zoom buttons (GSAP-driven so the motion matches the app)
  const animateView = useCallback(
    (target: View) => {
      const proxy = { ...viewRef.current };
      gsap.to(proxy, {
        k: target.k,
        x: target.x,
        y: target.y,
        duration: REDUCED_MOTION ? 0 : 0.45,
        ease: "power3.out",
        overwrite: "auto",
        onUpdate: () => setView(clampView({ k: proxy.k, x: proxy.x, y: proxy.y })),
      });
    },
    [clampView]
  );

  const zoomStep = useCallback(
    (dir: 1 | -1) => {
      const v = viewRef.current;
      // anchor = current viewport centre in svg-user space
      const anchor = { x: VB.x + VB.w / 2, y: VB.y + VB.h / 2 };
      const mx = (anchor.x - v.x) / v.k;
      const my = (anchor.y - v.y) / v.k;
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * (dir === 1 ? 1.6 : 1 / 1.6)));
      animateView(clampView({ k, x: anchor.x - k * mx, y: anchor.y - k * my }));
    },
    [animateView, clampView]
  );

  const recenter = useCallback(() => {
    animateView(clampView({ k: 1, x: 0, y: 0 }));
    setSelected(null);
  }, [animateView, clampView]);

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

  const filteredKeys = useMemo(() => new Set(filtered.map(hotspotKey)), [filtered]);

  // project hotspots into map units
  const plotted = useMemo(
    () =>
      filtered.map((h) => ({
        h,
        x: PX(h.lng),
        y: PY(h.lat),
      })),
    [filtered]
  );

  // ------------------------------------------------- marker layer motion
  const markerLayerRef = useRef<HTMLDivElement>(null);
  const firstPlot = useRef(true);

  useGSAP(
    () => {
      if (!markerLayerRef.current) return;
      if (REDUCED_MOTION) return;
      gsap.fromTo(
        markerLayerRef.current,
        { opacity: 0 },
        { opacity: 1, duration: firstPlot.current ? 0.6 : 0.3, ease: "power2.out" }
      );
      firstPlot.current = false;
    },
    { dependencies: [filteredKeys] }
  );

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

  /** map coords -> host pixel coords (markers keep constant screen size) */
  const toPx = (mx: number, my: number) => {
    const v = view;
    return {
      left: offsets.offX + (v.x + v.k * mx - VB.x) / unitScale,
      top: offsets.offY + (v.y + v.k * my - VB.y) / unitScale,
    };
  };

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
        <div ref={hostRef} className="absolute inset-0">
          <svg
            ref={svgRef}
            viewBox={VIEW_BOX}
            preserveAspectRatio="xMidYMid meet"
            role="application"
            aria-label="Interactive vector map of South Africa with documented hotspot areas"
            className="absolute inset-0 h-full w-full touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            <defs>
              <radialGradient id="fast-map-glow" cx="50%" cy="42%" r="75%">
                <stop offset="0%" stopColor="#161616" />
                <stop offset="100%" stopColor="#050505" />
              </radialGradient>
            </defs>

            {/* backdrop wash inside the viewBox */}
            <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="url(#fast-map-glow)" />

            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {/* graticule */}
              <g aria-hidden>
                {GRID_LINES.map((l, i) => (
                  <line
                    key={i}
                    x1={l.x1}
                    y1={l.y1}
                    x2={l.x2}
                    y2={l.y2}
                    stroke="#1c1c1c"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>

              {/* provinces */}
              {PROVINCE_SHAPES.map((p) => {
                const active = province === p.name;
                const hovered = hoverProv === p.name;
                return (
                  <path
                    key={p.name}
                    d={p.d}
                    fill={active ? "#262626" : hovered ? "#1d1d1d" : "#111111"}
                    stroke={active ? "#8a8a8a" : hovered ? "#5a5a5a" : "#333333"}
                    strokeWidth={active ? 1.5 : 1}
                    vectorEffect="non-scaling-stroke"
                    fillRule="evenodd"
                    className="transition-[fill,stroke] duration-200"
                    onPointerEnter={() => setHoverProv(p.name)}
                    onPointerLeave={() => setHoverProv((cur) => (cur === p.name ? null : cur))}
                  />
                );
              })}
            </g>
          </svg>

          {/* ---------------------------------------- HTML overlay layer */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {/* city dots + labels (HTML layer = constant pixel size) */}
            {size.w > 0 &&
              CITIES.map((c) => {
                const pt = toPx(c.x, c.y);
                if (pt.left < -80 || pt.top < -40 || pt.left > size.w + 80 || pt.top > size.h + 40)
                  return null;
                return (
                  <span key={c.name} className="absolute" style={{ left: pt.left, top: pt.top }}>
                    <span
                      className="absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-500"
                      aria-hidden
                    />
                    <span
                      className="absolute whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.14em] text-neutral-500"
                      style={{
                        left: 8,
                        top: -6,
                        opacity: view.k >= 2.1 ? 0.6 : 0.34,
                      }}
                    >
                      {c.name}
                    </span>
                  </span>
                );
              })}

            {/* province names — appear once you zoom in a little */}
            {size.w > 0 &&
              view.k >= 1.8 &&
              PROVINCE_SHAPES.filter((p) => province === "ALL" || p.name === province).map((p) => {
                const pt = toPx(p.centroid.x, p.centroid.y);
                if (pt.left < -100 || pt.top < -40 || pt.left > size.w + 100 || pt.top > size.h + 40)
                  return null;
                return (
                  <span
                    key={p.name}
                    className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-600"
                    style={{ left: pt.left, top: pt.top }}
                  >
                    {p.name}
                  </span>
                );
              })}

            {/* hotspot markers */}
            <div ref={markerLayerRef} className="absolute inset-0">
              {size.w > 0 &&
                plotted.map(({ h, x, y }) => {
                  const pt = toPx(x, y);
                  if (pt.left < -60 || pt.top < -60 || pt.left > size.w + 60 || pt.top > size.h + 60)
                    return null;
                  const d = 18 + h.intensity * 6;
                  const isActive = selected ? hotspotKey(selected) === hotspotKey(h) : false;
                  const ringOpacity = Math.min(0.95, 0.38 + h.intensity * 0.115);
                  return (
                    <div key={hotspotKey(h)} className="absolute" style={{ left: pt.left, top: pt.top }}>
                      <button
                        type="button"
                        aria-label={`Documented hotspot: ${h.area}, ${h.province}`}
                        onClick={() => setSelected(h)}
                        className={`fast-hspot${isActive ? " fast-hspot-active" : ""}`}
                        style={{ width: d, height: d }}
                      >
                        <span
                          className="fast-hspot-ring"
                          style={{ opacity: ringOpacity, borderWidth: h.intensity >= 5 ? 2 : 1 }}
                        />
                        {h.intensity >= 4 && <span className="fast-hspot-ping" aria-hidden />}
                        <span className="fast-hspot-dot" />
                      </button>
                      {view.k >= 2.6 && (
                        <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-neutral-300">
                          {h.area}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

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
        </div>

        {/* zoom controls (44px+ touch targets) */}
        <div className="absolute bottom-3 right-3 z-[700] flex flex-col gap-1.5">
          {[
            { icon: Plus, label: "Zoom in", action: () => zoomStep(1) },
            { icon: Minus, label: "Zoom out", action: () => zoomStep(-1) },
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
        {view.k === 1 && !loading && !!feed && (
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
        <span className="text-[9px] text-neutral-600">Boundaries · geoBoundaries (CC BY 3.0 IGO)</span>
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
