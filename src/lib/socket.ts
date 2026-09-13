"use client";

import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

/**
 * Singleton socket connection to the Fast Guns realtime service.
 * Never put the port in the URL — Caddy forwards via XTransformPort.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io("/?XTransformPort=3003", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
  }
  return socket;
}
