"use client";

/**
 * FAST transport — HTTP sync client (replaces the socket.io relay)
 * ================================================================
 * Why: custom WebSocket servers don't exist on serverless hosts (Vercel), and
 * the sandbox-only gateway URL made deployed builds retry forever. The whole
 * transport is now ONE endpoint — POST /api/sessions/[code]/sync — which
 * carries presence, message/key/photo deltas, key requests and termination.
 *
 *  - one poll loop per open session (foreground ~1.6s, hidden ~6s)
 *  - every mutation (send msg/key/photo, keyreq) piggybacks a delta poll
 *  - full history on first sync of a session (cursor 0) -> everyone holding
 *    the session key sees the complete conversation
 *  - creator rooms self-heal across serverless cold starts (create re-assert)
 *  - exponential backoff on network errors; instant retry after sends
 *
 * Security invariant: only ciphertext + public material ever goes on the wire.
 */

import type { WireMessage } from "@/lib/fast/api";

export type WireEnvelope = {
  id: string;
  forFp: string;
  fromFp: string;
  epk: string;
  iv: string;
  payload: string;
};

export type WirePhoto = {
  id: string;
  senderFp: string;
  counter: number;
  iv: string;
  data: string;
  createdAt: string;
};

/** M1: a peer's write-once signing public key ("ed25519:..." | "ecdsa-p256:..."). */
export type WireSignKey = { fingerprint: string; signPub: string };

type Cursors = { msg: number; env: number; photo: number };

export type RosterEntry = { fingerprint: string; nickname: string; role: string };

type DeltaBody = {
  ok?: boolean;
  alive?: boolean;
  terminated?: boolean;
  /** true when the termination came from the 5h retention window */
  expired?: boolean;
  createdAt?: string;
  expiresAt?: string;
  serverNow?: string;
  cursor?: Cursors;
  presence?: string[];
  members?: { fingerprint: string; publicKey: string }[];
  roster?: RosterEntry[];
  signKeys?: WireSignKey[];
  keyRequests?: string[];
  messages?: WireMessage[];
  envelopes?: WireEnvelope[];
  photos?: WirePhoto[];
  error?: string;
};

export type SessionMeta = { createdAt: string; expiresAt: string };

export type TransportEvents = {
  presence: {
    code: string;
    fingerprints: string[];
    members: Record<string, string>;
    roster: Record<string, { nickname: string; role: string }>;
    signKeys?: WireSignKey[];
  };
  messages: { code: string; messages: WireMessage[]; initial: boolean };
  key: { code: string; envelopes: WireEnvelope[] };
  keyrequest: { code: string; fingerprints: string[]; members: Record<string, string> };
  photo: { code: string; photos: WirePhoto[] };
  terminated: { code: string; reason: "deleted" | "expired" };
};

type EventName = keyof TransportEvents;

const POLL_ACTIVE_MS = 1600;
const POLL_HIDDEN_MS = 6000;
const MAX_BACKOFF_MS = 8000;
const DEAD_LIMIT = 3; // consecutive dead polls before declaring termination

class Transport {
  private handlers: { [K in EventName]: Set<(data: TransportEvents[K]) => void> } = {
    presence: new Set(),
    messages: new Set(),
    key: new Set(),
    keyrequest: new Set(),
    photo: new Set(),
    terminated: new Set(),
  };

  private cursors = new Map<string, Cursors>();
  private loop = new Map<string, boolean>(); // code -> running
  private timer = new Map<string, ReturnType<typeof setTimeout>>();
  private backoff = new Map<string, number>();
  private dead = new Map<string, number>();
  private seenPresence = new Map<string, string>(); // code -> last presence signature
  private info = new Map<
    string,
    { fp: string; publicKey: string; creator: boolean; attestation?: string }
  >();
  private meta = new Map<string, SessionMeta>(); // code -> retention window
  private skew = new Map<string, number>(); // code -> serverNow - Date.now() ms
  private pollingNow = new Set<string>();

  on<K extends EventName>(event: K, handler: (data: TransportEvents[K]) => void): () => void {
    this.handlers[event].add(handler);
    return () => this.handlers[event].delete(handler);
  }

  isJoined(code: string): boolean {
    return this.loop.get(code) === true;
  }

  /** Retention window for a session (from the last sync payload). */
  getMeta(code: string): SessionMeta | null {
    return this.meta.get(code) ?? null;
  }

  /** serverNow - localNow, so clients can correct countdowns for clock skew. */
  getSkew(code: string): number {
    return this.skew.get(code) ?? 0;
  }

  // ------------------------------------------------------------- lifecycle

