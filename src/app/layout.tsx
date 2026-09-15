import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { FastToaster } from "@/components/fast/toast";
import { Lockdown } from "@/components/fast/lockdown";
import { OfflineVaultRegistrar } from "@/components/fast/offline-vault";

/**
 * NONCE CSP REQUIREMENT (M3 — src/proxy.ts): the per-request nonce only
 * reaches Next.js's own bootstrap scripts when the document is rendered
 * PER-REQUEST. Without this export the root page is statically prerendered
 * at build time with nonce-less inline scripts, and under 'strict-dynamic'
 * the browser blocks every one of them (console: "Executing inline script
 * violates ... 'script-src ... nonce-...'"). Forcing dynamic rendering is
 * the documented prerequisite for nonce-based CSPs — and this app is fully
 * client-side anyway, so nothing is lost.
 */
export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * DISCRETION vs BRAND: the tab wears the house name ("FAST GUNS" — the 187
 * mark), but nothing else leaks into the page head: no description, no
 * keywords, indexing refused at every layer (robots meta + X-Robots-Tag
 * header in next.config.ts) so the deployment stays out of search results.
 */
export const metadata: Metadata = {
  title: "FAST GUNS",
  applicationName: "FAST GUNS",
  description: " ",
  keywords: [],
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FAST GUNS",
  },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  // MOBILE LAW: when the soft keyboard opens, the visual viewport SHRINKS so
  // the chat composer and hub dock stay visible above it — instead of the
  // keyboard floating over the input like a cop over a witness.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-background text-foreground`}>
        {children}
        <FastToaster />
        <Lockdown />
        <OfflineVaultRegistrar />
      </body>
    </html>
  );
}
