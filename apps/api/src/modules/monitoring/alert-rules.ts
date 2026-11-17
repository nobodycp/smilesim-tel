// The early warnings' rules (spec 2026-11-17-system-monitor, section 4; slice M.6): the ten rules of the table over
// rows the database has already counted, each answering the alerts that should be open now; and the plan of one
// round of the alert pass against the alerts that are open. Pure (backend-engineering.mdc 5.1): no Nest, no
// Prisma, no clock but the one handed in. The values are in `thresholds.ts`.
import type { SystemAlertKind } from '../platform';
import {
  ALERT_QUIET_MINUTES, CRACKING_FAILS, FAILING_MIN_REQUESTS, FAILING_ROUTE_CRASHES, FAILING_SHARE,
  MANY_ACCOUNTS_NAMES, PERMISSION_REFUSALS, PROBING_ANSWERS, RATE_LIMIT_HITS, SECOND_STEP_WRONG, SERVICE_DOWN_MINUTES,
  SLOW_MIN_REQUESTS, SLOW_P95_MS, WORKER_DOWN_AFTER_S, WRONG_DOOR_REFUSALS,
} from './thresholds';
import { judgeWorker } from './status.rules';

export type AlertState = 'open' | 'closed';

/** Who or what an alert is about: the fields its kind names, the others empty. */
export type AlertSubject = { loginName: string; accountId: string | null; ip: string; method: string; route: string; path: string; part: string; detail: string };

/** When the counted events happened: the first and the last, and the newest of them (to count what came since). */
type Span = { firstAt: Date; lastAt: Date };
type Events = Span & { recent: Date[] };

/**
 * A rule passed for one subject: what the alert is about (`kind`, `key`), how many events the window holds, and
 * when they happened. `recent` (newest first) lets a round count only the events after an open alert's `lastAt`;
 * a rule over a state (the share of failures, a part that is down, the 95th percentile) has none and counts rounds.
 */
export type AlertFinding = Span & { kind: SystemAlertKind; key: string; subject: AlertSubject; count: number; recent: Date[] | null };

const NO_SUBJECT: AlertSubject = { loginName: '', accountId: null, ip: '', method: '', route: '', path: '', part: '', detail: '' };
const subject = (fields: Partial<AlertSubject>): AlertSubject => ({ ...NO_SUBJECT, ...fields });
const latest = (dates: Date[]) => new Date(Math.max(...dates.map((date) => date.getTime())));
const earliest = (dates: Date[]) => new Date(Math.min(...dates.map((date) => date.getTime())));

// ── What the database counts (alert.repository.ts), one shape a source ────────────────────────────────────────

/** Failed sign-ins for one login name (the activity log): in the cracking window, and refused by the account's own lock. */
export type SignInFailures = Events & { loginName: string; accountId: string | null; fails: number; locked: number; addresses: number; ip: string };
/** Failed sign-ins from one address: how many, for how many different login names. */
export type AddressSignIns = Events & { ip: string; fails: number; names: number };
/** Wrong second-step codes for one account (the activity log). */
export type WrongCodes = Events & { accountId: string; loginName: string; wrong: number };
/** `429` answers of one method and path, to one account (or none) from one address. */
export type RateLimited = Events & { method: string; path: string; loginName: string; accountId: string | null; ip: string; hits: number };
/** `404` or `401` answers to one address. */
export type ProbeAnswers = Events & { ip: string; status: number; answers: number };
/** `DOOR_MISMATCH` and cross-origin refusals to one address. */
export type DoorRefusals = Events & { ip: string; refusals: number };
/** `403` answers to one account (the door's refusals left to their own rule). */
export type PermissionRefusals = Events & { accountId: string; loginName: string; refusals: number };
/** Every request of the failing window: how many, how many 5xx. */
export type RequestFailures = Span & { requests: number; failed: number };
/** 5xx answers of one route. */
export type RouteCrashes = Events & { method: string; route: string; crashes: number };
/** A part seen `down` without a break since `since`, last seen so at `lastDownAt` (kept by the pass between rounds). */
export type DownSpell = { part: string; since: Date; lastDownAt: Date };
/** Every request of the slow window: how many, and the 95th percentile of their durations. */
export type RequestSpeed = Span & { requests: number; p95Ms: number };

