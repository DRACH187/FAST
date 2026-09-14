"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decryptMessage,
  encryptMessage,
  generateSessionKey,
  unwrapSessionKey,
  wrapSessionKeyFor,
} from "@/lib/crypto/e2ee";
import {
  ensureIdentity,
  getSessionKey,
  hasSessionKey,
  keyReceivedAt,
  markSeen,
  nextCounter,
  observeCounter,
  purgeSession,
  stashPending,
  storeSessionKey,
  takePending,
  type DecryptedMessage,
} from "@/lib/crypto/keyvault";
import { api, type WireMessage } from "@/lib/fast/api";
import { getRelay } from "@/lib/fast/relay";
import { toast } from "@/components/fast/toast";
import * as vault from "@/lib/fast/vault-db";

export type Phase = "splash" | "gate" | "app";

export type SessionView = {
  code: string;
  createdAt: string;
  members: Record<string, string>; // fingerprint -> public key
  presence: string[]; // fingerprints currently in the relay room
  messages: DecryptedMessage[];
  hasKey: boolean;
  unread: number;
};

const CODE_RE = /^[A-Z]{6}$/;

function sortMessages(list: DecryptedMessage[]): DecryptedMessage[] {
  return [...list].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)
  );
}

/**
 * The orchestrator. Owns:
 *  - the splash -> gate(187) -> app flow
 *  - multiple concurrent sessions per tab (hub <-> chat)
 *  - the E2EE handshake (session-key wrap/unwrap) and message ratchet
 *  - relay (socket.io) wiring and ciphertext persistence
 *
 * Security invariant: every value that leaves this module toward the network
 * is either public material or ciphertext. Plaintext exists only inside
 * function scope and the transcript views.
 */
