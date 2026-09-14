"use client";

/**
 * FAST — bespoke UI primitives.
 * Hand-built replacements for the stock component-library parts: modal,
 * popover menu, button, input. Everything is monochrome, keyboard-accessible
 * and animated with GSAP. No default element styling survives.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Copy, Timer } from "lucide-react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { REDUCED_MOTION, pressFeedback } from "@/components/fast/motion";

gsap.registerPlugin(useGSAP);

// ------------------------------------------------------------------ button

type FastButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "solid" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
};

export function FastButton({
  variant = "solid",
  size = "md",
  className = "",
  onClick,
  ...rest
}: FastButtonProps) {
  const base =
    "inline-flex select-none items-center justify-center gap-2 rounded-xl font-bold tracking-wide transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:pointer-events-none disabled:opacity-40";
  const sizes = {
    sm: "min-h-[40px] px-3.5 text-xs",
    md: "min-h-[48px] px-5 text-sm",
    lg: "min-h-[52px] px-6 text-base",
    icon: "size-11",
  };
  const variants = {
    solid: "bg-white text-black hover:bg-neutral-200 active:scale-[0.98]",
    outline:
      "border border-neutral-800 bg-neutral-950 text-neutral-100 hover:border-neutral-600 hover:bg-neutral-900 active:scale-[0.98]",
    ghost: "text-neutral-400 hover:bg-neutral-900 hover:text-white",
    danger:
      "border border-neutral-800 bg-transparent text-neutral-200 hover:border-neutral-400 hover:bg-neutral-950 active:scale-[0.98]",
  };

  return (
    <button
      {...rest}
      onClick={(e) => {
        if (!REDUCED_MOTION && e.currentTarget instanceof HTMLElement) {
          pressFeedback(e.currentTarget);
        }
        onClick?.(e);
      }}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    />
  );
}

// ------------------------------------------------------------------- input

export function FastInput({
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    /* The wrapper keeps rounded corners + focus ring shape in one place. */
    <div className="rounded-xl">
      <input
        {...rest}
        className={`h-13 w-full rounded-xl border border-neutral-800 bg-black px-4 text-[15px] font-semibold text-neutral-100 outline-none transition-colors placeholder:font-medium placeholder:text-neutral-600 focus:border-neutral-400 disabled:opacity-50 ${className}`}
      />
    </div>
  );
}

// ------------------------------------------------------------------- modal

type FastModalProps = {
  open: boolean;
  onClose: () => void;
  label: string;
  /** Wide two-column-ready panel (case builders, big forms). */
  wide?: boolean;
  children: ReactNode;
};

/**
 * Bespoke modal: GSAP enter/exit, bottom-sheet on phones, centered dialog
 * on larger screens, scroll lock, Escape + backdrop dismissal.
 */