/** Everything one round counted. */
export type Counted = {
  signInFailures: SignInFailures[];
  addressSignIns: AddressSignIns[];
  wrongCodes: WrongCodes[];
  rateLimited: RateLimited[];
  probeAnswers: ProbeAnswers[];
  doorRefusals: DoorRefusals[];
  permissionRefusals: PermissionRefusals[];
  requestFailures: RequestFailures;
  routeCrashes: RouteCrashes[];
  downSpells: DownSpell[];
  requestSpeed: RequestSpeed;
};

// ── The activity log's rows, counted here (its login column is read by Prisma's name, `actorLoginName`) ────────

/** One refused sign-in or second step of the activity log, newest first. */
export type ActivityRow = { at: Date; actorId: string | null; actorLoginName: string; reason: string; ip: string };

/**
 * An address as the request log writes it (`request-log.middleware.ts` drops the IPv4-mapped `::ffff:`); the activity
 * log keeps it as sent, so its addresses are read the same way, or an alert's link would find no request.
 */
const plainAddress = (ip: string) => ip.replace(/^::ffff:/, '');

function groupBy<Row>(rows: Row[], keyOf: (row: Row) => string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key) groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}
const eventsOf = (rows: { at: Date }[]): Events => ({ firstAt: earliest(rows.map((row) => row.at)), lastAt: latest(rows.map((row) => row.at)), recent: rows.map((row) => row.at) });

/** Failed sign-ins (newest first) by login name, case ignored: those after `failSince`, and those the account's lock refused. */
export function signInFailuresOf(rows: ActivityRow[], failSince: Date): SignInFailures[] {
  return [...groupBy(rows, (row) => row.actorLoginName.trim().toLowerCase())].map(([loginName, group]) => ({
    loginName,
    accountId: group.find((row) => row.actorId)?.actorId ?? null,
    fails: group.filter((row) => row.at > failSince).length,
    locked: group.filter((row) => row.reason === 'RATE_LIMITED').length,
    addresses: new Set(group.map((row) => plainAddress(row.ip))).size,
    ip: plainAddress(group[0].ip),
    ...eventsOf(group),
  }));
}

/** Failed sign-ins (newest first) by address, and for how many different login names. */
export function addressSignInsOf(rows: ActivityRow[]): AddressSignIns[] {
  return [...groupBy(rows, (row) => plainAddress(row.ip))].map(([ip, group]) => ({
    ip, fails: group.length, names: new Set(group.map((row) => row.actorLoginName.trim().toLowerCase()).filter(Boolean)).size, ...eventsOf(group),
  }));
}

/** Wrong second-step codes (newest first) by account. */
export function wrongCodesOf(rows: ActivityRow[]): WrongCodes[] {
  return [...groupBy(rows, (row) => row.actorId ?? '')].map(([accountId, group]) => ({ accountId, loginName: group[0].actorLoginName, wrong: group.length, ...eventsOf(group) }));
}

// ── The ten rules ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Cracking a password: `CRACKING_FAILS` failed sign-ins for one login name in the window, or one sign-in refused by
 * the account's own lock (10 failures in 15 min, `auth/validators.ts`) in `ACCOUNT_LOCK_WINDOW_MINUTES`. Keyed by
 * the login name as it was tried, whether or not such an account exists. The address is named when there was one.
 */
export function crackingRule(rows: SignInFailures[]): AlertFinding[] {
  return rows
    .filter((row) => row.loginName && (row.fails >= CRACKING_FAILS || row.locked > 0))
    .map((row) => ({
      kind: 'password_cracking', key: row.loginName, count: row.fails + row.locked, firstAt: row.firstAt, lastAt: row.lastAt, recent: row.recent,
      subject: subject({ loginName: row.loginName, accountId: row.accountId, ip: row.addresses === 1 ? row.ip : '', detail: row.locked > 0 ? 'locked' : '' }),
    }));
}

/** One address trying many accounts: failed sign-ins for `MANY_ACCOUNTS_NAMES` different login names. Keyed by the address. */
export function manyAccountsRule(rows: AddressSignIns[]): AlertFinding[] {
  return rows
    .filter((row) => row.ip && row.names >= MANY_ACCOUNTS_NAMES)
    .map((row) => ({ kind: 'many_accounts', key: row.ip, count: row.fails, firstAt: row.firstAt, lastAt: row.lastAt, recent: row.recent, subject: subject({ ip: row.ip, detail: String(row.names) }) }));
}

