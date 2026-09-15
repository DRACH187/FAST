# FAST GUNS — Secure Sessions (the 187)

A monochrome, mobile-first, zero-knowledge chat app built as a production-grade
security exercise — loud brand, silent footprint. Messages are sealed **in your
browser** with per-message keys; the server only ever stores and relays
**opaque ciphertext**. Photos can be taken and shared, but are **never stored
on any device** — they burn after viewing.

Strictly **black · white · grey**. Normal system fonts. Every control is
bespoke — no default browser or library chrome. Motion is GSAP-driven.

Deploys clean to **Vercel** (no WebSocket server, no database requirement) and
runs identically self-hosted.

---

## The flow

```
SPLASH (FAST GUNS logo + 187 mark, GSAP slam)   7s picture show — skip by tap
  └─> ACCESS GATE (passphrase)        constant-time check, rate limited, lockout
        └─> CALLSIGN LOGIN            nickname — saved/deleted permanently per device
              └─> SESSION HUB         start / join / delete sessions · ALL-TIME ROLL
                    ├─> CHAT (E2EE, multiple sessions at once, 5h auto-wipe)
                    ├─> WANTED BOARD  two categories only: WANTED / ELIMINATED
                    ├─> SURROUNDINGS MAP  just a themed Google Map — nothing else
                    └─> LIVE BOARD    everyone on the site right now + total ever
```

- **Start session** — mints a fresh 6-letter code **client-side** with real
  crypto randomness (e.g. `BZYFTB`).
- **Join session** — enter any 6-letter code; the session key is wrapped to
  your device by a member who holds it (Megolm-style outbound key wrap).
- **Delete session** — erases the code, membership and full ciphertext
  history **for every participant**, instantly.
- **Multiple sessions** — hold as many as you like side-by-side; each has its
  own key slots in RAM.
- **Nickname (callsign) system** — every operative logs in with a nickname,
  saved permanently on the device (deletable from Profile). Nicknames are
  public display data; a server-signed attestation token backs every join
  and heartbeat, so display identity is unforgeable. The **DRACH** callsign
  is reserved and requires the boss key (constant-time server check).
- **All-time member ledger** — the hub, live board and profile show the
  total number of members that have EVER entered. Fully zero-knowledge: the
  client sends only `SHA-256(salt | persistent-device-id | callsign)`; the
  server counts irreversibly-salted digests in RAM and can never reverse
  them.
- **Boss summons (DRACH only)** — from DIE WERF ROL the boss opens a fresh
  E2EE session and doorbells any online operative: their device auto-joins
  the room within one heartbeat and the session key is wrapped to them
  straight from the boss's device. Summons are one-line doorbells (code +
  timestamp), RAM-only, 3-minute TTL.
- **Private chat invites (DRACH only)** — every member on the boss's roll
  (online OR offline) carries a PRIVAAT button: it opens a 1:1 E2EE session
  with the boss and hangs a private doorbell with a **2-hour TTL**, so an
  offline member's phone lights up the moment they next surface. Only the
  boss and the invited member ever hold that room's key.
- **Encrypted media law** — every image and video is sealed in the browser
  before it leaves the device: chat photos ride per-photo AES-256-GCM
  ratchet keys (with random filler padding so even the ciphertext SIZE is
  blurred), WANTED-board exhibits (JPEG stills + MP4/WebM clips) ride the
  PBKDF2 board key. The server stores nothing but noise, and media bubbles
  wear the proof: `AES-256 · GE-ENKRIPT`.
- **Dead-man's switch** — 15 minutes without a pulse (no touch, click, key
  or scroll) burns EVERYTHING in the tab: session keys, ratchet state,
  decrypted photos, the WANTED key, offline vault blobs — then drops the
  device back at the 187 gate. A locked screen is a seized phone; the house
  assumes the worst.
- **Mobile-first build** — keyboard-aware viewport (the composer rides above
  the soft keyboard), safe-area insets on every fixed bar, 44px+ touch
  targets, touch-action to kill tap delay, and an iOS-only floor on input
  font sizes so focus never zoom-hijacks the screen.
