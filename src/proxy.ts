import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request nonce CSP (spec §12 — M3 hardening).
 * ================================================
 * Every document response gets a fresh nonce. Script execution is locked to
 * the app's own origin + that single-use nonce + 'strict-dynamic' (scripts
 * introduced by trusted scripts inherit trust; injected inline blobs don't).
 *
 * - 'unsafe-eval' exists ONLY in development (React refresh) and can never
 *   reach a production response.
 * - style-src keeps 'unsafe-inline': Next.js injects style attributes at
 *   runtime; stylesheet injection is not script execution (documented risk).
 * - The ONLY third-party frame is the Google Maps embed, pinned to Google's
 *   maps hosts (third-party exposure documented in SECURITY.md).
 *
 * Next.js reads the CSP header set on the REQUEST and applies the nonce to
 * its own bootstrap scripts automatically.
 */
export default function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV !== "production";

  const csp = [
    "default-src 'self'",
    // Next.js injects some inline bootstrap scripts; with the nonce +
    // strict-dynamic they are covered without opening the door to attackers
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval' 'unsafe-inline'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    // the SURROUNDINGS basemap is a real Google Maps embed — the only
    // third-party frame allowed, pinned to Google's maps hosts
    "frame-src https://maps.google.com https://www.google.com",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // skip static assets — the CSP matters for documents only
  matcher: [
    "/((?!_next/static|_next/image|sw.js|manifest.webmanifest|icon-|apple-touch-icon|fast-logo|robots.txt|fonts/).*)",
  ],
};
