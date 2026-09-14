"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  ArrowRight,
  ChevronRight,
  Copy,
  KeyRound,
  Map as MapIcon,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "@/components/fast/toast";
import { ScreenShell, staggerAnimChildren } from "@/components/fast/motion";
import { FastButton, FastInput, FastModal } from "@/components/fast/primitives";
import type { SessionView } from "@/lib/fast/session-manager";

gsap.registerPlugin(useGSAP);

const CODE_RE = /^[A-Z]{6}$/;

type HubProps = {
  identityFp: string;
  sessions: SessionView[];
  busy: boolean;
  onOpen: (code: string) => void;
  onStart: () => Promise<string>;
  onJoin: (code: string) => Promise<void>;
  onDelete: (code: string) => Promise<void>;
  onClose: (code: string) => void;
  onOpenMap: () => void;
};

export function HubScreen({
  identityFp,
  sessions,
  busy,
  onOpen,
  onStart,
  onJoin,
  onDelete,
  onClose,
  onOpenMap,
}: HubProps) {
  const shellRef = useRef<HTMLElement>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteCode, setDeleteCode] = useState("");
  const [leaveCode, setLeaveCode] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  // GSAP: staggered hub entrance
  useGSAP(
    () => staggerAnimChildren(shellRef.current),
    { scope: shellRef }
  );

  const handleStart = useCallback(async () => {
    try {
      const code = await onStart();
      setCreated(code);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start session");
    }
  }, [onStart]);

  const submitJoin = useCallback(
    async (code: string) => {
      if (!CODE_RE.test(code)) return;
      setJoinOpen(false);
      try {
        await onJoin(code);
        setJoinCode("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not join session");
      }
    },
    [onJoin]
  );

  const submitDelete = useCallback(async () => {
    const code = deleteCode.trim().toUpperCase();
    if (!CODE_RE.test(code)) return;
    try {
      await onDelete(code);
      setDeleteOpen(false);
      setDeleteCode("");
      toast.success(`Session ${code} terminated for all users`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete session");
    }
  }, [deleteCode, onDelete]);

  const copyCode = useCallback((code: string) => {
    void navigator.clipboard.writeText(code);
    toast.success("Code copied");
  }, []);

  return (
    <ScreenShell as="main" className="flex min-h-dvh flex-col">
      <div ref={shellRef} className="contents">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-5 pb-6 pt-12">
        {/* brand */}
        <header data-anim className="flex flex-col items-center gap-3">
          <Image
            src="/fast-logo.png"
            alt="FAST logo"
            width={1254}
            height={1254}
            priority
            draggable={false}
            className="h-auto w-28 mix-blend-screen sm:w-32"
          />
          <div className="flex items-center gap-1.5 text-neutral-500">
            <ShieldCheck className="size-3.5" aria-hidden />
            <span className="font-mono text-[10px] uppercase tracking-[0.3em]">
              End-to-end encrypted
            </span>
          </div>
        </header>

        {/* actions */}
        <section data-anim aria-label="Session actions" className="grid gap-3">
          <ActionCard
            icon={Plus}
            solid
            title="Start session"
            subtitle="Generate a fresh 6-letter code"
            onClick={handleStart}
            disabled={busy}
          />
          <ActionCard
            icon={KeyRound}
            title="Join session"
            subtitle="Enter a 6-letter code"
            onClick={() => setJoinOpen(true)}
            disabled={busy}
          />
          <ActionCard
            icon={MapIcon}
            title="Surroundings map"
            subtitle="South Africa · gang hotspot intel"
            onClick={onOpenMap}
          />
          <ActionCard
            icon={Trash2}
            ghost
            title="Delete session"
            subtitle="Erase it for every participant"
            onClick={() => setDeleteOpen(true)}
            disabled={busy}
          />
        </section>

        {/* open sessions */}
        <section data-anim aria-label="Open sessions" className="flex flex-col gap-3">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-600">
            Open sessions {sessions.length > 0 && `· ${sessions.length}`}
          </h2>

          {sessions.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-neutral-900 p-5 text-center text-xs text-neutral-600">
              No sessions open. You can hold several at once.
            </p>
          ) : (
            <ul className="grid gap-2.5">
              {sessions.map((s) => (
                <SessionRow
                  key={s.code}
                  session={s}
                  onOpen={() => onOpen(s.code)}
                  onClose={() => setLeaveCode(s.code)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* sticky footer */}
      <footer data-anim className="mx-auto mt-auto w-full max-w-md px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <div className="flex flex-col items-center gap-1 border-t border-neutral-900 pt-4 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-neutral-600">
            Keys live in this tab only
          </p>
          <p className="font-mono text-[10px] text-neutral-700">
            device {identityFp.slice(0, 4)}·{identityFp.slice(4, 8)}
          </p>
        </div>
      </footer>

      {/* created code */}
      <FastModal open={created !== null} onClose={() => setCreated(null)} label="Session created">
        <div className="flex flex-col items-center gap-5 text-center">
          <div>
            <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-neutral-400">
              Session created
            </h2>
            <p className="mt-2 text-xs text-neutral-500">
              Share the code — it works from anywhere.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 py-1">
            <span className="font-mono text-3xl font-bold tracking-[0.3em] text-white">
              {created}
            </span>
            <button
              aria-label="Copy session code"
              onClick={() => created && copyCode(created)}
              className="flex size-10 items-center justify-center rounded-full border border-neutral-700 text-neutral-300 outline-none transition-colors hover:border-neutral-500 hover:text-white"
            >
              <Copy className="size-4" aria-hidden />
            </button>
          </div>
          <FastButton
            className="w-full"
            onClick={() => {
              const code = created;
              setCreated(null);
              if (code) onOpen(code);
            }}
          >
            Enter session
          </FastButton>
        </div>
      </FastModal>

      {/* join */}
      <FastModal
        open={joinOpen}
        onClose={() => {
          setJoinOpen(false);
          setJoinCode("");
        }}
        label="Join session"
      >
        <div className="flex flex-col gap-4">
          <div className="text-center">
            <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-neutral-400">
              Join session
            </h2>
            <p className="mt-2 text-xs text-neutral-500">Enter the 6-letter code.</p>
          </div>
          <FastInput
            autoFocus
            value={joinCode}
            onChange={(e) => {
              const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
              setJoinCode(v);
              if (v.length === 6) void submitJoin(v);
            }}
            placeholder="ABCDEF"
            aria-label="6-letter session code"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={6}
            className="text-center font-mono text-xl font-bold tracking-[0.4em] uppercase"
          />
          <FastButton
            disabled={!CODE_RE.test(joinCode)}
            onClick={() => void submitJoin(joinCode)}
            className="w-full"
          >
            Join
          </FastButton>
        </div>
      </FastModal>

      {/* delete for everyone */}
      <FastModal
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setDeleteCode("");
        }}
        label="Terminate a session"
      >
        <div className="flex flex-col gap-4">
          <div className="text-center">
            <h2 className="flex items-center justify-center gap-2 text-sm font-medium text-neutral-100">
              <Trash2 className="size-4 text-neutral-300" aria-hidden />
              Terminate a session
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-neutral-500">
              This erases the code, its membership and the full ciphertext history —
              for <span className="text-neutral-300">every</span> participant, immediately
              and irreversibly.
            </p>
          </div>
          <FastInput
            value={deleteCode}
            onChange={(e) => setDeleteCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6))}
            placeholder="CODE"
            aria-label="Session code to delete"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={6}
            className="text-center font-mono text-lg font-bold tracking-[0.4em] uppercase"
          />
          <div className="flex flex-col gap-2">
            <FastButton
              disabled={!CODE_RE.test(deleteCode.trim())}
              onClick={() => void submitDelete()}
              className="w-full"
            >
              Delete for everyone
            </FastButton>
            <FastButton
              variant="ghost"
              className="w-full"
              onClick={() => {
                setDeleteOpen(false);
                setDeleteCode("");
              }}
            >
              Cancel
            </FastButton>
          </div>
        </div>
      </FastModal>

      {/* leave (local close) */}
      <FastModal
        open={leaveCode !== null}
        onClose={() => setLeaveCode(null)}
        label="Close session on this device"
      >
        <div className="flex flex-col gap-5">
          <div className="text-center">
            <h2 className="text-sm font-medium text-neutral-100">Close {leaveCode} here?</h2>
            <p className="mt-2 text-xs leading-relaxed text-neutral-500">
              Your device discards its key material for this session. Others keep chatting —
              to return you will need a member to hand you the key again.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <FastButton
              className="w-full"
              onClick={() => {
                if (leaveCode) onClose(leaveCode);
                setLeaveCode(null);
              }}
            >
              Close session here
            </FastButton>
            <FastButton variant="ghost" className="w-full" onClick={() => setLeaveCode(null)}>
              Stay
            </FastButton>
          </div>
        </div>
      </FastModal>
      </div>
    </ScreenShell>
  );
}

