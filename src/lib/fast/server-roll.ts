/**
 * ALL-TIME MEMBER ROLL — in-process, database-free.
 * =================================================
 * "Hoe baie ouens het AL OIT deur die 187 deur gestap?"
 *
 * The user's law: NO DATABASES. Ever. So the all-time roll lives in process
 * RAM, exactly like the chat relay and the identity registry. On the sandbox
 * / self-host that memory is persistent for the life of the server; on
 * serverless it survives every warm invocation of the lambda. A cold restart
 * can only ever shrink the *server's* view — the client keeps a local
 * high-water mark (see member-ledger.ts) so the displayed number NEVER rolls
 * backwards for a returning member.
 *
 * What is stored: a keyed digest ONLY (SHA-256 computed in the browser over
 * a device id + callsign). No nicknames, no IPs, no fingerprints, no
 * plaintext anything. Rows are never deleted — "ever" means ever.
 */

type MemberRec = { firstSeen: number; lastSeen: number; visits: number };

const MAX_MEMBERS = 50_000;

/** globalThis pinning keeps one roll across dev hot-reloads and route modules. */
function roll(): Map<string, MemberRec> {
  const g = globalThis as { __fastMemberRoll?: Map<string, MemberRec> };
  g.__fastMemberRoll ??= new Map<string, MemberRec>();
  return g.__fastMemberRoll;
}

/**
 * Register (or re-assert) a member digest. Returns the all-time total.
 * New digests join the roll; known digests tick their visit counter.
 */
export function registerMember(memberHash: string): { total: number; firstTime: boolean } {
  const table = roll();
  const now = Date.now();
  const existing = table.get(memberHash);
  if (existing) {
    existing.lastSeen = now;
    existing.visits += 1;
    return { total: table.size, firstTime: false };
  }
  // hard cap: if somehow flooded, recycle the coldest shadow (count never drops below the cap)
  if (table.size >= MAX_MEMBERS) {
    let coldestKey = "";
    let coldest = Infinity;
    for (const [k, v] of table) {
      if (v.lastSeen < coldest) {
        coldest = v.lastSeen;
        coldestKey = k;
      }
    }
    if (coldestKey) table.delete(coldestKey);
  }
  table.set(memberHash, { firstSeen: now, lastSeen: now, visits: 1 });
  return { total: table.size, firstTime: true };
}

/** Current all-time total of shadows on the roll. */
export function memberTotal(): number {
  return roll().size;
}
