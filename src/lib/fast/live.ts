"use client";

/**
 * Site-wide LIVE presence — heartbeat client.
 * POSTs a heartbeat every ~8s while the app phase is active and exposes the
 * online roster (callsign + role + since). One module-level store keeps every
 * consumer in sync without duplicated poll loops.
 */

import { useSyncExternalStore } from "react";
import type { Role } from "@/lib/fast/identity-store";

export type LiveUser = { fp: string; nickname: string; role: Role; since: number };

type LiveState = {
  online: LiveUser[];
  count: number;
  error: boolean;
};

let state: LiveState = { online: [], count: 0, error: false };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let heartbeatInFlight = false;

let myFp = "";
let myToken = "";

function notify() {
  for (const l of listeners) l();
}

function setState(patch: Partial<LiveState>) {
  state = { ...state, ...patch };
  notify();
}

export function configureHeartbeat(fp: string, token: string): void {
  myFp = fp;
  myToken = token;
}

async function beat(): Promise<void> {
  if (!myFp || heartbeatInFlight) return;
  heartbeatInFlight = true;
  try {
    const res = await fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint: myFp, token: myToken }),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      count?: number;
      online?: { fp: string; nickname: string; role: string; since: number }[];
    };
    if (res.ok && data.ok === true && Array.isArray(data.online)) {
      setState({
        online: data.online.map((u) => ({
          fp: u.fp,
          nickname: String(u.nickname).slice(0, 24),
          role: u.role === "boss" ? "boss" : "member",
          since: Number(u.since) || Date.now(),
        })),
        count: typeof data.count === "number" ? data.count : data.online.length,
        error: false,
      });
    } else {
      setState({ error: true });
    }
  } catch {
    setState({ error: true });
  } finally {
    heartbeatInFlight = false;
  }
}

/** Start/stop the heartbeat loop from the app shell. */
export function setHeartbeatActive(active: boolean): void {
  if (active && timer === null) {
    timer = setInterval(() => void beat(), 8000);
    void beat();
  } else if (!active && timer !== null) {
    clearInterval(timer);
    timer = null;
    state = { online: [], count: 0, error: false };
    notify();
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): LiveState {
  return state;
}

/** React binding — re-renders on every heartbeat (8s, cheap). */
export function useLivePresence(): LiveState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