export function FastModal({ open, onClose, label, wide = false, children }: FastModalProps) {
  const [mounted, setMounted] = useState(false);
  const [shownOpen, setShownOpen] = useState(open);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // open transitions mount the portal synchronously during render (the
  // React-sanctioned derive-during-render pattern — no cascading effect)
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) setMounted(true);
  }

  // GSAP entrance
  useGSAP(
    () => {
      if (!open || !mounted) return;
      gsap.killTweensOf([overlayRef.current, panelRef.current]);
      gsap.fromTo(
        overlayRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.2, ease: "power2.out" }
      );
      gsap.fromTo(
        panelRef.current,
        { y: 18, opacity: 0, scale: 0.97 },
        { y: 0, opacity: 1, scale: 1, duration: 0.34, ease: "power3.out" }
      );
    },
    { dependencies: [open, mounted] }
  );

  // GSAP exit — unmount happens in the tween callback (async, lint-safe)
  useEffect(() => {
    if (open || !mounted) return;
    const overlay = overlayRef.current;
    const panel = panelRef.current;
    if (!overlay || !panel) {
      const t = window.setTimeout(() => setMounted(false), 0);
      return () => window.clearTimeout(t);
    }
    gsap.to(panel, { y: 12, opacity: 0, scale: 0.98, duration: 0.16, ease: "power2.in" });
    gsap.to(overlay, {
      opacity: 0,
      duration: 0.18,
      ease: "power2.in",
      onComplete: () => setMounted(false),
    });
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-[150] flex items-end justify-center p-3 sm:items-center sm:p-4"
    >
      <div
        ref={overlayRef}
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        className={`relative max-h-[min(88dvh,100%)] w-full overflow-y-auto overscroll-contain rounded-3xl border border-neutral-800 bg-neutral-950 shadow-[0_24px_80px_rgba(0,0,0,0.8)] will-change-transform ${
          wide
            ? "max-w-xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-2xl sm:p-7"
            : "max-w-xs p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:max-w-sm"
        }`}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

// ----------------------------------------------------------------- popover

type FastPopoverProps = {
  label: string;
  align?: "start" | "end";
  button: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
};

/** Bespoke anchored menu with outside-click + Escape dismissal. */
export function FastPopover({ label, align = "end", button, children }: FastPopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useGSAP(
    () => {
      if (open && panelRef.current && !REDUCED_MOTION) {
        gsap.fromTo(
          panelRef.current,
          { opacity: 0, y: -6, scale: 0.97 },
          { opacity: 1, y: 0, scale: 1, duration: 0.22, ease: "power3.out" }
        );
      }
    },
    { dependencies: [open] }
  );

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {button({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={label}
          className={`absolute top-[calc(100%+6px)] z-40 w-52 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.75)] ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function FastMenuItem({
  icon: Icon,
  label,
  onSelect,
}: {
  icon: typeof Copy;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-medium text-neutral-200 outline-none transition-colors hover:bg-neutral-900 focus-visible:bg-neutral-900"
    >
      <Icon className="size-4 text-neutral-500" aria-hidden />
      {label}
    </button>
  );
}

// -------------------------------------------------------- wipe countdown

/** Under 20 minutes the wipe is imminent — chips switch to "SOON" + pulse. */
const SOON_MS = 20 * 60 * 1000;

/**
 * Compact time-until-wipe formatter shared by the hub rows and the chat
 * header. Returns "" placeholders:
 *   "—" when the deadline is unknown, "NOW" when already past,
 *   "SOON" under 20 minutes, otherwise "4H 12M" / "42M".
 */
export function formatTimeLeft(expiresAt: string | null, now: number): string {
  if (!expiresAt) return "—";
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return "—";
  const left = at - now;
  if (left <= 0) return "NOW";
  if (left < SOON_MS) return "SOON";
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  return h > 0 ? `${h}H ${String(m).padStart(2, "0")}M` : `${m}M`;
}

/**
 * Monochrome hard-wipe countdown chip. `now` comes from the owner screen's
 * single 30s tick — chips never run their own intervals.
 * `compact` renders an icon + "4H 12M" (chat header); full renders
 * "WIPES IN 4H 12M" (hub rows). Pulses gently when the wipe is imminent.
 */
export function WipeChip({
  expiresAt,
  now,
  compact = false,
  className = "",
}: {
  expiresAt: string | null;
  now: number;
  compact?: boolean;
  className?: string;
}) {
  const t = formatTimeLeft(expiresAt, now);
  const unknown = t === "—";
  const imminent = t === "SOON" || t === "NOW";
  return (
    <span
      title={
        unknown
          ? "Wipe deadline unknown — this chat still self-destructs"
          : "This chat wipes itself 5 hours after it was created"
      }
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] tabular-nums outline-none ${
        unknown
          ? "border-neutral-900 text-neutral-600"
          : imminent
            ? "animate-fast-pulse border-neutral-600 text-neutral-200"
            : "border-neutral-800 text-neutral-500"
      } ${className}`}
    >
      {compact ? (
        <Timer className="size-3" aria-hidden />
      ) : unknown ? null : imminent ? (
        "WIPES"
      ) : (
        "WIPES IN"
      )}
      {t}
    </span>
  );
}
