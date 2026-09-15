"use client";

/**
 * FAST — SURROUNDINGS: THE HOUSE MAP (v3 — 100% CUSTOM)
 * =====================================================
 * The whole territory is DRAWN BY THE HOUSE: a deterministic procedural city
 * rendered as pure SVG. No Google, no tiles, no iframe, no external request,
 * no geolocation, no tracking — the map even runs with the network dead.
 *
 *   - 100% custom: streets, blocks, the bay, the river, the boulevard — all
 *     generated from one seeded PRNG (seed 187) so every device sees the
 *     exact same territory, forever, offline.
 *   - NO CLUTTER: six district names, the brand card, three controls. That
 *     is the entire chrome. Nothing else floats over the territory.
 *   - STRICTLY DARK: the map is black by law. No moods, no themes, no
 *     daylight mode — this is the Flats at 3am, permanently.
 *   - BRAND: the FAST GUNS logo rides the territory card AND the map itself
 *     (the 187 beacons + the painted wordmark), plus rotating house hype.
 *   - Mobile: 44px+ controls, thumb clusters, safe-area padded, bottom
 *     controls clear the floating dock (--fast-dock-clear). Reduced-motion
 *     respected. Desktop: fills the content pane beside the rail.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ArrowLeft, Crosshair, Minus, Plus } from "lucide-react";
import { ScreenShell } from "@/components/fast/motion";
import { useLivePresence } from "@/lib/fast/live";
import {
  FAST_HYPE,
  MAP_LAW,
  MAP_LIVE_BADGE,
  MAP_PROMO_TITLE,
  MAP_RESET,
  MAP_SUB,
  MAP_TERRITORY_TAG,
  MAP_TITLE,
  MAP_ZONES,
  MAP_ZOOM_IN,
  MAP_ZOOM_OUT,
  pick,
  pickDiff,
} from "@/lib/fast/copy";

// -------------------------------------------------------------------- consts

const HYPE_MS = 9000;
const WORLD = 2400;

/** Strictly dark block palette — the Flats at 3am, forever. */
const BLOCK_FILLS = ["#0a0a0a", "#0d0d0d", "#101010", "#0b0b0b"] as const;

/** District anchors in world coordinates (labels + 187 beacons). */
const ZONE_ANCHORS: { name: string; x: number; y: number; beacon: boolean }[] = [
  { name: MAP_ZONES[0], x: 1200, y: 1120, beacon: true }, // DIE WERF — the heart
  { name: MAP_ZONES[1], x: 640, y: 1830, beacon: true }, // DIE HAWEN — the bay
  { name: MAP_ZONES[2], x: 1520, y: 480, beacon: true }, // NOORDKUS
  { name: MAP_ZONES[3], x: 430, y: 760, beacon: false }, // GRYSGEBIED
  { name: MAP_ZONES[4], x: 1860, y: 1420, beacon: false }, // DIE BRUG
  { name: MAP_ZONES[5], x: 1820, y: 2060, beacon: false }, // ROOIGROND
];

