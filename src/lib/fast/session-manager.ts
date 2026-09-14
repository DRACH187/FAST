"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decryptMessage,
  decryptPhoto,
  encryptMessage,
  encryptPhoto,
  generateSessionKey,
  unwrapSessionKey,
  wrapSessionKeyFor,
} from "@/lib/crypto/e2ee";
import {
  burnPhoto,
  ensureIdentity,
  getSessionKey,
  hasSessionKey,
  markSeen,
  nextCounter,
  observeCounter,
  purgeSession,
  stashPending,
  stashPhoto,
  storeSessionKey,
  takePending,
  type DecryptedMessage,
} from "@/lib/crypto/keyvault";
import { api, type WireMessage } from "@/lib/fast/api";
import { transport, type WireEnvelope } from "@/lib/fast/transport";
import { toast } from "@/components/fast/toast";
import * as vault from "@/lib/fast/vault-db";

export type Phase = "splash" | "loading" | "gate" | "app";

export type SessionView = {
  code: string;
  createdAt: string;
  members: Record<string, string>; // fingerprint -> public key
  presence: string[]; // fingerprints currently syncing with the room
  messages: DecryptedMessage[];
  hasKey: boolean;
  unread: number;
};

const CODE_RE = /^[A-Z]{6}$/;

/** 23-letter alphabet: unambiguous letters only (no I/L/O look-alikes). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";

/** The code is minted CLIENT-SIDE with real crypto randomness — the server
 *  never needs to be the origin of a session identity, which lets the room
 *  self-heal across serverless cold starts. */
