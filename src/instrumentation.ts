/**
 * Next.js instrumentation hook.
 * Boots the encrypted relay (socket.io, port 3003) inside this server
 * process — one service, one lifecycle, zero orphan daemons.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startRelay } = await import("@/lib/relay-server");
    startRelay();
  }
}