/** Seeded PRNG — deterministic territory, identical on every device. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type City = {
  blocks: { x: number; y: number; w: number; h: number; fill: string }[];
  arteries: string[];
  minor: string[];
  boulevard: string;
  river: string;
  coast: string;
};

/** Build the whole city once — pure function of the seed, zero randomness at render. */
function buildCity(): City {
  const rng = mulberry32(187187);
  const blocks: City["blocks"] = [];
  const arteries: string[] = [];
  const minor: string[] = [];

  // major grid — every 300 world units with a lazy sine wander
  const linesX: number[] = [];
  const linesY: number[] = [];
  for (let i = 0; i <= 8; i++) {
    linesX.push(120 + i * 290);
    linesY.push(120 + i * 290);
  }
  const wander = (base: number, i: number, vertical: boolean) => {
    const phase = rng() * Math.PI * 2;
    const amp = 26 + rng() * 30;
    const p1 = { x: vertical ? base : 0, y: vertical ? 0 : base };
    const p2 = { x: vertical ? base : WORLD, y: vertical ? WORLD : 0 };
    const c1 = {
      x: vertical ? base + Math.sin(phase) * amp : WORLD * 0.33,
      y: vertical ? WORLD * 0.33 : base + Math.sin(phase) * amp,
    };
    const c2 = {
      x: vertical ? base + Math.sin(phase + 2) * amp : WORLD * 0.66,
      y: vertical ? WORLD * 0.66 : base + Math.sin(phase + 2) * amp,
    };
    void i; void p1; void p2;
    return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
  };
  for (let i = 0; i < linesX.length; i++) arteries.push(wander(linesX[i], i, true));
  for (let j = 0; j < linesY.length; j++) arteries.push(wander(linesY[j], j, false));

  // minor streets — halfway between majors
  for (let i = 0; i < linesX.length - 1; i++) {
    minor.push(wander(linesX[i] + 145, i, true));
    minor.push(wander(linesY[i] + 145, i, false));
  }

  // city blocks — inset into the grid, jittered sizes, occasional courtyard
  for (let i = 0; i < linesX.length - 1; i++) {
    for (let j = 0; j < linesY.length - 1; j++) {
      const skip = rng() < 0.12; // empty plots keep it breathing
      if (skip) continue;
      const inset = 16 + rng() * 14;
      const x = linesX[i] + inset;
      const y = linesY[j] + inset;
      const w = 290 - inset * 2 + (rng() - 0.5) * 20;
      const h = 290 - inset * 2 + (rng() - 0.5) * 20;
      if (w < 40 || h < 40) continue;
      blocks.push({
        x,
        y,
        w,
        h,
        fill: BLOCK_FILLS[Math.floor(rng() * BLOCK_FILLS.length)],
      });
    }
  }

  // the diagonal boulevard — the house's spine, corner to corner
  const boulevard = `M ${-40} ${WORLD + 40} L ${WORLD + 40} ${-40}`;
  // the river — winds from the north-east down into the bay
  const river = `M ${WORLD - 140} 0 C ${WORLD - 320} ${WORLD * 0.3}, ${WORLD - 520} ${WORLD * 0.42}, ${WORLD - 700} ${WORLD * 0.56} C ${WORLD - 900} ${WORLD * 0.7}, ${WORLD - 1050} ${WORLD * 0.8}, ${WORLD - 1250} ${WORLD + 60}`;
  // the coast — the bay cuts the south-west corner
  const coast = `M 0 ${WORLD * 0.62} C ${WORLD * 0.14} ${WORLD * 0.7}, ${WORLD * 0.2} ${WORLD * 0.82}, ${WORLD * 0.38} ${WORLD * 0.88} C ${WORLD * 0.55} ${WORLD * 0.94}, ${WORLD * 0.68} ${WORLD * 0.97}, ${WORLD * 0.82} ${WORLD + 40} L -40 ${WORLD + 40} Z`;

  return { blocks, arteries, minor, boulevard, river, coast };
}

// --------------------------------------------------------------- component