- **Inspect-element lockdown** — right-click, devtools shortcuts and
  view-source routes are blocked; an overlay slams the page if docked
  devtools are detected. (A deterrent — no client-side trick can defeat a
  determined analyst; the real defence stays ciphertext-first.)
- **Offline vault (PWA)** — installable (“Download app” in Profile):
  service-worker app shell, offline boot, home-screen launch, near-zero data
  usage after first load. Chats auto-wipe **5 hours** after session creation.

## Security architecture

| Layer | Implementation |
|---|---|
| 1 · Crypto | Web Crypto only: ephemeral **X25519** identity per tab (ECDH P-256 fallback), **AES-256-GCM** payloads, **HKDF-SHA256** per-message keys `HKDF(sessionKey, salt=code, info=msg|counter|senderFp)`. AEAD additional-data binds `code\|senderFp\|counter` (tamper ⇒ bubble marked *undecryptable*). |
| 2 · Transport | **Blind HTTP sync endpoint** (`POST /api/sessions/[code]/sync`) — one serverless function carries presence, message/key/photo deltas, key requests and termination. Validates shapes and size caps; stores **only ciphertext and public material**. Works on any host: no WebSocket servers, no sticky sessions, no database. Ephemeral photos ride the same endpoint in RAM with a hard 60s TTL — forwarded and forgotten. |
| 3 · Gate | High-entropy passphrase (`GATE_PASSCODE` env — no default, fails closed) verified with `timingSafeEqual` + constant delay + sliding-window rate limit + exponentially escalating lockout. |
| 4 · Data | Server keeps session codes, public keys, `{senderFp, counter, iv, ciphertext}` blobs and wrapped key envelopes **in process memory** (self-healing across cold starts); the all-time roll stores **irreversible salted digests only**, also in RAM. Every device additionally holds its own **ciphertext-only vault** in IndexedDB — chat history is saved locally for every participant and revealed the moment a member re-wraps the key. **Zero key material is ever persisted anywhere. Zero databases exist.** |
| 5 · Identity | Nicknames are attested: `HMAC(fp|nickname|role|exp, server secret)` tokens ride every join/heartbeat. The reserved DRACH callsign requires the boss key, verified constant-time and never persisted. |
| 6 · Perimeter | Security headers + strict CSP on every response (`X-Frame-Options`, `nosniff`, `no-referrer`, `Permissions-Policy: camera=(self), geolocation=()`, COOP, `frame-ancestors 'none'`, noindex at header + meta). TLS terminates at the edge in production. |
| 7 · Metadata | **Traffic-analysis padding** — every sealed chat message and WANTED text envelope is padded into coarse size buckets (256B/1K/4K/16K/64K) with random jitter, so ciphertext lengths leak nothing about content. The only third-party endpoint in the entire app is the Google Maps frame; chat, board and presence traffic are all same-origin. No referrer, no analytics, no fonts/CDNs, `X-DNS-Prefetch-Control: off`. |

### Photo guarantee — "taken, never stored"

- Capture via `getUserMedia` (rear camera first) with a native camera-picker
  fallback. Frames are drawn to a canvas and encoded to JPEG ≤1280px **in
  memory**.
- The bytes are encrypted with a dedicated per-photo ratchet key
  (`photo|counter|senderFp` domain) and pushed to the sync endpoint, which
  holds them **in RAM for 60 seconds maximum** — no DB row, no IndexedDB, no
  wire cache, no `localStorage`.
- Rendered into a `<canvas>` (no `<img>`, no retained blob URLs, context menu
  disabled). Received photos are **burn-after-view**: a 60s hard TTL applies
  regardless. Burning literally zero-fills the `Uint8Array`.
- Keys live in module RAM only and die with the tab. Closing a session or
  deleting it for everyone burns its photos immediately.

### What the server can never do

It cannot read messages (ciphertext-only at rest), cannot derive session keys
(they are only ever transferred inside ephemeral-ECDH wrapped envelopes), and
cannot recover history for a session whose members' tabs all closed — by
design, that history no longer exists in any readable form.

## The map

`SURROUNDINGS` is **just a map** — nothing else:

