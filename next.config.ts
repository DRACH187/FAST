import type { NextConfig } from "next";

/**
 * Perimeter hardening (Layer 5 slice, application side).
 * In production a Coraza/Nginx edge adds WAF + HSTS on top; these headers are
 * the baseline the app itself guarantees on every response.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  {
    // Content-Security-Policy: script execution locked to the app's own
    // origin (inline/eval kept for the Next.js runtime itself), no framing,
    // no objects, no form hijack, no third-party connections. Images allow
    // https: because the map tiles come from public tile CDNs.
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  // discretion: refuse all indexing/caching of the deployment at the edge too
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
