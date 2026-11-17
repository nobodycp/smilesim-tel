/** Defaults when neither the account nor its layer sets a value (spec 2026-11-08-session-rules). */
export const SESSION_LIMIT = 3;
export const DEFAULT_SESSION_MINUTES = 360;
/** The cookie's own life; the server decides when a session ends. */
export const SESSION_COOKIE_SECONDS = 2592000;
export const SESSION_LIMIT_RANGE = { min: 1, max: 10 } as const;
export const SESSION_MINUTES_RANGE = { min: 15, max: 43200 } as const;

/**
 * How often a request writes the session row's last-activity time, at most (decision 13 of spec
 * 2026-11-17-scale-speed-cleanup, "A request's sign-in cost"). A request whose stored time is younger writes nothing;
 * the idle check still runs on every request against the stored time, so a session ends more than its idle limit
 * less a minute, and at most its idle limit, after its last request.
 */
export const SESSION_TOUCH_SECONDS = 60;

/** Whether a request writes the session's last-activity time: the stored one is a minute old or older. */
export function activityDue(lastSeenAt: Date, now: number = Date.now()): boolean {
  return now - lastSeenAt.getTime() >= SESSION_TOUCH_SECONDS * 1000;
}

/** One level's values; null follows the next level. */
export type SessionRuleValues = { maxSessions: number | null; sessionMinutes: number | null };
export type SessionRules = { maxSessions: number; idleSeconds: number };

/** Account beats layer beats default. */
export function effectiveRules(account: Partial<SessionRuleValues> | null | undefined, layer: Partial<SessionRuleValues> | null | undefined): SessionRules {
  const maxSessions = account?.maxSessions ?? layer?.maxSessions ?? SESSION_LIMIT;
  const minutes = account?.sessionMinutes ?? layer?.sessionMinutes ?? DEFAULT_SESSION_MINUTES;
  return { maxSessions, idleSeconds: minutes * 60 };
}

type Row = {
  id: string;
  createdAt: Date;
  scope: 'full' | 'password_change' | 'two_factor';
  kind: 'account' | 'impersonation';
  revokedAt?: Date | null;
};

export function idsToRevoke(existing: Row[], creatingNewFullSession: boolean, limit: number = SESSION_LIMIT): string[] {
  const countable = existing
    .filter((row) => row.kind === 'account' && row.scope === 'full' && !row.revokedAt)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const overflow = countable.length + (creatingNewFullSession ? 1 : 0) - limit;
  if (overflow <= 0) return [];
  return countable.slice(0, overflow).map((row) => row.id);
}

export function isListedAccountSession(row: Pick<Row, 'scope' | 'kind' | 'revokedAt'>): boolean {
  return row.kind === 'account' && row.scope === 'full' && !row.revokedAt;
}
