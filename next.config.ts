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
  // resource isolation: our own subresources never load cross-origin paper
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // HSTS: Vercel terminates TLS; browsers then refuse any plain-HTTP path to
  // the deployment (ignored on plain http/localhost, so dev is unaffected)
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  // NOTE: Content-Security-Policy is issued PER-REQUEST with a fresh nonce
  // by src/middleware.ts (M3) — it deliberately does NOT live here.
  // discretion: refuse all indexing/caching of the deployment at the edge too
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // spec §25 (M7): type errors must NEVER ship silently. The build fails
  // closed on the first TS error — the whole point.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
