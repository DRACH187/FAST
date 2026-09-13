"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowDown,
  ArrowLeft,
  Copy,
  KeyRound,
  Lock,
  MoreVertical,
  SendHorizontal,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import type { SessionView } from "@/lib/fast/session-manager";
import type { DecryptedMessage } from "@/lib/crypto/keyvault";

type ChatProps = {
  session: SessionView;
  myFp: string;
  onBack: () => void;
  onSend: (text: string) => Promise<void>;
  onDelete: (code: string) => Promise<void>;
};

export function ChatScreen({ session, myFp, onBack, onSend, onDelete }: ChatProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    scrollToBottom(false);
  }, [session.code]);

  useEffect(() => {
    if (atBottom) scrollToBottom(true);
  }, [session.messages.length]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !session.hasKey) return;
    setSending(true);
    try {
      await onSend(text);
      setDraft("");
      if (taRef.current) taRef.current.style.height = "auto";
      requestAnimationFrame(() => scrollToBottom(true));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Message not sent");
    } finally {
      setSending(false);
    }
  }, [draft, onSend, scrollToBottom, sending, session.hasKey]);

  const grouped = useMemo(() => {
    const groups: { senderFp: string; mine: boolean; items: DecryptedMessage[] }[] = [];
    for (const m of session.messages) {
      const last = groups[groups.length - 1];
      if (last && last.senderFp === m.senderFp && last.mine === m.mine) {
        last.items.push(m);
      } else {
        groups.push({ senderFp: m.senderFp, mine: m.mine, items: [m] });
      }
    }
    return groups;
  }, [session.messages]);

  const otherCount = useMemo(() => {
    const others = new Set(
      session.presence.filter((fp) => fp !== myFp)
    );
    return others.size;
  }, [session.presence, myFp]);

  return (
    <main className="h-dvh flex flex-col bg-black animate-fast-fade-in">
      {/* header */}
      <header className="sticky top-0 z-20 border-b border-neutral-900 bg-black/85 backdrop-blur-md pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 items-center gap-2 px-3">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Back to sessions"
            onClick={onBack}
            className="size-10 rounded-full text-neutral-400 hover:bg-neutral-900 hover:text-white"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Button>

          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="flex flex-col leading-tight">
              <span className="font-mono text-sm font-bold tracking-[0.22em] text-white">
                {session.code}
              </span>
              <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-neutral-500">
                <Users className="size-3" aria-hidden />
                {otherCount > 0 ? `${otherCount + 1} live` : "solo"}
                {session.hasKey ? (
                  <Lock className="size-3 text-neutral-400" aria-label="Session key active" />
                ) : (
                  <KeyRound
                    className="size-3 animate-fast-pulse text-neutral-300"
                    aria-label="Awaiting session key"
                  />
                )}
              </span>
            </div>
          </div>

          {session.hasKey && (
            <span
              className="hidden xs:flex sm:flex items-center gap-1 rounded-full border border-neutral-800 px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.2em] text-neutral-400"
              title="Messages are sealed with per-message keys in your browser"
            >
              <ShieldCheck className="size-3.5" aria-hidden />
              e2e
            </span>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Session menu"
                className="size-10 rounded-full text-neutral-400 hover:bg-neutral-900 hover:text-white"
              >
                <MoreVertical className="size-5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="w-52 rounded-2xl border-neutral-800 bg-neutral-950"
            >
              <DropdownMenuItem
                onClick={() => setCodeOpen(true)}
                className="gap-2 rounded-xl text-neutral-200 focus:bg-neutral-900"
              >
                <Copy className="size-4" aria-hidden />
                Copy code
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-neutral-800" />
              <DropdownMenuItem
                onClick={() => setDeleteOpen(true)}
                className="gap-2 rounded-xl text-neutral-200 focus:bg-neutral-900"
              >
                <Trash2 className="size-4" aria-hidden />
                Delete for everyone
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* key pending banner */}
      {!session.hasKey && (
        <div className="flex items-center justify-center gap-2 border-b border-neutral-900 bg-neutral-950 px-4 py-2 text-[11px] text-neutral-400">
          <KeyRound className="size-3.5 animate-fast-pulse" aria-hidden />
          Awaiting session key from a member…
        </div>
      )}

      {/* transcript */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="slim-scroll relative flex-1 overflow-y-auto overflow-x-hidden px-4 py-4"
        role="log"
        aria-label="Encrypted transcript"
      >
        {session.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950">
              <Lock className="size-6 text-neutral-500" aria-hidden />
            </div>
            <p className="max-w-[240px] text-xs leading-relaxed text-neutral-500">
              Sealed channel. Everything typed here is encrypted in your browser
              before it ever leaves.
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-md flex-col gap-1.5">
            {grouped.map((group, gi) => (
              <div
                key={`${group.senderFp}-${gi}`}
                className={`flex flex-col gap-1 ${group.mine ? "items-end" : "items-start"}`}
              >
                {!group.mine && (
                  <span className="px-1 font-mono text-[10px] tracking-wider text-neutral-600">
                    {group.senderFp.slice(0, 4)}·{group.senderFp.slice(4, 8)}
                  </span>
                )}
                {group.items.map((m) => (
                  <Bubble key={m.id} message={m} />
                ))}
                <span className="px-1 text-[9px] font-mono text-neutral-700">
                  {formatTime(group.items[group.items.length - 1].ts)}
                </span>
              </div>
            ))}
            <div className="h-2" />
          </div>
        )}
      </div>

      {/* jump to latest */}
      {!atBottom && (
        <button
          onClick={() => scrollToBottom(true)}
          aria-label="Jump to latest message"
          className="absolute bottom-24 right-4 z-10 flex size-10 items-center justify-center rounded-full border border-neutral-700 bg-black text-neutral-300 shadow-lg transition-colors hover:text-white"
        >
          <ArrowDown className="size-4" aria-hidden />
        </button>
      )}

      {/* composer (sticky footer) */}
      <footer className="mt-auto border-t border-neutral-900 bg-black/90 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-md items-end gap-2">
          <Textarea
            ref={taRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={session.hasKey ? "Message" : "Locked until key arrives"}
            disabled={!session.hasKey}
            rows={1}
            aria-label="Message"
            className="slim-scroll max-h-[120px] min-h-[44px] flex-1 resize-none rounded-2xl border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-600 focus-visible:ring-neutral-700"
          />
          <Button
            size="icon"
            onClick={() => void send()}
            disabled={!session.hasKey || !draft.trim() || sending}
            aria-label="Send message"
            className="size-11 shrink-0 rounded-full bg-white text-black transition-transform hover:bg-neutral-200 active:scale-95 disabled:opacity-30"
          >
            <SendHorizontal className="size-5" aria-hidden />
          </Button>
        </div>
      </footer>

      {/* code dialog */}
      <Dialog open={codeOpen} onOpenChange={setCodeOpen}>
        <DialogContent className="max-w-xs rounded-3xl border-neutral-800 bg-neutral-950 p-6">
          <DialogHeader className="items-center text-center">
            <DialogTitle className="text-xs font-mono uppercase tracking-[0.3em] text-neutral-400">
              Session code
            </DialogTitle>
          </DialogHeader>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(session.code);
              toast.success("Code copied");
            }}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border border-neutral-800 py-4 transition-colors hover:border-neutral-600 min-h-[44px]"
          >
            <span className="font-mono text-2xl font-bold tracking-[0.3em] text-white">
              {session.code}
            </span>
            <Copy className="size-4 text-neutral-400" aria-hidden />
          </button>
        </DialogContent>
      </Dialog>

      {/* delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="max-w-xs rounded-3xl border-neutral-800 bg-neutral-950 p-6">
          <AlertDialogHeader className="items-center text-center">
            <AlertDialogTitle className="flex items-center gap-2 text-sm">
              <ShieldAlert className="size-4 text-neutral-300" aria-hidden />
              Delete {session.code} for everyone?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed text-neutral-500">
              Every member is ejected immediately and the ciphertext history is
              erased. There is no undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setDeleteOpen(false);
                void onDelete(session.code).catch((err) =>
                  toast.error(err instanceof Error ? err.message : "Delete failed")
                );
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
    </main>
  );
}

function Bubble({ message }: { message: DecryptedMessage }) {
  if (message.failed) {
    return (
      <div className="animate-fast-bubble-in flex max-w-[85%] items-center gap-2 rounded-2xl border border-dashed border-neutral-700 bg-neutral-950 px-3.5 py-2.5">
        <ShieldAlert className="size-3.5 shrink-0 text-neutral-500" aria-hidden />
        <span className="text-xs italic text-neutral-500">Undecryptable — integrity check failed</span>
      </div>
    );
  }
  if (message.sealed) {
    return (
      <div className="animate-fast-bubble-in flex max-w-[85%] items-center gap-2 rounded-2xl border border-dashed border-neutral-800 bg-transparent px-3.5 py-2.5">
        <Lock className="size-3 shrink-0 text-neutral-600" aria-hidden />
        <span className="text-xs italic text-neutral-600">Sealed — arrived before your key</span>
      </div>
    );
  }
  return (
    <div
      className={`animate-fast-bubble-in max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
        message.mine
          ? "rounded-br-md bg-white text-black"
          : "rounded-bl-md border border-neutral-800 bg-neutral-900 text-neutral-100"
      }`}
    >
      {message.text}
    </div>
  );
}

function formatTime(ts: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
