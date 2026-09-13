import { createServer } from "http";
import { Server } from "socket.io";

const httpServer = createServer();

const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: "/",
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

type ChatMessage = {
  id: string;
  content: string;
  author: string;
  channelId: string;
  channelSlug: string;
  createdAt: string;
};

let onlineCount = 0;

io.on("connection", (socket) => {
  onlineCount++;
  io.emit("presence", { count: onlineCount });
  console.log(`[connect] ${socket.id} — online: ${onlineCount}`);

  // Fired by a client AFTER its message was persisted via the Next.js API.
  // Broadcast to everyone else (the sender already appended it locally).
  socket.on("chat:message", (msg: ChatMessage) => {
    if (
      !msg ||
      typeof msg.content !== "string" ||
      typeof msg.author !== "string" ||
      typeof msg.channelSlug !== "string" ||
      msg.content.length > 2000
    ) {
      return;
    }
    socket.broadcast.emit("chat:message", msg);
  });

  // Typing indicator relay
  socket.on(
    "chat:typing",
    (data: { channelSlug: string; author: string; isTyping: boolean }) => {
      if (!data || typeof data.channelSlug !== "string" || typeof data.author !== "string")
        return;
      socket.broadcast.emit("chat:typing", {
        channelSlug: data.channelSlug,
        author: data.author,
        isTyping: !!data.isTyping,
      });
    }
  );

  socket.on("disconnect", () => {
    onlineCount = Math.max(0, onlineCount - 1);
    io.emit("presence", { count: onlineCount });
    console.log(`[disconnect] ${socket.id} — online: ${onlineCount}`);
  });

  socket.on("error", (error) => {
    console.error(`[error] ${socket.id}:`, error);
  });
});

const PORT = 3003;
httpServer.listen(PORT, () => {
  console.log(`[chat-service] Fast Guns realtime server running on port ${PORT}`);
});

process.on("SIGTERM", () => {
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  httpServer.close(() => process.exit(0));
});
