"use client";

/**
 * FAST REST client — now intentionally tiny.
 *
 * All chat traffic (join / messages / key envelopes / photos / presence /
 * termination) flows through the unified sync endpoint via
 * `@/lib/fast/transport`. This module keeps only the two things that are NOT
 * session-scoped: the access gate, plus the wire types shared with it.
 */

export type Member = { fingerprint: string; publicKey: string };

export type WireMessage = {
  id: string;
  senderFp: string;
  counter: number;
  iv: string;
  ciphertext: string;
  createdAt: string;
};

export const api = {
  gate: (passcode: string) =>
    fetch("/api/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    }).then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok !== true) {
        throw new Error(
          typeof data.error === "string" ? data.error : `Access denied (${res.status})`
        );
      }
      return data;
    }),
};
