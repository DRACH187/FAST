"use client";

/**
 * FAST — POESE: THE WALL OF HATE.
 * ===============================
 * The house's enemies wall. Every enemy gets a dossier card: status chip,
 * threat grade, a HAAT-METER that pins the hate to a number, the lead roast,
 * a SMEER button that fires a fresh roast on the spot, and the full dossier
 * (scrollable, per house law on long lists).
 *
 * The house brand rides the wall: FAST GUNS logo, ROOI-WIT-BLOU, 187, and a
 * rotating hype line straight out of the brand hype block.
 *
 * HOUSE LAW (copy.ts): the targets are FICTIONAL — invented crews and one
 * parody police force (die KOPPE). No real institution and no real crew is
 * ever named. The fiction stamp is printed on the wall itself.
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  Flame,
  FolderMinus,
  FolderOpen,
  Skull,
} from "lucide-react";
import { ScreenShell } from "@/components/fast/motion";
import { toast } from "@/components/fast/toast";
import {
  FAST_HYPE,
  pick,
  pickDiff,
  POESE_BRAND_SUB,
  POESE_BRAND_TITLE,
  POESE_DOSSIER_CLOSE,
  POESE_DOSSIER_CTA,
  POESE_DOSSIER_HEAD,
  POESE_ENEMIES,
  POESE_FICTION_STAMP,
  POESE_FOOTER_LAW,
  POESE_METER,
  POESE_SMEER,
  POESE_SUB,
  POESE_TICKER,
  POESE_TITLE,
  type PoeseEnemy,
} from "@/lib/fast/copy";

const TICKER_MS = 7000;
const HYPE_MS = 9000;

// --------------------------------------------------------------- component

export function PoeseScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(open);
  const [shownOpen, setShownOpen] = useState(open);
  const [sub] = useState(() => pick(POESE_SUB));
  const [ticker, setTicker] = useState(() => pick(POESE_TICKER));
  const [hype, setHype] = useState(() => pick(FAST_HYPE));
  const [openDossier, setOpenDossier] = useState<string | null>(null);

  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) {
      setMounted(true);
      setOpenDossier(null);
    }
  }

  // the wall talks: ticker + brand hype rotate on their own clocks
  useEffect(() => {
    if (!open || !mounted) return;
    const t1 = window.setInterval(
      () => setTicker((prev) => pickDiff(POESE_TICKER, prev)),
      TICKER_MS
    );
    const t2 = window.setInterval(
      () => setHype((prev) => pickDiff(FAST_HYPE, prev)),
      HYPE_MS
    );
    return () => {
      window.clearInterval(t1);
      window.clearInterval(t2);
    };
  }, [open, mounted]);

  useEffect(() => {
    if (!open || !mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, mounted, onClose]);

  if (!open || !mounted) return null;

  const smeer = (enemy: PoeseEnemy) => {
    // the roast IS the toast — a fresh line every press
    toast.success(pick(enemy.roasts));
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-black lg:absolute lg:inset-0 lg:z-auto"
      role="region"
      aria-label="Poese wall of hate"
    >
      <ScreenShell as="div" className="flex h-dvh flex-col lg:h-full">
        {/* ---------------------------------------------------------- header */}
        <header className="sticky top-0 z-20 shrink-0 border-b border-neutral-900 bg-black/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="flex h-14 items-center gap-2.5 px-3 sm:px-4">
            <button
              onClick={onClose}
              aria-label="Close the Poese wall"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-neutral-400 outline-none transition-colors hover:bg-neutral-900 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
            >
              <ArrowLeft className="size-5" aria-hidden />
            </button>
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950"
            >
              <Skull className="size-4 text-neutral-200" />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="gang-font text-2xl leading-none text-white">{POESE_TITLE}</span>
              <span className="truncate font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-neutral-500">
                {sub}
              </span>
            </div>
          </div>
        </header>

        {/* ------------------------------------------------------ the wall */}
        <section
          aria-label="Enemy dossiers"
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--fast-dock-clear)+1.5rem)] pt-4 lg:pb-10"
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {/* fiction stamp — the law printed on the wall itself */}
            <p className="inline-flex w-fit items-center gap-1.5 rounded-full border border-dashed border-neutral-700 px-3 py-1.5 font-mono text-[8px] font-black uppercase tracking-[0.24em] text-neutral-400">
              <Skull className="size-3 shrink-0" aria-hidden />
              {POESE_FICTION_STAMP}
            </p>

            {/* ticker — the wall never shuts up */}
            <div className="flex items-center gap-3 rounded-2xl border border-neutral-900 bg-black px-4 py-3.5">
              <Flame className="size-4 shrink-0 text-neutral-300" aria-hidden />
              {/* key retriggers the house fade on every fresh line */}
              <p
                key={ticker}
                className="fast-fade font-mono text-[10px] font-bold uppercase leading-relaxed tracking-[0.18em] text-neutral-300"
              >
                {ticker}
              </p>
            </div>

            {/* the dossiers */}
            {POESE_ENEMIES.map((enemy) => (
              <DossierCard
                key={enemy.id}
                enemy={enemy}
                dossierOpen={openDossier === enemy.id}
                onToggle={() =>
                  setOpenDossier((cur) => (cur === enemy.id ? null : enemy.id))
                }
                onSmeer={() => smeer(enemy)}
              />
            ))}

            {/* the house rides the wall — brand card */}
            <article className="rounded-2xl border border-neutral-800 bg-black p-4">
              <div className="flex items-center gap-3">
                <Image
                  src="/fast-logo.png"
                  alt="FAST GUNS"
                  width={256}
                  height={256}
                  draggable={false}
                  className="size-12 shrink-0 mix-blend-screen"
                />
                <div className="min-w-0">
                  <p className="gang-font text-2xl leading-none text-white [text-shadow:0_0_26px_rgba(255,255,255,0.25)]">
                    {POESE_BRAND_TITLE}
                  </p>
                  <p className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-neutral-500">
                    {POESE_BRAND_SUB}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-[13px] font-semibold leading-relaxed text-neutral-300">
                &ldquo;{hype}&rdquo;
              </p>
            </article>

            {/* footer law */}
            <p className="pt-1 text-center font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-neutral-700">
              {POESE_FOOTER_LAW}
            </p>
          </div>
        </section>
      </ScreenShell>
    </div>
  );
}

