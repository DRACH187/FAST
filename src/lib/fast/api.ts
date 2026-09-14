"use client";

/**
 * Typed REST client. Every endpoint exchanges ONLY public material or
 * ciphertext — see src/app/api/** for the server contracts.
 */

import type { WrappedKeyEnvelope } from "@/lib/crypto/e2ee";

export type Member = { fingerprint: string; publicKey: string };

export type WireMessage = {
  id: string;
  senderFp: string;
  counter: number;
  iv: string;
  ciphertext: string;
  createdAt: string;
};

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof (data as { error?: string }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  gate: (passcode: string) =>
    jsonFetch<{ ok: boolean }>("/api/gate", {
      method: "POST",
      body: JSON.stringify({ passcode }),
    }),

  createSession: () =>
    jsonFetch<{ ok: boolean; code: string; createdAt: string }>("/api/sessions", {
      method: "POST",
    }),

  getSession: (code: string) =>
    jsonFetch<{ ok: boolean; code: string; createdAt: string; participants: Member[] }>(
      `/api/sessions/${code}`
    ),

  deleteSession: (code: string) =>
    jsonFetch<{ ok: boolean }>(`/api/sessions/${code}`, { method: "DELETE" }),

  join: (code: string, fingerprint: string, publicKey: string) =>
    jsonFetch<{ ok: boolean; members: Member[] }>(`/api/sessions/${code}/join`, {
      method: "POST",
      body: JSON.stringify({ fingerprint, publicKey }),
    }),

  postKeyEnvelope: (code: string, envelope: WrappedKeyEnvelope) =>
    jsonFetch<{ ok: boolean }>(`/api/sessions/${code}/keys`, {
      method: "POST",
      body: JSON.stringify({ envelope }),
    }),

  fetchKeyEnvelopes: (code: string, fingerprint: string) =>
    jsonFetch<{
      ok: boolean;
      envelopes: { id: string; epk: string; iv: string; payload: string }[];
    }>(`/api/sessions/${code}/keys?fingerprint=${encodeURIComponent(fingerprint)}`),

  fetchMessages: (code: string, since?: string) =>
    jsonFetch<{ ok: boolean; messages: WireMessage[] }>(
      `/api/sessions/${code}/messages${since ? `?since=${encodeURIComponent(since)}` : ""}`
    ),

  postMessage: (code: string, message: Omit<WireMessage, "createdAt">) =>
    jsonFetch<{ ok: boolean; serverId: string; createdAt: string }>(
      `/api/sessions/${code}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ message }),
      }
    ),
};
