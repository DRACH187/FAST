"use client";

import { useState } from "react";
import { ArrowRight, Dices, Skull } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const STREET_NAMES = [
  "El Ghost",
  "Sad Girl",
  "Smiley",
  "Crafty",
  "Wicked",
  "Blu",
  "Sleepy",
  "Payasa",
  "Chino",
  "Dreamer",
  "Snake",
  "La Muerte",
  "Tiny",
  "Creeper",
  "Giggles",
  "Shady",
  "Hazard",
  "Blaze",
  "Reaper",
  "Vato Loco",
];

export function TagEntry({ onEnter }: { onEnter: (tag: string) => void }) {
  const [tag, setTag] = useState("");

  const submit = () => {
    const t = tag.trim().slice(0, 20);
    if (t) onEnter(t);
  };

  const rollName = () => {
    setTag(STREET_NAMES[Math.floor(Math.random() * STREET_NAMES.length)]);
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#070707] px-4 py-10">
      {/* spray paint decor */}
      <img
        src="/textures/spray-splatter.png"
        alt=""
        aria-hidden="true"
        className="splatter absolute -right-28 -top-28 w-96 rotate-12 opacity-25"
      />
      <img
        src="/textures/spray-splatter.png"
        alt=""
        aria-hidden="true"
        className="splatter absolute -bottom-32 -left-32 w-[30rem] -rotate-6 opacity-20"
      />
      {/* blood slivers in the corners */}
      <span aria-hidden="true" className="absolute left-0 top-0 h-10 w-[3px] bg-blood" />
      <span aria-hidden="true" className="absolute left-0 top-0 h-[3px] w-10 bg-blood" />
      <span aria-hidden="true" className="absolute bottom-0 right-0 h-10 w-[3px] bg-blood" />
      <span aria-hidden="true" className="absolute bottom-0 right-0 h-[3px] w-10 bg-blood" />

      <section className="relative z-10 w-full max-w-md border border-[#242424] bg-[#0c0c0c]/95 p-8 shadow-[0_0_90px_rgba(0,0,0,0.95)] sm:p-10">
        <Skull className="mb-5 h-9 w-9 text-neutral-500" strokeWidth={1.5} />

        <h1 className="font-script text-[3.4rem] leading-[0.95] text-white drop-shadow-[0_2px_14px_rgba(255,255,255,0.12)]">
          Claim Yo Tag
        </h1>
        <div className="mt-3 h-[2px] w-24 bg-blood" />
        <p className="mt-3 font-street text-[11px] uppercase tracking-[0.35em] text-neutral-500">
          every rider needs a name
        </p>

        <div className="mt-9 flex gap-2">
          <Input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="e.g. El Ghost"
            maxLength={20}
            autoFocus
            aria-label="Your street tag"
            className="h-12 border-[#2a2a2a] bg-[#111111] font-street text-base tracking-wide text-neutral-100 placeholder:text-neutral-600 focus-visible:ring-blood/60"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={rollName}
            title="Roll a name"
            aria-label="Roll a random street name"
            className="h-12 w-12 shrink-0 border-[#2a2a2a] text-neutral-400 hover:border-blood hover:bg-transparent hover:text-blood"
          >
            <Dices className="h-5 w-5" />
          </Button>
        </div>

        <Button
          onClick={submit}
          disabled={!tag.trim()}
          className="mt-4 h-12 w-full bg-neutral-100 font-street text-sm font-semibold uppercase tracking-[0.3em] text-black transition-colors hover:bg-blood hover:text-white"
        >
          Rep It
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>

        <p className="mt-8 text-center font-gothic text-sm tracking-wide text-neutral-600">
          fast guns 26 · est. forever
        </p>
      </section>
    </main>
  );
}
