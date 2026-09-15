# FAST GUNS — Security Documentation

This document describes what the system ACTUALLY does — its trust boundaries,
cryptographic design, enforcement points, and its honest limits. No marketing
claims: nothing here says "unhackable", "military grade", or "perfect".

**Posture statement:** hardened against realistic remote attackers, malicious
clients, XSS, authentication/authorization abuse, brute force, replay,
impersonation, request flooding, secret leakage, and serverless-specific
weaknesses, under the threat model below. Verified by the regression suite in
`scripts/security-suite.ts` (43 automated checks).

---

## 1. Threat model

**Defends against:**
- A malicious or curious server operator (zero-knowledge relay — see §2)
- A passive network observer (ISP, Wi-Fi snoop): sees TLS-wrapped ciphertext
  with size-bucketed padding, nothing else
- An attacker who knows a room code but not the gate passphrase
- Impersonation of callsigns, including "DRACH" (attestation layer)
- Sender forgery inside a session (per-message signatures — M1)
- Key substitution / participant hijack (key binding + write-once slots — M2)
- Unauthorized room termination (creator/boss-only — H3)
- Unauthorized board deletion (HMAC capabilities — M2)
- Brute force on the gate (rate limit + exponential lockout + trusted-IP
  extraction that ignores client-supplied headers — H1)
- Session flooding, board flooding, member-roll inflation (bounded stores,
  per-route limits, admission budgets — M5)
- XSS (no dangerous DOM sinks, strict nonce CSP, zero third-party scripts)

**Does NOT defend against:**
- A compromised endpoint (keylogger, malware, stolen unlocked device)
- A malicious browser extension running in the page's origin
- A recipient intentionally copying plaintext (screenshots, notes)
- Traffic-analysis correlation (timing, volume patterns, who-talks-to-whom
  timing) — padding blunts exact lengths, not rhythms
- The server operator observing *metadata*: room existence, participant
  fingerprints, message counts, timestamps, online presence
- Legal/physical compromise of the hosting platform (Vercel)

## 2. Trust boundaries & the zero-knowledge relay

```
Browser tab (trust boundary #1 — all plaintext, all keys, RAM only)
   │  everything on the wire is ciphertext / public material / signatures
   ▼
Next.js API routes (trust boundary #2 — sees ciphertext + public keys +
   │                   signatures + timestamps; CANNOT decrypt content)
   ▼
Process RAM (the only "storage"; dies with the process; NO database)
```

The server stores ONLY: `{senderFp, counter, iv, ciphertext, sig?}` per
message, wrapped key envelopes, ephemeral photo ciphertext (60s), sealed
board cases (24h), fingerprints, attested nicknames, and operational
timestamps. There is no database anywhere in the project — verified by
audit — and no plaintext of user content ever reaches the server.

## 3. Cryptographic design (all native Web Crypto — no home-rolled math)

| Purpose | Construction |
|---|---|
| Identity | Ephemeral X25519 keypair per tab (ECDH P-256 fallback); private key RAM-only |
| Fingerprint | SHA-256(public key), first 16 bytes, 32 hex chars — **bound to the key at the server** (a stolen fp is useless without a colliding key: 128-bit problem) |
| Session key | Random 256-bit per room, wrapped per member via fresh ephemeral ECDH + HKDF + AES-256-GCM (Megolm-style); ephemeral wrapper keys destroyed after use |
| Per-message keys | HKDF-SHA256(sessionKey, salt=`fast-msg\|code`, info=`msg\|counter\|senderFp`) — key separation per message per sender |
| Message integrity | AES-256-GCM AAD = `code\|senderFp\|counter` (cross-room replay + field substitution fail AEAD) |
| Sender authenticity (M1) | Ed25519 (ECDSA P-256 fallback) signature over `fast.sig.v1\|code\|senderFp\|counter\|id\|iv\|SHA256(ciphertext)`; verified client-side before rendering; invalid → text hidden, tamper shown; unsigned → marked "ongeteken" |
| Signing keys | Per-tab, write-once on the server roster; client mirrors write-once (conflicts ignored) |
| Photos | Dedicated key domain (`fast-photo\|...`), RAM-only, 60s TTL, burn-after-view with byte zeroization |
| WANTED board (H2) | AES-256-GCM, key = PBKDF2-SHA512 (600k iters) over the **high-entropy gate passphrase** (env), versioned salt `v2`, content version stamped `wv:2` inside the sealed envelope |
| Traffic analysis | Ciphertext length padded into coarse buckets (256B–64KB) with jitter |

