"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ArrowRight,
  ChevronRight,
  Copy,
  KeyRound,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { SessionView } from "@/lib/fast/session-manager";

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
}: HubProps) {
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteCode, setDeleteCode] = useState("");
  const [leaveCode, setLeaveCode] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

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
    <main className="min-h-dvh flex flex-col animate-fast-fade-in">
      <div className="flex-1 w-full max-w-md mx-auto px-5 pt-10 pb-6 flex flex-col gap-8">
        {/* brand */}
        <header className="flex flex-col items-center gap-3">
          <Image
            src="/fast-logo.png"
            alt="FAST logo"
            width={256}
            height={256}
            priority
            draggable={false}
            className="w-16 h-auto mix-blend-screen"
          />
          <div className="flex items-center gap-1.5 text-neutral-500">
            <ShieldCheck className="size-3.5" aria-hidden />
            <span className="text-[10px] font-mono uppercase tracking-[0.3em]">
              End-to-end encrypted
            </span>
          </div>
        </header>

        {/* actions */}
        <section aria-label="Session actions" className="grid gap-3">
          <button
            onClick={handleStart}
            disabled={busy}
            className="group flex items-center gap-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4 text-left transition-colors hover:border-neutral-600 hover:bg-neutral-900 disabled:opacity-50 min-h-[60px]"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-black transition-transform group-hover:scale-105">
              <Plus className="size-5" aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-medium text-neutral-100">Start session</span>
              <span className="block text-xs text-neutral-500">Generate a fresh 6-letter code</span>
            </span>
            <ChevronRight className="size-4 text-neutral-600 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>

          <button
            onClick={() => setJoinOpen(true)}
            disabled={busy}
            className="group flex items-center gap-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4 text-left transition-colors hover:border-neutral-600 hover:bg-neutral-900 disabled:opacity-50 min-h-[60px]"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-800 text-neutral-100 transition-transform group-hover:scale-105">
              <KeyRound className="size-5" aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-medium text-neutral-100">Join session</span>
              <span className="block text-xs text-neutral-500">Enter a 6-letter code</span>
            </span>
            <ChevronRight className="size-4 text-neutral-600 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>

          <button
            onClick={() => setDeleteOpen(true)}
            disabled={busy}
            className="group flex items-center gap-4 rounded-2xl border border-neutral-900 bg-transparent p-4 text-left transition-colors hover:border-neutral-700 hover:bg-neutral-950 disabled:opacity-50 min-h-[60px]"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-neutral-800 text-neutral-400 transition-transform group-hover:scale-105">
              <Trash2 className="size-4.5" aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-medium text-neutral-300">Delete session</span>
              <span className="block text-xs text-neutral-600">Erase it for every participant</span>
            </span>
            <ChevronRight className="size-4 text-neutral-700 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>
        </section>

        {/* open sessions */}
        <section aria-label="Open sessions" className="flex flex-col gap-3">
          <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] text-neutral-600">
            Open sessions {sessions.length > 0 && `· ${sessions.length}`}
          </h2>

          {sessions.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-neutral-900 p-5 text-center text-xs text-neutral-600">
              No sessions open. You can hold several at once.
            </p>
          ) : (
            <ul className="grid gap-2.5">
              {sessions.map((s) => (
                <li key={s.code} className="relative">
                  <button
                    onClick={() => onOpen(s.code)}
                    className="group flex w-full items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3.5 text-left transition-colors hover:border-neutral-600 hover:bg-neutral-900 min-h-[60px]"
                  >
                    <span className="font-mono text-base font-semibold tracking-[0.25em] text-neutral-100">
                      {s.code}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-neutral-500">
                      <Users className="size-3" aria-hidden />
                      {s.presence.length}
                    </span>
                    {!s.hasKey && (
                      <span
                        className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-neutral-500 animate-fast-pulse"
                        title="Waiting for a member to hand you the session key"
                      >
                        <KeyRound className="size-3" aria-hidden />
                        key
                      </span>
                    )}
                    <span className="flex-1" />
                    {s.unread > 0 && (
                      <span className="flex min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[10px] font-bold text-black">
                        {s.unread > 99 ? "99+" : s.unread}
                      </span>
                    )}
                    <ArrowRight className="size-4 text-neutral-600 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </button>
                  <button
                    onClick={() => setLeaveCode(s.code)}
                    aria-label={`Close session ${s.code} on this device`}
                    className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full border border-neutral-700 bg-black text-neutral-500 transition-colors hover:text-white hover:border-neutral-500"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* sticky footer */}
      <footer className="mt-auto w-full max-w-md mx-auto px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <div className="flex flex-col items-center gap-1 border-t border-neutral-900 pt-4 text-center">
          <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-neutral-600">
            Keys live in this tab only
          </p>
          <p className="font-mono text-[10px] text-neutral-700">
            device {identityFp.slice(0, 4)}·{identityFp.slice(4, 8)}
          </p>
        </div>
      </footer>

      {/* created code */}
      <Dialog open={created !== null} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent className="max-w-xs rounded-3xl border-neutral-800 bg-neutral-950 p-6">
          <DialogHeader className="items-center text-center">
            <DialogTitle className="text-xs font-mono uppercase tracking-[0.3em] text-neutral-400">
              Session created
            </DialogTitle>
            <DialogDescription className="text-xs text-neutral-500">
              Share the code — it works from anywhere.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center gap-3 py-2">
            <span className="font-mono text-3xl font-bold tracking-[0.3em] text-white">
              {created}
            </span>
            <Button
              size="icon"
              variant="outline"
              aria-label="Copy session code"
              className="rounded-full border-neutral-700 bg-transparent"
              onClick={() => created && copyCode(created)}
            >
              <Copy className="size-4" aria-hidden />
            </Button>
          </div>
          <Button
            className="w-full rounded-xl bg-white text-black hover:bg-neutral-200 min-h-[44px]"
            onClick={() => {
              const code = created;
              setCreated(null);
              if (code) onOpen(code);
            }}
          >
            Enter session
          </Button>
        </DialogContent>
      </Dialog>

      {/* join */}
      <Dialog
        open={joinOpen}
        onOpenChange={(o) => {
          setJoinOpen(o);
          if (!o) setJoinCode("");
        }}
      >
        <DialogContent className="max-w-xs rounded-3xl border-neutral-800 bg-neutral-950 p-6">
          <DialogHeader className="items-center text-center">
            <DialogTitle className="text-xs font-mono uppercase tracking-[0.3em] text-neutral-400">
              Join session
            </DialogTitle>
            <DialogDescription className="text-xs text-neutral-500">
              Enter the 6-letter code.
            </DialogDescription>
          </DialogHeader>
          <Input
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
            className="h-14 rounded-xl border-neutral-800 bg-black text-center font-mono text-xl font-bold tracking-[0.4em] uppercase placeholder:text-neutral-700"
          />
          <Button
            disabled={!CODE_RE.test(joinCode)}
            onClick={() => void submitJoin(joinCode)}
            className="w-full rounded-xl bg-white text-black hover:bg-neutral-200 min-h-[44px]"
          >
            Join
          </Button>
        </DialogContent>
      </Dialog>

      {/* delete for everyone */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="max-w-xs rounded-3xl border-neutral-800 bg-neutral-950 p-6">
          <AlertDialogHeader className="items-center text-center">
            <AlertDialogTitle className="flex items-center gap-2 text-sm">
              <Trash2 className="size-4 text-neutral-300" aria-hidden />
              Terminate a session
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed text-neutral-500">
              This erases the code, its membership and the full ciphertext history —
              for <span className="text-neutral-300">every</span> participant, immediately
              and irreversibly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteCode}
            onChange={(e) => setDeleteCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6))}
            placeholder="CODE"
            aria-label="Session code to delete"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={6}
            className="h-12 rounded-xl border-neutral-800 bg-black text-center font-mono text-lg font-bold tracking-[0.4em] uppercase placeholder:text-neutral-700"
          />
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogAction
              disabled={!CODE_RE.test(deleteCode.trim())}
              onClick={(e) => {
                e.preventDefault();
                void submitDelete();
              }}
              className="w-full rounded-xl bg-white text-black hover:bg-neutral-200 min-h-[44px]"
            >
              Delete for everyone
            </AlertDialogAction>
            <AlertDialogCancel className="w-full rounded-xl border-neutral-800 bg-transparent text-neutral-400 min-h-[44px]">
              Cancel
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* leave (local close) */}
      <AlertDialog open={leaveCode !== null} onOpenChange={(o) => !o && setLeaveCode(null)}>
        <AlertDialogContent className="max-w-xs rounded-3xl border-neutral-800 bg-neutral-950 p-6">
          <AlertDialogHeader className="items-center text-center">
            <AlertDialogTitle className="text-sm">Close {leaveCode} here?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed text-neutral-500">
              Your device discards its key material for this session. Others keep chatting —
              to return you will need a member to hand you the key again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogAction
              onClick={() => {
                if (leaveCode) onClose(leaveCode);
                setLeaveCode(null);
              }}
              className="w-full rounded-xl bg-white text-black hover:bg-neutral-200 min-h-[44px]"
            >
              Close session here
            </AlertDialogAction>
            <AlertDialogCancel className="w-full rounded-xl border-neutral-800 bg-transparent text-neutral-400 min-h-[44px]">
              Stay
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
