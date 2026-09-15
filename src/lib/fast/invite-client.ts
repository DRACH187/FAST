"use client";

/**
 * NOOI-STRINGS — client side of the secure invite system (task 23).
 * =================================================================
 * A string looks like  FG187.<payload>.<signature>  and opens ONE door for
 * a limited time / limited uses. It never carries the session key: after a
 * successful redeem the client joins like any other member and waits for a
 * holder to wrap the key over, oog tot oog.
 */

import { INVITE_BAD, INVITE_BURNED, INVITE_DEAD, INVITE_EXPIRED } from "@/lib/fast/copy";

export type MintedInvite = {
  invite: string;
  expiresAt: string;
  code: string;
  maxUses: number;
};

export type RedeemOk = { ok: true; code: string; usesLeft: number };
export type RedeemFail = { ok: false; message: string };
export type RedeemResult = RedeemOk | RedeemFail;

/** Invite-shaped input? (the hub join field accepts both codes and strings) */
export function looksLikeInvite(value: string): boolean {
  const v = value.trim().toUpperCase();
  return v.startsWith("FG187.") && /^FG187\.[A-Z0-9\-_.]{10,}$/.test(v);
}

/** Mint a signed invite for a room this device holds a slot in. */
export async function mintInvite(
  fingerprint: string,
  token: string,
  code: string,
  opts: { ttlMinutes?: number; maxUses?: number } = {}
): Promise<MintedInvite> {
  const res = await fetch("/api/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fingerprint,
      token,
      code,
      action: "mint",
      ...(opts.ttlMinutes ? { ttlMinutes: Math.floor(opts.ttlMinutes) } : {}),
      ...(opts.maxUses ? { maxUses: Math.floor(opts.maxUses) } : {}),
    }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    invite?: string;
    expiresAt?: string;
    code?: string;
    maxUses?: number;
    reason?: string;
  };
  if (!res.ok || data.ok !== true || typeof data.invite !== "string") {
    throw new Error(data.reason === "membership" ? "membership" : data.reason === "dead" ? "dead" : "fail");
  }
  return {
    invite: data.invite,
    expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : "",
    code: typeof data.code === "string" ? data.code : code,
    maxUses: typeof data.maxUses === "number" ? data.maxUses : 1,
  };
}

/** Kill every live string for a room (creator/participant move). */
export async function revokeInvites(fingerprint: string, token: string, code: string): Promise<number> {
  const res = await fetch("/api/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fingerprint, token, code, action: "revoke" }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; revoked?: number };
  if (!res.ok || data.ok !== true) throw new Error("fail");
  return typeof data.revoked === "number" ? data.revoked : 0;
}

/** Redeem a string server-side. The caller joins the returned code. */
export async function redeemInvite(
  fingerprint: string,
  token: string,
  invite: string
): Promise<RedeemResult> {
  try {
    const res = await fetch("/api/invite/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint, token, invite: invite.trim() }),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      code?: string;
      usesLeft?: number;
      reason?: string;
    };
    if (res.ok && data.ok === true && typeof data.code === "string") {
      return {
        ok: true,
        code: data.code,
        usesLeft: typeof data.usesLeft === "number" ? data.usesLeft : 0,
      };
    }
    const reason = typeof data.reason === "string" ? data.reason : "";
    const message =
      reason === "burned"
        ? INVITE_BURNED
        : reason === "expired"
          ? INVITE_EXPIRED
          : reason === "dead"
            ? INVITE_DEAD
            : INVITE_BAD;
    return { ok: false, message };
  } catch {
    return { ok: false, message: INVITE_BAD };
  }
}