  async join(
    code: string,
    fingerprint: string,
    publicKey: string,
    opts: {
      create?: boolean;
      nickname?: string;
      role?: string;
      attestation?: string;
      /** M1: this tab's signing public key (write-once slot on the server) */
      signPub?: string;
    } = {}
  ): Promise<{ alive: boolean; members: Record<string, string> }> {
    const body = await this.rpc(code, {
      action: "join",
      fingerprint,
      publicKey,
      create: opts.create === true,
      attestation: typeof opts.attestation === "string" ? opts.attestation.slice(0, 1024) : "",
      signPub: typeof opts.signPub === "string" ? opts.signPub.slice(0, 256) : undefined,
      cursors: this.cursors.get(code) ?? { msg: 0, env: 0, photo: 0 },
    });

    if (!body.alive) throw new Error("Session not found (404)");

    this.info.set(code, {
      fp: fingerprint,
      publicKey,
      creator: opts.create === true,
      attestation: opts.attestation,
    });
    this.dead.set(code, 0);
    this.backoff.set(code, 0);
    this.startLoop(code);
    return { alive: true, members: toMemberMap(body.members) };
  }

  leave(code: string) {
    this.stop(code);
    const rec = this.info.get(code);
    if (rec) {
      void this.rpc(code, { action: "leave", fingerprint: rec.fp }).catch(() => undefined);
    }
  }

  async terminate(code: string, fingerprint: string, attestation?: string) {
    this.stop(code);
    // H3: termination is creator/boss-only — the attestation rides along so
    // the server can authorize the actor
    await this.rpc(code, {
      action: "terminate",
      fingerprint,
      attestation: typeof attestation === "string" ? attestation.slice(0, 1024) : "",
    });
  }

  /** Re-pull the full transcript (used right after a key adoption so blobs
   *  that arrived pre-key are re-delivered decryptable and replace their
   *  sealed placeholders in place). */
  resync(code: string) {
    this.cursors.set(code, { msg: 0, env: 0, photo: 0 });
    void this.pollOnce(code);
  }

  stop(code: string) {
    this.loop.set(code, false);
    const t = this.timer.get(code);
    if (t) clearTimeout(t);
    this.timer.delete(code);
    this.cursors.delete(code);
    this.info.delete(code);
    this.backoff.delete(code);
    this.dead.delete(code);
    this.seenPresence.delete(code);
    this.meta.delete(code);
    this.skew.delete(code);
  }

  stopAll() {
    for (const code of [...this.loop.keys()]) this.stop(code);
  }

  /** Tab became visible again — poll every open room right now. */
  wake() {
    for (const code of [...this.loop.keys()]) {
      if (this.loop.get(code) && this.info.has(code)) void this.pollOnce(code);
    }
  }

  // ------------------------------------------------------------- mutations

  async postMessage(code: string, wire: Omit<WireMessage, "createdAt">, fingerprint: string) {
    const body = await this.rpc(code, {
      action: "msg",
      fingerprint,
      message: {
        id: wire.id,
        senderFp: wire.senderFp,
        counter: wire.counter,
        iv: wire.iv,
        ciphertext: wire.ciphertext,
        sig: typeof wire.sig === "string" ? wire.sig.slice(0, 1024) : undefined,
      },
    });
    this.dispatch(code, body);
    if (!body.alive) throw new Error("Session no longer exists (404)");
  }

  async postKey(code: string, envelope: Omit<WireEnvelope, "id">, fingerprint: string) {
    const body = await this.rpc(code, { action: "key", fingerprint, envelope });
    this.dispatch(code, body);
  }

  async requestKey(code: string, fingerprint: string) {
    const body = await this.rpc(code, { action: "keyreq", fingerprint });
    this.dispatch(code, body);
  }

  async postPhoto(code: string, photo: WirePhoto, fingerprint: string) {
    const body = await this.rpc(code, { action: "photo", fingerprint, photo });
    this.dispatch(code, body);
  }

  // ------------------------------------------------------------ poll engine

  private startLoop(code: string) {
    if (this.loop.get(code)) return;
    this.loop.set(code, true);
    this.schedule(code, 0);
  }

  private schedule(code: string, delay: number) {
    if (this.loop.get(code) !== true) return;
    const t = this.timer.get(code);
    if (t) clearTimeout(t);
    this.timer.set(
      code,
      setTimeout(() => {
        if (this.loop.get(code) !== true) return;
        void this.pollOnce(code);
      }, delay)
    );
  }

  private nextDelay(code: string): number {
    const err = this.backoff.get(code) ?? 0;
    if (err > 0) return err;
    return typeof document !== "undefined" && document.hidden ? POLL_HIDDEN_MS : POLL_ACTIVE_MS;
  }