// ---------------------------------------------------------------- pieces

type ActionCardProps = {
  icon: typeof Plus;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
  solid?: boolean;
  ghost?: boolean;
};

function ActionCard({ icon: Icon, title, subtitle, onClick, disabled, solid, ghost }: ActionCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group flex min-h-[64px] w-full items-center gap-4 rounded-2xl border p-4 text-left outline-none transition-all duration-200 focus-visible:border-neutral-500 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 ${
        ghost
          ? "border-neutral-900 bg-transparent hover:border-neutral-700 hover:bg-neutral-950"
          : "border-neutral-800/80 bg-neutral-950 hover:border-neutral-600 hover:bg-neutral-900"
      }`}
    >
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105 ${
          solid ? "bg-white text-black" : ghost ? "border border-neutral-800 text-neutral-400" : "bg-neutral-800 text-neutral-100"
        }`}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="flex-1">
        <span className="block text-sm font-medium text-neutral-100">{title}</span>
        <span className="block text-xs text-neutral-500">{subtitle}</span>
      </span>
      <ChevronRight
        className="size-4 text-neutral-600 transition-transform duration-200 group-hover:translate-x-0.5"
        aria-hidden
      />
    </button>
  );
}

function SessionRow({
  session,
  onOpen,
  onClose,
}: {
  session: SessionView;
  onOpen: () => void;
  onClose: () => void;
}) {
  const rowRef = useRef<HTMLLIElement>(null);

  // GSAP: rows pop in as they appear (including restored sessions)
  useGSAP(
    () => {
      gsap.fromTo(
        rowRef.current,
        { opacity: 0, y: 12, scale: 0.98 },
        { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: "power3.out" }
      );
    },
    { scope: rowRef }
  );

  return (
    <li ref={rowRef} className="relative will-change-transform">
      <button
        onClick={onOpen}
        className="group flex min-h-[60px] w-full items-center gap-3 rounded-2xl border border-neutral-800/80 bg-neutral-950 px-4 py-3.5 text-left outline-none transition-colors duration-200 hover:border-neutral-600 hover:bg-neutral-900 focus-visible:border-neutral-500"
      >
        <span className="font-mono text-base font-semibold tracking-[0.22em] text-neutral-100">
          {session.code}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-neutral-500">
          <Users className="size-3" aria-hidden />
          {session.presence.length}
        </span>
        {!session.hasKey && (
          <span
            className="flex animate-fast-pulse items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-neutral-500"
            title="Waiting for a member to hand you the session key"
          >
            <KeyRound className="size-3" aria-hidden />
            key
          </span>
        )}
        <span className="flex-1" />
        {session.unread > 0 && (
          <span className="flex min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[10px] font-bold text-black">
            {session.unread > 99 ? "99+" : session.unread}
          </span>
        )}
        <ArrowRight
          className="size-4 text-neutral-600 transition-transform duration-200 group-hover:translate-x-0.5"
          aria-hidden
        />
      </button>
      <button
        onClick={onClose}
        aria-label={`Close session ${session.code} on this device`}
        className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full border border-neutral-700 bg-black text-neutral-500 outline-none transition-colors hover:border-neutral-500 hover:text-white"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}
