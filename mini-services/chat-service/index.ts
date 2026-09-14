import { createServer } from "http";
import { Server } from "socket.io";

/**
 * FAST secure-session relay
 * -------------------------
 * A DUMB, BLIND relay. It never sees plaintext:
 *  - clients publish AES-256-GCM ciphertext blobs (messages)
 *  - clients publish per-recipient wrapped session keys (key envelopes)
 *  - this server only routes blobs between sockets in a session room
 *
 * Transport hardening: socket.io with per-message payload validation,
 * strict size caps, and room isolation. In production this sits behind
 * the Caddy gateway (TLS termination) — all client traffic uses wss.
 */

const httpServer = createServer();

const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request
  path: "/",
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 64 * 1024, // ciphertext blobs are small; reject whoppers
});

const CODE_RE = /^[A-Z]{6}$/;
const FP_RE = /^[a-f0-9]{8,64}$/;
const MAX_CIPHERTEXT = 8 * 1024; // ~8KB of base64 ciphertext per message
const MAX_B64 = 2 * 1024; // IVs / wrapped keys / pubkeys are tiny
const MAX_MSG_JSON = 16 * 1024; // hard cap on any single relayed frame

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
  console.log(`[connect] ${socket.id}`);

  socket.on("session:join", (data: { code: string; fingerprint: string }) => {
    if (!data || !CODE_RE.test(data.code) || !FP_RE.test(data.fingerprint)) return;
    joinRoom(socket.id, data.code, data.fingerprint);
    socket.join(data.code);
    emitPresence(data.code);
    console.log(`[join] ${data.fingerprint} -> ${data.code}`);
  });

  socket.on("session:leave", (data: { code: string }) => {
    if (!data || !CODE_RE.test(data.code)) return;
    socket.leave(data.code);
    leaveRoom(socket.id, data.code);
    emitPresence(data.code);
  });

  // Encrypted message relay — broadcast to the room (sender dedupes by id)
  socket.on("session:message", (env: Envelope) => {
    if (!env || !CODE_RE.test(env.code)) return console.log(`[drop] bad code`);
    if (typeof env.id !== "string" || env.id.length > 64) return console.log(`[drop] bad id`);
    if (!FP_RE.test(env.senderFp)) return console.log(`[drop] bad fp: ${String(env.senderFp).slice(0, 20)}`);
    if (typeof env.counter !== "number" || env.counter < 0 || env.counter > 1e9) return console.log(`[drop] bad counter`);
    if (typeof env.iv !== "string" || env.iv.length > MAX_B64) return console.log(`[drop] bad iv`);
    if (typeof env.ciphertext !== "string" || env.ciphertext.length > MAX_CIPHERTEXT) return console.log(`[drop] bad ct len`);
    console.log(`[relay-msg] ${env.id.slice(0, 8)} room=${env.code} from=${env.senderFp.slice(0, 8)} members=${rooms.get(env.code)?.size ?? 0}`);
    socket.to(env.code).emit("session:message", env);
  });

  // A member that holds no session key yet asks holders to wrap one for it.
  socket.on("session:keyrequest", (data: { code: string; fingerprint: string }) => {
    if (!data || !CODE_RE.test(data.code) || !FP_RE.test(data.fingerprint)) return;
    socket.to(data.code).emit("session:keyrequest", {
      code: data.code,
      fingerprint: data.fingerprint,
    });
  });

  // Wrapped session-key envelope — routed to the whole room, clients filter by forFp
  socket.on("session:key", (data: { code: string; envelope: { forFp: string; epk: string; iv: string; payload: string; fromFp: string } }) => {
    if (!data || !CODE_RE.test(data.code) || !data.envelope) return;
    const e = data.envelope;
    if (!FP_RE.test(e.forFp) || !FP_RE.test(e.fromFp)) return;
    if (typeof e.epk !== "string" || e.epk.length > MAX_B64) return;
    if (typeof e.iv !== "string" || e.iv.length > MAX_B64) return;
    if (typeof e.payload !== "string" || e.payload.length > MAX_B64) return;
    socket.to(data.code).emit("session:key", { code: data.code, envelope: e });
  });

  // Fired by the deleting client AFTER the DELETE API succeeded.
  // Everyone in the room is evicted — the session ceases to exist for all users.
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
    console.log(`[terminated] ${data.code}`);
  });

  socket.on("disconnect", () => {
    const set = memberships.get(socket.id);
    if (set) {
      for (const code of Array.from(set)) {
        leaveRoom(socket.id, code);
        emitPresence(code);
      }
    }
    console.log(`[disconnect] ${socket.id}`);
  });

  socket.on("error", (error) => {
    console.error(`[error] ${socket.id}:`, error);
  });
});

const PORT = 3003;
httpServer.listen(PORT, () => {
  console.log(`[relay] FAST secure-session relay listening on ${PORT}`);
});

process.on("SIGTERM", () => {
  console.log("[relay] SIGTERM");
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.log("[relay] SIGINT");
  httpServer.close(() => process.exit(0));
});
process.on("uncaughtException", (err) => {
  console.error("[relay] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[relay] unhandledRejection:", reason);
});
