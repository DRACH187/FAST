/**
 * FAST relay — in-process socket.io server (Layer 2)
 * ===================================================
 * The encrypted backbone: a BLIND router that moves opaque ciphertext between
 * the browsers of a session room. It never sees plaintext and holds no
 * persistent state — rooms exist only while sockets are connected.
 *
 * Hosted inside the Next.js server process via src/instrumentation.ts so the
 * relay shares the dev server's lifecycle (no orphan process to babysit).
 * The identical standalone deployment lives in mini-services/chat-service
 * (bun + socket.io, port 3003) for production use behind its own supervisor.
 */

import { createServer, type Server as HttpServer } from "http";
import type { Server as IoServer } from "socket.io";

const CODE_RE = /^[A-Z]{6}$/;
const FP_RE = /^[a-f0-9]{8,64}$/;
const MAX_CIPHERTEXT = 8 * 1024; // base64 ciphertext per message
const MAX_B64 = 2 * 1024; // IVs / wrapped keys / pubkeys are tiny
const MAX_PHOTO_B64 = 1_600_000; // ephemeral encrypted photos (RAM-only relay)

type Envelope = {
  code: string;
  id: string;
  senderFp: string;
  counter: number;
  iv: string;
  ciphertext: string;
  createdAt: string;
};

// room -> (socketId -> fingerprint)
const rooms = new Map<string, Map<string, string>>();
// socketId -> Set<room>
const memberships = new Map<string, Set<string>>();

function presenceFor(code: string): string[] {
  const room = rooms.get(code);
  return room ? Array.from(new Set(room.values())) : [];
}

let started = false;

