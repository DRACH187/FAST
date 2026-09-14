import { z } from "zod";
import { db } from "@/lib/db";
import { clientIp, json, rateLimit } from "@/lib/server-guard";
import { geminiApiKey, geminiGenerate } from "@/lib/fast/ai";

/**
 * SURROUNDINGS — South Africa community-safety intel feed.
 *
 * Area-level, public-information awareness data only (open-source reporting /
 * academic research on documented gang activity). NOT law-enforcement guidance.
 *
 * Pipeline: rate limit -> in-memory 10-minute cache (serverless-safe) ->
 * optional SQLite MapCache (self-host only) -> Gemini FREE flash model (JSON
 * mode) -> strict zod validation + sanitisation -> curated offline fallback.
 * The key NEVER leaves the server; the response body only ever carries the
 * sanitised dataset. `?refresh=1` skips the caches for a fresh AI generation.
 *
 * The 10-minute TTL matches the client's auto-sync cadence (MapScreen re-polls
 * every 10 minutes while the map is open), so each scheduled sync can pick up
 * a genuinely regenerated feed.
 */

export const dynamic = "force-dynamic";

const CACHE_ID = "sa-gang-hotspots";
const CACHE_TTL_MS = 10 * 60 * 1000;

// process-wide memory cache — survives across requests in the same lambda /
// server process, which is the only storage guarantee on Vercel
type MemCache = { hotspots: SanitizedHotspot[]; source: "gemini" | "fallback"; updatedAt: number };
let memCache: MemCache | null = null;

// ---------------------------------------------------------------- schema

