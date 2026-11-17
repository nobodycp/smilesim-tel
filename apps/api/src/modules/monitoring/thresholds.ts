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
