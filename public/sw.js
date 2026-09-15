/**
 * FAST GUNS — OFFLINE VAULT service worker
 * ========================================
 * The block stays open when the network dies:
 *
 *  - App shell + static assets: stale-while-revalidate (instant from cache,
 *    refreshed in the background).
 *  - Navigations: network-first, falling back to the cached shell when
 *    offline — the app boots with zero connectivity and every vault
 *    (callsign, session codes, 5h message cache) lives in LocalStorage.
 *  - /api/*: NEVER cached. Ciphertext sync, presence, ledgers — always live,
 *    always no-store.
 *  - No data-saving shortcuts: repeated visits are served from cache, so the
 *    app costs almost nothing on mobile data after the first load.
 */

const VERSION = "fg-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const OFFLINE_URLS = ["/", "/manifest.webmanifest", "/fast-logo.png", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(OFFLINE_URLS))
      .catch(() => undefined) // a blocked precache must never break install
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/** true for requests that must never touch a cache */
function isForbidden(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.search.includes("XTransformPort") ||
    (url.origin === self.location.origin && url.pathname.startsWith("/_next/webpack-hmr"))
  );
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === "opaque")) {
        cache.put(request, response.clone()).catch(() => undefined);
      }
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}

async function navigateWithFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (
      (await cache.match("/")) ||
      (await cache.match(request)) ||
      new Response(
        "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>FAST GUNS</title><style>html,body{height:100%;margin:0;background:#000;color:#a3a3a3;font:600 12px/1.6 ui-monospace,monospace;letter-spacing:.3em;text-transform:uppercase;display:grid;place-items:center;text-align:center;padding:24px}</style></head><body><div>187 — offline<br><span style='font-size:9px;color:#525252'>open the app once online to cache the block</span></div></body></html>",
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      )
    );
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin && !url.pathname.endsWith(".png") && !url.pathname.endsWith(".woff2")) {
    return; // ignore foreign requests except immutable assets
  }
  if (isForbidden(url)) return; // ciphertext + presence stay live-only

  if (request.mode === "navigate") {
    event.respondWith(navigateWithFallback(request));
    return;
  }

  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".webmanifest") ||
    url.pathname === "/fonts/pirata-one.woff2";

  if (isStatic) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // everything else (same-origin GETs): network-first, cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          caches
            .open(RUNTIME_CACHE)
            .then((cache) => cache.put(request, response.clone()))
            .catch(() => undefined);
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) || Response.error())
  );
});