- **A real, normal Google Map** (roadmap + satellite, pan/pinch/zoom exactly
  like google.com/maps) wearing the house colours through a monochrome theme
  filter. One tap flips to RAW SAT; one tap pulls back to the whole country.
  No hotspots, no feeds, no intel, no API key, no geolocation — the user
  drives everything with their own fingers.
- Full-screen on every device: phone, tablet and desktop all give the map
  the entire viewport.
- *Geolocation is disabled by design — the map shows a place, never you.*

## Data-saving tech

- **Local vault (IndexedDB)**: every device saves its sessions and ciphertext
  transcripts locally (capped), so history survives reloads and re-joins —
  sealed rows become readable again the moment a member re-wraps the key to
  your device. Past device fingerprints (public data) are kept for message
  attribution. Drafts live in tab-scoped `sessionStorage`.
- **Server**: process-memory room state with delta cursors — every client
  pulls the full transcript on first sync and only deltas afterwards.
- **Zero key material is ever persisted.**

## Run it

```bash
bun install
bun run dev                       # Next.js on :3000 — nothing else to run
```

Open the app, wait out the boot ritual, enter the gate code `187`. (The house
credentials are built in — see the Environment table and SECURITY.md §11.)

### Deploy to Vercel

1. Push this repo to GitHub (e.g. `DRACH187/FAST`) — Vercel deploys on every
   push to the connected branch. **That's it.** The app ships with built-in
   house credentials (owner mandate, SECURITY.md §11), so a fresh Vercel
   import works with ZERO environment variables: gate `187`, boss key
   `BIGBOSS27`, attest root built in.
2. Optional hardening: set your OWN values for the three variables below in
   **Settings → Environment Variables**, then **Deployments → Redeploy**.
   Overrides must pass the strength rules; an invalid override fails closed
   (clear 503, exact reason in the Runtime Logs).
3. If you ever see `SERVER CONFIGURATION ERROR` (HTTP 503): the credentials
   in play failed validation — check the deployment logs. On default
   settings this cannot happen; it means a bad override was set.

Chat state lives in the sync function's memory (rooms self-heal across cold
starts) and each device keeps its own encrypted history vault.

Production standalone (any Node host): `bun run build && bun run start`.

### Environment

| Variable | Purpose |
|---|---|
| `GATE_PASSCODE` | Optional override — built-in: the house mark `187` (owner decision, SECURITY.md §11). Any other value must pass the burned/weak/length rules (≥16 chars in production). Seeds the WANTED-board content key client-side |
| `DRACH_KEY` | Optional override — built-in: `BIGBOSS27` (owner decision). Boss key for the reserved DRACH callsign; other values need full strength (≥16 chars in production) |
| `FAST_ATTEST_SECRET` | Optional override — built-in: a fixed owner-supplied value (public in this repo). Set your own `openssl rand -hex 32` value to restore real attestation/capability secrecy |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Optional — enables cluster-wide rate limiting; keys are HMAC digests, raw IPs never leave the app |

The server runs with zero configuration (built-in house credentials, owner
decision — SECURITY.md §11). Setting overrides is optional; an override that
is burned, weak, or too short fails closed. See SECURITY.md for the full
threat model.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · GSAP ·
Google Maps embed · Web Crypto. No crypto libraries — native primitives only.

## Layout

```
src/lib/crypto/       e2ee.ts (X25519 + HKDF + AES-GCM ratchet + size-bucket padding),
                      keyvault.ts (RAM-only), wanted-crypto.ts (gate-derived AES-GCM)
src/lib/fast/         session-manager, transport (HTTP sync client), memory-store,
                      vault-db (IndexedDB, ct-only), summons (boss doorbell table),
                      identity + identity-store (callsigns, attestation, roster),
                      live.ts + member-ledger.ts (presence + all-time roll),
                      server-roll.ts (digest-only member counter), copy.ts (house voice)
src/app/api/          gate · identity · presence · members · wanted · roster · summons ·
                      sessions/[code]/sync (the whole chat backend)
src/components/fast/  splash, gate, callsign, hub, chat, camera, map, wanted, live,
                      lockdown (inspect deterrent), profile-sheet,
                      offline-vault (PWA register + install), primitives
public/               sw.js (offline vault service worker), manifest.webmanifest, icons
```