// ------------------------------------------------------------ dossier card

function DossierCard({
  enemy,
  dossierOpen,
  onToggle,
  onSmeer,
}: {
  enemy: PoeseEnemy;
  dossierOpen: boolean;
  onToggle: () => void;
  onSmeer: () => void;
}) {
  const [smeerLabel] = useState(() => pick(POESE_SMEER));

  return (
    <article className="rounded-2xl border border-neutral-900 bg-neutral-950 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="gang-font text-2xl leading-none text-white">{enemy.name}</h3>
          <p className="mt-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-neutral-500">
            {enemy.threat}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-neutral-700 bg-black px-2.5 py-1 font-mono text-[8px] font-black uppercase tracking-[0.16em] text-neutral-300">
          {enemy.chip}
        </span>
      </div>

      {/* hate meter — the number does the talking */}
      <div className="mt-3.5">
        <div className="flex items-center justify-between font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-neutral-500">
          <span>{POESE_METER}</span>
          <span className="tabular-nums text-neutral-200">{enemy.meter}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={enemy.meter}
          aria-label={`${POESE_METER}: ${enemy.name}`}
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-900"
        >
          <div className="h-full rounded-full bg-white" style={{ width: `${enemy.meter}%` }} />
        </div>
      </div>

      {/* the lead roast */}
      <p className="mt-3 text-[13px] font-semibold leading-relaxed text-neutral-300">
        &ldquo;{enemy.roasts[0]}&rdquo;
      </p>

      {/* actions */}
      <div className="mt-3.5 flex flex-wrap gap-2">
        <button
          onClick={onSmeer}
          className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-neutral-800 bg-black px-3.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-200 outline-none transition-colors hover:border-neutral-400 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
        >
          <Flame className="size-3.5 shrink-0" aria-hidden />
          {smeerLabel}
        </button>
        <button
          onClick={onToggle}
          aria-expanded={dossierOpen}
          className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-neutral-900 px-3.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-400 outline-none transition-colors hover:border-neutral-600 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
        >
          {dossierOpen ? (
            <FolderMinus className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <FolderOpen className="size-3.5 shrink-0" aria-hidden />
          )}
          {dossierOpen ? POESE_DOSSIER_CLOSE : POESE_DOSSIER_CTA}
        </button>
      </div>

      {/* full dossier — max height + scroll per the long-list law */}
      {dossierOpen && (
        <div className="mt-3.5 rounded-xl border border-neutral-900 bg-black p-3.5">
          <p className="font-mono text-[8px] font-bold uppercase tracking-[0.24em] text-neutral-600">
            {POESE_DOSSIER_HEAD}
          </p>
          <ul className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto pr-1 no-scrollbar">
            {enemy.roasts.map((roast, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-[12px] font-semibold leading-relaxed text-neutral-400"
              >
                <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-neutral-600" />
                {roast}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
