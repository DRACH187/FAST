"use client";

/**
 * Profile — callsign ownership.
 * The callsign is SAVED PERMANENTLY on this device the moment it is claimed.
 * From here an operative can switch to a new name or delete the saved one —
 * both wipe the local record for good and drop back to the callsign login.
 */

import { useState } from "react";
import { Crown, Fingerprint, Save, Trash2, UserRoundCog, X } from "lucide-react";
import { toast } from "@/components/fast/toast";
import { FastButton, FastModal } from "@/components/fast/primitives";
import { pressFeedback } from "@/components/fast/motion";
import type { CallsignIdentity } from "@/lib/fast/identity";

type ProfileProps = {
  open: boolean;
  onClose: () => void;
  callsign: CallsignIdentity | null;
  identityFp: string;
  /** Clears the saved callsign permanently and returns to the login. */
  onSwitch: () => void;
};

export function ProfileSheet({ open, onClose, callsign, identityFp, onSwitch }: ProfileProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const boss = callsign?.role === "boss";

  const wipe = () => {
    setConfirmOpen(false);
    onClose();
    onSwitch();
    toast.success("Nickname deleted permanently — claim a new one.");
  };

  return (
    <>
      <FastModal open={open} onClose={onClose} label="Profile">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-neutral-400">
              <UserRoundCog className="size-4" aria-hidden />
              Profile
            </h2>
            <button
              onClick={onClose}
              aria-label="Close profile"
              className="flex size-8 items-center justify-center rounded-full border border-neutral-800 text-neutral-500 outline-none transition-colors hover:border-neutral-500 hover:text-white"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {/* current callsign */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-800 bg-black px-4 py-4">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-mono text-[8px] uppercase tracking-[0.28em] text-neutral-600">
                current callsign
              </span>
              <span
                className={`truncate text-xl font-bold text-white ${
                  boss ? "drach-font text-2xl" : "tracking-wide"
                }`}
              >
                {callsign?.nickname ?? "UNCLAIMED"}
              </span>
            </div>
            {boss && (
              <span className="flex shrink-0 items-center gap-1 rounded-full border border-neutral-600 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.22em] text-neutral-200">
                <Crown className="size-3" aria-hidden />
                boss
              </span>
            )}
          </div>

          {/* permanence status */}
          <div className="flex items-start gap-3 rounded-2xl border border-neutral-900 px-4 py-3.5">
            <Save className="mt-0.5 size-4 shrink-0 text-neutral-500" aria-hidden />
            <p className="text-[11px] leading-relaxed text-neutral-400">
              <span className="font-semibold text-neutral-200">Saved permanently.</span>{" "}
              This device keeps your nickname through reloads and restarts until
              you delete or replace it here.
            </p>
          </div>

          {/* actions */}
          <div className="grid grid-cols-1 gap-2">
            <FastButton
              variant="ghost"
              onClick={() => setConfirmOpen(true)}
              className="min-h-[48px] w-full"
            >
              <Trash2 className="size-4" aria-hidden />
              Delete nickname permanently
            </FastButton>
          </div>

          {/* device identity */}
          <div className="flex flex-col gap-1.5 rounded-2xl border border-dashed border-neutral-900 px-4 py-3">
            <p className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.24em] text-neutral-600">
              <Fingerprint className="size-3" aria-hidden />
              device identity
            </p>
            <p className="font-mono text-[9px] leading-relaxed text-neutral-500">
              {identityFp.slice(0, 8)}·{identityFp.slice(8, 16)} — session keys live in RAM
              only and die with this tab.
            </p>
          </div>
        </div>
      </FastModal>

      {/* delete confirm */}
      <FastModal open={confirmOpen} onClose={() => setConfirmOpen(false)} label="Confirm deletion">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="flex size-11 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950">
              <Trash2 className="size-5 text-neutral-300" aria-hidden />
            </span>
            <h2 className="text-sm font-bold text-white">Delete nickname permanently?</h2>
            <p className="max-w-[260px] text-[11px] leading-relaxed text-neutral-500">
              <span className="font-semibold text-neutral-300">{callsign?.nickname}</span> is
              wiped from this device for good. You will need to claim a fresh callsign before
              entering the block.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FastButton variant="ghost" onClick={() => setConfirmOpen(false)} className="min-h-[46px]">
              Keep it
            </FastButton>
            <FastButton onClick={wipe} className="min-h-[46px]">
              Delete
            </FastButton>
          </div>
        </div>
      </FastModal>
    </>
  );
}