function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

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
 *  - HTTP sync transport wiring and ciphertext persistence
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

  // mirrors for stable access inside transport callbacks
  const sessionsRef = useRef<SessionView[]>([]);
  const activeCodeRef = useRef<string | null>(null);
  const identityRef = useRef<Awaited<ReturnType<typeof ensureIdentity>> | null>(null);
  const wrappedFor = useRef(new Map<string, Set<string>>()); // code -> fps I already wrapped
  const keyPoll = useRef(new Map<string, ReturnType<typeof setInterval>>());
  /** codes registered with the transport during this tab generation (drives rejoin logic) */
  const registered = useRef(new Set<string>());
  /** restored-from-vault blob ids per code — eligible for re-decryption after a key re-wrap */
  const restoredIds = useRef(new Map<string, Set<string>>());
  /** every fingerprint this device has ever sent from (public material — see vault-db meta) */
  const myFps = useRef(new Set<string>());
  const restoreKick = useRef(false);
  /** photoId -> burn timer — photos are RAM-only with a hard TTL */
  const photoTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** how long decrypted photo bytes survive in RAM before they burn */
  const PHOTO_TTL_MS = 60_000;

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
        // optimistic entries carry client UUIDs and history rows reuse the
        // same id now — (senderFp, counter) is the stable logical identity.
        // Sealed/failed placeholders yield to a real decryption of the same
        // logical message (full-history resync replaces them in place).
        const incomingIds = new Set(incoming.map((m) => m.id));
        const incomingPairs = new Set(
          incoming.map((m) => (m.counter === undefined ? null : `${m.senderFp}:${m.counter}`))
        );
        const kept = s.messages.filter((m) => {
          if (m.sealed || m.failed) {
            if (incomingIds.has(m.id)) return false;
            if (m.counter !== undefined && incomingPairs.has(`${m.senderFp}:${m.counter}`)) return false;
          }
          return true;
        });
        const knownIds = new Set(kept.map((m) => m.id));
        const knownPairs = new Set(
          kept.map((m) => (m.counter === undefined ? null : `${m.senderFp}:${m.counter}`))
        );
        const fresh = incoming.filter((m) => {
          if (knownIds.has(m.id)) return false;
          if (m.counter !== undefined && knownPairs.has(`${m.senderFp}:${m.counter}`)) return false;
          return true;
        });
        if (fresh.length === 0) return kept.length === s.messages.length ? s : { ...s, messages: sortMessages(kept) };
        return { ...s, messages: sortMessages([...kept, ...fresh]) };
      })
    );
  }, []);

  /**
   * Decrypt one wire blob. Key held -> decrypt (no timestamp gate: the user
   * requirement is that EVERY member holding the session key sees the whole
   * conversation — the server only ever held ciphertext, so this reveals
   * nothing the server could). No key -> sealed until a member wraps it over.
   */
  const decryptWire = useCallback(
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
      if (!key) return base; // sealed: key not on this device yet
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
    async (code: string, requestedFps?: string[], liveMembers?: Record<string, string>) => {
      const identity = identityRef.current;
      const key = getSessionKey(code);
      if (!identity || !key || !hasSessionKey(code)) return;

      const view = sessionsRef.current.find((s) => s.code === code);
      if (!view) return;

      // use the live list from the transport event when provided — the state
      // mirror lags one render behind and would drop first-contact members.
      // The live roster merges over it so the wrap never depends on stale state.
      const members = { ...view.members, ...(liveMembers ?? {}) };
      const online = requestedFps ?? view.presence;
      const targets = online.filter((fp) => fp !== identity.fingerprint);
      if (targets.length === 0) return;

      const sent = wrappedFor.current.get(code) ?? new Set<string>();
      for (const fp of targets) {
        if (sent.has(fp) || !members[fp]) continue;
        try {
          const envelope = await wrapSessionKeyFor(identity, key, code, members[fp], fp);
          sent.add(fp);
          wrappedFor.current.set(code, sent);
          // persisted for offline pickup — the target's poll delivers it
          await transport.postKey(code, envelope, identity.fingerprint);
        } catch {
          sent.delete(fp);
        }
      }
    },
    []
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
        pending.map((w) => decryptWire(code, w, w.senderFp === me))
      );
      appendMessages(code, entries);
      // everyone holding the key sees the WHOLE chat — re-pull the full
      // transcript so pre-key blobs are re-delivered decryptable and replace
      // their sealed placeholders in place (dedupe handled by appendMessages)
      transport.resync(code);
    },
    [appendMessages, decryptWire, patchSession, revealRestoredHistory]
  );

  const startKeyPolling = useCallback(
    (code: string) => {
      if (keyPoll.current.has(code)) return;
      const poll = setInterval(() => {
        const identity = identityRef.current;
        if (!identity || hasSessionKey(code)) {
          const t = keyPoll.current.get(code);
          if (t) clearInterval(t);
          keyPoll.current.delete(code);
          return;
        }
        // ask holders to wrap the session key for us (envelopes arrive via sync)
        void transport.requestKey(code, identity.fingerprint).catch(() => undefined);
      }, 5000);
      keyPoll.current.set(code, poll);
    },
    []
  );

  // --------------------------------------------------------- transport wiring

  const onPresence = useCallback(
    (data: { code: string; fingerprints: string[]; members: Record<string, string> }) => {
      if (!CODE_RE.test(data.code)) return;
      setSessions((prev) =>
        prev.map((s) =>
          s.code === data.code
            ? { ...s, presence: data.fingerprints, members: { ...s.members, ...data.members } }
            : s
        )
      );
      // newcomer appeared -> holders wrap a key for them (live list, not state)
      if (identityRef.current && data.fingerprints.includes(identityRef.current.fingerprint)) {
        void wrapForKeylessMembers(data.code, data.fingerprints);
      }
    },
    [wrapForKeylessMembers]
  );

  const onMessages = useCallback(
    (data: { code: string; messages: WireMessage[]; initial: boolean }) => {
      const { code, messages, initial } = data;
      if (!CODE_RE.test(code) || messages.length === 0) return;
      const fresh = messages.filter((w) => markSeen(code, w.id));
      if (fresh.length === 0) return;
      for (const w of fresh) observeCounter(code, w.counter);
      void vault.saveWire(code, fresh); // data-saving: ciphertext at rest (no keys)

      const me = identityRef.current?.fingerprint;
      void (async () => {
        const entries = await Promise.all(
          fresh.map((w) => decryptWire(code, w, w.senderFp === me))
        );
        appendMessages(code, entries);
        const keyHeld = hasSessionKey(code);
        for (let i = 0; i < fresh.length; i++) {
          const w = fresh[i];
          const entry = entries[i];
          const mine = w.senderFp === me;
          if (entry.sealed && !mine && !keyHeld) {
            stashPending(code, { ...w, code });
          }
        }
        if (!initial) {
          const notMine = fresh.filter((w) => w.senderFp !== me).length;
          if (notMine > 0 && activeCodeRef.current !== code) {
            patchSession(code, (s) => ({ unread: s.unread + notMine }));
          }
        }
      })();
    },
    [appendMessages, decryptWire, patchSession]
  );

  const onKey = useCallback(
    (data: { code: string; envelopes: WireEnvelope[] }) => {
      void (async () => {
        const identity = identityRef.current;
        if (!identity) return;
        for (const envelope of data.envelopes) {
          if (envelope.forFp !== identity.fingerprint || hasSessionKey(data.code)) continue;
          try {
            const raw = await unwrapSessionKey(identity, data.code, envelope);
            await adoptSessionKey(data.code, raw);
            return; // key adopted — stop trying more envelopes
          } catch {
            /* wrong generation — a later request will get a fresh envelope */
          }
        }
      })();
    },
    [adoptSessionKey]
  );

  const onKeyRequest = useCallback(
    (data: { code: string; fingerprints: string[]; members: Record<string, string> }) => {
      if (!CODE_RE.test(data.code)) return;
      const me = identityRef.current?.fingerprint;
      const targets = data.fingerprints.filter((fp) => fp !== me);
      if (targets.length === 0) return;
      void wrapForKeylessMembers(data.code, targets, data.members);
    },
    [wrapForKeylessMembers]
  );

  /**
   * Ephemeral photo arrived: decrypt straight into RAM, never touch disk.
   * No key yet -> the photo is DROPPED by design (photos are never stored,
   * not even sealed — there is nothing on the server to fetch later).
   */
  const onPhoto = useCallback(
    (data: { code: string; photos: { id: string; senderFp: string; counter: number; iv: string; data: string; createdAt: string }[] }) => {
      void (async () => {
        const { code, photos } = data;
        if (!CODE_RE.test(code) || photos.length === 0) return;
        const key = getSessionKey(code);
        const me = identityRef.current?.fingerprint;
        for (const p of photos) {
          if (!markSeen(code, `ph:${p.id}`)) continue;
          observeCounter(code, p.counter);
          if (!key) return; // dropped — never queued, never persisted
          let bytes: Uint8Array;
          try {
            bytes = await decryptPhoto(key, code, p.senderFp, p.counter, p.iv, p.data);
          } catch {
            continue; // tampered or foreign blob — vanish silently
          }
          stashPhoto(code, p.id, bytes);
          const timer = setTimeout(() => {
            burnPhoto(p.id);
            photoTimers.current.delete(p.id);
          }, PHOTO_TTL_MS);
          photoTimers.current.set(p.id, timer);
          const mine = p.senderFp === me;
          appendMessages(code, [
            {
              id: p.id,
              code,
              senderFp: p.senderFp,
              mine,
              text: "",
              ts: Date.parse(p.createdAt) || Date.now(),
              createdAt: p.createdAt,
              counter: p.counter,
              kind: "photo",
              photoId: p.id,
            },
          ]);
          if (!mine && activeCodeRef.current !== code) {
            patchSession(code, (s) => ({ unread: s.unread + 1 }));
          }
        }
      })();
    },
    [appendMessages, patchSession]
  );

  const onTerminated = useCallback((data: { code: string }) => {
    if (!data || !CODE_RE.test(data.code)) return;
    const code = data.code;
    const wasOpen = sessionsRef.current.some((s) => s.code === code);
    purgeSession(code); // also zeroes the session's photo bytes
    const poll = keyPoll.current.get(code);
    if (poll) clearInterval(poll);
    keyPoll.current.delete(code);
    for (const [pid, t] of photoTimers.current) {
      clearTimeout(t);
      photoTimers.current.delete(pid);
    }
    wrappedFor.current.delete(code);
    registered.current.delete(code);
    restoredIds.current.delete(code);
    void vault.forgetSession(code); // wipe local vault rows too
    setSessions((prev) => prev.filter((s) => s.code !== code));
    setActiveCode((cur) => (cur === code ? null : cur));
    if (wasOpen) {
      toast.success(`Session ${code} was deleted for everyone`);
    }
  }, []);

  useEffect(() => {
    if (phase !== "app") return;
    const offs = [
      transport.on("presence", onPresence),
      transport.on("messages", onMessages),
      transport.on("key", onKey),
      transport.on("keyrequest", onKeyRequest),
      transport.on("photo", onPhoto),
      transport.on("terminated", onTerminated),
    ];
    return () => offs.forEach((off) => off());
  }, [phase, onPresence, onMessages, onKey, onKeyRequest, onPhoto, onTerminated]);

  // ---------------------------------------------------------------- actions

  const registerAndJoinRoom = useCallback(
    async (code: string, opts: { create?: boolean } = {}) => {
      const identity = await ensureIdentity();
      identityRef.current = identity;
      setIdentityFp(identity.fingerprint);

      setConnecting(true);
      try {
        // registers the participant + starts the sync loop (throws when the
        // room does not exist and we are not its creator)
        const { members } = await transport.join(code, identity.fingerprint, identity.publicB64, {
          create: opts.create,
        });
        registered.current.add(code);
        return { members, fingerprint: identity.fingerprint };
      } finally {
        setConnecting(false);
      }
    },
    []
  );

  const startSession = useCallback(async () => {
    const code = generateCode();
    const key = generateSessionKey();
    storeSessionKey(code, key);
    void vault.markKeyHeld(code);
    const { members } = await registerAndJoinRoom(code, { create: true });
    setSessions((prev) => [
      ...prev,
      {
        code,
        createdAt: new Date().toISOString(),
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

      const identity = await ensureIdentity();
      identityRef.current = identity;
      setIdentityFp(identity.fingerprint);

      // registers + starts the sync loop; throws "Session not found (404)"
      // when the room does not exist
      const { members } = await registerAndJoinRoom(code, { create: false });
      const alreadyHasKey = hasSessionKey(code) || sessionsRef.current.some((s) => s.code === code && s.hasKey);

      if (!alreadyHasKey) {
        // announce + ask holders to wrap the session key for us
        void transport.requestKey(code, identity.fingerprint).catch(() => undefined);
        startKeyPolling(code);
      }

      setSessions((prev) => {
        if (prev.some((s) => s.code === code)) return prev;
        return [
          ...prev,
          {
            code,
            createdAt: new Date().toISOString(),
            members,
            presence: [identity.fingerprint],
            messages: [],
            hasKey: alreadyHasKey,
            unread: 0,
          },
        ];
      });
      setActiveCode(code);
      return code;
    },
    [registerAndJoinRoom, startKeyPolling]
  );

  const openSession = useCallback(
    async (code: string) => {
      patchSession(code, { unread: 0 });
      setActiveCode(code);
      const identity = identityRef.current;
      if (!identity) return;

      // restored sessions (post-reload) may not be registered with the
      // transport yet — join now so a member can re-wrap the key to this device
      if (!registered.current.has(code) || !transport.isJoined(code)) {
        try {
          await registerAndJoinRoom(code);
          if (!hasSessionKey(code)) {
            void transport.requestKey(code, identity.fingerprint).catch(() => undefined);
            startKeyPolling(code);
          }
        } catch {
          /* offline — sealed transcript still viewable */
        }
      }
    },
    [patchSession, registerAndJoinRoom, startKeyPolling]
  );

  const closeSession = useCallback(
    (code: string) => {
      // leaving a session DESTROYS our local key material — rejoining later
      // requires a fresh wrap from a member still inside.
      transport.leave(code);
      purgeSession(code); // zeroes keys + photo bytes
      const poll = keyPoll.current.get(code);
      if (poll) clearInterval(poll);
      keyPoll.current.delete(code);
      for (const [pid, t] of photoTimers.current) {
        clearTimeout(t);
        photoTimers.current.delete(pid);
      }
      wrappedFor.current.delete(code);
      registered.current.delete(code);
      restoredIds.current.delete(code);
      void vault.forgetSession(code); // a closed session should not resurrect after reload
      setSessions((prev) => prev.filter((s) => s.code !== code));
      setActiveCode((cur) => (cur === code ? null : cur));
    },
    []
  );

  const deleteSession = useCallback(async (code: string) => {
    const identity = identityRef.current;
    restoredIds.current.delete(code);
    void vault.forgetSession(code);
    purgeSession(code); // zero local keys + photo bytes immediately
    // soft-terminate server-side; every member's next sync evicts itself
    try {
      await transport.terminate(code, identity?.fingerprint ?? "00000000");
    } catch {
      /* room may already be gone — local wipe still applies */
    }
  }, []);

  /**
   * Take a photo -> encrypt -> sync. NOTHING is persisted: no DB row, no
   * vault blob, no wire cache. Only RAM on the devices currently in the room.
   */
  const sendPhoto = useCallback(
    async (code: string, bytes: Uint8Array) => {
      const identity = identityRef.current;
      const key = getSessionKey(code);
      if (!identity || !key) throw new Error("Session key not available yet.");

      const counter = nextCounter(code);
      const enc = await encryptPhoto(key, code, identity.fingerprint, counter, bytes);
      const createdAt = new Date().toISOString();

      stashPhoto(code, enc.id, bytes); // sender keeps its own RAM copy
      const timer = setTimeout(() => {
        burnPhoto(enc.id);
        photoTimers.current.delete(enc.id);
      }, PHOTO_TTL_MS);
      photoTimers.current.set(enc.id, timer);

      appendMessages(code, [
        {
          id: enc.id,
          code,
          senderFp: identity.fingerprint,
          mine: true,
          text: "",
          ts: Date.now(),
          createdAt,
          counter,
          kind: "photo",
          photoId: enc.id,
        },
      ]);

      // RAM-only relay with a 60s server TTL — it forwards, then forgets
      await transport.postPhoto(
        code,
        {
          id: enc.id,
          senderFp: identity.fingerprint,
          counter: enc.counter,
          iv: enc.iv,
          data: enc.data,
          createdAt,
        },
        identity.fingerprint
      );
    },
    [appendMessages]
  );

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

      try {
        // the sync response doubles as an instant delta poll — everyone
        // else picks this message up on their very next sync tick
        await transport.postMessage(
          code,
          {
            id: wire.id,
            senderFp: wire.senderFp,
            counter: wire.counter,
            iv: wire.iv,
            ciphertext: wire.ciphertext,
          },
          identity.fingerprint
        );
      } catch (err) {
        // roll back the optimistic bubble — never fake a delivery
        setSessions((prev) =>
          prev.map((s) =>
            s.code === code ? { ...s, messages: s.messages.filter((m) => m.id !== id) } : s
          )
        );
        throw err;
      }

      void vault.saveWire(code, [wire]);
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

  // gentle safety: resync the open session when the tab regains focus
  useEffect(() => {
    if (phase !== "app" || !activeCode) return;
    const code = activeCode;
    const onFocus = () => transport.wake();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [phase, activeCode]);

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
        const identity = identityRef.current;
        if (!identity) return;
        try {
          // registers + verifies the room still exists (404 -> gone for everyone)
          const { members } = await transport.join(row.code, identity.fingerprint, identity.publicB64, {
            create: false,
          });
          setSessions((prev) =>
            prev.some((s) => s.code === row.code)
              ? prev
              : [
                  ...prev,
                  {
                    code: row.code,
                    createdAt: row.createdAt,
                    members,
                    presence: [],
                    messages: [],
                    hasKey: false,
                    unread: row.unread,
                  },
                ]
          );
          registered.current.add(row.code);
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

      // reconnect every restored room (key request + polling)
      for (const row of stored) {
        if (!hasSessionKey(row.code)) {
          try {
            await transport.requestKey(row.code, identityFp);
          } catch {
            /* stay sealed; opening the session manually retries */
          }
          startKeyPolling(row.code);
        }
      }
    },
    [appendMessages, startKeyPolling]
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
    sendPhoto,
    setActiveCode,
  };
}
