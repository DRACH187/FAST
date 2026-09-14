import { z } from "zod";
import { clientIp, json, rateLimit } from "@/lib/server-guard";
import { geminiApiKey, geminiGenerate } from "@/lib/fast/ai";
import {
  canonicalProvince,
  clampSACoords,
  cleanText,
  classifyGang,
  MAX_BLOCKS_PER_AREA,
  sanitizeTurfBlocks,
  type TurfBlock,
} from "@/lib/fast/gang-turf";

/**
 * SURROUNDINGS intel feed — /api/map/hotspots (GET only).
 * ========================================================
 * Block-and-neighbourhood level community-safety intel for the map screen.
 *
 * Pipeline (in order):
 *   1. Rate limit (per IP; manual `?refresh=1` gets a tighter bucket).
 *   2. 10-minute in-process cache — every serve is cached, so a deployment
 *      without an AI key never hammers anything and the client's 10-minute
 *      auto-sync mirrors the server TTL exactly.
 *   3. Gemini flash (free model, JSON mode, key SERVER-SIDE ONLY) is asked
 *      for a structured feed of documented SA areas with block rows.
 *   4. Strict zod schema + a paranoid sanitiser: strings cleaned, coords
 *      clamped into SA, provinces canonicalised, areas deduped + capped,
 *      blocks deduped + capped at 6, and every block's allegiance re-derived
 *      on the server (the AI's allegiance field is NEVER trusted).
 *   5. On any failure: serve the last good cached feed ("cache") if one
 *      exists, else the curated FALLBACK dataset (~28 documented areas,
 *      all 9 provinces, block rows incl. house turf) — source "fallback".
 *
 * TONE LAW: real, publicly documented gangs are described in a neutral,
 * encyclopedic, public-safety tone. Crew banter lives ONLY in the fictional
 * crew fields (FAST GUNS = home, AMERICANS = ally, VARADOS =
 * rival) and is strictly crew-name trash talk: no people, no operations,
 * no instructions — turf branding and scoreboards only.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* Vercel Hobby default is 10s — the AI feed needs room; its own upstream
   timeout always fires first. */
export const maxDuration = 60;

// ------------------------------------------------------------------ config

const CACHE_TTL_MS = 10 * 60 * 1000; // mirrors SYNC_INTERVAL_MS on the client
const MAX_AREAS = 28; // wire cap for the feed
const MIN_AI_AREAS = 8; // below this an AI reply counts as garbage
const AI_TIMEOUT_MS = 20_000;

// -------------------------------------------------------------------- wire

type Threat = "MODERATE" | "HIGH" | "SEVERE";

type WireHotspot = {
  area: string;
  province: string;
  lat: number;
  lng: number;
  intensity: number;
  summary: string;
  gangs: { name: string; threat: Threat; notes: string }[];
  blocks: TurfBlock[];
};

type FeedSource = "gemini" | "fallback" | "cache";

type Wire = {
  ok: true;
  source: FeedSource;
  updatedAt: string;
  reason?: string;
  hotspots: WireHotspot[];
};

// ------------------------------------------------------------------- cache

let cache: { wire: Wire; at: number } | null = null;
let inflight: Promise<Wire> | null = null;

// ------------------------------------------------------------------- zod

const THREATS = ["MODERATE", "HIGH", "SEVERE"] as const;

const aiSchema = z.object({
  hotspots: z
    .array(
      z.object({
        area: z.string().min(1).max(48),
        province: z.string().min(2).max(24),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        intensity: z.number().min(1).max(5),
        summary: z.string().max(400),
        gangs: z
          .array(
            z.object({
              name: z.string().min(1).max(40),
              threat: z.enum(THREATS),
              notes: z.string().max(200),
            })
          )
          .max(6)
          .optional(),
        blocks: z
          .array(
            z.object({
              name: z.string().min(1).max(48),
              gang: z.string().min(1).max(40),
              note: z.string().max(180).optional(),
            })
          )
          .max(8)
          .optional(),
      })
    )
    .max(24),
});

// ------------------------------------------------------------------ prompt