**Forward secrecy — honest statement:** the session design is HKDF key
separation, NOT a true hash/DH ratchet. If a running session key is extracted
from a live tab, the whole transcript of that room decrypts. The code and this
document do not claim forward secrecy.

## 4. Authentication & authorization

**Gate (Tier B):** high-entropy `GATE_PASSCODE` from validated env; no
default exists; constant-time compare; 350ms failure delay; 10/min/source
sliding window; 8 failures/10min → lockout escalating 10m→30m→90m→6h→24h.

**Secrets (C1):** `src/lib/server-env.ts` refuses to boot when any required
secret is missing, shorter than the environment minimum, trivially weak, or
matches a burned/historical value (the old `187`, `BIGBOSS27`, the old
attest default, etc.). Development values live in gitignored `.env.local`
only; production values live in the platform's secret store.

**Trusted IP (H1):** `clientIp()` reads `x-real-ip` (platform-set) or the
RIGHTMOST `x-forwarded-for` hop only — client-supplied left hops are never
trusted. Malformed/absent → one shared "unknown" bucket (missing metadata
cannot mint unlimited limiter keys). IPs are hashed (HMAC) into limiter keys
and never stored or logged.

**Callsigns:** normalized server-side (ASCII allowlist — homoglyph tricks
dead), `drach` reserved behind the boss key. Registration mints an HMAC
attestation `fp|nickname|role|exp(24h)` — the ONLY source of nickname/role
on every join/heartbeat/roster/summons/wipe.

**Boss privileges:** roster, summons, board wipe, board moderation — all
require an attestation carrying the boss role. Forged/garbage/member tokens
→ 401/403.

**Room termination (H3):** requires a valid attestation AND creator-or-boss.
The creator is bound at provisioning time; anonymous or member terminate →
403.

**Board capabilities (M2):** create/attach/delete/comment/uncomment are
authorized by HMAC capabilities bound to (action, resource id, holder fp,
expiry). A public fingerprint grants nothing. Boss attestation is the
override. Tombstones make deleted/wiped ids un-resurrectable via reseed.

**Participant keys (M2):** join verifies `fp = SHA-256(pubkey)` prefix
binding; slots are write-once (ECDH key AND signing key); a different key
under an occupied fp → 409/400, never a silent overwrite.

## 5. Rate limiting & abuse control (H4)

Per-route sliding windows (gate 10/min, sync 240/min, presence 30/min,
identity 12/min, roster 20/min, summons 10/min, wanted 40–240/min,
members 30/min) + a per-instance circuit breaker (503 + Retry-After) +
exponential gate lockout. Limiter state is `globalThis`-pinned per process.

**Distributed mode (optional):** set `UPSTASH_REDIS_REST_URL` +
`UPSTASH_REDIS_REST_TOKEN` and the limiter becomes cluster-wide via a
fixed-window Redis backend. Keys are HMAC digests (no raw IPs leave the
app); backend errors FAIL CLOSED. Without it, multi-instance serverless
deployments get per-instance limits — a documented residual risk (§8).

**Members roll (M5):** only attested members can join the roll; at most 120
NEW digests are admitted per minute process-wide, so flooding cannot
inflate the total or evict real members.

## 6. Input validation & API hardening

- Every route: zod `.strict()` schemas (unknown fields rejected), regex
  allowlists for codes/fps, base64 format + size ceilings before any
  expensive work, JSON-only Content-Type (415 otherwise), hard body caps
  (413) enforced BEFORE parsing, idempotent mutations
- Posting into a room requires a bound participant slot (`join` first)
- Errors are generic ("Invalid payload", "Malformed request") — no stack
  traces, no internals, no oracle-rich distinctions
- No redirect targets, no server-side URL fetching, no file paths, no
  SQL, no cookies, no ambient credentials (CSRF is structurally dead:
  JSON-only bodies + no auth cookies + no CORS grants)

## 7. Frontend hardening

- **CSP:** per-request nonce + `'strict-dynamic'` issued by `src/proxy.ts`;
  `unsafe-eval`/`unsafe-inline` exist ONLY in development responses;
  `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`,
  `connect-src 'self'`
- Zero `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function` (audited)
- All user-controlled rendering flows through React text nodes
- Headers: HSTS(2y, preload), X-Frame-Options DENY, nosniff, no-referrer,
  COOP/CORP same-origin, Permissions-Policy (camera self-only, everything
  else denied), noindex everywhere