  private async pollOnce(code: string) {
    if (this.pollingNow.has(code)) {
      this.schedule(code, POLL_ACTIVE_MS);
      return;
    }
    const rec = this.info.get(code);
    if (!rec) {
      this.stop(code);
      return;
    }
    this.pollingNow.add(code);
    try {
      const body = await this.rpc(code, {
        action: "sync",
        fingerprint: rec.fp,
        create: rec.creator, // self-heal creator rooms across cold starts
        cursors: this.cursors.get(code) ?? { msg: 0, env: 0, photo: 0 },
      });
      const wasInitial = (this.cursors.get(code)?.msg ?? 0) === 0;
      this.backoff.set(code, 0);
      this.dispatch(code, body, wasInitial);
      this.schedule(code, this.nextDelay(code));
    } catch {
      const step = (this.backoff.get(code) ?? 0) || 2000;
      this.backoff.set(code, Math.min(MAX_BACKOFF_MS, step * 2));
      this.schedule(code, this.nextDelay(code));
    } finally {
      this.pollingNow.delete(code);
    }
  }

  // -------------------------------------------------------------- dispatch

  private dispatch(code: string, body: DeltaBody, wasInitial = false) {
    if (!body || body.ok !== true) return;

    // retention-window metadata rides on every payload
    if (body.createdAt && body.expiresAt) {
      this.meta.set(code, { createdAt: body.createdAt, expiresAt: body.expiresAt });
    }
    if (body.serverNow) {
      const at = Date.parse(body.serverNow);
      if (Number.isFinite(at)) this.skew.set(code, at - Date.now());
    }

    if (body.terminated) {
      this.stop(code);
      this.handlers.terminated.forEach((h) =>
        h({ code, reason: body.expired ? "expired" : "deleted" })
      );
      return;
    }

    if (!body.alive) {
      // Unknown room. The creator re-provisions on its own next poll; a
      // joiner tries one re-join, then waits a few cycles before evicting
      // (protects against momentary serverless drift).
      const rec = this.info.get(code);
      if (rec?.creator) return; // next sync re-creates via create:true
      const n = (this.dead.get(code) ?? 0) + 1;
      this.dead.set(code, n);
      if (n === 1 && rec) {
        void this.join(code, rec.fp, rec.publicKey, { create: false }).catch(() => undefined);
      }
      if (n >= DEAD_LIMIT) {
        this.stop(code);
        // a vanished room with a known 5h deadline reads as expired
        this.handlers.terminated.forEach((h) => h({ code, reason: "deleted" }));
      }
      return;
    }
    this.dead.set(code, 0);

    if (body.cursor) this.cursors.set(code, body.cursor);

    if (body.presence) {
      const presence = body.presence;
      const members = toMemberMap(body.members);
      const roster: Record<string, { nickname: string; role: string }> = {};
      for (const r of body.roster ?? []) roster[r.fingerprint] = { nickname: r.nickname, role: r.role };
      const sig = `${presence.join("|")}#${Object.keys(members).sort().join(",")}#${Object.entries(roster)
        .map(([fp, n]) => `${fp}:${n.nickname}:${n.role}`)
        .sort()
        .join(",")}`;
      if (this.seenPresence.get(code) !== sig) {
        this.seenPresence.set(code, sig);
        this.handlers.presence.forEach((h) =>
          h({ code, fingerprints: presence, members, roster, signKeys: body.signKeys })
        );
      }
    }

    if (body.keyRequests && body.keyRequests.length > 0) {
      // NOTE: no dedupe here on purpose — holders dedupe via their own
      // wrapped-sets, and repeat requests are the retry path when the first
      // wrap attempt raced the roster update. The live roster piggybacks so
      // the wrap never depends on stale client state.
      const members = toMemberMap(body.members);
      for (const h of this.handlers.keyrequest) {
        h({ code, fingerprints: body.keyRequests, members });
      }
    }

    if (body.envelopes && body.envelopes.length > 0) {
      this.handlers.key.forEach((h) => h({ code, envelopes: body.envelopes as WireEnvelope[] }));
    }

    if (body.messages && body.messages.length > 0) {
      for (const h of this.handlers.messages) h({ code, messages: body.messages, initial: wasInitial });
    }

    if (body.photos && body.photos.length > 0) {
      this.handlers.photo.forEach((h) => h({ code, photos: body.photos as WirePhoto[] }));
    }
  }

  // ------------------------------------------------------------------- rpc

  private async rpc(code: string, payload: Record<string, unknown>): Promise<DeltaBody> {
    const res = await fetch(`/api/sessions/${encodeURIComponent(code)}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as DeltaBody;
    if (!res.ok || data.ok !== true) {
      const message =
        typeof data.error === "string" && data.error.length <= 120
          ? data.error
          : `Sync failed (${res.status})`;
      throw new Error(message);
    }
    return data;
  }
}

function toMemberMap(members?: { fingerprint: string; publicKey: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of members ?? []) out[m.fingerprint] = m.publicKey;
  return out;
}

/** Tab-wide singleton — one transport, many session rooms. */
export const transport = new Transport();

if (typeof window !== "undefined") {
  // battery-friendly: slow polling in hidden tabs, instant catch-up on return
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      transport.wake();
    }
  });
}
