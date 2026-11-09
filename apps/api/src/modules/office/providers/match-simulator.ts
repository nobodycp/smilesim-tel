// Provider matching, simulated (spec 2026-11-08-overview-and-reports-nav, E; owner 2026-11-09: «اعمل مطابقه وهميه
// حسب المزودين الي عندنا … عشان نشوف الشكل والاليه»). No provider answers through a real API yet, so the amount a
// provider "charged" is our own provider cost, with a few deterministic differences so the difference flow shows.
// The real adapters replace `simulatedCharge`; the states, fields and screens stay. Pure.

export type MatchSource = 'api' | 'statement';
export type MatchState = 'matched' | 'difference' | 'pending';
export const MATCH_SOURCES: readonly MatchSource[] = ['api', 'statement'];

/** A small stable hash of the operation id, so the same operation always simulates the same way. */
function hashOf(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return hash;
}

/** What the provider "charged": our cost, and for about one operation in twelve a difference of 1–5 ₪ either way. */
export function simulatedCharge(id: string, cost: number): number {
  if (cost === 0) return 0;
  const hash = hashOf(id);
  if (hash % 12 !== 0) return cost;
  const shekels = 1 + (Math.floor(hash / 12) % 5);
  return cost + (hash % 2 === 0 ? 1 : -1) * shekels * 100;
}

/**
 * One operation's matching. API source: matched as soon as it happened. Statement source: matched only once a
 * statement covering its time was matched (`lastMatchedAt`), pending before that.
 */
export function matchOf(op: { id: string; at: Date; cost: number }, provider: { matchSource: string; lastMatchedAt: Date | null }) {
  const covered = provider.matchSource === 'api' || (provider.lastMatchedAt !== null && op.at <= provider.lastMatchedAt);
  if (!covered) return { state: 'pending' as MatchState, providerAmount: null, difference: null };
  const providerAmount = simulatedCharge(op.id, op.cost);
  const difference = providerAmount - op.cost;
  return { state: (difference === 0 ? 'matched' : 'difference') as MatchState, providerAmount, difference };
}

/** A statement provider is overdue once its last match is older than its period (or it was never matched). */
export function matchOverdue(provider: { matchSource: string; matchEveryDays: number; lastMatchedAt: Date | null }, now: Date = new Date()): boolean {
  if (provider.matchSource !== 'statement') return false;
  if (!provider.lastMatchedAt) return true;
  return now.getTime() - provider.lastMatchedAt.getTime() > provider.matchEveryDays * 86_400_000;
}
