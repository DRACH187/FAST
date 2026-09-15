"use client";

/**
 * FAST — FBOEK (the house's recruiting ground).
 * ============================================
 * The POESE slot is DEAD — in its place stands the official FAST GUNS
 * Facebook group. One screen, one job: drive every ouen through the link
 * so the outside-werf grows. Strictly dark, zero clutter, house voice
 * throughout. The link opens in a NEW TAB — this werf never closes behind
 * you — and the button is an <a>, so middle-click / long-press "open in
 * new tab" all behave natively.
 */

import Image from "next/image";
import { useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ArrowLeft, ArrowUpRight, Facebook, ShieldCheck, Users } from "lucide-react";
import { toast } from "@/components/fast/toast";
import { REDUCED_MOTION, ScreenShell, pressFeedback } from "@/components/fast/motion";
import {
  FB_BACK,
  FB_CARD_TAG,
  FB_CARD_TITLE,
  FB_CTA,
  FB_LAW,
  FB_OPENING,
  FB_PITCH,
  FB_POINTS,
  FB_POINTS_HEAD,
  FB_SUB,
  FB_TITLE,
  FB_URL,
  pick,
} from "@/lib/fast/copy";

gsap.registerPlugin(useGSAP);

export function FacebookScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sub] = useState(() => pick(FB_SUB));
  const [cta] = useState(() => pick(FB_CTA));
  const [pitch] = useState(() => pick(FB_PITCH));

  useGSAP(
    () => {
      if (REDUCED_MOTION) return;
      gsap.fromTo(
        "[data-fb-anim]",
        { opacity: 0, y: 18 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "power3.out", overwrite: "auto" }
      );
    },
    { dependencies: [open] }
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[92] bg-black lg:absolute lg:inset-0 lg:z-auto"
      role="region"
      aria-label="FBOEK — die huis se Facebook groep"
    >
      <ScreenShell as="div" className="flex h-dvh flex-col lg:h-full">
        {/* ---------------------------------------------------------- header */}
        <header className="sticky top-0 z-20 border-b border-neutral-900 bg-black/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-2 px-3 sm:px-4">
            <button
              onClick={onClose}
              aria-label="Close FBOEK"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-neutral-400 outline-none transition-colors hover:bg-neutral-900 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
            >
              <ArrowLeft className="size-5" aria-hidden />
            </button>
            <Image
              src="/fast-logo.png"
              alt="FAST GUNS"
              width={256}
              height={256}
              priority
              draggable={false}
              className="h-8 w-8 shrink-0 mix-blend-screen"
            />
            <div className="flex min-w-0 flex-col">
              <span className="gang-font text-2xl leading-none text-white">{FB_TITLE}</span>
              <span className="truncate font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500">
                {sub}
              </span>
            </div>
          </div>
        </header>

        {/* ------------------------------------------------------------ body */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-[calc(var(--fast-dock-clear)+3rem)] pt-6 lg:pb-10">
            {/* the card — one loud, unmissable doorway into the group */}
            <section
              data-fb-anim
              className="fast-grain relative overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 p-6 sm:p-8"
            >
              {/* faint brand watermark — the mark owns the wall, quietly */}
              <Image
                src="/fast-logo.png"
                alt=""
                aria-hidden
                width={512}
                height={512}
                draggable={false}
                className="pointer-events-none absolute -right-16 -top-16 size-64 opacity-[0.05] mix-blend-screen"
              />
              <div className="relative flex flex-col items-center gap-4 text-center">
                <span className="flex size-16 items-center justify-center rounded-2xl border border-neutral-800 bg-black">
                  <Facebook className="size-8 text-white" aria-hidden />
                </span>
                <h2 className="gang-font text-3xl leading-tight text-white sm:text-4xl">
                  {FB_CARD_TITLE}
                </h2>
                <span className="fast-stamp" aria-hidden>
                  {FB_CARD_TAG}
                </span>
                <p className="max-w-md text-[15px] font-semibold leading-relaxed text-neutral-300">
                  {pitch}
                </p>

                {/* THE link — plain <a> so every browser behaviour just works */}
                <a
                  href={FB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    toast.info(FB_OPENING);
                  }}
                  className="group mt-2 flex min-h-[56px] w-full max-w-sm items-center justify-center gap-2.5 rounded-2xl bg-white px-6 text-black outline-none transition-transform duration-150 hover:scale-[1.015] active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-neutral-400 sm:w-auto"
                  aria-label={`${cta} — maak die FAST GUNS Facebook groep in 'n nuwe tab oop`}
                >
                  <Facebook className="size-5 shrink-0" aria-hidden />
                  <span className="font-mono text-sm font-black uppercase tracking-[0.14em]">
                    {cta}
                  </span>
                  <ArrowUpRight className="size-5 shrink-0 transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                </a>
                <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-neutral-600">
                  maak in 'n nuwe tab oop — hierdie werf bly onder jou
                </span>
              </div>
            </section>

            {/* why you join — the recruitment list */}
            <section data-fb-anim className="rounded-3xl border border-neutral-800 bg-neutral-950 p-5 sm:p-6">
              <div className="flex items-center gap-2.5">
                <Users className="size-4 text-neutral-400" aria-hidden />
                <h3 className="font-mono text-[11px] font-black uppercase tracking-[0.22em] text-neutral-300">
                  {FB_POINTS_HEAD}
                </h3>
              </div>
              <ul className="mt-4 flex flex-col gap-3">
                {FB_POINTS.map((point, i) => (
                  <li
                    key={point}
                    className="flex items-start gap-3 border-b border-neutral-900 pb-3 last:border-b-0 last:pb-0"
                  >
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-black font-mono text-[10px] font-black text-neutral-300">
                      {i + 1}
                    </span>
                    <span className="text-sm font-semibold leading-relaxed text-neutral-200">
                      {point}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {/* the law — what the group is and is not */}
            <section
              data-fb-anim
              className="flex flex-col gap-3 rounded-3xl border border-dashed border-neutral-800 bg-black p-5 sm:flex-row sm:items-center sm:p-6"
            >
              <ShieldCheck className="size-6 shrink-0 text-neutral-500" aria-hidden />
              <p className="text-[13px] font-semibold leading-relaxed text-neutral-400">
                {FB_LAW}
              </p>
            </section>

            {/* back — for the ouens who read to the bottom */}
            <div data-fb-anim className="flex justify-center pb-2">
              <button
                onClick={(e) => {
                  pressFeedback(e.currentTarget);
                  onClose();
                }}
                className="flex min-h-[46px] items-center gap-2 rounded-xl border border-neutral-800 px-5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-400 outline-none transition-colors hover:border-neutral-500 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-500"
              >
                <ArrowLeft className="size-4" aria-hidden />
                {FB_BACK}
              </button>
            </div>
          </div>
        </div>
      </ScreenShell>
    </div>
  );
}