export function useSessionManager() {
  const [phase, setPhase] = useState<Phase>("splash");
  const [identityFp, setIdentityFp] = useState<string>("");
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // mirrors for stable access inside relay callbacks
  const sessionsRef = useRef<SessionView[]>([]);
  const activeCodeRef = useRef<string | null>(null);
  const identityRef = useRef<Awaited<ReturnType<typeof ensureIdentity>> | null>(null);
  const wrappedFor = useRef(new Map<string, Set<string>>()); // code -> fps I already wrapped
  const unwrappedIds = useRef(new Map<string, Set<string>>()); // code -> envelope ids tried
  const joinAt = useRef(new Map<string, string>()); // code -> ISO instant we registered
  const wireCache = useRef(new Map<string, Map<string, WireMessage>>()); // code -> id -> blob (sealed decrypt-on-key)
  const keyPoll = useRef(new Map<string, ReturnType<typeof setInterval>>());
  /** codes registered with the relay during this tab generation (drives rejoin logic) */
  const registered = useRef(new Set<string>());
  /** restored-from-vault blob ids per code — eligible for re-decryption after a key re-wrap */
  const restoredIds = useRef(new Map<string, Set<string>>());
  /** every fingerprint this device has ever sent from (public material — see vault-db meta) */
  const myFps = useRef(new Set<string>());
  const restoreKick = useRef(false);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    activeCodeRef.current = activeCode;
  }, [activeCode]);

  // ------------------------------------------------------------------ helpers

  const patchSession = useCallback((code: string, patch: Partial<SessionView> | ((s: SessionView) => Partial<SessionView>)) => {
    setSessions((prev) =>
      prev.map((s) => (s.code === code ? { ...s, ...(typeof patch === "function" ? patch(s) : patch) } : s))
    );
  }, []);

  const appendMessages = useCallback((code: string, incoming: DecryptedMessage[]) => {
    if (incoming.length === 0) return;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.code !== code) return s;
        const knownIds = new Set(s.messages.map((m) => m.id));
        // optimistic entries carry client UUIDs while history rows carry DB
        // cuids — (senderFp, counter) is the stable logical identity
        const knownPairs = new Set(
          s.messages.map((m) => (m.counter === undefined ? null : `${m.senderFp}:${m.counter}`))
        );
        const fresh = incoming.filter((m) => {
          if (knownIds.has(m.id)) return false;
          if (m.counter !== undefined && knownPairs.has(`${m.senderFp}:${m.counter}`)) return false;
          return true;
        });
        if (fresh.length === 0) return s;
        return { ...s, messages: sortMessages([...s.messages, ...fresh]) };
      })
    );
  }, []);

  /** Decrypt one wire blob; returns a transcript entry (sealed if unreadable/pre-key). */
  const toTranscriptEntry = useCallback(
    async (code: string, wire: WireMessage, mine: boolean): Promise<DecryptedMessage> => {
      const base: DecryptedMessage = {
        id: wire.id,
        code,
        senderFp: wire.senderFp,
        mine,
        text: "",
        ts: 0,
        createdAt: wire.createdAt,
        counter: wire.counter,
        sealed: true,
      };
      const key = getSessionKey(code);
      if (!key || wire.createdAt < new Date(keyReceivedAt(code) - 2000).toISOString()) {
        return base; // sealed: pre-key or pre-join
      }
      try {
        const payload = await decryptMessage(key, code, wire);
        return { ...base, text: payload.t, ts: payload.ts, counter: wire.counter, sealed: false };
      } catch {
        // AEAD tag mismatch = tampered or foreign blob — never render it
        return { ...base, failed: true, sealed: false };
      }
    },
    []
  );

  // ------------------------------------------------------- key distribution

  const wrapForKeylessMembers = useCallback(
    async (code: string, presenceOverride?: string[]) => {
      const identity = identityRef.current;
      const key = getSessionKey(code);
      if (!identity || !key || !hasSessionKey(code)) return;

      const view = sessionsRef.current.find((s) => s.code === code);
      if (!view) return;

      let members = view.members;
      // use the live list from the relay event when provided — the state mirror
      // lags one render behind and would drop first-contact members
      const online = presenceOverride ?? view.presence;
      const targets = online.filter((fp) => fp !== identity.fingerprint);
      if (targets.length === 0) return;

      // roster may be stale — refresh once when an unknown fingerprint appears
      if (targets.some((fp) => !members[fp])) {
        try {
          const info = await api.getSession(code);
          members = Object.fromEntries(info.participants.map((p) => [p.fingerprint, p.publicKey]));
          patchSession(code, { members });
        } catch {
          return;
        }
      }

      const sent = wrappedFor.current.get(code) ?? new Set<string>();
      for (const fp of targets) {
        if (sent.has(fp) || !members[fp]) continue;
        try {
          const envelope = await wrapSessionKeyFor(identity, key, code, members[fp], fp);
          sent.add(fp);
          wrappedFor.current.set(code, sent);
          await api.postKeyEnvelope(code, envelope); // persisted for offline retry
          getRelay().emit("session:key", { code, envelope }); // instant path
        } catch {
          sent.delete(fp);
        }
      }
    },
    [patchSession]
  );

  /**
   * Data-saving continuity: after a reload the session key is gone (RAM-only
   * by design), so restored ciphertext renders sealed. Once a member re-wraps
   * the key to this device, blobs it provably held before the reload become
   * decryptable again and replace their sealed placeholders in place.
   */
  const revealRestoredHistory = useCallback(async (code: string) => {
    const ids = restoredIds.current.get(code);
    const key = getSessionKey(code);
    if (!ids || ids.size === 0 || !key || myFps.current.size === 0) return;
    let blobs: WireMessage[] = [];
    try {
      blobs = await vault.loadWire(code);
    } catch {
      return;
    }
    if (blobs.length === 0) return;
    const replacements = new Map<string, DecryptedMessage>();
    await Promise.all(
      blobs.map(async (w) => {
        if (!ids.has(w.id)) return;
        try {
          const payload = await decryptMessage(key, code, w);
          replacements.set(w.id, {
            id: w.id,
            code,
            senderFp: w.senderFp,
            mine: myFps.current.has(w.senderFp),
            text: payload.t,
            ts: payload.ts,
            createdAt: w.createdAt,
            counter: w.counter,
            sealed: false,
          });
        } catch {
          /* corrupt or foreign blob — stays sealed */
        }
      })
    );
    if (replacements.size === 0) return;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.code !== code) return s;
        const messages = s.messages.map((m) => replacements.get(m.id) ?? m);
        return { ...s, messages: sortMessages(messages) };
      })
    );
    restoredIds.current.delete(code); // one-shot reveal
  }, []);

  const adoptSessionKey = useCallback(
    async (code: string, raw: Uint8Array) => {
      storeSessionKey(code, raw);
      void vault.markKeyHeld(code); // local attestation: this device held the key
      void revealRestoredHistory(code);
      const poll = keyPoll.current.get(code);
      if (poll) {
        clearInterval(poll);
        keyPoll.current.delete(code);
      }
      patchSession(code, { hasKey: true });
      // decrypt blobs that arrived while we were waiting for the key
      const pending = takePending(code);
      const me = identityRef.current?.fingerprint;
      const entries = await Promise.all(
        pending.map((w) => toTranscriptEntry(code, w, w.senderFp === me))
      );
      appendMessages(code, entries);
    },
    [appendMessages, patchSession, revealRestoredHistory, toTranscriptEntry]
  );

  const startKeyPolling = useCallback(
    (code: string) => {
      if (keyPoll.current.has(code)) return;
      const poll = setInterval(async () => {
        const identity = identityRef.current;
        if (!identity || hasSessionKey(code)) {
          const t = keyPoll.current.get(code);
          if (t) clearInterval(t);
          keyPoll.current.delete(code);
          return;
        }
        try {
          const tried = unwrappedIds.current.get(code) ?? new Set<string>();
          const { envelopes } = await api.fetchKeyEnvelopes(code, identity.fingerprint);
          for (const env of envelopes) {
            if (tried.has(env.id)) continue;
            tried.add(env.id);
            unwrappedIds.current.set(code, tried);
            try {
              const raw = await unwrapSessionKey(identity, code, env);
              await adoptSessionKey(code, raw);
              return;
            } catch {
              /* envelope not for this identity generation — try next */
            }
          }
        } catch {
          /* relay hiccup — poll again */
        }
      }, 3000);
      keyPoll.current.set(code, poll);
    },
    [adoptSessionKey]
  );

  // ------------------------------------------------------------ relay wiring

  useEffect(() => {
    if (phase !== "app") return;
    const relay = getRelay();

    const onPresence = (data: { code: string; fingerprints: string[] }) => {
      if (!data || !CODE_RE.test(data.code)) return;
      patchSession(data.code, { presence: data.fingerprints });
      // newcomer appeared -> holders wrap a key for them (live list, not state)
      if (identityRef.current && data.fingerprints.includes(identityRef.current.fingerprint)) {
        void wrapForKeylessMembers(data.code, data.fingerprints);
      }
    };

    const onMessage = (env: {
      code: string;
      id: string;
      senderFp: string;
      counter: number;
      iv: string;
      ciphertext: string;
      createdAt: string;
    }) => {
      if (!env || !CODE_RE.test(env.code)) return;
      if (!markSeen(env.code, env.id)) return;
      observeCounter(env.code, env.counter);
      const wire: WireMessage = {
        id: env.id,
        senderFp: env.senderFp,
        counter: env.counter,
        iv: env.iv,
        ciphertext: env.ciphertext,
        createdAt: env.createdAt ?? new Date().toISOString(),
      };
      const cache = wireCache.current.get(env.code) ?? new Map<string, WireMessage>();
      cache.set(wire.id, wire);
      wireCache.current.set(env.code, cache);
      void vault.saveWire(env.code, [wire]); // data-saving: ciphertext at rest (no keys)

      const mine = wire.senderFp === identityRef.current?.fingerprint;
      void toTranscriptEntry(env.code, wire, mine).then((entry) => {
        appendMessages(env.code, [entry]);
        if (entry.sealed && !mine && !hasSessionKey(env.code)) {
          stashPending(env.code, wire);
          patchSession(env.code, (s) => ({ unread: s.unread + 1 }));
        } else if (!mine && activeCodeRef.current !== env.code) {
          patchSession(env.code, (s) => ({ unread: s.unread + 1 }));
        }
      });
    };

    const onKey = (data: { code: string; envelope: { forFp: string; epk: string; iv: string; payload: string } }) => {
      void (async () => {
        if (!data || !CODE_RE.test(data.code)) return;
        const identity = identityRef.current;
        if (!identity || data.envelope.forFp !== identity.fingerprint || hasSessionKey(data.code)) return;
        try {
          const raw = await unwrapSessionKey(identity, data.code, data.envelope);
          await adoptSessionKey(data.code, raw);
        } catch {
          /* wrong generation — the 3s poll will find a usable envelope */
        }
      })();
    };

    const onKeyRequest = (data: { code: string; fingerprint: string }) => {
      if (!data || !CODE_RE.test(data.code)) return;
      if (data.fingerprint === identityRef.current?.fingerprint) return;
      void wrapForKeylessMembers(data.code, [data.fingerprint]);
    };

    const onTerminated = (data: { code: string }) => {
      if (!data || !CODE_RE.test(data.code)) return;
      const wasOpen = sessionsRef.current.some((s) => s.code === data.code);
      purgeSession(data.code);
      const poll = keyPoll.current.get(data.code);
      if (poll) clearInterval(poll);
      keyPoll.current.delete(data.code);
      wrappedFor.current.delete(data.code);
      unwrappedIds.current.delete(data.code);
      joinAt.current.delete(data.code);
      wireCache.current.delete(data.code);
      registered.current.delete(data.code);
      restoredIds.current.delete(data.code);
      void vault.forgetSession(data.code); // wipe local vault rows too
      setSessions((prev) => prev.filter((s) => s.code !== data.code));
      setActiveCode((cur) => (cur === data.code ? null : cur));
      if (wasOpen) {
        toast.success(`Session ${data.code} was deleted for everyone`);
      }
    };

    const onConnect = () => {
      // resync room membership after any reconnect
      for (const s of sessionsRef.current) {
        if (identityRef.current) {
          relay.emit("session:join", { code: s.code, fingerprint: identityRef.current.fingerprint });
          relay.emit("session:keyrequest", {
            code: s.code,
            fingerprint: identityRef.current.fingerprint,
          });
        }
      }
    };

    relay.on("session:presence", onPresence);
    relay.on("session:message", onMessage);
    relay.on("session:key", onKey);
    relay.on("session:keyrequest", onKeyRequest);
    relay.on("session:terminated", onTerminated);
    relay.on("connect", onConnect);
    if (relay.connected) onConnect();

    return () => {
      relay.off("session:presence", onPresence);
      relay.off("session:message", onMessage);
      relay.off("session:key", onKey);
      relay.off("session:keyrequest", onKeyRequest);
      relay.off("session:terminated", onTerminated);
      relay.off("connect", onConnect);
    };
  }, [phase, patchSession, appendMessages, toTranscriptEntry, adoptSessionKey, wrapForKeylessMembers]);

  // ---------------------------------------------------------------- actions

  const registerAndJoinRoom = useCallback(
    async (code: string) => {
      const identity = await ensureIdentity();
      identityRef.current = identity;
      setIdentityFp(identity.fingerprint);

      const now = new Date().toISOString();
      joinAt.current.set(code, now);
      const { members } = await api.join(code, identity.fingerprint, identity.publicB64);

      const relay = getRelay();
      if (!relay.connected) {
        setConnecting(true);
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          if (relay.connected) return done();
          relay.once("connect", done);
          setTimeout(done, 4000);
        });
        setConnecting(false);
      }
      relay.emit("session:join", { code, fingerprint: identity.fingerprint });
      registered.current.add(code);

      const memberMap = Object.fromEntries(members.map((m) => [m.fingerprint, m.publicKey]));
      return { members: memberMap, fingerprint: identity.fingerprint };
    },
    []
  );

  const startSession = useCallback(async () => {
    const { code, createdAt } = await api.createSession();
    const key = generateSessionKey();
    storeSessionKey(code, key);
    void vault.markKeyHeld(code);
    const { members } = await registerAndJoinRoom(code);
    setSessions((prev) => [
      ...prev,
      {
        code,
        createdAt,
        members,
        presence: [identityRef.current?.fingerprint ?? ""],
        messages: [],
        hasKey: true,
        unread: 0,
      },
    ]);
    // NOTE: stay on the hub — the UI shows the "share this code" dialog first;
    // the user enters the session explicitly via openSession().
    return code;
  }, [registerAndJoinRoom]);

  const joinSession = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim().toUpperCase();
      if (!CODE_RE.test(code)) throw new Error("Codes are 6 letters (A–Z).");

      const info = await api.getSession(code); // 404 -> throws, UI shows "not found"
      await registerAndJoinRoom(code);

      const identity = identityRef.current!;
      const alreadyHasKey = hasSessionKey(code) || sessionsRef.current.some((s) => s.code === code && s.hasKey);

      if (!alreadyHasKey) {
        // announce + ask holders to wrap the session key for us
        getRelay().emit("session:keyrequest", { code, fingerprint: identity.fingerprint });
        startKeyPolling(code);
      }

      setSessions((prev) => {
        if (prev.some((s) => s.code === code)) return prev;
        return [
          ...prev,
          {
            code,
            createdAt: info.createdAt,
            members: Object.fromEntries(info.participants.map((p) => [p.fingerprint, p.publicKey])),
            presence: [identity.fingerprint],
            messages: [],
            hasKey: alreadyHasKey,
            unread: 0,
          },
        ];
      });
      setActiveCode(code);

      // pull ciphertext history from the moment we registered
      try {
        const { messages } = await api.fetchMessages(code, joinAt.current.get(code));
        void vault.saveWire(code, messages);
        const entries = await Promise.all(
          messages.map((w) => toTranscriptEntry(code, w, w.senderFp === identity.fingerprint))
        );
        appendMessages(code, entries);
      } catch {
        /* history is best-effort */
      }
      return code;
    },
    [registerAndJoinRoom, startKeyPolling, toTranscriptEntry, appendMessages]
  );

  const openSession = useCallback(
    async (code: string) => {
      patchSession(code, { unread: 0 });
      setActiveCode(code);
      const identity = identityRef.current;
      if (!identity) return;

      // restored sessions (post-reload) may not be registered with the relay
      // yet — join now so a member can re-wrap the key to this device
      if (!registered.current.has(code)) {
        try {
          await registerAndJoinRoom(code);
          if (!hasSessionKey(code)) {
            getRelay().emit("session:keyrequest", { code, fingerprint: identity.fingerprint });
            startKeyPolling(code);
          }
        } catch {
          /* offline — sealed transcript still viewable */
        }
      }

      if (!hasSessionKey(code)) return;
      try {
        const since = new Date(keyReceivedAt(code) - 2000).toISOString();
        const { messages } = await api.fetchMessages(code, since);
        void vault.saveWire(code, messages);
        const entries = await Promise.all(
          messages.map((w) => {
            markSeen(code, w.id);
            return toTranscriptEntry(code, w, w.senderFp === identity.fingerprint);
          })
        );
        appendMessages(code, entries);
      } catch {
        /* best-effort */
      }
    },
    [appendMessages, patchSession, registerAndJoinRoom, startKeyPolling, toTranscriptEntry]
  );

  const closeSession = useCallback(
    (code: string) => {
      // leaving a session DESTROYS our local key material — rejoining later
      // requires a fresh wrap from a member still inside.
      getRelay().emit("session:leave", { code });
      purgeSession(code);
      const poll = keyPoll.current.get(code);
      if (poll) clearInterval(poll);
      keyPoll.current.delete(code);
      wrappedFor.current.delete(code);
      unwrappedIds.current.delete(code);
      joinAt.current.delete(code);
      wireCache.current.delete(code);
      registered.current.delete(code);
      restoredIds.current.delete(code);
      void vault.forgetSession(code); // a closed session should not resurrect after reload
      setSessions((prev) => prev.filter((s) => s.code !== code));
      setActiveCode((cur) => (cur === code ? null : cur));
    },
    []
  );

  const deleteSession = useCallback(async (code: string) => {
    await api.deleteSession(code);
    restoredIds.current.delete(code);
    void vault.forgetSession(code);
    // cascade done server-side; evict every device (including ours)
    getRelay().emit("session:terminated", { code });
  }, []);

  const sendMessage = useCallback(
    async (code: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const identity = identityRef.current;
      const key = getSessionKey(code);
      if (!identity || !key) throw new Error("Session key not available yet.");

      const counter = nextCounter(code);
      const id = crypto.randomUUID();
      const payload = { t: trimmed, ts: Date.now() };
      const enc = await encryptMessage(key, code, identity.fingerprint, counter, id, payload);
      const wire: WireMessage = { ...enc, senderFp: identity.fingerprint, createdAt: new Date().toISOString() };

      appendMessages(code, [
        {
          id,
          code,
          senderFp: identity.fingerprint,
          mine: true,
          text: trimmed,
          ts: payload.ts,
          createdAt: wire.createdAt,
          counter,
        },
      ]);

      let saved: { serverId: string; createdAt: string };
      try {
        saved = await api.postMessage(code, {
          id: wire.id,
          senderFp: wire.senderFp,
          counter: wire.counter,
          iv: wire.iv,
          ciphertext: wire.ciphertext,
        });
      } catch (err) {
        // roll back the optimistic bubble — never fake a delivery
        setSessions((prev) =>
          prev.map((s) =>
            s.code === code ? { ...s, messages: s.messages.filter((m) => m.id !== id) } : s
          )
        );
        throw err;
      }
      getRelay().emit("session:message", { code, ...wire, createdAt: saved.createdAt });

      void vault.saveWire(code, [
        {
          id: saved.serverId,
          senderFp: wire.senderFp,
          counter: wire.counter,
          iv: wire.iv,
          ciphertext: wire.ciphertext,
          createdAt: saved.createdAt,
        },
      ]);

      // adopt the server's identity + clock so history refetches dedupe cleanly
      setSessions((prev) =>
        prev.map((s) =>
          s.code === code
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === id ? { ...m, id: saved.serverId, createdAt: saved.createdAt } : m
                ),
              }
            : s
        )
      );
    },
    [appendMessages]
  );

  const unlock = useCallback(async (passcode: string) => {
    await api.gate(passcode);
    const identity = await ensureIdentity();
    identityRef.current = identity;
    setIdentityFp(identity.fingerprint);
    setPhase("app");
  }, []);

  const activeSession = useMemo(
    () => sessions.find((s) => s.code === activeCode) ?? null,
    [sessions, activeCode]
  );

  // gentle safety: refresh transcript of the open session when tab regains focus
  useEffect(() => {
    if (phase !== "app" || !activeCode) return;
    const code = activeCode;
    const onFocus = () => void openSession(code);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [phase, activeCode, openSession]);

  // ------------------------------------------------- data-saving (vault-db)

  /**
   * Restore-on-unlock: pull session rows + ciphertext blobs out of IndexedDB,
   * drop any session the server no longer knows, feed the blobs into the
   * transcript as sealed entries, then reconnect every room so members can
   * re-wrap the session key to this device (which reveals the history).
   */
  const restoreFromVault = useCallback(
    async (identityFp: string) => {
      let stored: vault.StoredSession[] = [];
      let wire: Record<string, WireMessage[]> = {};
      try {
        const data = await vault.loadVault();
        stored = data.sessions;
        wire = data.wire;
      } catch {
        return;
      }
      if (stored.length === 0) return;

      for (const row of stored) {
        if (sessionsRef.current.some((s) => s.code === row.code)) continue;
        try {
          const info = await api.getSession(row.code); // 404 -> gone for everyone, forget it
          const members = Object.fromEntries(
            info.participants.map((p) => [p.fingerprint, p.publicKey])
          );
          setSessions((prev) =>
            prev.some((s) => s.code === row.code)
              ? prev
              : [
                  ...prev,
                  {
                    code: row.code,
                    createdAt: info.createdAt,
                    members,
                    presence: [],
                    messages: [],
                    hasKey: false,
                    unread: row.unread,
                  },
                ]
          );
          // restored ciphertext — sealed until the key comes back
          const ids = new Set<string>();
          const entries: DecryptedMessage[] = [];
          for (const w of wire[row.code] ?? []) {
            ids.add(w.id);
            entries.push({
              id: w.id,
              code: row.code,
              senderFp: w.senderFp,
              mine: myFps.current.has(w.senderFp),
              text: "",
              ts: 0,
              createdAt: w.createdAt,
              counter: w.counter,
              sealed: true,
            });
          }
          if (entries.length > 0) {
            restoredIds.current.set(row.code, ids);
            appendMessages(row.code, entries);
          }
        } catch {
          void vault.forgetSession(row.code);
        }
      }

      // reconnect every restored room (relay join + key request + polling)
      for (const row of stored) {
        try {
          await registerAndJoinRoom(row.code);
          if (!hasSessionKey(row.code)) {
            getRelay().emit("session:keyrequest", {
              code: row.code,
              fingerprint: identityFp,
            });
            startKeyPolling(row.code);
          }
        } catch {
          /* stay sealed; opening the session manually retries */
        }
      }
    },
    [appendMessages, registerAndJoinRoom, startKeyPolling]
  );

  // kick the restore exactly once per entry into the app phase
  useEffect(() => {
    if (phase !== "app" || restoreKick.current) return;
    restoreKick.current = true;
    void (async () => {
      const identity = await ensureIdentity();
      identityRef.current = identity;
      setIdentityFp(identity.fingerprint);
      // remember every fingerprint this device has sent from (public info)
      try {
        const prevFps = await vault.getMyFingerprints();
        for (const fp of prevFps) myFps.current.add(fp);
      } catch {
        /* meta store unavailable */
      }
      myFps.current.add(identity.fingerprint);
      void vault.recordMyFingerprint(identity.fingerprint);
      await restoreFromVault(identity.fingerprint);
    })();
  }, [phase, restoreFromVault]);

  // debounce-persist session metadata whenever it changes
  useEffect(() => {
    if (phase !== "app") return;
    const t = window.setTimeout(() => {
      void vault.saveSessions(
        sessions.map((s) => ({
          code: s.code,
          createdAt: s.createdAt,
          unread: s.unread,
          heldKey: s.hasKey,
          savedAt: Date.now(),
        }))
      );
    }, 350);
    return () => window.clearTimeout(t);
  }, [sessions, phase]);

  return {
    phase,
    setPhase,
    identityFp,
    sessions,
    activeSession,
    activeCode,
    connecting,
    unlock,
    startSession,
    joinSession,
    openSession,
    closeSession,
    deleteSession,
    sendMessage,
    setActiveCode,
  };
}
