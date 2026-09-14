/**
 * BOSS SUMMONS — DRACH's direct line (RAM only, ZERO DATABASE)
 * ============================================================
 * When the boss opens a session and summons online operatives, the server
 * pins a one-line wake call per target fingerprint. The target's next
 * presence heartbeat (≤8s) drains it and the client auto-joins the session.
 *
 * WHAT IS STORED: target fingerprint (a RAM-only device handle), the 6-letter
 * session code, a timestamp. NO message content, NO callsigns, NO IPs — the
 * summons is a doorbell, not a letter. Everything dies with the process.
 *
 * Delivery is at-least-once: entries ride every heartbeat until TTL, and the
 * client dedupes by code. TTL is short (3 min) — a summons is a NOW thing.
 */

const TTL_MS = 3 * 60 * 1000;
const MAX_TARGETS = 200;
const MAX_PER_TARGET = 8;

type SummonRec = { code: string; at: number };

/* globalThis pinning: one table per process, survives module reloads. */
const g = globalThis as unknown as { __fastSummons?: Map<string, SummonRec[]> };
const table: Map<string, SummonRec[]> = g.__fastSummons ?? new Map<string, SummonRec[]>();
g.__fastSummons = table;

function sweep(now: number): void {
  for (const [fp, list] of table) {
    const kept = list.filter((s) => now - s.at < TTL_MS);
    if (kept.length === 0) table.delete(fp);
    else if (kept.length !== list.length) table.set(fp, kept);
  }
}

/**
 * Pin a summons for every target. Idempotent per (target, code): a re-post
 * refreshes the timestamp instead of stacking duplicates.
 */
export function postSummons(targets: string[], code: string): number {
  const now = Date.now();
  sweep(now);
  let pinned = 0;
  for (const fp of targets) {
    if (typeof fp !== "string" || !/^[a-f0-9]{8,64}$/.test(fp)) continue;
    const list = (table.get(fp) ?? []).filter((s) => s.code !== code);
    list.unshift({ code, at: now });
    table.set(fp, list.slice(0, MAX_PER_TARGET));
    pinned += 1;
    if (table.size > MAX_TARGETS) {
      // evict the coldest target rows once capacity is gone
      const oldest = [...table.entries()].sort((a, b) => a[1][0].at - b[1][0].at)[0];
      if (oldest) table.delete(oldest[0]);
    }
  }
  return pinned;
}

/**
 * Drain every live summons for a fingerprint. Called from the presence
 * heartbeat — the response IS the delivery receipt.
 */
export function takeSummons(fp: string): SummonRec[] {
  const now = Date.now();
  sweep(now);
  const list = table.get(fp);
  if (!list || list.length === 0) return [];
  table.delete(fp); // delivered — the client dedupes and re-alerts nobody
  return list;
}

/** Peek without draining (diagnostics / tests). */
export function pendingSummons(fp: string): number {
  const now = Date.now();
  sweep(now);
  return table.get(fp)?.length ?? 0;
}
