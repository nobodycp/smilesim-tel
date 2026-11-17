// How long the office keeps each table that grows without a business reason to keep it (plan 2026-11-17-database-scale,
// DB.13; the owner's values of 2026-11-17, spec 2026-11-17-scale-speed-cleanup). The worker deletes past these once
// a day, each table by its own module, in bounded statements (`inBatches`). The system monitor's own tables
// (requests, server errors, closed alerts) keep theirs in `monitoring/thresholds.ts`.
//
// Kept for ever, on purpose, and so named nowhere below: the ledger (`WalletEntry`), lines, tasks, provider
// operations and their decisions (`ProviderDecisionEvent`, append-only), and the log of entered sessions
// (`AccessLog`, an audit record: the owner's decision of 2026-11-17).

/** A notice that was read is kept this many days after it was written. */
export const READ_NOTICE_RETENTION_DAYS = 180;
/** A notice nobody read is kept this many days after it was written. */
export const UNREAD_NOTICE_RETENTION_DAYS = 365;
/** A session is kept this many days after it was revoked or expired (the sessions screen shows live ones only). */
export const ENDED_SESSION_RETENTION_DAYS = 30;
/** A published outbox message is kept this many days, and only while its operation is applied (see the purge). */
export const PUBLISHED_OUTBOX_RETENTION_DAYS = 30;
/** An account's daily line counts are kept this many days (the home compares with the previous month at most). */
export const LINE_SNAPSHOT_RETENTION_DAYS = 400;
/** The activity log is kept this many days; the audit page cannot ask for older rows (`clampActivityRange`). */
export const ACTIVITY_RETENTION_DAYS = 90;

/**
 * Each purge deletes at most this many rows a statement, each statement its own transaction, so that a backlog (a
 * first purge, or a worker that was down for weeks) never runs as one long statement holding its row locks and
 * keeping vacuum from reclaiming anything until it ends.
 */
export const RETENTION_BATCH_ROWS = 5_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The moment `days` days before `now`. */
export function daysBefore(days: number, now: Date): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** Runs one bounded delete until it removes fewer rows than its bound; answers the rows removed in all. */
export async function inBatches(deleteSome: (limit: number) => Promise<number>, batch: number): Promise<number> {
  if (!Number.isInteger(batch) || batch < 1) throw new RangeError('a batch of at least one row');
  let removed = 0;
  for (;;) {
    const count = await deleteSome(batch);
    removed += count;
    if (count < batch) return removed;
  }
}
