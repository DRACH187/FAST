"use client";

/**
 * Profile — callsign ownership + the OFFLINE VAULT.
 * The callsign is SAVED PERMANENTLY on this device the moment it is claimed.
 * From here an operative can switch to a new name or delete the saved one —
 * both wipe the local record for good and drop back to the callsign login.
 * The vault section offers the one-tap native install (downloadable PWA,
 * offline support) and shows the all-time roll of members ever.
 */

import { useEffect, useState } from "react";
import { Crown, Download, Save, Trash2, Users, X } from "lucide-react";
import { toast } from "@/components/fast/toast";
import { FastButton, FastModal } from "@/components/fast/primitives";
import { cachedMemberTotal, fetchMemberTotal } from "@/lib/fast/member-ledger";
import { canInstall, isStandalone, onInstallAvailability, promptInstall } from "@/components/fast/offline-vault";
import { PROFILE_DELETE, PROFILE_DELETED, PROFILE_FOOTER, PROFILE_INSTALL, PROFILE_ROLL_LABEL, PROFILE_TITLE, pick } from "@/lib/fast/copy";
import type { CallsignIdentity } from "@/lib/fast/identity";

type ProfileProps = {
  open: boolean;
  onClose: () => void;
  callsign: CallsignIdentity | null;
  /** Clears the saved callsign permanently and returns to the login. */
  onSwitch: () => void;
};

export function ProfileSheet({ open, onClose, callsign, onSwitch }: ProfileProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [installable, setInstallable] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [memberTotal, setMemberTotal] = useState(cachedMemberTotal);
  const [deleteLabel] = useState(() => pick(PROFILE_DELETE));
  const [footerLine] = useState(() => pick(PROFILE_FOOTER));
  const boss = callsign?.role === "boss";

  useEffect(() => {
    const off = onInstallAvailability((available) => {
      setInstallable(available);
      if (!available) setInstalled(isStandalone());
    });
    // defer the initial probe so we never setState synchronously in the effect
    const probe = window.setTimeout(() => {
      setInstallable(canInstall());
      setInstalled(isStandalone());
    }, 0);
    let alive = true;
    void fetchMemberTotal().then((t) => {
      if (alive && typeof t === "number") setMemberTotal(t);
    });
    return () => {
      alive = false;
      off();
      window.clearTimeout(probe);
    };
  }, [open]);

  const download = async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      toast.success("FAST GUNS armed on this device — offline vault active.");
      setInstalled(true);
      setInstallable(false);
    } else if (outcome === "dismissed") {
      toast.error("Install dismissed — the block stays browser-bound.");
    } else {
      toast.error("Use your browser menu → “Add to Home Screen / Install app”.");
    }
  };

  const wipe = () => {
    setConfirmOpen(false);
    onClose();
    onSwitch();
    toast.success(PROFILE_DELETED);
  };

  return (
    <>
      <FastModal open={open} onClose={onClose} label="Profile">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="gang-font text-3xl text-white">{PROFILE_TITLE}</h2>
            <button
              onClick={onClose}
              aria-label="Close profile"
              className="flex size-9 items-center justify-center rounded-full border border-neutral-800 text-neutral-400 outline-none transition-colors hover:border-neutral-400 hover:text-white"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {/* current callsign */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-800 bg-black px-4 py-4">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-neutral-500">
                jou naam
              </span>
              <span
                className={`truncate text-2xl text-white ${
                  boss ? "drach-font text-3xl" : "gang-font text-3xl"
                }`}
              >
                {callsign?.nickname ?? "GEEN NAAM"}
              </span>
            </div>
            {boss && (
              <span className="flex shrink-0 items-center gap-1 rounded-full border border-neutral-500 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-100">
                <Crown className="size-3.5" aria-hidden />
                boss
              </span>
            )}
          </div>

          {/* permanence status */}
          <div className="flex items-start gap-3 rounded-2xl border border-neutral-900 px-4 py-3.5">
            <Save className="mt-0.5 size-4 shrink-0 text-neutral-400" aria-hidden />
            <p className="text-[13px] font-semibold leading-relaxed text-neutral-300">
              <span className="font-bold text-neutral-100">Permanent gebrand.</span> Hierdie toestel hou jou naam deur alles — tot jy hom hier vee of vervang.
            </p>
          </div>

          {/* actions */}
          <div className="grid grid-cols-1 gap-2">
            <FastButton
              variant="ghost"
              onClick={() => setConfirmOpen(true)}
              className="min-h-[50px] w-full font-mono text-xs uppercase tracking-[0.2em]"
            >
              <Trash2 className="size-4" aria-hidden />
              {deleteLabel}
            </FastButton>
          </div>

          {/* offline vault — downloadable PWA + data saving */}
          <div className="flex flex-col gap-2.5 rounded-2xl border border-neutral-900 px-4 py-4">
            <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-neutral-400">
              <Download className="size-3.5" aria-hidden />
              kluis
            </p>
            {installed ? (
              <p className="text-[13px] font-semibold leading-relaxed text-neutral-300">
                <span className="font-bold text-neutral-100">Geïnstalleer.</span> FAST GUNS loop van jou tuisskerm af en bly loop wanneer die netwerk vrek — die kluis bly op hierdie toestel alleen.
              </p>
            ) : (
              <>
                <p className="text-[13px] font-semibold leading-relaxed text-neutral-400">
                  Sit die blok op hierdie toestel: volle af-lyn krag, tuisskerm-lanseering, amper geen data ná eerste laai.
                </p>
                <FastButton onClick={download} className="min-h-[50px] w-full font-mono text-xs uppercase tracking-[0.2em]">
                  <Download className="size-4" aria-hidden />
                  {PROFILE_INSTALL}
                </FastButton>
              </>
            )}
          </div>

          {/* all-time roll */}
          <div className="flex items-center justify-between rounded-2xl border border-dashed border-neutral-800 px-4 py-3.5">
            <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-neutral-400">
              <Users className="size-3.5" aria-hidden />
              {PROFILE_ROLL_LABEL}
            </span>
            <span className="font-mono text-sm font-black tracking-[0.2em] text-neutral-100">
              {memberTotal > 0 ? `${memberTotal} OIT` : "—"}
            </span>
          </div>

          {/* house footer */}
          <p className="text-center font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-600">
            {footerLine}
          </p>
        </div>
      </FastModal>

      {/* delete confirm */}
      <FastModal open={confirmOpen} onClose={() => setConfirmOpen(false)} label="Confirm deletion">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950">
              <Trash2 className="size-5 text-neutral-300" aria-hidden />
            </span>
            <h2 className="text-base font-bold text-white">Vee die naam permanent uit?</h2>
            <p className="max-w-[280px] text-[13px] font-semibold leading-relaxed text-neutral-400">
              <span className="font-bold text-neutral-200">{callsign?.nickname}</span> word van hierdie toestel geskop vir goed. Jy moet ‘n nuwe naam claim voor jy die blok weer instap.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FastButton variant="ghost" onClick={() => setConfirmOpen(false)} className="min-h-[48px]">
              Hou hom
            </FastButton>
            <FastButton onClick={wipe} className="min-h-[48px]">
              Vee uit
            </FastButton>
          </div>
        </div>
      </FastModal>
    </>
  );
}