const SYSTEM = `You are the data desk of a South African community-safety awareness app. You output ONLY valid JSON, no prose, no markdown fences.

TONE LAW (absolute):
- Real, publicly documented gangs (Americans, Hard Live Kids, Junky Funky Kids, 26s, 27s, 28s, Clever Kids, Numbers gangs) are described in a NEUTRAL, encyclopedic, public-safety tone. Facts only, no glorification.
- FAST GUNS, AMERICANS and VARADOS are FICTIONAL street crews in the app's turf-branding game. Light trash talk about the rival crew NAME (VARADOS) is allowed in block "note" fields ONLY, in Afrikaans/English banter style. Nothing about hurting anyone: no people, no operations, no weapons, no instructions — scoreboards and brand banter only.
- Never name or describe real individuals. Never include anything operational.`;

const PROMPT = `Build a South Africa community-safety awareness feed: 16 documented areas (townships, suburbs, hotspots) spread across ALL 9 provinces.

JSON shape (exactly):
{"hotspots":[{"area":"Manenberg","province":"Western Cape","lat":-33.976,"lng":18.569,"intensity":4,"summary":"One or two neutral sentences on documented public-safety context.","gangs":[{"name":"Hard Live Kids","threat":"HIGH","notes":"Neutral public-safety note."}],"blocks":[{"name":"Gamka Street flats","gang":"FAST GUNS","note":"Hype for FAST GUNS blocks, light crew-name banter for VARADOS blocks, neutral for documented gangs."}]}]}

Rules:
- Use REAL documented area names and REAL approximate coordinates inside South Africa. Provinces exactly: Eastern Cape, Free State, Gauteng, KwaZulu-Natal, Limpopo, Mpumalanga, North West, Northern Cape, Western Cape. Weight toward the Western Cape (Cape Flats, Elsies River) where documented gang activity is best known.
- intensity: 1 (quiet) to 5 (severe), integer.
- gangs: 0-3 real publicly documented groups per area, neutral tone. threat: MODERATE | HIGH | SEVERE.
- blocks: 0-4 real sub-neighbourhoods (sections, sites, streets, flats) per area for at least 10 areas. gang = the crew/group associated with that block: FAST GUNS (home turf hype, Cape Flats/Elsies River areas), AMERICANS (friendly), VARADOS (rival crew — mock the CREW NAME in the note), or a real documented gang name (neutral note).
- Summaries and notes: max 2 sentences each. No markdown. JSON only.`;

// -------------------------------------------------------------- sanitiser

/** Round an AI intensity into a safe 1..5 integer. */
function clampIntensity(v: unknown): number {
  const n = typeof v === "number" ? Math.round(v) : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, n));
}

function clampThreat(v: unknown): Threat {
  const s = typeof v === "string" ? v.toUpperCase() : "";
  return (THREATS as readonly string[]).includes(s) ? (s as Threat) : "MODERATE";
}