export function MapScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(open);
  const [shownOpen, setShownOpen] = useState(open);
  const [brandOpen, setBrandOpen] = useState(true);
  const [hype, setHype] = useState(() => pick(FAST_HYPE));
  const { count } = useLivePresence();

  // viewport in world units: x/y origin + width (height follows the aspect)
  const [vb, setVb] = useState({ x: 240, y: 240, w: 1920 });
  const [ratio, setRatio] = useState(0.75); // container h/w
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastPinch = useRef<number | null>(null);

  const city = useMemo(() => buildCity(), []);

  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) {
      setMounted(true);
      setVb({ x: 240, y: 240, w: 1920 });
      setBrandOpen(true);
    }
  }

  // container aspect drives the viewBox height (no distortion, ever);
  // the FIRST measurement also centres the opening view on the territory
  useEffect(() => {
    if (!open || !mounted) return;
    const el = svgRef.current;
    if (!el) return;
    let fitted = false;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.width > 0) {
        const nextRatio = r.height / r.width;
        setRatio(nextRatio);
        if (!fitted) {
          fitted = true;
          // open on the whole territory with a little breathing room
          const w = Math.min(3000, Math.max(420, (WORLD * 1.15) / nextRatio));
          setVb({ w, x: (WORLD - w) / 2, y: (WORLD - w * nextRatio) / 2 });
        }
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
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

  const clampVb = useCallback((next: { x: number; y: number; w: number }) => {
    const w = Math.min(3000, Math.max(420, next.w));
    const h = w * ratio;
    const margin = WORLD * 0.35;
    return {
      w,
      x: Math.min(WORLD + margin - w, Math.max(-margin, next.x)),
      y: Math.min(WORLD + margin - h, Math.max(-margin, next.y)),
    };
  }, [ratio]);

  /** Zoom keeping the world point under the given client coords fixed. */
  const zoomAtClient = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const px = (clientX - r.left) / r.width;
      const py = (clientY - r.top) / r.height;
      setVb((v) => {
        const w2 = Math.min(3000, Math.max(420, v.w / factor));
        const worldX = v.x + px * v.w;
        const worldY = v.y + py * (v.w * ratio);
        // keep (worldX, worldY) pinned under (px, py) in the NEW viewport
        return clampVb({ w: w2, x: worldX - px * w2, y: worldY - py * (w2 * ratio) });
      });
    },
    [clampVb, ratio]
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      zoomAtClient(e.clientX, e.clientY, factor);
    },
    [zoomAtClient]
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      const el = svgRef.current;
      if (!prev || !el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.current.size >= 2) {
        // pinch — zoom by the distance ratio around the midpoint
        const pts = [...pointers.current.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (lastPinch.current && dist > 0) {
          const factor = dist / lastPinch.current;
          const midX = (pts[0].x + pts[1].x) / 2;
          const midY = (pts[0].y + pts[1].y) / 2;
          zoomAtClient(midX, midY, factor);
        }
        lastPinch.current = dist;
        return;
      }

      // single-finger pan
      setVb((v) => clampVb({ w: v.w, x: v.x - (dx / r.width) * v.w, y: v.y - (dy / r.height) * (v.w * ratio) }));
    },
    [clampVb, ratio, zoomAtClient]
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) lastPinch.current = null;
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const el = svgRef.current;
      const r = el?.getBoundingClientRect();
      zoomAtClient(
        r ? r.left + r.width / 2 : 0,
        r ? r.top + r.height / 2 : 0,
        factor
      );
    },
    [zoomAtClient]
  );

  const resetView = useCallback(() => setVb({ x: 240, y: 240, w: 1920 }), []);

  if (!open || !mounted) return null;

  const vbH = vb.w * ratio;
  const vbStr = `${vb.x} ${vb.y} ${vb.w} ${vbH}`;

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

        {/* ------------------------------------- the territory — full bleed */}
        <section
          aria-label="House territory map — custom drawn, strictly dark"
          className="relative min-h-0 flex-1 touch-none bg-black"
        >
          <svg
            ref={svgRef}
            viewBox={vbStr}
            preserveAspectRatio="xMidYMid slice"
            className="absolute inset-0 size-full cursor-grab active:cursor-grabbing select-none"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={(e) => zoomAtClient(e.clientX, e.clientY, 1.6)}
            role="img"
          >
            <rect x={-WORLD} y={-WORLD} width={WORLD * 3} height={WORLD * 3} fill="#000000" />

            {/* city blocks */}
            <g>
              {city.blocks.map((b, i) => (
                <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={10} fill={b.fill} />
              ))}
            </g>

            {/* minor streets */}
            <g fill="none" stroke="#141414" strokeWidth={7} strokeLinecap="round">
              {city.minor.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>

            {/* major arteries */}
            <g fill="none" stroke="#1f1f1f" strokeWidth={15} strokeLinecap="round">
              {city.arteries.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>

            {/* the boulevard — the house spine */}
            <path d={city.boulevard} fill="none" stroke="#2e2e2e" strokeWidth={22} strokeLinecap="round" />

            {/* the river */}
            <path d={city.river} fill="none" stroke="#111926" strokeWidth={46} strokeLinecap="round" />

            {/* the bay */}
            <path d={city.coast} fill="#0b1220" stroke="#1b2637" strokeWidth={3} />

            {/* district labels */}
            <g>
              {ZONE_ANCHORS.map((z) => (
                <g key={z.name}>
                  <text
                    x={z.x}
                    y={z.y - 34}
                    textAnchor="middle"
                    fill="#8f8f8f"
                    style={{
                      font: "700 30px ui-monospace, SFMono-Regular, Menlo, monospace",
                      letterSpacing: "0.32em",
                    }}
                  >
                    {z.name}
                  </text>
                  {z.beacon ? (
                    <>
                      <circle cx={z.x} cy={z.y} r={10} fill="#ffffff" className="animate-fast-pulse" />
                      <circle cx={z.x} cy={z.y} r={26} fill="none" stroke="#ffffff" strokeOpacity={0.28} strokeWidth={2} />
                      <text
                        x={z.x}
                        y={z.y + 58}
                        textAnchor="middle"
                        fill="#e5e5e5"
                        style={{
                          font: "900 34px ui-monospace, SFMono-Regular, Menlo, monospace",
                          letterSpacing: "0.24em",
                        }}
                      >
                        187
                      </text>
                    </>
                  ) : null}
                </g>
              ))}
            </g>

            {/* painted wordmark — the name lives on the territory itself */}
            <text
              x={1200}
              y={1188}
              textAnchor="middle"
              fill="#ffffff"
              fillOpacity={0.08}
              style={{
                font: "900 150px ui-monospace, SFMono-Regular, Menlo, monospace",
                letterSpacing: "0.18em",
              }}
            >
              FAST GUNS
            </text>
          </svg>

          {/* ------------------------------------------ territory card —
              the house logo + 187 tag + rotating hype + live count,
              collapsible so it never eats the map on a small phone */}
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
                <p className="mt-2 flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-neutral-400">
                  <span aria-hidden className="size-1.5 animate-fast-pulse rounded-full bg-white" />
                  {MAP_LIVE_BADGE(count)}
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

          {/* right thumb column — zoom + reset, 44px+, glass */}
          <div className="absolute right-3 top-3 flex flex-col gap-1.5">
            <div className="flex flex-col overflow-hidden rounded-xl border border-neutral-700 bg-black/80 backdrop-blur-sm">
              <button
                onClick={() => zoomBy(1.25)}
                aria-label={MAP_ZOOM_IN}
                className="flex size-11 items-center justify-center text-neutral-300 outline-none transition-colors hover:bg-neutral-900 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
              >
                <Plus className="size-4" aria-hidden />
              </button>
              <span aria-hidden className="h-px w-full bg-neutral-800" />
              <button
                onClick={() => zoomBy(1 / 1.25)}
                aria-label={MAP_ZOOM_OUT}
                className="flex size-11 items-center justify-center text-neutral-300 outline-none transition-colors hover:bg-neutral-900 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
              >
                <Minus className="size-4" aria-hidden />
              </button>
            </div>
            <button
              onClick={resetView}
              aria-label={MAP_RESET}
              title={MAP_RESET}
              className="flex size-11 items-center justify-center rounded-xl border border-neutral-700 bg-black/80 text-neutral-300 backdrop-blur-sm outline-none transition-colors hover:border-neutral-400 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
            >
              <Crosshair className="size-4" aria-hidden />
            </button>
          </div>

          {/* the law — one quiet line, bottom, above the dock clearance */}
          <p className="absolute inset-x-3 bottom-[calc(var(--fast-dock-clear)+0.6rem)] text-center font-mono text-[8px] font-bold uppercase leading-relaxed tracking-[0.22em] text-neutral-600 lg:bottom-3">
            {MAP_LAW}
          </p>
        </section>
      </ScreenShell>
    </div>
  );
}