const PROVINCES = [
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

const gangSchema = z.object({
  name: z.string(),
  threat: z.enum(["MODERATE", "HIGH", "SEVERE"]),
  notes: z.string().optional().default(""),
});

const hotspotSchema = z.object({
  area: z.string(),
  province: z.enum(PROVINCES),
  lat: z.number(),
  lng: z.number(),
  intensity: z.number(),
  summary: z.string(),
  gangs: z.array(gangSchema).min(1).max(6),
});

const hotspotArraySchema = z.array(hotspotSchema);

export type SanitizedGang = {
  name: string;
  threat: "MODERATE" | "HIGH" | "SEVERE";
  notes: string;
};

export type SanitizedHotspot = {
  area: string;
  province: (typeof PROVINCES)[number];
  lat: number;
  lng: number;
  intensity: number;
  summary: string;
  gangs: SanitizedGang[];
};

// ----------------------------------------------------------- sanitisation

/** Strip control characters (incl. newlines inside single-line fields). */
function cleanText(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeHotspots(input: unknown[]): SanitizedHotspot[] {
  const parsed = hotspotArraySchema.safeParse(input);
  const source = parsed.success ? parsed.data : [];

  const seen = new Set<string>();
  const out: SanitizedHotspot[] = [];

  for (const item of source) {
    const area = cleanText(item.area, 60);
    if (!area) continue;
    const key = `${area.toLowerCase()}|${item.province}`;
    if (seen.has(key)) continue;

    const lat = Number.isFinite(item.lat) ? clamp(item.lat, -35, -22) : NaN;
    const lng = Number.isFinite(item.lng) ? clamp(item.lng, 16, 34) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const gangs: SanitizedGang[] = [];
    const gangSeen = new Set<string>();
    for (const g of item.gangs) {
      const name = cleanText(g.name, 60);
      if (!name) continue;
      const gkey = name.toLowerCase();
      if (gangSeen.has(gkey)) continue;
      gangSeen.add(gkey);
      gangs.push({
        name,
        threat: g.threat,
        notes: cleanText(g.notes, 140),
      });
      if (gangs.length === 4) break;
    }
    if (gangs.length === 0) continue;

    out.push({
      area,
      province: item.province,
      lat,
      lng,
      intensity: clamp(Math.round(item.intensity), 1, 5),
      summary: cleanText(item.summary, 220),
      gangs,
    });
    seen.add(key);
    // cap mirrors the prompt's 20-28 band (keeps feed size predictable)
    if (out.length === 28) break;
  }
  return out;
}

// ------------------------------------------------------------------ gemini

const PROMPT = `You are an open-source intelligence summarizer for COMMUNITY SAFETY AWARENESS in South Africa, writing for a neutral public-information display.

Return a STRICT JSON array of 20 to 28 objects. Each object MUST have exactly this shape:
{
  "area": string (township or suburb name),
  "province": one of "Eastern Cape" | "Free State" | "Gauteng" | "KwaZulu-Natal" | "Limpopo" | "Mpumalanga" | "North West" | "Northern Cape" | "Western Cape",
  "lat": number,
  "lng": number,
  "intensity": integer 1-5 (5 = most extensively documented gang activity),
  "summary": string, maximum 220 characters, neutral and factual,
  "gangs": array of 1 to 4 objects { "name": string, "threat": "MODERATE" | "HIGH" | "SEVERE", "notes": string, maximum 140 characters }
}

Hard requirements:
- Coordinates must be real populated places in South Africa with correct latitude/longitude (latitude between -35 and -22, longitude between 16 and 34). Area-level granularity ONLY — never street-level, never personal.
- SPAN ALL NINE PROVINCES: include documented areas in Eastern Cape, Free State, Gauteng, KwaZulu-Natal, Limpopo, Mpumalanga, North West, Northern Cape and Western Cape wherever documentation supports them. Where a province has thin street-gang documentation, include its most-reported township and attribute only what public research supports (for example the Numbers prison gangs 26s, 27s, 28s, which correctional research documents nationally).
- Base everything on widely published news reporting and academic research. Use well-documented gang names only (for example Cape Flats street gangs, or the Numbers prison gangs 26s, 27s, 28s as documented in public research). Do not invent names.
- Include the following areas where documentation supports them: Western Cape Cape Flats (Manenberg, Mitchells Plain, Hanover Park, Lavender Hill, Athlone, Elsies River, Delft, Nyanga, Gugulethi, Khayelitsha), Gauteng (Westbury, Eldorado Park, Hillbrow, Alexandra, Katlehong, Thokoza, Reiger Park), KwaZulu-Natal (Umlazi, Chatsworth, KwaMashu, Wentworth), Eastern Cape Northern Areas (Gelvandale, Helenvale).
- No instructions, no safety-advice framing, no glorification, no sensationalism. Neutral, encyclopedic tone.
- Output ONLY the JSON array. No markdown, no commentary, no code fences.`;

async function fetchFromGemini(): Promise<SanitizedHotspot[] | null> {
  const text = await geminiGenerate(PROMPT, 20_000);
  if (!text) return null;

  // Strip markdown fences if the model wrapped the array anyway.
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  // Tolerate a { "hotspots": [...] } wrapper in addition to a bare array.
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { hotspots?: unknown[] } | null)?.hotspots)
      ? ((parsed as { hotspots: unknown[] }).hotspots)
      : null;
  if (!list) return null;

  const hotspots = sanitizeHotspots(list);
  // Too little usable output -> treat as a failed generation.
  return hotspots.length >= 6 ? hotspots : null;
}

// ---------------------------------------------------------------- fallback

/**
 * Curated offline dataset — 28 documented areas spanning all nine provinces.
 * Gang names are restricted to structures named in published news reporting
 * and academic research (Cape Flats street gangs, Numbers prison gangs 26s /
 * 27s / 28s, and names used in provincial press coverage). Provinces with
 * thin street-gang documentation carry only Numbers-gang references as
 * documented in national correctional research. Wording is neutral and
 * encyclopedic throughout.
 */
