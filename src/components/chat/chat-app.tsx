"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { getSocket } from "@/lib/socket";
import type { ChannelInfo, ChatMessage } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { Sidebar } from "./sidebar";
import { ChatHeader } from "./chat-header";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";

type ChatAppProps = {
  user: string;
  onResetTag: () => void;
};

export function ChatApp({ user, onResetTag }: ChatAppProps) {
  const { toast } = useToast();
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [activeSlug, setActiveSlug] = useState("the-yard");
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [typing, setTyping] = useState<Record<string, Record<string, number>>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [online, setOnline] = useState(0);
  const [connected, setConnected] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadingChannel, setLoadingChannel] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const activeRef = useRef(activeSlug);
  activeRef.current = activeSlug;

  /* ---------- load channels ---------- */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/channels")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data.channels) return;
        setChannels(data.channels);
        setActiveSlug((prev) =>
          data.channels.some((c: ChannelInfo) => c.slug === prev)
            ? prev
            : (data.channels[0]?.slug ?? prev)
        );
      })
      .catch(() => {
        if (!cancelled) {
          toast({
            title: "Couldn't load the sets",
            description: "Check the block and refresh.",
            variant: "destructive",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  /* ---------- realtime socket ---------- */
  useEffect(() => {
    const s = getSocket();
    socketRef.current = s;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onPresence = (d: { count: number }) => setOnline(d.count);

    const onMessage = (msg: ChatMessage) => {
      if (!msg?.id || !msg.channelSlug) return;
      appendMessage(msg);
    };

    const onTyping = (d: {
      channelSlug: string;
      author: string;
      isTyping: boolean;
    }) => {
      if (!d?.author || d.author === user) return;
      setTyping((prev) => {
        const forSlug = { ...(prev[d.channelSlug] ?? {}) };
        if (d.isTyping) forSlug[d.author] = Date.now();
        else delete forSlug[d.author];
        return { ...prev, [d.channelSlug]: forSlug };
      });
    };

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("presence", onPresence);
    s.on("chat:message", onMessage);
    s.on("chat:typing", onTyping);
    if (s.connected) setConnected(true);

    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("presence", onPresence);
      s.off("chat:message", onMessage);
      s.off("chat:typing", onTyping);
    };
  }, [user]);

  /* ---------- prune stale typers ---------- */
  useEffect(() => {
    const iv = window.setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        let changed = false;
        const next: Record<string, Record<string, number>> = {};
        for (const [slug, authors] of Object.entries(prev)) {
          const kept: Record<string, number> = {};
          for (const [author, t] of Object.entries(authors)) {
            if (now - t < 4200) kept[author] = t;
            else changed = true;
          }
          next[slug] = kept;
        }
        return changed ? next : prev;
      });
    }, 2500);
    return () => window.clearInterval(iv);
  }, []);

  /* ---------- helpers ---------- */
  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      const list = prev[msg.channelSlug] ?? [];
      if (list.some((m) => m.id === msg.id)) return prev;
      return { ...prev, [msg.channelSlug]: [...list, msg] };
    });
    setChannels((prev) =>
      prev.map((c) =>
        c.slug === msg.channelSlug
          ? {
              ...c,
              messageCount: c.messageCount + 1,
              lastMessage: {
                author: msg.author,
                content: msg.content,
                createdAt: msg.createdAt,
              },
            }
          : c
      )
    );
    if (msg.channelSlug !== activeRef.current) {
      setUnread((prev) => ({
        ...prev,
        [msg.channelSlug]: (prev[msg.channelSlug] ?? 0) + 1,
      }));
    }
  }, []);

  /* ---------- load messages when channel changes ---------- */
  useEffect(() => {
    if (!activeSlug) return;
    let cancelled = false;
    setLoadingChannel(true);
    setUnread((prev) => ({ ...prev, [activeSlug]: 0 }));
    fetch(`/api/channels/${activeSlug}/messages`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data.messages) return;
        setMessages((prev) => ({ ...prev, [activeSlug]: data.messages }));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingChannel(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSlug]);

  /* ---------- send ---------- */
  const handleSend = useCallback(
    async (content: string) => {
      const slug = activeRef.current;
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const optimistic: ChatMessage = {
        id: tempId,
        content,
        author: user,
        channelId: "",
        channelSlug: slug,
        createdAt: new Date().toISOString(),
      };
      appendMessage(optimistic);

      try {
        const res = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, author: user, channelSlug: slug }),
        });
        const data = await res.json();
        if (!res.ok || !data.message) throw new Error(data.error || "failed");

        const real: ChatMessage = { ...data.message, channelSlug: slug };
        setMessages((prev) => {
          const list = (prev[slug] ?? []).map((m) =>
            m.id === tempId ? real : m
          );
          const deduped = list.filter(
            (m, i) => list.findIndex((x) => x.id === m.id) === i
          );
          return { ...prev, [slug]: deduped };
        });
        socketRef.current?.emit("chat:message", real);
      } catch {
        setMessages((prev) => ({
          ...prev,
          [slug]: (prev[slug] ?? []).filter((m) => m.id !== tempId),
        }));
        toast({
          title: "Message bounced",
          description: "The block didn't get that. Try again.",
          variant: "destructive",
        });
      }
    },
    [user, appendMessage, toast]
  );

  const handleTyping = useCallback(
    (isTyping: boolean) => {
      socketRef.current?.emit("chat:typing", {
        channelSlug: activeRef.current,
        author: user,
        isTyping,
      });
    },
    [user]
  );

  const activeChannel = channels.find((c) => c.slug === activeSlug);
  const activeMessages = messages[activeSlug] ?? [];
  const typers = Object.keys(typing[activeSlug] ?? {});

  return (
    <div className="flex h-dvh overflow-hidden bg-[#070707]">
      <Sidebar
        channels={channels}
        activeSlug={activeSlug}
        unread={unread}
        user={user}
        online={online}
        connected={connected}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={(slug) => {
          setActiveSlug(slug);
          setSidebarOpen(false);
        }}
        onResetTag={onResetTag}
      />

      <div className="concrete-bg relative flex min-w-0 flex-1 flex-col">
        <ChatHeader
          channel={activeChannel}
          online={online}
          connected={connected}
          onOpenSidebar={() => setSidebarOpen(true)}
        />

        <MessageList
          messages={activeMessages}
          user={user}
          loading={loadingChannel}
          channelName={activeChannel?.name ?? ""}
        />

        {/* typing indicator */}
        <div className="relative z-10 h-7 px-4 md:px-6" aria-live="polite">
          {typers.length > 0 && (
            <p className="font-script text-lg leading-none text-neutral-400">
              {typers.slice(0, 2).join(" & ")}
              {typers.length > 2 ? " & more" : ""}{" "}
              {typers.length > 1 ? "are" : "is"} tagging up
              <span>
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </span>
            </p>
          )}
        </div>

        <MessageInput onSend={handleSend} onTyping={handleTyping} />
      </div>
    </div>
  );
}
