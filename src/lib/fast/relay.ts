"use client";

import { io, type Socket } from "socket.io-client";

/**
 * Single shared relay connection for the whole tab.
 * One socket, many session rooms — this is what makes multiple
 * concurrent sessions cheap. All payloads are opaque ciphertext.
 */

let socket: Socket | null = null;

export function getRelay(): Socket {
  if (!socket) {
    socket = io("/?XTransformPort=3003", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });
  }
  return socket;
}