const FALLBACK: SanitizedHotspot[] = [
  // ---------------------------------------------------------- Western Cape
  {
    area: "Manenberg",
    province: "Western Cape",
    lat: -33.9747,
    lng: 18.5814,
    intensity: 5,
    summary:
      "Cape Flats residential area repeatedly documented in public reporting for entrenched street-gang structures and periodic spikes of shooting incidents.",
    gangs: [
      { name: "Americans", threat: "SEVERE", notes: "Long-documented Cape Flats street gang active in Manenberg." },
      { name: "Hard Live Kids", threat: "HIGH", notes: "Named in consistent public reporting since the 1990s." },
    ],
  },
  {
    area: "Hanover Park",
    province: "Western Cape",
    lat: -33.9799,
    lng: 18.6159,
    intensity: 5,
    summary:
      "Among the most frequently reported Cape Flats hotspots for gang-related shootings and community protest action against the violence.",
    gangs: [
      { name: "Americans", threat: "SEVERE", notes: "Documented as the dominant structure in the area." },
      { name: "Cairo Gang", threat: "HIGH", notes: "Referenced in long-running public reporting." },
    ],
  },
  {
    area: "Nyanga",
    province: "Western Cape",
    lat: -33.9876,
    lng: 18.5819,
    intensity: 5,
    summary:
      "Township repeatedly recorded among the country's highest contact-crime policing precincts; public reporting documents entrenched group violence and extortion.",
    gangs: [
      { name: "Boko Haram", threat: "HIGH", notes: "Name used in published police and press reporting on Nyanga-Philippi East group violence." },
      { name: "26s", threat: "MODERATE", notes: "Numbers structures referenced in correctional research." },
    ],
  },
  {
    area: "Mitchells Plain",
    province: "Western Cape",
    lat: -34.0122,
    lng: 18.6231,
    intensity: 4,
    summary:
      "Large Cape Flats township where police statistics and press coverage consistently record gang-related contact crime in several sections.",
    gangs: [
      { name: "Junky Funky Kids", threat: "HIGH", notes: "Documented street gang operating across the Plain." },
      { name: "Nice Time Kids", threat: "MODERATE", notes: "Long-standing gang named in academic research." },
    ],
  },
  {
    area: "Lavender Hill",
    province: "Western Cape",
    lat: -34.0283,
    lng: 18.6608,
    intensity: 4,
    summary:
      "Steenberg-adjacent area with recurring media documentation of gang confrontations and prolonged shooting sprees affecting residents.",
    gangs: [
      { name: "Americans", threat: "HIGH", notes: "Reported as the primary documented structure." },
      { name: "Clever Kids", threat: "MODERATE", notes: "Named in Cape Flats gang research." },
    ],
  },
  {
    area: "Elsies River",
    province: "Western Cape",
    lat: -33.9324,
    lng: 18.5104,
    intensity: 4,
    summary:
      "Cape Town northern-suburbs area repeatedly recorded in crime reporting for gang shootings and anti-gang policing operations.",
    gangs: [
      { name: "Fast Guns", threat: "HIGH", notes: "Documented gang associated with the greater Elsies River area." },
      { name: "Bollie Braders", threat: "MODERATE", notes: "Named in published gang research." },
    ],
  },
  {
    area: "Khayelitsha",
    province: "Western Cape",
    lat: -34.0351,
    lng: 18.6787,
    intensity: 4,
    summary:
      "Cape Town's largest township; documented violence is driven by a mix of gang structures, extortion networks and opportunistic crime.",
    gangs: [
      { name: "26s", threat: "HIGH", notes: "Numbers prison gang with documented township presence." },
      { name: "28s", threat: "SEVERE", notes: "Numbers gang extensively documented in commission-of-inquiry and academic evidence." },
    ],
  },
  {
    area: "Delft",
    province: "Western Cape",
    lat: -33.9925,
    lng: 18.6296,
    intensity: 4,
    summary:
      "Cape Flats township repeatedly named in public reporting for gang shootings, service-delivery protests and sustained anti-gang policing operations.",
    gangs: [
      { name: "Americans", threat: "HIGH", notes: "Cape-linked street structure named in reporting on Delft shootings." },
      { name: "28s", threat: "MODERATE", notes: "Numbers structures referenced in regional research." },
    ],
  },
  {
    area: "Gugulethi",
    province: "Western Cape",
    lat: -33.9889,
    lng: 18.5907,
    intensity: 4,
    summary:
      "Cape Flats township with a long-documented history of street gangs and, more recently, extortion networks reported by community structures.",
    gangs: [
      { name: "Americans", threat: "HIGH", notes: "Cape-linked structure named in long-running public reporting." },
      { name: "28s", threat: "MODERATE", notes: "Numbers gang referenced in regional corrections research." },
    ],
  },
  {
    area: "Ocean View",
    province: "Western Cape",
    lat: -34.1211,
    lng: 18.4161,
    intensity: 3,
    summary:
      "Southern Peninsula community where sustained community studies and local reporting document street-gang activity and substance-economy violence.",
    gangs: [
      { name: "Americans", threat: "MODERATE", notes: "Cape-linked street structure referenced in community research." },
      { name: "26s", threat: "MODERATE", notes: "Numbers structures referenced in regional research." },
    ],
  },
  // --------------------------------------------------------------- Gauteng
  {
    area: "Westbury",
    province: "Gauteng",
    lat: -26.1855,
    lng: 27.9192,
    intensity: 4,
    summary:
      "Johannesburg western-corridor area with sustained public reporting on drug-economy gang structures and resident protest action.",
    gangs: [
      { name: "28s", threat: "HIGH", notes: "Numbers gang structures documented in Gauteng reporting." },
    ],
  },
  {
    area: "Eldorado Park",
    province: "Gauteng",
    lat: -26.3047,
    lng: 27.9397,
    intensity: 4,
    summary:
      "Southern Johannesburg community repeatedly covered in national reporting for gang and drug-related violence, especially around Ext sections.",
    gangs: [
      { name: "26s", threat: "HIGH", notes: "Documented Numbers-gang influence in the local drug economy." },
    ],
  },
  {
    area: "Hillbrow",
    province: "Gauteng",
    lat: -26.1909,
    lng: 28.0483,
    intensity: 4,
    summary:
      "Dense inner-city district extensively documented for organized extortion, drug networks and armed robbery rather than classic turf gangs.",
    gangs: [
      { name: "26s", threat: "HIGH", notes: "Numbers gang networks documented in inner-city research." },
      { name: "27s", threat: "MODERATE", notes: "Referenced in prison-to-city gang literature." },
    ],
  },
  {
    area: "Katlehong",
    province: "Gauteng",
    lat: -26.3581,
    lng: 28.1578,
    intensity: 4,
    summary:
      "Large Ekurhuleni township where reporting records armed groups around the taxi and informal economies alongside historically documented hostel conflict.",
    gangs: [
      { name: "26s", threat: "MODERATE", notes: "Numbers structures referenced in township research." },
    ],
  },
  {
    area: "Reiger Park",
    province: "Gauteng",
    lat: -26.2011,
    lng: 28.2317,
    intensity: 4,
    summary:
      "Boksburg community repeatedly covered in East Rand reporting for gang shootings and substance-economy violence.",
    gangs: [
      { name: "Americans", threat: "HIGH", notes: "Cape-linked street structure named in East Rand public reporting." },
    ],
  },
  {
    area: "Thokoza",
    province: "Gauteng",
    lat: -26.3575,
    lng: 28.1424,
    intensity: 3,
    summary:
      "Ekurhuleni township with a documented history of hostel-linked armed conflict; contemporary reporting records drug-economy group activity.",
    gangs: [
      { name: "26s", threat: "MODERATE", notes: "Numbers structures referenced in township research." },
    ],
  },
  {
    area: "Sharpeville",
    province: "Gauteng",
    lat: -26.6884,
    lng: 27.8648,
    intensity: 3,
    summary:
      "Vaal township whose public reporting documents group violence around shebeen economies and periodic mass shooting incidents.",
    gangs: [
      { name: "26s", threat: "MODERATE", notes: "Numbers structures referenced in regional research." },
    ],
  },
  // -------------------------------------------------------- KwaZulu-Natal
  {
    area: "Umlazi",
    province: "KwaZulu-Natal",
    lat: -29.9667,
    lng: 30.8833,
    intensity: 3,
    summary:
      "Durban south township documented for armed groups around taxi conflict and shebeen violence; differs from Cape Flats gang models.",
    gangs: [
      { name: "26s", threat: "MODERATE", notes: "Numbers structures referenced in KwaZulu-Natal research." },
    ],
  },
  {
    area: "Chatsworth",
    province: "KwaZulu-Natal",
    lat: -29.9187,
    lng: 30.8894,
    intensity: 3,
    summary:
      "Durban area whose documented gang history features in KwaZulu-Natal research; contemporary incidents cluster around drug-trade disputes.",
    gangs: [
      { name: "28s", threat: "MODERATE", notes: "Numbers gang influence documented in published research." },
    ],
  },
  {
    area: "KwaMashu",
    province: "KwaZulu-Natal",
    lat: -29.7406,
    lng: 30.9942,
    intensity: 3,
    summary:
      "Durban north-west township named in KwaZulu-Natal reporting for group violence around drug-trade disputes and taxi routes.",
    gangs: [
      { name: "28s", threat: "MODERATE", notes: "Numbers gang influence documented in published research." },
    ],
  },
  {
    area: "Wentworth",
    province: "KwaZulu-Natal",
    lat: -29.9461,
    lng: 30.9403,
    intensity: 3,
    summary:
      "Durban south community where long-running reporting documents gang and substance-economy violence near the industrial basin.",
    gangs: [
      { name: "26s", threat: "HIGH", notes: "Numbers structures documented in Durban-area research." },
      { name: "28s", threat: "MODERATE", notes: "Referenced in regional corrections literature." },
    ],
  },
  // ---------------------------------------------------------- Eastern Cape
  {
    area: "Gelvandale",
    province: "Eastern Cape",
    lat: -33.9255,
    lng: 25.5445,
    intensity: 4,
    summary:
      "Gqeberha Northern Areas suburb repeatedly recorded in reporting for gang shootings and sustained anti-gang policing operations.",
    gangs: [
      { name: "Americans", threat: "HIGH", notes: "Cape-linked structure documented in Eastern Cape reporting." },
      { name: "26s", threat: "MODERATE", notes: "Numbers structures referenced in regional research." },
    ],
  },
  {
    area: "Helenvale",
    province: "Eastern Cape",
    lat: -33.9139,
    lng: 25.5314,
    intensity: 4,
    summary:
      "Northern Areas area frequently cited in research and media as among Gqeberha's most gang-affected residential zones.",
    gangs: [
      { name: "28s", threat: "HIGH", notes: "Numbers gang documented in Northern Areas research." },
      { name: "Americans", threat: "HIGH", notes: "Long-documented street structure in the area." },
    ],
  },
  // ------------------------------------------------------------ Free State
  {
    area: "Botshabelo",
    province: "Free State",
    lat: -29.2333,
    lng: 26.6333,
    intensity: 3,
    summary:
      "Large Free State township east of Bloemfontein; public research documents youth-gang formation and Numbers-gang influence linked to regional correctional facilities.",
    gangs: [
      { name: "26s", threat: "MODERATE", notes: "Numbers structures documented in national corrections research." },
      { name: "28s", threat: "MODERATE", notes: "Referenced in Free State correctional research." },
    ],
  },
  // --------------------------------------------------------------- Limpopo
  {
    area: "Seshego",
    province: "Limpopo",
    lat: -23.8614,
    lng: 29.4436,
    intensity: 2,
    summary:
      "Polokwane township where provincial reporting records occasional group violence and drug-economy activity rather than entrenched turf structures.",
    gangs: [
      { name: "26s", threat: "MODERATE", notes: "Numbers structures referenced in national corrections research." },
    ],
  },
  // ------------------------------------------------------------- Mpumalanga
  {
    area: "eMbalenhle",
    province: "Mpumalanga",
    lat: -26.5356,
    lng: 29.0619,
    intensity: 2,
    summary:
      "Secunda-adjacent township named in provincial reporting for sporadic group violence around informal economies.",
    gangs: [
      { name: "26s", threat: "MODERATE", notes: "Numbers structures referenced in national corrections research." },
    ],
  },
  // -------------------------------------------------------------- North West
  {
    area: "Jouberton",
    province: "North West",
    lat: -26.8697,
    lng: 26.6453,
    intensity: 2,
    summary:
      "Klerksdorp township where reporting documents periodic group violence and substance-economy activity.",
    gangs: [
      { name: "28s", threat: "MODERATE", notes: "Numbers structures referenced in national corrections research." },
    ],
  },
  // ---------------------------------------------------------- Northern Cape
  {
    area: "Galeshewe",
    province: "Northern Cape",
    lat: -28.7186,
    lng: 24.7569,
    intensity: 2,
    summary:
      "Kimberley township, among the Northern Cape's largest; public research documents Numbers-gang influence linked to regional correctional facilities.",
    gangs: [
      { name: "26s", threat: "MODERATE", notes: "Numbers structures referenced in national corrections research." },
    ],
  },
];