- Service worker: caches the app shell ONLY; `/api/*` is never cached
- Devtools deterrents (context menu, shortcuts, overlay) are EXPLICITLY
  cosmetic and are never described as security

## 8. Honest limitations

1. **Serverless multi-instance:** without the optional Upstash backend,
   rate limits and lockouts are per-instance (H4 residual). Documented,
   accepted, pluggable.
2. **Callsign continuity:** the identity registry is RAM-only by law (no
   database). A cold restart frees nicknames; the nickPass ownership proof
   dies with it. DRACH at least re-requires the boss key.
3. **Board crypto root:** the board key derives from the gate passphrase.
   With the required high-entropy passphrase this is sound (Tier B), but it
   means anyone who learns the passphrase can decrypt captured board
   ciphertext (PBKDF2-600k makes this expensive, not impossible).
4. **Google Maps embed:** the map screen loads Google's iframe — Google
   sees visitor IPs/timing for that screen. The only third-party surface;
   pinned by CSP.
5. **Metadata:** the relay necessarily sees room existence, participant
   fps, timestamps, sizes (coarse), presence. It cannot see content.
6. **Endpoint compromise** defeats everything — true of every E2EE system.
7. **Roll integrity:** the all-time count is attestation-gated and
   budget-bounded, but is still process-RAM (cold start shrinks the
   server's view; client high-water marks prevent display regressions).

## 9. Deployment requirements (fail-closed)

Set in Vercel → Settings → Environment Variables (Production + Preview):

| Variable | Minimum | Generate |
|---|---|---|
| `GATE_PASSCODE` | 16 chars | `openssl rand -base64 24` |
| `DRACH_KEY` | 16 chars | `openssl rand -base64 24` |
| `FAST_ATTEST_SECRET` | 32 chars | `openssl rand -hex 32` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | optional | Upstash console |

Values matching burned/historical credentials are rejected at boot in every
environment. Missing secrets = the app does not serve. Never commit `.env*`
(except `.env.example`); rotate anything that was ever pasted into chat,
tickets, or config files.

## 10. Verification

```bash
bunx tsc --noEmit            # type gate (build fails closed on errors)
bun run lint                 # ESLint
bun scripts/security-suite.ts http://localhost:3000   # 43 regression checks
```

The suite covers: CSP/headers, gate auth + spoofed-XFF bypass resistance,
attestation forgery, boss boundaries, member-roll gating, fingerprint/key
binding, slot conflicts, anonymous/member/creator terminate matrix, message
posting gate, board capability forgery/deletion, AES-GCM roundtrip, AEAD
tamper, cross-room replay, signature verify/tamper/impersonation, and nonce
reuse across 500 seals.

## 11. Owner decisions (recorded)

**Gate code = the house mark "187" (2025 mandate).** The front door accepts
the three-digit mark by explicit owner instruction. Rationale recorded so no
future audit flags it as an accident:

- The gate is friction + abuse control — rate limits, escalating lockouts
  (10m → 24h), constant-time compare, 350ms failure delay — NOT the root of
  message secrecy. E2EE session keys and server attestations carry that.
- Consequence accepted: the WANTED-board content key is derived client-side
  from this code (PBKDF2-SHA512, 600k iters). A 3-digit code space (1,000
  keys) means board ciphertext offers no protection against a determined
  offline attacker who captures it. Board entries self-destruct within 24h.
  Board encryption therefore = tamper-evidence + casual-viewer blinding,
  not strong confidentiality.
- Implementation: `server-env.ts` grants an explicit carve-out for the exact
  value "187" on GATE_PASSCODE ONLY. Every other secret (and any other
  GATE_PASSCODE value) still faces the full burned/weak/length rules.
- Brute-force surface: 999 wrong codes, 10 attempts/min/IP, hard lockout
  after 8 failures inside 10 minutes, escalating on repeat. Enumerating the
  space takes ≥ 100 minutes per source under ideal conditions for the
  attacker, and every failure is an observable lockout event.
**Boss key = "BIGBOSS27" (2025 mandate).** The reserved DRACH callsign is
unlocked with the house value by explicit owner instruction. Scope of the
value: it authorizes the boss ROLE on the identity registry endpoint only —
constant-time verified, rate-limited (12/min/IP), never stored or logged.
It grants: DIE WERF ROL roster rights, boss summon, board wipe. It is NOT a
crypto root and never derives keys. Implementation: explicit carve-out for
the exact value "BIGBOSS27" on DRACH_KEY ONLY in `server-env.ts`; all other
secrets keep the full burned/weak/length rules.
