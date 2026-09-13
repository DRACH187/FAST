"use client";

import { cn } from "@/lib/utils";

const DRIPS = [
  { x: 16, w: 3, len: 15 },
  { x: 46, w: 4, len: 27 },
  { x: 82, w: 3, len: 10 },
  { x: 122, w: 4, len: 22 },
  { x: 160, w: 3, len: 34 },
  { x: 199, w: 4, len: 12 },
  { x: 234, w: 3, len: 21 },
];

const FALLING = [
  { cx: 48, cy: 30, r: 1.8 },
  { cx: 161.5, cy: 37, r: 1.5 },
];

/**
 * Blood-red dripping paint underline — aggressive Chicano flourish.
 */
export function DripUnderline({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 260 40"
      aria-hidden="true"
      className={cn("text-blood", className)}
      fill="currentColor"
    >
      {/* top bar */}
      <rect x="0" y="0" width="260" height="5" />
      {/* hanging drips */}
      {DRIPS.map((d, i) => (
        <g key={i}>
          <rect x={d.x} y="0" width={d.w} height={d.len} rx={d.w / 2} />
          <ellipse cx={d.x + d.w / 2} cy={d.len} rx={d.w / 2 + 0.7} ry={d.w / 2 + 1.6} />
        </g>
      ))}
      {/* falling droplets */}
      {FALLING.map((f, i) => (
        <circle key={`d-${i}`} cx={f.cx} cy={f.cy} r={f.r} />
      ))}
    </svg>
  );
}
