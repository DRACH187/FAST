"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Loader2, Lock } from "lucide-react";

/**
 * Front door (Layer 3 slice). Constant-time verified access code.
 * Wrong entries shake; the field auto-submits on the third digit.
 */
export function GateScreen({ onUnlock }: { onUnlock: (passcode: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  const submit = useCallback(
    async (code: string) => {
      if (inflight.current) return;
      inflight.current = true;
      setBusy(true);
      try {
        await onUnlock(code);
      } catch (err) {
        setError(true);
        setValue("");
        window.setTimeout(() => setError(false), 500);
        toast.error(err instanceof Error ? err.message : "Access denied");
      } finally {
        setBusy(false);
        inflight.current = false;
      }
    },
    [onUnlock]
  );

  const handleChange = useCallback(
    (v: string) => {
      const digits = v.replace(/\D/g, "").slice(0, 3);
      setValue(digits);
      if (digits.length === 3) void submit(digits);
    },
    [submit]
  );

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 animate-fast-fade-in">
      <div className="flex flex-col items-center gap-8 w-full max-w-xs">
        <Image
          src="/fast-logo.png"
          alt="FAST logo"
          width={256}
          height={256}
          priority
          draggable={false}
          className="w-20 h-auto mix-blend-screen opacity-90"
        />

        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex items-center gap-2 text-neutral-500">
            <Lock className="size-3.5" aria-hidden />
            <span className="text-[11px] font-mono uppercase tracking-[0.3em]">Restricted</span>
          </div>
          <h1 className="text-sm font-medium text-neutral-200">Enter access code</h1>
        </div>

        <div className={error ? "animate-fast-shake" : ""}>
          <InputOTP
            autoFocus
            maxLength={3}
            value={value}
            onChange={handleChange}
            disabled={busy}
            aria-label="3-digit access code"
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} className="size-14 text-xl font-mono rounded-xl border-neutral-800 bg-neutral-950" />
              <InputOTPSeparator />
              <InputOTPSlot index={1} className="size-14 text-xl font-mono rounded-xl border-neutral-800 bg-neutral-950" />
              <InputOTPSeparator />
              <InputOTPSlot index={2} className="size-14 text-xl font-mono rounded-xl border-neutral-800 bg-neutral-950" />
            </InputOTPGroup>
          </InputOTP>
        </div>

        <div className="h-5 flex items-center text-[11px] text-neutral-600 font-mono tracking-wider" aria-live="polite">
          {busy ? (
            <span className="flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              VERIFYING
            </span>
          ) : (
            <span>3 DIGITS</span>
          )}
        </div>
      </div>
    </main>
  );
}