/** Full paranoid pass over the AI payload -> wire-safe hotspots. */
function sanitizeFeed(raw: z.infer<typeof aiSchema>): WireHotspot[] {
  const seenArea = new Set<string>();
  const out: WireHotspot[] = [];

  for (const h of raw.hotspots) {
    if (out.length >= MAX_AREAS) break;

    const area = cleanText(h.area, 48);
    const province = canonicalProvince(h.province);
    const coords = clampSACoords(h.lat, h.lng);
    if (!area || !province || !coords) continue;

    // dedupe areas per province (case-insensitive)
    const key = `${province}|${area.toLowerCase()}`;
    if (seenArea.has(key)) continue;
    seenArea.add(key);

    const gangsRaw = Array.isArray(h.gangs) ? h.gangs : [];
    const seenGang = new Set<string>();
    const gangs: WireHotspot["gangs"] = [];
    for (const g of gangsRaw.slice(0, 6)) {
      const name = cleanText(g?.name, 40);
      if (!name) continue;
      const gk = name.toLowerCase();
      if (seenGang.has(gk)) continue;
      seenGang.add(gk);
      gangs.push({
        name,
        threat: clampThreat(g?.threat),
        notes: cleanText(g?.notes, 180),
      });
    }

    out.push({
      area,
      province,
      lat: coords.lat,
      lng: coords.lng,
      intensity: clampIntensity(h.intensity),
      summary: cleanText(h.summary, 320),
      gangs,
      blocks: sanitizeTurfBlocks(h.blocks).slice(0, MAX_BLOCKS_PER_AREA),
    });
  }

  return out;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // tolerate the model's favourite sin: prose before the JSON
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

// --------------------------------------------------------- fallback feed

type FallbackArea = {
  area: string;
  province: string;
  lat: number;
  lng: number;
  intensity: number;
  summary: string;
  gangs: { name: string; threat: Threat; notes: string }[];
  blocks?: { name: string; gang: string; note: string }[];
};

/**
 * Curated HUIS INTEL (offline) dataset: ~28 documented South African areas,
 * all 9 provinces. Real gangs stay neutral/encyclopedic; the fictional crews
 * (FAST GUNS home, AMERICANS ally, VARADOS rival) live in the
 * blocks with crew-name banter only. Block names are editorially curated
 * from public reporting where available.
 */
const FALLBACK: FallbackArea[] = [
  // ---------------------------------------------------------- Western Cape
  {
    area: "Manenberg",
    province: "Western Cape",
    lat: -33.976,
    lng: 18.569,
    intensity: 4,
    summary:
      "Cape Flats residential area with decades of publicly documented gang activity and periodic shooting incidents tracked in public safety reporting.",
    gangs: [
      { name: "Hard Live Kids", threat: "HIGH", notes: "Documented Cape Flats gang with a long public record in Manenberg." },
      { name: "Junky Funky Kids", threat: "HIGH", notes: "Long-documented Manenberg street gang in public safety reporting." },
      { name: "Americans", threat: "MODERATE", notes: "Publicly documented Cape Flats gang, present in the wider area." },
    ],
    blocks: [
      { name: "Gamka Street flats", gang: "FAST GUNS", note: "FAST GUNS hou die blok vas — rooi-wit-blou waai hier elke dag." },
      { name: "Schermbrucker Street", gang: "Hard Live Kids", note: "Publiek gedokumenteerde straataanwesigheid — neutraal gehou." },
      { name: "The Flats section", gang: "Junky Funky Kids", note: "Long-documented presence per public safety reporting." },
      { name: "Manenberg Avenue row", gang: "VARADOS", note: "VARADOS het hier probeer vestig… hulle hardloop nog." },
    ],
  },
  {
    area: "Elsies River",
    province: "Western Cape",
    lat: -33.946,
    lng: 18.719,
    intensity: 3,
    summary:
      "Northern suburbs node with a long publicly documented gang history; the house counts this ground as its own.",
    gangs: [
      { name: "Americans", threat: "HIGH", notes: "Publicly documented presence in Elsies River and surrounds." },
      { name: "26s", threat: "MODERATE", notes: "Numbers-gang network documented in public reporting." },
      { name: "27s", threat: "MODERATE", notes: "Numbers-gang presence tracked in public safety records." },
    ],
    blocks: [
      { name: "Clarke Estate", gang: "FAST GUNS", note: "HUISGROND. FAST GUNS staan hier vas — 187 tot die einde." },
      { name: "Norwood", gang: "FAST GUNS", note: "Tweede huis van die werf — hier word ons naam gerespekteer." },
      { name: "Leonsdale", gang: "VARADOS", note: "VARADOS het hier 'n vlag probeer plant. Die vlag is weg. Hulle ook." },
      { name: "Sarepta", gang: "AMERICANS", note: "Bondgenoot-grond — die AMERICANS hou hier saam met die huis." },
      { name: "Matroosfontein", gang: "26s", note: "Numbers-gang network documented in public safety reporting." },
    ],
  },
  {
    area: "Hanover Park",
    province: "Western Cape",
    lat: -33.99,
    lng: 18.641,
    intensity: 4,
    summary:
      "Cape Flats area with one of the longest publicly documented records of gang violence and community safety interventions.",
    gangs: [
      { name: "Americans", threat: "HIGH", notes: "Publicly documented gang presence in Hanover Park." },
      { name: "26s", threat: "MODERATE", notes: "Numbers-gang network documented across the Cape Flats." },
    ],
    blocks: [
      { name: "Emms Drive flats", gang: "AMERICANS", note: "AMERICANS-grond — bondgenote van die huis, stil en sterk." },
      { name: "The back streets", gang: "FAST GUNS", note: "Die huis se pad deur Hanover Park loop oop — altyd." },
      { name: "Hanover Park CBD row", gang: "VARADOS", note: "VARADOS sê hulle eie die CBD. Die CBD het ander planne." },
    ],
  },
  {
    area: "Mitchells Plain",
    province: "Western Cape",
    lat: -34.012,
    lng: 18.621,
    intensity: 4,
    summary:
      "Large Cape Flats residential area with extensively documented gang-related shooting incidents and community safety programmes.",
    gangs: [
      { name: "Americans", threat: "HIGH", notes: "Publicly documented across Mitchells Plain's southern sections." },
      { name: "Junky Funky Kids", threat: "MODERATE", notes: "Documented Cape Flats gang with occasional presence reported." },
    ],
    blocks: [
      { name: "Tafelsig", gang: "AMERICANS", note: "Bondgenoot-hoofkwartier — AMERICANS en die huis staan saam." },
      { name: "Beacon Valley", gang: "AMERICANS", note: "Documented American gang stronghold per public reporting." },
      { name: "Rocklands", gang: "FAST GUNS", note: "FAST GUNS-seuntjie loop hier veilig — die werf wag." },
    ],
  },
  {
    area: "Nyanga",
    province: "Western Cape",
    lat: -33.982,
    lng: 18.583,
    intensity: 5,
    summary:
      "Township repeatedly recorded among the country's highest documented murder rates in national crime statistics releases.",
    gangs: [
      { name: "28s", threat: "SEVERE", notes: "Numbers-gang network documented in public safety reporting." },
      { name: "Street-level networks", threat: "HIGH", notes: "Documented informal networks per police station statistics." },
    ],
    blocks: [
      { name: "Zanzele", gang: "28s", note: "Publiek gedokumenteerde hotspot — neutraal gehou." },
      { name: "Lusaka", gang: "27s", note: "Documented informal settlement section in public reporting." },
      { name: "KTC", gang: "26s", note: "Numbers-gang presence documented in public records." },
    ],
  },
  {
    area: "Khayelitsha",
    province: "Western Cape",
    lat: -34.013,
    lng: 18.672,
    intensity: 4,
    summary:
      "Cape Town's largest township with documented violent-crime concentrations and active community policing forums.",
    gangs: [
      { name: "26s", threat: "HIGH", notes: "Numbers-gang network documented in public safety reporting." },
      { name: "Street-level networks", threat: "HIGH", notes: "Documented per station-level crime statistics." },
    ],
    blocks: [
      { name: "Site C", gang: "26s", note: "Documented dense residential section, tracked in public records." },
      { name: "Harare", gang: "28s", note: "Publicly documented hotspot zone — neutral note." },
      { name: "Kuyasa", gang: "FAST GUNS", note: "Die huis se lig brand hier — FAST GUNS loop Kuyasa deur." },
    ],
  },
  {
    area: "Lavender Hill",
    province: "Western Cape",
    lat: -34.061,
    lng: 18.663,
    intensity: 4,
    summary:
      "Retreat-side area with a long publicly documented record of gang shootings and community safety activism.",
    gangs: [
      { name: "Americans", threat: "HIGH", notes: "Documented presence per public safety reporting." },
      { name: "28s", threat: "MODERATE", notes: "Numbers-gang network documented in the wider Deep South." },
    ],
    blocks: [
      { name: "The Hill", gang: "VARADOS", note: "VARADOS beloof elke jaar 'n comeback. Elke jaar niks." },
      { name: "Santa Clara flats", gang: "28s", note: "Documented public-housing section in public records." },
    ],
  },
  {
    area: "Heideveld",
    province: "Western Cape",
    lat: -33.974,
    lng: 18.604,
    intensity: 3,
    summary:
      "Athlone-adjacent Cape Flats area with documented gang activity and long-running community interventions.",
    gangs: [
      { name: "Americans", threat: "MODERATE", notes: "Publicly documented presence in Heideveld." },
      { name: "Hard Live Kids", threat: "MODERATE", notes: "Documented Cape Flats gang, occasional presence reported." },
    ],
    blocks: [
      { name: "The Circle", gang: "AMERICANS", note: "AMERICANS-gebied — die bondgenoot waai wit hier." },
      { name: "Buitekant strokes", gang: "FAST GUNS", note: "Huis-grond — die strokes ken ons naam." },
    ],
  },
  {
    area: "Gugulethu",
    province: "Western Cape",
    lat: -33.989,
    lng: 18.57,
    intensity: 4,
    summary:
      "Established township with documented violent-crime concentrations around its NY sections and informal settlements.",
    gangs: [
      { name: "26s", threat: "HIGH", notes: "Numbers-gang network documented in public reporting." },
      { name: "27s", threat: "MODERATE", notes: "Documented Numbers-gang presence in the wider area." },
    ],
    blocks: [
      { name: "Barcelona", gang: "26s", note: "Documented informal settlement in public safety records." },
      { name: "Kanana", gang: "27s", note: "Publicly documented settlement section — neutral." },
    ],
  },
  {
    area: "Delft",
    province: "Western Cape",
    lat: -33.976,
    lng: 18.648,
    intensity: 4,
    summary:
      "Rapidly grown area with documented gang-related shootings, particularly across its Dutch-named sections.",
    gangs: [
      { name: "Americans", threat: "HIGH", notes: "Documented presence across Delft South per public reporting." },
      { name: "26s", threat: "MODERATE", notes: "Numbers-gang presence documented in public records." },
    ],
    blocks: [
      { name: "Leiden", gang: "AMERICANS", note: "Documented Delft section with public gang-activity record." },
      { name: "Voorbrug", gang: "26s", note: "Publicly documented section — neutral note." },
      { name: "Roosendal", gang: "VARADOS", note: "VARADOS het hier verdwaal op pad na Roosendal. Nog steeds weg." },
    ],
  },
  // ---------------------------------------------------------------- Gauteng
  {
    area: "Alexandra",
    province: "Gauteng",
    lat: -26.103,
    lng: 28.106,
    intensity: 4,
    summary:
      "A dense Johannesburg township with documented violent-crime concentrations and long-running renewal programmes.",
    gangs: [
      { name: "28s", threat: "HIGH", notes: "Numbers-gang network documented in Gauteng public reporting." },
      { name: "Street-level networks", threat: "HIGH", notes: "Documented per station-level crime statistics." },
    ],
    blocks: [
      { name: "Dark City", gang: "28s", note: "Publicly documented Alexandra section — neutral note." },
      { name: "Beirut", gang: "VARADOS", note: "VARADOS sê hulle regeer hier. Niemand het hulle al gesien nie." },
    ],
  },
  {
    area: "Hillbrow",
    province: "Gauteng",
    lat: -26.19,
    lng: 28.125,
    intensity: 4,
    summary:
      "High-density inner-city district with extensively documented property-crime and violent-crime records.",
    gangs: [
      { name: "26s", threat: "HIGH", notes: "Numbers-gang networks documented across inner-city Johannesburg." },
      { name: "27s", threat: "HIGH", notes: "Documented Numbers-gang presence per public reporting." },
    ],
    blocks: [
      { name: "Ponte City", gang: "26s", note: "Iconic tower, documented in decades of public reporting." },
      { name: "Highpoint", gang: "27s", note: "Documented high-rise block in public safety records." },
    ],
  },
  {
    area: "Katlehong",
    province: "Gauteng",
    lat: -26.354,
    lng: 28.159,
    intensity: 3,
    summary:
      "East Rand township with documented violent-crime concentrations and active taxi-industry flashpoints.",
    gangs: [
      { name: "28s", threat: "HIGH", notes: "Numbers-gang network documented on the East Rand." },
    ],
    blocks: [
      { name: "Moleleki", gang: "VARADOS", note: "VARADOS claims Moleleki. Al ver weg, soos hul gevaar." },
      { name: "Zonkezizwe", gang: "28s", note: "Documented East Rand section in public safety records." },
    ],
  },
  {
    area: "Thokoza",
    province: "Gauteng",
    lat: -26.366,
    lng: 28.133,
    intensity: 3,
    summary:
      "East Rand township with a documented history of conflict and ongoing public-safety challenges.",
    gangs: [
      { name: "26s", threat: "MODERATE", notes: "Numbers-gang presence documented in public reporting." },
    ],
    blocks: [
      { name: "Phola Park", gang: "VARADOS", note: "VARADOS se blokke is so hul teetime — koud en leeg." },
      { name: "Umthambeka", gang: "26s", note: "Publicly documented section — neutral note." },
    ],
  },
  {
    area: "Tembisa",
    province: "Gauteng",
    lat: -25.997,
    lng: 28.221,
    intensity: 3,
    summary:
      "Large Ekurhuleni township with documented property-crime and violent-crime concentrations.",
    gangs: [
      { name: "28s", threat: "MODERATE", notes: "Numbers-gang presence documented in public records." },
    ],
    blocks: [
      { name: "Ivory Park", gang: "28s", note: "Documented dense section per public safety reporting." },
      { name: "Sethokga", gang: "VARADOS", note: "VARADOS probeer Tembisa. Tembisa lag." },
    ],
  },
  {
    area: "Soweto",
    province: "Gauteng",
    lat: -26.268,
    lng: 27.858,
    intensity: 3,
    summary:
      "Johannesburg's largest township complex with documented crime concentrations around its nodes and transport corridors.",
    gangs: [
      { name: "26s", threat: "MODERATE", notes: "Numbers-gang networks documented across Soweto." },
      { name: "27s", threat: "MODERATE", notes: "Documented Numbers-gang presence per public reporting." },
    ],
  },
  // ------------------------------------------------------------ KwaZulu-Natal
  {
    area: "uMlazi",
    province: "KwaZulu-Natal",
    lat: -29.966,
    lng: 30.883,
    intensity: 3,
    summary:
      "Durban's largest township, letter-coded into sections, with documented violent-crime concentrations.",
    gangs: [
      { name: "28s", threat: "HIGH", notes: "Numbers-gang network documented in KwaZulu-Natal." },
    ],
    blocks: [
      { name: "V Section", gang: "28s", note: "Publicly documented uMlazi section — neutral note." },
      { name: "E Section", gang: "VARADOS", note: "VARADOS in E Section? Die section het hulle nie herken nie." },
    ],
  },
  {
    area: "Berea",
    province: "KwaZulu-Natal",
    lat: -29.853,
    lng: 31.001,
    intensity: 3,
    summary:
      "Durban inner area with documented property-crime and drug-market activity in public reporting.",
    gangs: [
      { name: "26s", threat: "HIGH", notes: "Numbers-gang presence documented in Durban's inner areas." },
    ],
  },
  {
    area: "Imbali",
    province: "KwaZulu-Natal",
    lat: -29.642,
    lng: 30.338,
    intensity: 2,
    summary:
      "Pietermaritzburg township with documented periodic violent-crime spikes per station statistics.",
    gangs: [
      { name: "Street-level networks", threat: "MODERATE", notes: "Documented per public station-level reporting." },
    ],
  },
  // ------------------------------------------------------------ Eastern Cape
  {
    area: "Helenvale",
    province: "Eastern Cape",
    lat: -33.925,
    lng: 25.54,
    intensity: 4,
    summary:
      "Gqeberha Northern Areas suburb with one of the country's longest publicly documented gang-presence records.",
    gangs: [
      { name: "Clever Kids", threat: "HIGH", notes: "Documented Northern Areas gang in public safety reporting." },
      { name: "Americans", threat: "HIGH", notes: "Publicly documented presence in the Northern Areas." },
    ],
    blocks: [
      { name: "Helenvale Flats", gang: "VARADOS", note: "VARADOS het hier 'n hoofkwartier probeer open. Die deur was slot." },
      { name: "Salsoneville", gang: "Clever Kids", note: "Documented section per public safety records." },
    ],
  },
  {
    area: "Mdantsane",
    province: "Eastern Cape",
    lat: -32.971,
    lng: 27.749,
    intensity: 2,
    summary:
      "East London's large township with documented periodic violent-crime concentrations.",
    gangs: [
      { name: "Street-level networks", threat: "MODERATE", notes: "Documented per station-level statistics." },
    ],
  },
  {
    area: "Motherwell",
    province: "Eastern Cape",
    lat: -33.805,
    lng: 25.593,
    intensity: 3,
    summary:
      "Gqeberha township with documented violent-crime records and active community safety structures.",
    gangs: [
      { name: "28s", threat: "MODERATE", notes: "Numbers-gang presence documented in public reporting." },
    ],
  },
  // -------------------------------------------------------------- Free State
  {
    area: "Thabong",
    province: "Free State",
    lat: -27.867,
    lng: 26.779,
    intensity: 2,
    summary:
      "Welkom township with documented periodic violent-crime spikes per national statistics releases.",
    gangs: [
      { name: "26s", threat: "MODERATE", notes: "Numbers-gang presence documented in public records." },
    ],
  },
  {
    area: "Mangaung",
    province: "Free State",
    lat: -29.128,
    lng: 26.211,
    intensity: 2,
    summary:
      "Bloemfontein township area with documented property-crime and periodic violent-crime concentrations.",
    gangs: [
      { name: "Street-level networks", threat: "MODERATE", notes: "Documented per station-level reporting." },
    ],
  },
  // -------------------------------------------------------------- Mpumalanga
  {
    area: "eMbalenhle",
    province: "Mpumalanga",
    lat: -26.574,
    lng: 29.155,
    intensity: 2,
    summary:
      "Secunda township with documented property-crime concentrations and periodic violent-crime spikes.",
    gangs: [
      { name: "Street-level networks", threat: "MODERATE", notes: "Documented per public station statistics." },
    ],
  },
  // ----------------------------------------------------------------- Limpopo
  {
    area: "Mankweng",
    province: "Limpopo",
    lat: -23.886,
    lng: 29.711,
    intensity: 2,
    summary:
      "University-adjacent township outside Polokwane with documented property-crime activity.",
    gangs: [
      { name: "Street-level networks", threat: "MODERATE", notes: "Documented per station-level reporting." },
    ],
  },
  // --------------------------------------------------------------- North West
  {
    area: "Jouberton",
    province: "North West",
    lat: -26.862,
    lng: 26.643,
    intensity: 2,
    summary:
      "Klerksdorp township with documented periodic violent-crime concentrations per national statistics.",
    gangs: [
      { name: "26s", threat: "MODERATE", notes: "Numbers-gang presence documented in public records." },
    ],
  },
  // ----------------------------------------------------------- Northern Cape
  {
    area: "Galeshewe",
    province: "Northern Cape",
    lat: -28.719,
    lng: 24.749,
    intensity: 2,
    summary:
      "Kimberley's large township with a documented history of community unrest and property crime.",
    gangs: [
      { name: "28s", threat: "MODERATE", notes: "Numbers-gang presence documented in the Northern Cape." },
    ],
  },
];

/** Materialise the fallback into wire shape (allegiance derived centrally). */
function fallbackWire(reason: string): Wire {
  return {
    ok: true,
    source: "fallback",
    updatedAt: new Date().toISOString(),
    reason,
    hotspots: FALLBACK.map((h) => ({
      area: h.area,
      province: h.province,
      lat: h.lat,
      lng: h.lng,
      intensity: h.intensity,
      summary: h.summary,
      gangs: h.gangs.map((g) => ({ ...g })),
      blocks: sanitizeTurfBlocks(
        (h.blocks ?? []).map((b) => ({ name: b.name, gang: b.gang, note: b.note }))
      ),
    })),
  };
}

// ------------------------------------------------------------- feed builder

async function buildFeed(): Promise<Wire> {
  // 1) No key -> house intel immediately (and cache it; cheap + honest).
  if (!geminiApiKey()) {
    const wire = fallbackWire("no-key");
    cache = { wire, at: Date.now() };
    return wire;
  }

  // 2) Ask the free flash model, JSON mode.
  let aiWire: Wire | null = null;
  try {
    const result = await geminiGenerate(PROMPT, AI_TIMEOUT_MS, {
      jsonMode: true,
      temperature: 0.2,
      system: SYSTEM,
    });
    if (result.text) {
      const raw = extractJson(result.text);
      const parsed = raw ? aiSchema.safeParse(raw) : null;
      if (parsed?.success) {
        const hotspots = sanitizeFeed(parsed.data);
        if (hotspots.length >= MIN_AI_AREAS) {
          aiWire = {
            ok: true,
            source: "gemini",
            updatedAt: new Date().toISOString(),
            hotspots,
          };
        }
      }
    }
  } catch {
    aiWire = null;
  }

  // 3) AI win -> cache and serve.
  if (aiWire) {
    cache = { wire: aiWire, at: Date.now() };
    return aiWire;
  }

  // 4) AI miss -> last good feed wins, else house intel.
  if (cache) {
    return { ...cache.wire, source: "cache", reason: "ai-unavailable" };
  }
  const wire = fallbackWire("ai-unavailable");
  cache = { wire, at: Date.now() };
  return wire;
}

// --------------------------------------------------------------------- GET

export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";

  // Manual refreshes get a tighter bucket so nobody can force-drain quota.
  const rl = rateLimit(`map-hotspots:${clientIp(req)}`, refresh ? 6 : 60, 60_000);
  if (!rl.ok) {
    return json(
      { ok: false, error: "Stadig af, ouen — die kaart is al gewaarsku.", reason: "rate" },
      429,
      { "Retry-After": String(rl.retryAfter) }
    );
  }

  // Fresh cache (and not a manual refresh) -> serve straight away.
  if (!refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return json(cache.wire);
  }

  // Single-flight: concurrent misses share one upstream build.
  if (!inflight) {
    inflight = buildFeed().finally(() => {
      inflight = null;
    });
  }
  return json(await inflight);
}
