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
 * rejects commits that contain provider secrets, and committed keys are
 * public keys. Free models ONLY (never paid): the default model is
 * `gemini-flash-latest` on the generativelanguage.googleapis.com free tier.
 * Without a key the map still works — it serves the curated offline dataset.
 */

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

export function geminiEndpoint(): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent`;
}

/** Shared JSON-mode call helper. Returns raw text or null on any failure. */
export async function geminiGenerate(prompt: string, timeoutMs = 20_000): Promise<string | null> {
  const apiKey = geminiApiKey();
  if (!apiKey) return null;

  let res: Response;
  try {
    res = await fetch(geminiEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null; // network error / timeout
  }
  if (!res.ok) return null;

  type GeminiReply = { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  let reply: GeminiReply;
  try {
    reply = (await res.json()) as GeminiReply;
  } catch {
    return null;
  }
  const text = (reply.candidates?.[0]?.content?.parts ?? [])
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();
  return text || null;
}
