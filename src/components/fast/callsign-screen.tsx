"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "@/components/fast/toast";
import { ScreenShell, shakeElement } from "@/components/fast/motion";
import { FastButton, FastInput } from "@/components/fast/primitives";
import {
  NICKNAME_RULE,
  isReserved,
  registerCallsign,
  validateNickname,
  type CallsignIdentity,
} from "@/lib/fast/identity";

gsap.registerPlugin(useGSAP);

/**
 * Callsign login — every operative picks a nickname after the gate.
 * The DRACH callsign is reserved: selecting it reveals the BOSS KEY field,
 * verified server-side in constant time. Without the key, DRACH is refused.
 */
export function CallsignScreen({
  fingerprint,
  onReady,
}: {
  fingerprint: string;
  onReady: (identity: CallsignIdentity, nickPass: string) => void;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const [nickname, setNickname] = useState("");
  const [bossKey, setBossKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [drachAttempt, setDrachAttempt] = useState(false);

  // live-preview the callsign with its final typography (DRACH gets the
  // blackletter boss treatment the moment the name matches)
  const isDrach = isReserved(nickname);
  useEffect(() => setDrachAttempt(isDrach), [isDrach]);

  useGSAP(
    () => {
      if (!shell.current) return;
      const rows = shell.current.querySelectorAll("[data-step]");
      gsap.fromTo(
        rows,
        { opacity: 0, y: 18 },
        { opacity: 1, y: 0, duration: 0.55, stagger: 0.09, ease: "power3.out" }
      );
    },
    { scope: shell }
  );

  const submit = useCallback(async () => {
    if (busy) return;
    const nick = validateNickname(nickname);
    if (!nick) {
      toast.error(`Invalid callsign — ${NICKNAME_RULE}`);
      if (shell.current) shakeElement(shell.current.querySelector("[data-nickwrap]") as HTMLElement);
      return;
    }
    setBusy(true);
    try {
      const res = await registerCallsign(fingerprint, nick, isReserved(nick) ? { bossKey } : {});
      if (!res.ok) {
        toast.error(res.error);
        if (shell.current) shakeElement(shell.current.querySelector("[data-nickwrap]") as HTMLElement);
        if (isReserved(nick)) setBossKey("");
        return;
      }
      onReady(res.identity, res.nickPass ?? "");
    } catch {
      toast.error("Network unreachable — try again");
    } finally {
      setBusy(false);
    }
  }, [bossKey, busy, fingerprint, nickname, onReady]);

  return (
    <ScreenShell as="main" className="fast-grain flex min-h-dvh flex-col items-center justify-center px-6">
      <div ref={shell} className="flex w-full max-w-sm flex-col gap-8">
        {/* brand block — the logo stays big and visible */}
        <div data-step className="flex flex-col items-center gap-4 text-center">
          <Image
            src="/fast-logo.png"
            alt="FAST"
            width={256}
            height={256}
            priority
            draggable={false}
            className="h-auto w-16 mix-blend-screen"
          />
          <div className="flex flex-col gap-1.5">
            <h1 className="font-mono text-[11px] uppercase tracking-[0.42em] text-neutral-400">
              Choose your callsign
            </h1>
            <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-neutral-600">
              {NICKNAME_RULE}
            </p>
          </div>
        </div>

        {/* live preview of the callsign */}
        <div data-step aria-hidden className="flex h-14 items-center justify-center">
          <span
            className={
              isDrach
                ? "drach-font text-3xl text-white"
                : "font-mono text-xl font-bold tracking-[0.3em] text-neutral-300 uppercase"
            }
          >
            {nickname.trim() ? nickname.trim().toUpperCase() : "…"}
          </span>
        </div>

        <div data-step data-nickwrap className="flex flex-col gap-3">
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-neutral-600" aria-hidden />
            <FastInput
              value={nickname}
              onChange={(e) => setNickname(e.target.value.slice(0, 16))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="CALLSIGN"
              aria-label="Your callsign"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={16}
              className="pl-10 font-mono tracking-[0.2em] uppercase"
            />
          </div>

          {drachAttempt && (
            <div className="flex flex-col gap-2 rounded-xl border border-neutral-700 bg-neutral-950 p-3.5">
              <div className="flex items-center gap-2">
                <KeyRound className="size-3.5 text-neutral-300" aria-hidden />
                <span className="font-mono text-[9px] uppercase tracking-[0.28em] text-neutral-300">
                  Boss key required
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-neutral-500">
                “DRACH” is a protected callsign. Without the boss key it will
                be refused — by everyone, forever.
              </p>
              <FastInput
                type="password"
                value={bossKey}
                onChange={(e) => setBossKey(e.target.value.slice(0, 64))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
                placeholder="BOSS KEY"
                aria-label="Boss key"
                autoComplete="off"
                className="font-mono tracking-[0.2em]"
              />
            </div>
          )}

          <FastButton
            size="lg"
            disabled={busy || nickname.trim().length < 2}
            onClick={() => void submit()}
            className="w-full font-mono text-[11px] uppercase tracking-[0.28em]"
          >
            {busy ? "Registering" : "Enter FAST GUNS"}
          </FastButton>
        </div>

        <div data-step className="flex items-center justify-center gap-2 text-center">
          <ShieldCheck className="size-3.5 text-neutral-700" aria-hidden />
          <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-neutral-700">
            Callsigns are public · keys never leave this device
          </span>
        </div>
      </div>
    </ScreenShell>
  );
}
