/**
 * Gemini (free tier) server-side configuration.
 * ==============================================
 * Only API routes may import this — the key never ships to the browser.
 *
 * Resolution order:
 *   1. GEMINI_API_KEY env var (recommended — set it in Vercel → Settings →
 *      Environment Variables, or .env.local for local dev; see .env.example)
 *   2. GOOGLE_AI_API_KEY env var (alias)
 *
 * No literal key is committed on purpose — GitHub push protection (rightly)
 * rejects commits that contain provider secrets. Free models ONLY (never
 * paid): the default is `gemini-flash-latest`, with an automatic retry on
 * `gemini-2.0-flash` when a deployment's key does not recognise the alias.
 * Without a key every AI surface degrades gracefully to curated/fallback
 * content and the UI says exactly why.
 *
 * Vercel hardening: routes that call Gemini must export
 * `export const maxDuration = 60` — Hobby functions default to 10s and die
 * mid-generation otherwise. Safety thresholds are relaxed to BLOCK_ONLY_HIGH
 * so the house persona's rough talk is not silently swallowed; true
 * refusals still surface as `reason: "blocked"` instead of a dead line.
 */

export type GeminiFailureReason =
  | "ok"
  | "no-key"
  | "timeout"
  | "upstream"
  | "model"
  | "blocked"
  | "empty";

export type GeminiResult = { text: string | null; reason: GeminiFailureReason };

export function geminiApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
  return key.trim().length > 0 ? key.trim() : null;
}

export function geminiModel(): string {
  const model = (process.env.GEMINI_MODEL || "gemini-flash-latest").trim();
  // hard guard: this project must never silently upgrade to a paid model
  if (/pro|ultra|thinking|exp-/i.test(model)) return "gemini-flash-latest";
  return model;
}

/** Free-model fallback chain: alias first, stable 2.0 flash second. */
const FALLBACK_MODELS = ["gemini-2.0-flash"] as const;

function geminiEndpoint(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/**
 * Safety thresholds: the persona is loud, vulgar and loyal — that is not a
 * safety incident. Only genuinely high-risk content gets blocked, and when
 * it does the caller receives `reason: "blocked"` and answers in character.
 */
const SAFETY_SETTINGS = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_ONLY_HIGH" }));

type GeminiCallOptions = {
  /** Ask the model for raw JSON output (used by the intel feed). */
  jsonMode?: boolean;
  /** Persistent persona / rules injected as system_instruction. */
  system?: string;
  temperature?: number;
};

type GeminiReply = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
};

function extractReply(reply: GeminiReply): { text: string | null; reason: GeminiFailureReason } {
  const candidate = reply.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();
  if (text) return { text, reason: "ok" };
  const blockReason = reply.promptFeedback?.blockReason ?? candidate?.finishReason;
  if (blockReason && /safety|blocked|prohibited/i.test(blockReason)) {
    return { text: null, reason: "blocked" };
  }
  return { text: null, reason: "empty" };
}

/** One POST to one model. Never throws. */
async function callModel(
  model: string,
  body: Record<string, unknown>,
  apiKey: string,
  timeoutMs: number
): Promise<{ status: number; result: GeminiResult }> {
  let res: Response;
  try {
    res = await fetch(geminiEndpoint(model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { status: 0, result: { text: null, reason: "timeout" } };
    }
    return { status: 0, result: { text: null, reason: "upstream" } };
  }

  if (!res.ok) {
    if (res.status === 404 || res.status === 400) {
      return { status: res.status, result: { text: null, reason: "model" } };
    }
    return { status: res.status, result: { text: null, reason: "upstream" } };
  }

  try {
    const reply = (await res.json()) as GeminiReply;
    return { status: res.status, result: extractReply(reply) };
  } catch {
    return { status: res.status, result: { text: null, reason: "upstream" } };
  }
}

/** Run a body across the fallback chain until a model answers. */
async function callWithFallback(
  body: Record<string, unknown>,
  apiKey: string,
  timeoutMs: number
): Promise<GeminiResult> {
  const primary = geminiModel();
  const chain: string[] = [primary, ...FALLBACK_MODELS.filter((m) => m !== primary)];

  let last: GeminiResult = { text: null, reason: "upstream" };
  for (let i = 0; i < chain.length; i++) {
    const { status, result } = await callModel(chain[i], body, apiKey, timeoutMs);
    if (result.text) return result;
    last = result;
    // only a bad/unavailable MODEL name justifies the next link in the chain
    if (!(result.reason === "model" && (status === 404 || status === 400))) break;
  }
  return last;
}

/**
 * Single-shot call helper. Returns the raw reply text or a precise failure
 * reason on ANY failure (missing key, network, timeout, quota, garbage).
 * Callers own the fallback and the user-facing wording.
 */
export async function geminiGenerate(
  prompt: string,
  timeoutMs = 20_000,
  options: GeminiCallOptions = {}
): Promise<GeminiResult> {
  const apiKey = geminiApiKey();
  if (!apiKey) return { text: null, reason: "no-key" };

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: options.temperature ?? (options.jsonMode ? 0.2 : 0.9),
      ...(options.jsonMode ? { responseMimeType: "application/json" } : {}),
      maxOutputTokens: 2048,
    },
    safetySettings: SAFETY_SETTINGS,
  };
  if (options.system) {
    body.systemInstruction = { parts: [{ text: options.system }] };
  }

  return callWithFallback(body, apiKey, timeoutMs);
}

/**
 * Multi-turn chat variant for the WAR ROOM. `history` is the visible
 * conversation (already trimmed by the caller); the persona rides in as
 * system_instruction so it can never be drowned out by long turns.
 */
export async function geminiChat(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  system: string,
  timeoutMs = 30_000
): Promise<GeminiResult> {
  const apiKey = geminiApiKey();
  if (!apiKey) return { text: null, reason: "no-key" };

  const contents = history.map((turn) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: [{ text: turn.content }],
  }));

  return callWithFallback(
    {
      contents,
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: { temperature: 1.0, maxOutputTokens: 1024 },
      safetySettings: SAFETY_SETTINGS,
    },
    apiKey,
    timeoutMs
  );
}