/** Second-step guessing: `SECOND_STEP_WRONG` wrong codes for one account. Keyed by the account's id. */
export function secondStepRule(rows: WrongCodes[]): AlertFinding[] {
  return rows
    .filter((row) => row.wrong >= SECOND_STEP_WRONG)
    .map((row) => ({ kind: 'second_step', key: row.accountId, count: row.wrong, firstAt: row.firstAt, lastAt: row.lastAt, recent: row.recent, subject: subject({ loginName: row.loginName, accountId: row.accountId }) }));
}

/** The paths that sign in (`rate-limit.middleware.ts` `SIGN_IN`), and the second step, which the account's lock also refuses. */
const SIGN_IN_PATHS = ['/auth/login', '/auth/passkey-login', '/auth/passkey-login/options', '/v1/handoff', '/auth/two-factor/verify'];
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Which limit refused a `429`. A row does not say which counter refused it, so this is read from the request: a
 * sign-in path is the sign-in limit (the address's, or the account's own lock); else a write is taken as the
 * session's writes (60 a minute, the lower ceiling) and a read as the session's requests.
 */
export function limitOf(row: Pick<RateLimited, 'method' | 'path'>): 'sign_in' | 'session_writes' | 'session_requests' {
  if (SIGN_IN_PATHS.includes(row.path)) return 'sign_in';
  return WRITE_METHODS.has(row.method) ? 'session_writes' : 'session_requests';
}

/**
 * Rate limit hit: any `429`. One alert a limit and a caller: a session's limits by the account, the sign-in limit
 * (and a session's, when no account is named) by the address. It names the path refused most in the window.
 */
