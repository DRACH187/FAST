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
