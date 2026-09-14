import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { FastToaster } from "@/components/fast/toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * DISCRETION: the site is deliberately anonymous to outsiders.
 *  - tab title is a blank-ish glyph, the app name never appears in metadata
 *  - nothing about encryption, sessions or the map leaks into the page head
 *  - indexing is refused at every layer (robots meta + X-Robots-Tag header
 *    in next.config.ts) so the deployment stays out of search results
 */
export const metadata: Metadata = {
  title: "—",
  applicationName: " ",
  description: " ",
  keywords: [],
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
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
      </body>
    </html>
  );
}
