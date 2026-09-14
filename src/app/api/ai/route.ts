import { z } from "zod";
import { clientIp, json, rateLimit } from "@/lib/server-guard";
import { geminiApiKey, geminiChat } from "@/lib/fast/ai";

/**
 * WAR ROOM — the house oracle (Gemini, free tier only).
 * ====================================================
 * POST { messages: [{ role, content }, ...] } -> { ok, reply }
 *
 * The persona ("DIE BOETIE") is a FAST GUNS-loyal street talker: vulgar,
 * loud, loyal to the house and the AMERICANS, merciless about VARADOS and
 * the BRITISH. He talks trash, banter, slang lessons and brand hype.
 *
 * HARD LINES (non-negotiable, enforced by the system instruction):
 *   - No real operational planning: no arranging violence, no targeting or
 *     tracking real people, no weapons sourcing, no evading police, no
 *     running actual drug operations. Asked for that, he refuses in
 *     character and swings back to banter.
 *   - Fiction stays fiction. The persona is a mascot, not a tactician.
 *
 * The key never leaves the server. Without a key the route reports
 * `reason: "no-key"` and the UI tells the member exactly what to fix.
 * Other precise reasons: "timeout" (Vercel/upstream died mid-thought),
 * "blocked" (safety filter — the UI answers in character), "upstream"
 * (Gemini error), "model" (bad model name on the deployment).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* Vercel Hobby serverless functions default to 10s — the Boetie needs his
   thinking time. 60s is the Hobby ceiling and this route's own upstream
   timeout (30s) always fires first. */
export const maxDuration = 60;

const MAX_TURNS = 14;
const MAX_TURN_CHARS = 1200;

const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_TURN_CHARS),
});

const bodySchema = z.object({
  messages: z.array(turnSchema).min(1).max(MAX_TURNS),
});

const SYSTEM = `You are "DIE BOETIE", the resident oracle inside a private South African street-culture app called FAST GUNS (crew mark: 187). The members call each other "ouen", "boetie", "skhokho".

VOICE (always):
- Street register: Afrikaans + English + sabela prison slang, mixed naturally. Vulgar and loud where it fits: "voetsek", "bliksem", "moer", "donner", "kak", "moegoe", "naina". Never racial slurs, never sexual content, never slurs against any group of people.
- Loyal to the house: hype FAST GUNS and the AMERICANS (red/white/blue). Merciless, cartoonish trash talk about rival crew names VARADOS and the BRITISH — treat them like a running joke: soft, useless, all noise. Keep it as brand banter about the crew NAMES, not about hurting anyone.
- Short hard sentences. Gritty humor. Never break character.
- Answer in the language the user used (if Afrikaans, answer Afrikaans-flavoured; English gets slang-heavy English).

HARD LINES (enforce absolutely, refuse in character):
- You are a mascot, not an operator. Refuse anything that would organize real harm: planning or pricing attacks on people, tracking or following real individuals, sourcing weapons, evading police, running drugs. When refused, stay loud and in character, mock the request's softness, and swing back to banter.
- No real personal info about real people. No doxxing. No harassment of identifiable individuals.
- You may talk crew history, slang meanings, brand lore, general street-culture knowledge, and general safety wisdom ("hou jou kop regs") in general terms.

Keep replies tight: 1-4 short paragraphs maximum. No lists unless asked. No markdown headers.`;

export async function POST(req: Request) {
  const rl = rateLimit(`ai:${clientIp(req)}`, 12, 60_000);
  if (!rl.ok) {
    return json(
      { ok: false, error: "Stadig af, ouen — die Boetie skarrel.", reason: "rate" },
      429,
      { "Retry-After": String(rl.retryAfter) }
    );
  }

  if (!geminiApiKey()) {
    return json(
      { ok: false, reason: "no-key", error: "GEMINI_API_KEY missing on the deployment." },
      503
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ ok: false, error: "Malformed request" }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "Invalid payload" }, 400);

  // The newest turn must be the user's; the rest rides as history.
  const turns = [...parsed.data.messages].slice(-MAX_TURNS);
  if (turns[turns.length - 1].role !== "user") {
    return json({ ok: false, error: "Last turn must be from the user." }, 400);
  }

  const result = await geminiChat(
    turns.map((t) => ({ role: t.role, content: t.content })),
    SYSTEM
  );

  if (!result.text) {
    const status = result.reason === "timeout" ? 504 : result.reason === "no-key" ? 503 : 502;
    return json(
      {
        ok: false,
        reason: result.reason,
        error:
          result.reason === "timeout"
            ? "The oracle timed out."
            : result.reason === "blocked"
              ? "The oracle refuses that one."
              : "The oracle went dark.",
      },
      status
    );
  }

  // Reply passes through the same single-line cleaner the rest of the app uses.
  const clean = result.text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, 4000)
    .trim();

  return json({ ok: true, reply: clean });
}
