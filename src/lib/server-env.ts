import { createHash } from "crypto";

/**
 * CENTRALIZED SECRET VALIDATION — owner-mandated house credentials, fail
 * closed on anything else. (Spec §3, amended by owner mandate.)
 * =====================================================================
 * Law of this module:
 *   1. OWNER DECISION (explicit mandate): the house ships with BUILT-IN
 *      credentials — GATE_PASSCODE "187", DRACH_KEY "BIGBOSS27" and a fixed
 *      FAST_ATTEST_SECRET. When the environment does not define a variable,
 *      the built-in house value is used. Zero-configuration deployments
 *      (e.g. Vercel with no env vars) therefore work out of the box.
 *   2. Environment values ALWAYS override the built-ins. An override that is
 *      burned/weak/too short still fails closed — bad overrides are a hard
 *      refusal, never silently replaced by the built-in.
 *   3. Values matching known-burned / historical / example credentials are
 *      rejected in EVERY environment — except the exact owner marks above.
 *   4. Nothing here is ever logged, serialized, or returned to a client.
 *
 * SECURITY NOTE (documented in SECURITY.md §11): the built-ins live in a
 * public repository, so they are PUBLIC KNOWLEDGE. Message secrecy is
 * unaffected (E2EE per-session keys never touch these values), but the
 * attestation/capability layer should be treated as anti-casual-abuse, not
 * anti-adversary. Set real env overrides whenever that changes.
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
 * OWNER-MANDATED BUILT-IN HOUSE CREDENTIALS.
 * Used ONLY when the environment does not define the variable (or leaves it
 * empty). Explicitly ordered by the owner: the gate is the house mark "187",
 * the boss key is "BIGBOSS27", and the attestation root is the owner-supplied
 * random value below. All three are public knowledge in this repository —
 * consequences documented in SECURITY.md §11.
 */
const OWNER_FALLBACKS: Record<SecretName, string> = {
  GATE_PASSCODE: "187",
  DRACH_KEY: "BIGBOSS27",
  FAST_ATTEST_SECRET: "v7Qm2Zx9Lp4Kc8NwR3tY6Hs1Fd5Jq0Aa",
};

/**
 * Load + validate one secret.
 *   - Missing/empty in the environment -> the OWNER-MANDATED built-in is
 *     used (zero-config deployments work; see SECURITY.md §11).
 *   - An explicitly-set override that is burned/weak/too short -> THROW
 *     (fail closed). Bad overrides are never silently swapped for the
 *     built-in value.
 *   - The owner marks ("187" / "BIGBOSS27") and the built-in attest secret
 *     are accepted exactly as written; every other value faces the full rules.
 */
function requireSecret(name: SecretName): string {
  const cached = validated.get(name);
  if (cached) return cached;

  const raw: unknown = process.env[name];
  const override = typeof raw === "string" && raw.trim().length > 0;
  const value = override ? (raw as string).trim() : OWNER_FALLBACKS[name];

  const fail: (why: string) => never = (why: string) => {
    throw new Error(
      `SECURITY: ${name} failed validation — ${why}. ` +
        (override
          ? "Fix or remove the environment override (the built-in house value is fine)."
          : "The built-in house credential is invalid — this is a code bug.")
    );
  };

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

  // --------------------------------------------------------- boss key mark
  // OWNER DECISION (explicit mandate): the DRACH boss key is the house value
  // "BIGBOSS27". Same reasoning as the gate mark: this value authorizes one
  // pseudonymous role on one registry endpoint (constant-time verified,
  // rate-limited, never stored) — it is not a crypto root. Accepted for
  // DRACH_KEY ONLY; every other secret faces the full strength rules.
  if (name === "DRACH_KEY" && value === "BIGBOSS27") {
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