export function rateLimitRule(rows: RateLimited[]): AlertFinding[] {
  const groups = new Map<string, RateLimited[]>();
  for (const row of rows) {
    const limit = limitOf(row);
    const who = limit !== 'sign_in' && row.loginName ? `account:${row.loginName}` : `ip:${row.ip}`;
    const key = `${limit} ${who}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].flatMap(([key, group]) => {
    const hits = group.reduce((sum, row) => sum + row.hits, 0);
    if (hits < RATE_LIMIT_HITS) return [];
    const top = [...group].sort((a, b) => b.hits - a.hits || b.lastAt.getTime() - a.lastAt.getTime())[0];
    const limit = limitOf(top);
    const byAccount = key.includes(' account:');
    return [{
      kind: 'rate_limit' as const, key, count: hits, firstAt: earliest(group.map((row) => row.firstAt)), lastAt: latest(group.map((row) => row.lastAt)),
      recent: group.flatMap((row) => row.recent).sort((a, b) => b.getTime() - a.getTime()),
      subject: subject({ detail: limit, method: top.method, path: top.path, ...(byAccount ? { loginName: top.loginName, accountId: top.accountId } : { ip: top.ip }) }),
    }];
  });
}

/** Probing: `PROBING_ANSWERS` `404` or `401` answers to one address. One alert a status and an address. */
export function probingRule(rows: ProbeAnswers[]): AlertFinding[] {
  return rows
    .filter((row) => row.ip && row.answers >= PROBING_ANSWERS)
    .map((row) => ({ kind: 'probing', key: `${row.status} ${row.ip}`, count: row.answers, firstAt: row.firstAt, lastAt: row.lastAt, recent: row.recent, subject: subject({ ip: row.ip, detail: String(row.status) }) }));
}

/** Wrong door or origin: `WRONG_DOOR_REFUSALS` refusals to one address. Keyed by the address. */
export function wrongDoorRule(rows: DoorRefusals[]): AlertFinding[] {
  return rows
    .filter((row) => row.ip && row.refusals >= WRONG_DOOR_REFUSALS)
    .map((row) => ({ kind: 'wrong_door', key: row.ip, count: row.refusals, firstAt: row.firstAt, lastAt: row.lastAt, recent: row.recent, subject: subject({ ip: row.ip }) }));
}

/** Permission probing: `PERMISSION_REFUSALS` `403` answers to one account. Keyed by the account's id. */
export function permissionRule(rows: PermissionRefusals[]): AlertFinding[] {
  return rows
    .filter((row) => row.refusals >= PERMISSION_REFUSALS)
    .map((row) => ({ kind: 'permission_probing', key: row.accountId, count: row.refusals, firstAt: row.firstAt, lastAt: row.lastAt, recent: row.recent, subject: subject({ loginName: row.loginName, accountId: row.accountId }) }));
}

/**
 * The system is failing: 5xx over `FAILING_SHARE` of at least `FAILING_MIN_REQUESTS` requests (key `share`), or
 * `FAILING_ROUTE_CRASHES` crashes of one route (key `route <method> <route>`).
 */
export function failingRule(all: RequestFailures, routes: RouteCrashes[]): AlertFinding[] {
  const found: AlertFinding[] = [];
  if (all.requests >= FAILING_MIN_REQUESTS && all.failed / all.requests > FAILING_SHARE) {
    found.push({ kind: 'system_failing', key: 'share', count: all.failed, firstAt: all.firstAt, lastAt: all.lastAt, recent: null, subject: subject({ detail: 'share' }) });
  }
  for (const row of routes.filter((route) => route.crashes >= FAILING_ROUTE_CRASHES)) {
    found.push({
      kind: 'system_failing', key: `route ${row.method} ${row.route}`, count: row.crashes, firstAt: row.firstAt, lastAt: row.lastAt, recent: row.recent,
      subject: subject({ method: row.method, route: row.route, detail: 'route' }),
    });
  }
  return found;
}

/** A service is down: a part `down` without a break for `SERVICE_DOWN_MINUTES`. Keyed by the part's name. */
export function serviceDownRule(spells: DownSpell[]): AlertFinding[] {
  return spells
    .filter((spell) => spell.lastDownAt.getTime() - spell.since.getTime() >= SERVICE_DOWN_MINUTES * 60_000)
    .map((spell) => ({ kind: 'service_down', key: spell.part, count: 1, firstAt: spell.since, lastAt: spell.lastDownAt, recent: null, subject: subject({ part: spell.part }) }));
}

/**
 * The worker's silence as the API's watch sees it (M.9): a spell of `worker` down since its last beat, when the
 * status judges it `down` by its own limit (`judgeWorker`, 3 minutes); null while it beats. A deployment with no
 * heartbeat row at all is the API's to wait for: the API starts first, so it is not judged until the API itself
 * has been up for the same limit, and is then down since the API started. Its length is always past the rule's
 * 2 minutes, so `serviceDownRule` opens it on the first look.
 */
export function workerDownSpell(beat: { lastBeatAgeS: number | null }, apiUptimeS: number, now: Date): DownSpell | null {
  if (judgeWorker(beat).state !== 'down') return null;
  if (beat.lastBeatAgeS === null && apiUptimeS < WORKER_DOWN_AFTER_S) return null;
  const silentS = beat.lastBeatAgeS ?? apiUptimeS;
  return { part: 'worker', since: new Date(now.getTime() - Math.round(silentS * 1000)), lastDownAt: now };
}

/** Slow: the 95th percentile of at least `SLOW_MIN_REQUESTS` requests over `SLOW_P95_MS`. One key, `p95`. */
export function slowRule(speed: RequestSpeed): AlertFinding[] {
  if (speed.requests < SLOW_MIN_REQUESTS || speed.p95Ms <= SLOW_P95_MS) return [];
  return [{ kind: 'slow', key: 'p95', count: 1, firstAt: speed.firstAt, lastAt: speed.lastAt, recent: null, subject: subject({ detail: String(speed.p95Ms) }) }];
}

/** Every rule over what one round counted. */
export function findAlerts(counted: Counted): AlertFinding[] {
  return [
    ...crackingRule(counted.signInFailures),
    ...manyAccountsRule(counted.addressSignIns),
    ...secondStepRule(counted.wrongCodes),
    ...rateLimitRule(counted.rateLimited),
    ...probingRule(counted.probeAnswers),
    ...wrongDoorRule(counted.doorRefusals),
    ...permissionRule(counted.permissionRefusals),
    ...failingRule(counted.requestFailures, counted.routeCrashes),
    ...serviceDownRule(counted.downSpells),
    ...slowRule(counted.requestSpeed),
  ];
}

// ── One round against the open alerts ──────────────────────────────────────────────────────────────────────────

/** An open alert as the round reads it. */
export type OpenAlert = { id: string; kind: string; key: string; count: number; lastAt: Date };

export type RoundPlan = {
  /** Rules passed for a subject with no open alert: each opens one, and tells the owner once. */
  open: AlertFinding[];
  /** Open alerts whose rule was passed again: what to add to `count`, and the new `lastAt`. */
  raise: { id: string; add: number; lastAt: Date }[];
  /** Open alerts whose rule has not been passed for `ALERT_QUIET_MINUTES`. */
  close: string[];
};

/**
 * What one round does. A rule passed again raises its open alert by the events after the alert's `lastAt` (a rule
 * over a state, by one round that saw it later) and moves `lastAt`; nothing new, nothing written. An open alert whose rule was not
 * passed this round closes once its `lastAt` is `ALERT_QUIET_MINUTES` old: `lastAt` moves only when the rule is
 * passed, so it is the last time it was.
 */
export function planRound(open: OpenAlert[], found: AlertFinding[], now: Date): RoundPlan {
  const byKey = new Map(open.map((alert) => [`${alert.kind}\n${alert.key}`, alert]));
  const plan: RoundPlan = { open: [], raise: [], close: [] };
  const passed = new Set<string>();
  for (const finding of found) {
    const id = `${finding.kind}\n${finding.key}`;
    if (passed.has(id)) continue;
    passed.add(id);
    const alert = byKey.get(id);
    if (!alert) {
      plan.open.push(finding);
      continue;
    }
    // A state (no events) adds one round when this round saw it later than the alert last did.
    const add = finding.recent ? finding.recent.filter((at) => at > alert.lastAt).length : Number(finding.lastAt > alert.lastAt);
    const lastAt = latest([alert.lastAt, finding.lastAt]);
    if (add > 0 || lastAt > alert.lastAt) plan.raise.push({ id: alert.id, add, lastAt });
  }
  const quietSince = now.getTime() - ALERT_QUIET_MINUTES * 60_000;
  for (const alert of open) {
    if (!passed.has(`${alert.kind}\n${alert.key}`) && alert.lastAt.getTime() <= quietSince) plan.close.push(alert.id);
  }
  return plan;
}

// ── What the page needs to show the rows behind an alert ───────────────────────────────────────────────────────

/**
 * The request log's filters (`GET /v1/system/requests`) that show the rows behind an alert: its subject as filters,
 * and its time, a minute wider on each side (a sign-in's activity row is written after its request arrived).
 */
export type AlertLink = { from: string; to: string; status?: string; code?: string; method?: string; route?: string; unmatched?: '1'; ip?: string; account?: string; slowerThan?: string };

const LINK_MARGIN_MS = 60_000;

export function linkOf(alert: { kind: string; firstAt: Date; lastAt: Date } & Omit<AlertSubject, 'accountId' | 'part'>): AlertLink {
  const range = { from: new Date(alert.firstAt.getTime() - LINK_MARGIN_MS).toISOString(), to: new Date(alert.lastAt.getTime() + LINK_MARGIN_MS).toISOString() };
  const ip = alert.ip ? { ip: alert.ip } : {};
  switch (alert.kind) {
    case 'password_cracking':
    case 'many_accounts':
      return { ...range, route: '/auth/login', ...ip };
    case 'second_step':
      return { ...range, account: alert.loginName, code: 'WRONG_CODE' };
    case 'rate_limit':
      return { ...range, status: '429', ...(alert.loginName ? { account: alert.loginName } : ip) };
    case 'probing':
      return { ...range, status: alert.detail, ...ip };
    case 'wrong_door':
      return { ...range, status: '403', ...ip };
    case 'permission_probing':
      return { ...range, status: '403', account: alert.loginName };
    case 'system_failing':
      if (alert.detail !== 'route') return { ...range, status: '5xx' };
      return { ...range, status: '5xx', method: alert.method, ...(alert.route ? { route: alert.route } : { unmatched: '1' }) };
    case 'slow':
      return { ...range, slowerThan: String(SLOW_P95_MS) };
    default:
      return range;
  }
}
