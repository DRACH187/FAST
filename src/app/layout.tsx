import type { Metadata, Viewport } from "next";
import {
  Geist,
  Geist_Mono,
  Pirata_One,
  Mr_Dafoe,
  UnifrakturCook,
  Oswald,
} from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Chicano tattoo blackletter — headers & channel names
const pirata = Pirata_One({
  weight: "400",
  variable: "--font-pirata",
  subsets: ["latin"],
});

// Flowing Chicano script — names, signatures & flourishes
const mrDafoe = Mr_Dafoe({
  weight: "400",
  variable: "--font-mrdafoe",
  subsets: ["latin"],
});

// Gothic blackletter — small stamps & labels
const unifraktur = UnifrakturCook({
  weight: "700",
  variable: "--font-unifraktur",
  subsets: ["latin"],
});

// Condensed street label font
const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fast Guns 26 — Street Chat",
  description:
    "Sleek dark-mode street chat dripping in Chicano script. Fast Guns 26 — pull up, claim yo tag, and speak on it.",
  keywords: ["chat", "street", "chicano", "dark mode", "fast guns"],
};

export const viewport: Viewport = {
  themeColor: "#070707",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${pirata.variable} ${mrDafoe.variable} ${unifraktur.variable} ${oswald.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
