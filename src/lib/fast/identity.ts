"use client";

/**
 * Callsign identity — the nickname login layer (client side)
 * ==========================================================
 * A callsign is PUBLIC display material. It is stored in LocalStorage (the
 * only thing that is), registered with the server on every app entry so the
 * roster / live board can render it, and re-verified when the server forgets
 * (cold start). The DRACH callsign is reserved: using it requires the boss
 * key, which is typed at login, verified server-side in constant time, and
 * NEVER persisted anywhere.
 */

import type { Role } from "@/lib/fast/identity-store";
import { registerMember } from "@/lib/fast/member-ledger";

const STORE_KEY = "fast_callsign_v1";

export type CallsignIdentity = {
  nickname: string;
  role: Role;
  /** server-signed attestation carried on joins/heartbeats (public material) */
  token: string;
};

/** Full stored record — includes the device-local nickname ownership pass. */
export type StoredCallsign = CallsignIdentity & { nickPass: string };

const NICK_RE = /^[a-zA-Z0-9 _.\-]{2,16}$/;
export const NICKNAME_RULE = "2–16 characters · letters, numbers, space, . _ -";
export const RESERVED_DRACH = "drach";

export function validateNickname(raw: string): string | null {
  const nick = raw.replace(/[\u0000-\u001F\u007F]/g, "").trim().replace(/\s+/g, " ").slice(0, 16);
  if (!NICK_RE.test(nick)) return null;
  return nick;
}

export function isReserved(nickname: string): boolean {
  return nickname.trim().toLowerCase() === RESERVED_DRACH;
}

export function loadCallsign(): StoredCallsign | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      nickname?: unknown;
      role?: unknown;
      token?: unknown;
      nickPass?: unknown;
    };
    if (typeof parsed.nickname !== "string") return null;
    const nickname = validateNickname(parsed.nickname);
    if (!nickname) return null;
    const role: Role = parsed.role === "boss" ? "boss" : "member";
    if (role === "boss" && !isReserved(nickname)) return null; // tamper guard
    if (typeof parsed.token !== "string" || parsed.token.length === 0) return null;
    if (typeof parsed.nickPass !== "string" || parsed.nickPass.length === 0) return null;
    return { nickname, role, token: parsed.token, nickPass: parsed.nickPass };
  } catch {
    return null;
  }
}

export function saveCallsign(identity: StoredCallsign): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(identity));
  } catch {
    /* storage unavailable — identity stays session-only */
  }
}

export function clearCallsign(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

export type RegisterResponse =
  | { ok: true; identity: CallsignIdentity; nickPass?: string }
  | { ok: false; error: string; status: number };

/**
 * Register the callsign with the server. For DRACH the boss key rides along
 * once and is then discarded by the caller (never cached, never stored).
 * A successful registration returns a server-signed attestation token plus
 * (on first claim) the nickname ownership pass.
 */
export async function registerCallsign(
  fingerprint: string,
  nickname: string,
  opts: { bossKey?: string; nickPass?: string } = {}
): Promise<RegisterResponse> {
  const res = await fetch("/api/identity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fingerprint,
      nickname,
      bossKey: opts.bossKey || undefined,
      nickPass: opts.nickPass || undefined,
    }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    nickname?: string;
    role?: string;
    token?: string;
    nickPass?: string;
    error?: string;
  };
  if (!res.ok || data.ok !== true || typeof data.nickname !== "string" || typeof data.token !== "string") {
    return {
      ok: false,
      error: typeof data.error === "string" ? data.error : "Registration failed",
      status: res.status,
    };
  }
  // All-time member ledger — every registered callsign joins the permanent
  // roll (hashed, zero-knowledge, attested per M5). Fire-and-forget: never
  // blocks the login.
  void registerMember(data.nickname, fingerprint, data.token);

  return {
    ok: true,
    identity: {
      nickname: data.nickname,
      role: data.role === "boss" ? "boss" : "member",
      token: data.token,
    },
    nickPass: typeof data.nickPass === "string" ? data.nickPass : undefined,
  };
}

/** Batch callsign lookup for a set of fingerprints (chat roster, live board). */
export async function lookupCallsigns(
  fps: string[]
): Promise<Record<string, { nickname: string; role: Role }>> {
  if (fps.length === 0) return {};
  try {
    const res = await fetch(`/api/identity?fps=${encodeURIComponent(fps.slice(0, 64).join(","))}`, {
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      names?: Record<string, { nickname: string; role: string }>;
    };
    if (!res.ok || data.ok !== true || !data.names) return {};
    const out: Record<string, { nickname: string; role: Role }> = {};
    for (const [fp, n] of Object.entries(data.names)) {
      out[fp] = { nickname: String(n.nickname).slice(0, 24), role: n.role === "boss" ? "boss" : "member" };
    }
    return out;
  } catch {
    return {};
  }
}
