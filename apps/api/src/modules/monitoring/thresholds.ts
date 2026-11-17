// The thresholds of the system status (spec 2026-11-17-system-monitor, section 1; D6: chosen once, here, changed
// by a commit and not by a screen). "Over" is strictly over: a figure equal to its threshold is still `ok`.

/** Every probe answers within this, or its part is `down` (`timeout`) while the others still answer. */
export const PROBE_TIMEOUT_MS = 2_000;

/** API: `warn` when the memory in use is over this share of its limit. It has no `down`: it answers, or the page shows the outage. */
export const API_MEMORY_WARN_SHARE = 0.8;

/** Worker: how often a worker writes its heartbeat; `warn` with none for 60 s, `down` with none for 3 min. */
export const HEARTBEAT_EVERY_MS = 20_000;
export const WORKER_WARN_AFTER_S = 60;
export const WORKER_DOWN_AFTER_S = 180;

/** PostgreSQL: `warn` when `SELECT 1` takes over 200 ms; `down` when it does not answer. */
export const POSTGRES_PING_WARN_MS = 200;

/** Redis: `warn` when `PING` takes over 100 ms; `down` when it does not answer. */
export const REDIS_PING_WARN_MS = 100;

/** Queues: `warn` when a queue holds over 100 waiting jobs, or any failed one. No `down`. */
export const QUEUE_WAITING_WARN = 100;
export const QUEUE_FAILED_WARN = 0;

/** Outbox: `warn` when the oldest unpublished message is over 1 min old, `down` over 10 min. */
export const OUTBOX_WARN_AFTER_S = 60;
export const OUTBOX_DOWN_AFTER_S = 600;

/** Requests: the window looked at, and the share of 5xx answers over which it is `warn` (1 %) and `down` (10 %). */
export const REQUESTS_WINDOW_MINUTES = 15;
export const REQUESTS_FAILED_WARN_SHARE = 0.01;
export const REQUESTS_FAILED_DOWN_SHARE = 0.1;

// ── Alerts (spec section 4, the table's first values; slice M.6) ──────────────────────────────────────────────
// "At" a threshold opens: a count equal to it is passed (the spec says "5 failed sign-ins", not "over 5").

/** How often the worker's alert pass runs, and how long an open alert stays open once its rule is no longer passed. */
export const ALERT_PASS_EVERY_MS = 30_000;
export const ALERT_QUIET_MINUTES = 30;

/** Cracking a password: failed sign-ins for one login name, or the account's own sign-in lock seen in its window. */
export const CRACKING_FAILS = 5;
export const CRACKING_WINDOW_MINUTES = 10;
/** The window in which a sign-in refused by the account's own lock (`RATE_LIMITED`, 10 failures in 15 min) counts. */
export const ACCOUNT_LOCK_WINDOW_MINUTES = 15;

/** One address trying many accounts: failed sign-ins for this many different login names. */
export const MANY_ACCOUNTS_NAMES = 5;
export const MANY_ACCOUNTS_WINDOW_MINUTES = 10;

/** Second-step guessing: wrong codes for one account. */
export const SECOND_STEP_WRONG = 5;
export const SECOND_STEP_WINDOW_MINUTES = 10;

/** Rate limit hit: any `429`; the window the pass looks back over for them. */
export const RATE_LIMIT_HITS = 1;
export const RATE_LIMIT_WINDOW_MINUTES = 10;

/** Probing: `404` or `401` answers to one address. */
export const PROBING_ANSWERS = 30;
export const PROBING_WINDOW_MINUTES = 5;

/** Wrong door or origin: `DOOR_MISMATCH` or cross-origin refusals to one address. */
export const WRONG_DOOR_REFUSALS = 10;
export const WRONG_DOOR_WINDOW_MINUTES = 10;

/** Permission probing: `403` answers to one account. */
export const PERMISSION_REFUSALS = 20;
export const PERMISSION_WINDOW_MINUTES = 10;

/** The system is failing: 5xx over this share of the requests, or this many crashes of one route. */
export const FAILING_SHARE = 0.05;
export const FAILING_ROUTE_CRASHES = 10;
export const FAILING_WINDOW_MINUTES = 5;
/**
 * Not in the spec's table: the share is judged over this many requests at least, so that one crash on a quiet
 * system (one request of one) is not "the system is failing". The crashes of one route have their own count.
 */
export const FAILING_MIN_REQUESTS = 20;

/** A service is down: the worker, PostgreSQL, Redis or the outbox `down` for this long. */
export const SERVICE_DOWN_MINUTES = 2;

/** Slow: the 95th percentile of every request over this, over the window. */
export const SLOW_P95_MS = 2_000;
export const SLOW_WINDOW_MINUTES = 5;
/** Not in the spec's table, for the same reason as `FAILING_MIN_REQUESTS`: one slow report on a quiet system is not "slow". */
export const SLOW_MIN_REQUESTS = 20;

// ── Retention (spec D2; slice M.8) ─────────────────────────────────────────────────────────────────────────────
// Deleted by the worker's daily purge (`retention.ts`, beside the activity log's), and by the owner's buttons at any time.

/** Requests and their server errors are kept this many days. */
export const REQUEST_LOG_RETENTION_DAYS = 14;
/** A closed alert is kept this many days after its last event; an open one is never purged (it is still happening). */
export const CLOSED_ALERT_RETENTION_DAYS = 90;
/**
 * The purge deletes requests and errors this many rows a statement, each statement its own transaction, so that a
 * backlog of millions (a first purge, a busy fortnight) never runs as one long statement: its row locks would hold
 * the owner's clearing for its whole length and vacuum could reclaim nothing until it ended.
 */
export const PURGE_BATCH_ROWS = 5_000;
