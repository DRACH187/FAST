"use client";

/**
 * ALL-TIME MEMBER LEDGER (client side)
 * ====================================
 * "How many ouens have EVER walked through the 187 door?"
 *
 * - A persistent device id is minted once and kept in LocalStorage forever.
 * - memberHash = SHA-256("fast-member-187:v1|deviceId|lowercased callsign").
 *   Only the digest ever leaves the device — the server counts shadows,
 *   never names.
 * - A local HIGH-WATER MARK keeps the displayed total from ever rolling
 *   backwards (protects the number across server cold starts).
 */

const DEVICE_KEY = "fast_device_v1";
const HWM_KEY = "fast_members_hwm_v1";
const SALT = "fast-member-187:v1";

function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && /^[a-f0-9-]{10,64}$/.test(existing)) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    // storage unavailable — fall back to a per-session shadow id
    return (globalThis.__fastShadowDevice ??= crypto.randomUUID());
  }
}

async function memberHash(nickname: string): Promise<string | null> {
  try {
    const material = `${SALT}|${deviceId()}|${nickname.trim().toLowerCase()}`;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function readHwm(): number {
  try {
    const v = Number(localStorage.getItem(HWM_KEY) ?? "0");
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  } catch {
    return 0;
  }
}

function bumpHwm(total: number): number {
  const best = Math.max(total, readHwm());
  try {
    localStorage.setItem(HWM_KEY, String(best));
  } catch {
    /* ignore */
  }
  return best;
}

/** Cached total for instant first paint (0 = unknown yet). */
export function cachedMemberTotal(): number {
  return readHwm();
}

declare global {
  interface Window {
    __fastShadowDevice?: string;
  }
}

/**
 * Register this device+callsign as a member of the all-time roll. Fire on
 * every successful callsign assertion — the server dedupes by digest, so
 * repeats only tick the visit counter, never the total.
 *
 * M5: the roll only admits ATTESTED members — fingerprint + server-signed
 * token ride along so anonymous digests cannot mint rows.
 */
export async function registerMember(
  nickname: string,
  fingerprint?: string,
  token?: string
): Promise<number | null> {
  const hash = await memberHash(nickname);
  if (!hash || !fingerprint || !token) return null;
  try {
    const res = await fetch("/api/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberHash: hash, fingerprint, token }),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; total?: number };
    if (!res.ok || data.ok !== true || typeof data.total !== "number") return null;
    return bumpHwm(data.total);
  } catch {
    return null;
  }
}

/** Pull the all-time total (merged with the local high-water mark). */
export async function fetchMemberTotal(): Promise<number | null> {
  try {
    const res = await fetch("/api/members", { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; total?: number };
    if (!res.ok || data.ok !== true || typeof data.total !== "number") return null;
    return bumpHwm(data.total);
  } catch {
    return null;
  }
}