export function startRelay(port = Number(process.env.RELAY_PORT ?? 3003)): void {
  if (started) return;
  started = true;

  void (async () => {
    const { Server } = await import("socket.io");

    const httpServer: HttpServer = createServer();
    const io: IoServer = new Server(httpServer, {
      // DO NOT change the path — Caddy's XTransformPort gateway forwards here
      path: "/",
      cors: { origin: "*", methods: ["GET", "POST"] },
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 2 * 1024 * 1024, // messages are tiny; photos ride the same pipe
    });

    function emitPresence(code: string) {
      io.to(code).emit("session:presence", { code, fingerprints: presenceFor(code) });
    }

    function joinRoom(socketId: string, code: string, fingerprint: string) {
      let room = rooms.get(code);
      if (!room) {
        room = new Map();
        rooms.set(code, room);
      }
      room.set(socketId, fingerprint);
      let set = memberships.get(socketId);
      if (!set) {
        set = new Set();
        memberships.set(socketId, set);
      }
      set.add(code);
    }

    function leaveRoom(socketId: string, code: string) {
      rooms.get(code)?.delete(socketId);
      memberships.get(socketId)?.delete(code);
      if (rooms.get(code)?.size === 0) rooms.delete(code);
      if (memberships.get(socketId)?.size === 0) memberships.delete(socketId);
    }

    io.on("connection", (socket) => {
      console.log(`[relay] connect ${socket.id}`);

      socket.on("session:join", (data: { code: string; fingerprint: string }) => {
        if (!data || !CODE_RE.test(data.code) || !FP_RE.test(data.fingerprint)) return;
        joinRoom(socket.id, data.code, data.fingerprint);
        socket.join(data.code);
        emitPresence(data.code);
        console.log(`[relay] join ${data.fingerprint} -> ${data.code}`);
      });

      socket.on("session:leave", (data: { code: string }) => {
        if (!data || !CODE_RE.test(data.code)) return;
        socket.leave(data.code);
        leaveRoom(socket.id, data.code);
        emitPresence(data.code);
      });

      // Encrypted message relay — broadcast to the room (sender dedupes by id)
      socket.on("session:message", (env: Envelope) => {
        if (!env || !CODE_RE.test(env.code)) return;
        if (typeof env.id !== "string" || env.id.length > 64) return;
        if (!FP_RE.test(env.senderFp)) return;
        if (typeof env.counter !== "number" || env.counter < 0 || env.counter > 1e9) return;
        if (typeof env.iv !== "string" || env.iv.length > MAX_B64) return;
        if (typeof env.ciphertext !== "string" || env.ciphertext.length > MAX_CIPHERTEXT) return;
        socket.to(env.code).emit("session:message", env);
      });

      // Wrapped session-key envelope — routed to the room, clients filter by forFp
      socket.on(
        "session:key",
        (data: { code: string; envelope: { forFp: string; epk: string; iv: string; payload: string; fromFp: string } }) => {
          if (!data || !CODE_RE.test(data.code) || !data.envelope) return;
          const e = data.envelope;
          if (!FP_RE.test(e.forFp) || !FP_RE.test(e.fromFp)) return;
          if (typeof e.epk !== "string" || e.epk.length > MAX_B64) return;
          if (typeof e.iv !== "string" || e.iv.length > MAX_B64) return;
          if (typeof e.payload !== "string" || e.payload.length > MAX_B64) return;
          socket.to(data.code).emit("session:key", { code: data.code, envelope: e });
        }
      );

      // A member without the session key asks holders to wrap one for it
      socket.on("session:keyrequest", (data: { code: string; fingerprint: string }) => {
        if (!data || !CODE_RE.test(data.code) || !FP_RE.test(data.fingerprint)) return;
        socket.to(data.code).emit("session:keyrequest", {
          code: data.code,
          fingerprint: data.fingerprint,
        });
      });

      // Ephemeral photo relay — base64 ciphertext broadcast to the room.
      // RAM-ONLY: this server keeps zero copies; it forwards and forgets.
      socket.on(
        "session:photo",
        (p: { code: string; id: string; senderFp: string; counter: number; iv: string; data: string; createdAt: string }) => {
          if (!p || !CODE_RE.test(p.code)) return;
          if (typeof p.id !== "string" || p.id.length > 64) return;
          if (!FP_RE.test(p.senderFp)) return;
          if (typeof p.counter !== "number" || p.counter < 0 || p.counter > 1e9) return;
          if (typeof p.iv !== "string" || p.iv.length > 512) return;
          if (typeof p.data !== "string" || p.data.length < 16 || p.data.length > MAX_PHOTO_B64) return;
          if (typeof p.createdAt !== "string" || p.createdAt.length > 40) return;
          socket.to(p.code).emit("session:photo", p);
        }
      );

      // Fired by the deleting client AFTER the DELETE API succeeded.
      // Everyone in the room is evicted — the session ceases to exist for all.
      socket.on("session:terminated", (data: { code: string }) => {
        if (!data || !CODE_RE.test(data.code)) return;
        io.to(data.code).emit("session:terminated", { code: data.code });
        const room = rooms.get(data.code);
        if (room) {
          for (const socketId of Array.from(room.keys())) {
            io.in(socketId).socketsLeave(data.code);
            leaveRoom(socketId, data.code);
          }
        }
        console.log(`[relay] terminated ${data.code}`);
      });

      socket.on("disconnect", () => {
        const set = memberships.get(socket.id);
        if (set) {
          for (const code of Array.from(set)) {
            leaveRoom(socket.id, code);
            emitPresence(code);
          }
        }
        console.log(`[relay] disconnect ${socket.id}`);
      });

      socket.on("error", (error) => {
        console.error(`[relay] error ${socket.id}:`, error);
      });
    });

    // bind with retries (the port may be in TIME_WAIT after a restart)
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (err: Error) => reject(err);
          httpServer.once("error", onError);
          httpServer.listen(port, () => {
            httpServer.off("error", onError);
            resolve();
          });
        });
        console.log(`[relay] FAST secure-session relay listening on ${port}`);
        return;
      } catch (err) {
        console.error(`[relay] bind attempt ${attempt} failed:`, err);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    console.error("[relay] giving up after 10 bind attempts");
  })();
}
