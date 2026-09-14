/**
 * FAST GUNS — TURF data layer.
 * ============================
 * Block-and-neighbourhood granularity for the SURROUNDINGS map: every
 * documented area can carry sub-places ("blocks") and every block carries
 * an allegiance from the house's point of view.
 *
 * LAWS OF THE HOUSE (same as copy.ts):
 *  - FAST GUNS = "home". AMERICANS = "ally". VARADOS = "rival".
 *  - Every REAL, publicly documented gang stays "documented" and neutral —
 *    no crew branding on encyclopedic public-safety data.
 *  - Crew allegiance is decided HERE, deterministically from the gang
 *    name, so the AI feed and the curated fallback can never drift apart.
 *  - Mocking = crew-name banter only. No people, no operations, no violence.
 *
 * Shared by the server (hotspots route sanitiser) and the client
 * (map screen) — pure data, zero framework imports.
 */

// -------------------------------------------------------------- allegiance

export type BlockAllegiance = "home" | "ally" | "rival" | "documented";

/** One block / sub-neighbourhood under a documented area. */
export type TurfBlock = {
  /** Real, documented sub-place name (section, site, flats, block). */
  name: string;
  /** Gang / crew associated with that sub-place. */
  gang: string;
  /** House allegiance — derived from the gang name, never trusted from AI. */
  allegiance: BlockAllegiance;
  /** Hype for home, banter for rival, neutral fact for documented. */
  note: string;
};

/**
 * Deterministic allegiance mapping: FAST GUNS = home, AMERICANS = ally,
 * VARADOS = rival, every real documented gang = documented.
 * Matching is normalised (punctuation/case/"the"-less variants) so the AI
 * feed can never drift the mapping by writing "FAST GUNS 187" or
 * "fast guns crew" — the house crews always classify correctly.
 */
export function classifyGang(gang: string): BlockAllegiance {
  const norm = (gang ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!norm) return "documented";
  if (norm.includes("fastgun")) return "home";
  if (norm.includes("american")) return "ally";
  if (norm.includes("varados")) return "rival";
  return "documented";
}

/** True when a block's gang names a crew the house refuses to platform. */
export function isBannedCrew(gang: string): boolean {
  const norm = (gang ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm.includes("brit") || norm.includes("british");
}

// ------------------------------------------------------------ sanitisation
// Shared, framework-free scrubbers for the hotspots route: the AI feed is
// never trusted as-is — every string is cleaned, coordinates clamped to SA,
// allegiance re-derived HERE, banned crews dropped, blocks deduped + capped.

/** Hard cap: no area carries more than 6 blocks on the wire. */
export const MAX_BLOCKS_PER_AREA = 6;

/** SA bounding box (mirrors the map viewport clamp). */
export const SA_LAT_RANGE = [-34.95, -21.9] as const;
export const SA_LNG_RANGE = [16.3, 33.3] as const;

/** The 9 canonical provinces — the only ones allowed on the wire. */
export const SA_PROVINCE_NAMES = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
] as const;

/** Strip control chars, collapse whitespace, hard-cap length. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Clamp to SA (or null when the value is not a finite coordinate). */
export function clampSACoords(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat: Math.min(SA_LAT_RANGE[1], Math.max(SA_LAT_RANGE[0], lat)),
    lng: Math.min(SA_LNG_RANGE[1], Math.max(SA_LNG_RANGE[0], lng)),
  };
}

/** Map a loose province string to a canonical province, or null. */
export function canonicalProvince(raw: unknown): string | null {
  const norm = cleanText(raw, 24).toLowerCase().replace(/[^a-z]/g, "");
  if (!norm) return null;
  for (const p of SA_PROVINCE_NAMES) {
    if (p.toLowerCase().replace(/[^a-z]/g, "") === norm) return p;
  }
  // substring rescue: "Kwazulu Natal Province" -> KwaZulu-Natal
  for (const p of SA_PROVINCE_NAMES) {
    const pn = p.toLowerCase().replace(/[^a-z]/g, "");
    if (norm.length >= 4 && pn.length >= 6 && (norm.includes(pn) || pn.includes(norm))) return p;
  }
  return null;
}

/**
 * Scrub a raw blocks array into wire-safe TurfBlocks: cleaned text, banned
 * crews dropped outright, deduped by (case-insensitive) name, capped at 6,
 * and allegiance ALWAYS re-derived from the gang name — the AI's own
 * allegiance field is never trusted.
 */
export function sanitizeTurfBlocks(raw: ReadonlyArray<unknown> | undefined | null): TurfBlock[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TurfBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { name?: unknown; gang?: unknown; note?: unknown };
    const name = cleanText(rec.name, 48);
    const gang = cleanText(rec.gang, 40);
    if (!name || !gang) continue;
    if (isBannedCrew(gang)) continue; // refused crews never reach the wire
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      gang,
      allegiance: classifyGang(gang),
      note: cleanText(rec.note, 140),
    });
    if (out.length >= MAX_BLOCKS_PER_AREA) break;
  }
  return out;
}

// ------------------------------------------------------------------- chips

/** Monochrome chip styling per allegiance (home solid white, rival struck). */
export const BLOCK_CHIP_CLASS: Record<BlockAllegiance, string> = {
  home: "border-white bg-white text-black",
  ally: "border-neutral-300 text-neutral-100",
  rival: "border-neutral-600 text-neutral-400 line-through",
  documented: "border-neutral-700 text-neutral-500",
};

// ---------------------------------------------------------------- taglines

/** Rotating disrespect ticker: VARADOS jabs from the house voice. */
export const WAR_BOARD_TAGLINES: readonly string[] = [
  "VARADOS se turf lyk soos 'n verlate grond — hulle kan nie eens reg uitkom nie.",
  "Waar VARADOS loop, huil die straat. Van skande.",
  "Varados beteken 'val'. Hulle leef hul naam. Elke dag.",
  "Fast Guns loop, Varados hardloop, almal ander kyk.",
] as const;

// ---------------------------------------------------------------- tally

export type TurfCount = {
  home: number;
  ally: number;
  rival: number;
  documented: number;
  totalBlocks: number;
};

/** Count blocks per allegiance across a feed (or a single area). */
export function countTurf(hotspots: ReadonlyArray<{ blocks?: TurfBlock[] }>): TurfCount {
  const tally: TurfCount = { home: 0, ally: 0, rival: 0, documented: 0, totalBlocks: 0 };
  for (const h of hotspots) {
    const blocks = Array.isArray(h?.blocks) ? h.blocks : [];
    for (const b of blocks) {
      tally.totalBlocks += 1;
      switch (b.allegiance) {
        case "home":
          tally.home += 1;
          break;
        case "ally":
          tally.ally += 1;
          break;
        case "rival":
          tally.rival += 1;
          break;
        default:
          tally.documented += 1;
      }
    }
  }
  return tally;
}