// ------------------------------------------------------------------- route

export async function GET(req: Request) {
  // 1. Sliding-window rate limit: 1 generation / 10s / IP (cached reads pass).
  const rl = rateLimit(`hotspots:${clientIp(req)}`, 1, 10_000);
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";

  const serveMem = () =>
    memCache && Date.now() - memCache.updatedAt < CACHE_TTL_MS
      ? json({
          ok: true,
          source: memCache.source,
          updatedAt: new Date(memCache.updatedAt).toISOString(),
          hotspots: memCache.hotspots,
        })
      : null;

  // 2a. Rate-limited requests still get cached intel instead of a hard 429.
  if (!rl.ok) {
    const cached = serveMem();
    if (cached) return cached;
    return json(
      { ok: false, error: "Slow down — the intel feed refreshes every 10 seconds." },
      429,
      { "Retry-After": String(rl.retryAfter) }
    );
  }

  // 2b. Fresh generations pass the limiter; otherwise serve warm caches.
  if (!refresh) {
    const cached = serveMem();
    if (cached) return cached;

    // 2c. Optional SQLite cache (self-host only — read-only FS on Vercel).
    try {
      const cached = await db.mapCache.findUnique({ where: { id: CACHE_ID } });
      if (cached && Date.now() - cached.updatedAt.getTime() < CACHE_TTL_MS) {
        const cachedHotspots = sanitizeHotspots(JSON.parse(cached.payload) as unknown[]);
        if (cachedHotspots.length > 0) {
          const cachedSource = cached.source === "gemini" ? "gemini" : "fallback";
          memCache = { hotspots: cachedHotspots, source: cachedSource, updatedAt: cached.updatedAt.getTime() };
          return json({
            ok: true,
            source: "cache",
            updatedAt: cached.updatedAt.toISOString(),
            hotspots: cachedHotspots,
          });
        }
      }
    } catch {
      // cache layer failed -> fall through to a fresh resolve
    }
  }

  // 3-5. Gemini (free model) with strict validation; curated fallback on any failure.
  let hotspots: SanitizedHotspot[];
  let source: "gemini" | "fallback";
  try {
    const fromGemini = await fetchFromGemini();
    if (fromGemini) {
      hotspots = fromGemini;
      source = "gemini";
    } else {
      hotspots = FALLBACK;
      source = "fallback";
    }
  } catch {
    hotspots = FALLBACK;
    source = "fallback";
  }

  // tell the client WHY it is seeing the curated dataset (drives a hint chip)
  const aiReason = source === "fallback" ? (geminiApiKey() ? "generation-failed" : "no-key") : undefined;

  const updatedAt = new Date();

  // 6. Cache for the next 10 minutes (memory always; SQLite best-effort self-host).
  memCache = { hotspots, source, updatedAt: updatedAt.getTime() };
  try {
    await db.mapCache.upsert({
      where: { id: CACHE_ID },
      create: { id: CACHE_ID, payload: JSON.stringify(hotspots), source, updatedAt },
      update: { payload: JSON.stringify(hotspots), source, updatedAt },
    });
  } catch {
    // persistence is best-effort (read-only filesystem on Vercel)
  }

  // 7. Respond (no-store is applied by the json helper).
  return json({
    ok: true,
    source,
    reason: aiReason,
    updatedAt: updatedAt.toISOString(),
    hotspots,
  });
}
