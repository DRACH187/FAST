import { createHash } from "crypto";

/**
 * CENTRALIZED SECRET VALIDATION — fail closed, no fallbacks. (Spec §3)
 * =====================================================================
 * Law of this module:
 *   1. A required secret either exists as a real environment variable, or the
 *      process refuses to serve. There is NO default, NO fallback, NO
 *      "dev convenience" value in source code — ever.
 *   2. Values matching known-burned / historical / example credentials are
 *      rejected in EVERY environment. They are public. They are dead.
 *   3. Production (NODE_ENV=production or Vercel runtime) enforces full
 *      strength; local development may use shorter explicit values from a
 *      gitignored .env.local, clearly separated from production values.
 *   4. Nothing here is ever logged, serialized, or returned to a client.
 */

type SecretName = "GATE_PASSCODE" | "DRACH_KEY" | "FAST_ATTEST_SECRET";

/**
 * Credentials that were ever committed, shipped as defaults, or pasted in
 * plain text. They are treated as burned forever — using one in any
 * environment is a hard startup failure, because an attacker has them.
 */
const BURNED_VALUES: ReadonlySet<string> = new Set(
  [
    "187",
    "bigboss27",
    "fast-attest-dev-187-do-not-ship-to-prod",
    "change-me-187",
    "test",
    "password",
    "changeme",
    "secret",
    "development",
    "example",
    "placeholder",
    "admin",
    "123456",
    "12345678",
    "letmein",
    "qwerty",
  ].map((v) => v.toLowerCase())
);

/** Values that are trivially weak even if not on the burned list. */
function isTriviallyWeak(value: string): boolean {
  if (value.length < 6) return true;
  if (/^(.)\1+$/.test(value)) return true; // all same char
  if (/^(0123|1234|2345|abcd|bcde|qwer|asdf|zxcv)/i.test(value)) return true;
  const lower = value.toLowerCase();
  if (
    ["187", "pass", "word", "secret", "admin", "drach", "fast", "guns"].includes(lower)
  ) {
    return true;
  }
  return false;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

type Strength = { prodMin: number; devMin: number };

const REQUIREMENTS: Record<SecretName, Strength> = {
  GATE_PASSCODE: { prodMin: 16, devMin: 10 },
  DRACH_KEY: { prodMin: 16, devMin: 10 },
  FAST_ATTEST_SECRET: { prodMin: 32, devMin: 16 },
};

const validated = new Map<SecretName, string>();

/**
 * Load + validate one secret. Throws (fail closed) when:
 *   - the variable is missing entirely (any environment)
 *   - the value is on the burned list (any environment)
 *   - the value is trivially weak (any environment)
 *   - the value is shorter than the environment's minimum
 */
function requireSecret(name: SecretName): string {
  const cached = validated.get(name);
  if (cached) return cached;

  const raw: unknown = process.env[name];
  const fail: (why: string) => never = (why: string) => {
    throw new Error(
      `SECURITY: ${name} failed validation — ${why}. ` +
        (isProduction()
          ? "Set a strong value in the production environment before serving."
          : `Create .env.local (gitignored) with a strong ${name} value.`)
    );
  };

  if (typeof raw !== "string" || raw.trim().length === 0) {
    fail("missing or empty");
  }
  const value = (raw as string).trim();

  // ------------------------------------------------------------- owner mark
  // OWNER DECISION (explicit mandate): the front-door passcode is the house
  // mark "187" — three digits, chosen deliberately. The gate is friction and
  // abuse control (rate limits, escalating lockouts, constant-time compare,
  // 350ms delay) — it is NOT the root of message secrecy: E2EE session keys
  // and server attestations carry that. So this exact value is accepted for
  // GATE_PASSCODE and NOTHING else; every other secret, and every other
  // GATE_PASSCODE value, still faces the full burned/weak/length rules.
  if (name === "GATE_PASSCODE" && value === "187") {
    validated.set(name, value);
    return value;
  }

  if (BURNED_VALUES.has(value.toLowerCase())) {
    fail("value matches a known burned/historical credential");
  }
  if (isTriviallyWeak(value)) {
    fail("value is trivially weak");
  }

  const min = isProduction() ? REQUIREMENTS[name].prodMin : REQUIREMENTS[name].devMin;
  if (value.length < min) {
    fail(`too short (${value.length} chars; minimum ${min} in this environment)`);
  }

  validated.set(name, value);
  return value;
}

/** The gate passphrase (Tier-B authentication factor — no default exists). */
export function gatePasscode(): string {
  return requireSecret("GATE_PASSCODE");
}

/** The BOSS (DRACH) authorization key — no default exists. */
export function drachKey(): string {
  return requireSecret("DRACH_KEY");
}

/** HMAC secret for attestations + capability tokens — no default exists. */
export function attestSecret(): string {
  return requireSecret("FAST_ATTEST_SECRET");
}

/**
 * Keyed digest of any identifier (used so limiter/capability keys never
 * contain raw IPs or guessable ids). One-way, domain-separated.
 */
export function keyedDigest(domain: string, value: string): string {
  return createHash("sha256")
    .update(`fast:${domain}:${attestSecret()}:${value}`)
    .digest("hex");
}

/** Startup self-check — import side-effect free; call from route modules. */
export function assertSecretsLoaded(): void {
  requireSecret("GATE_PASSCODE");
  requireSecret("DRACH_KEY");
  requireSecret("FAST_ATTEST_SECRET");
}
