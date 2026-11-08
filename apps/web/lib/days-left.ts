/** «ينتهي قريباً»: an active line ending within this many days (owner, 2026-11-08; the API's EXPIRING_DAYS). */
export const EXPIRING_DAYS = 3;

/** Whole days until `endsAt`, rounded up, never below zero. */
export function daysLeft(endsAt: string, now = Date.now()): number {
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.ceil((end - now) / 86_400_000));
}
