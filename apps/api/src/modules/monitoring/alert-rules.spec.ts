import {
  addressSignInsOf, signInFailuresOf, wrongCodesOf, crackingRule, failingRule, findAlerts, limitOf, linkOf, manyAccountsRule, permissionRule, planRound, probingRule, rateLimitRule, secondStepRule,
  serviceDownRule, slowRule, workerDownSpell, wrongDoorRule, type AlertFinding, type Counted,
} from './alert-rules';
import {
  ALERT_QUIET_MINUTES, CRACKING_FAILS, FAILING_MIN_REQUESTS, FAILING_ROUTE_CRASHES, MANY_ACCOUNTS_NAMES, PERMISSION_REFUSALS, PROBING_ANSWERS,
  SECOND_STEP_WRONG, SERVICE_DOWN_MINUTES, SLOW_MIN_REQUESTS, SLOW_P95_MS, WORKER_DOWN_AFTER_S, WRONG_DOOR_REFUSALS,
} from './thresholds';

// The ten rules of the early warnings (spec 2026-11-17-system-monitor, section 4; slice M.6), alone: each opens at
// its threshold and not one under it, keyed as the page and the pass expect; then one round's plan against the
// open alerts, and the request-log filters behind an alert.

const T0 = new Date('2026-11-17T10:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
/** `n` events, one a second from T0, newest first. */
const events = (n: number) => {
  const recent = Array.from({ length: n }, (_, i) => at(n - 1 - i));
  return { firstAt: at(0), lastAt: at(Math.max(0, n - 1)), recent };
};
const keys = (found: AlertFinding[]) => found.map((finding) => `${finding.kind} ${finding.key}`);

describe('each rule opens at its threshold and not one under it', () => {
  it('cracking a password: failed sign-ins for one login name, or one refusal by the account\'s own lock', () => {
    const row = (fails: number, locked = 0, addresses = 1) => ({ loginName: 'ghost', accountId: null, fails, locked, addresses, ip: '10.0.0.9', ...events(fails + locked) });
    expect(crackingRule([row(CRACKING_FAILS - 1)])).toEqual([]);
    const [found] = crackingRule([row(CRACKING_FAILS)]);
    expect(found).toMatchObject({ kind: 'password_cracking', key: 'ghost', count: CRACKING_FAILS, subject: { loginName: 'ghost', ip: '10.0.0.9', detail: '' } });
    // The lock alone opens it, and says so; from several addresses no address is named.
    expect(crackingRule([row(0, 1, 2)])[0]).toMatchObject({ key: 'ghost', subject: { ip: '', detail: 'locked' } });
    expect(crackingRule([{ ...row(CRACKING_FAILS), loginName: '' }])).toEqual([]);
  });

  it('one address trying many accounts: different login names from one address', () => {
    const row = (names: number) => ({ ip: '10.0.0.9', fails: names * 2, names, ...events(names * 2) });
    expect(manyAccountsRule([row(MANY_ACCOUNTS_NAMES - 1)])).toEqual([]);
    expect(manyAccountsRule([row(MANY_ACCOUNTS_NAMES)])).toMatchObject([{ kind: 'many_accounts', key: '10.0.0.9', count: MANY_ACCOUNTS_NAMES * 2, subject: { ip: '10.0.0.9', detail: String(MANY_ACCOUNTS_NAMES) } }]);
    expect(manyAccountsRule([{ ...row(MANY_ACCOUNTS_NAMES), ip: '' }])).toEqual([]);
  });

  it('second-step guessing: wrong codes for one account, keyed by its id', () => {
    const row = (wrong: number) => ({ accountId: 'acc-1', loginName: 'pos1', wrong, ...events(wrong) });
    expect(secondStepRule([row(SECOND_STEP_WRONG - 1)])).toEqual([]);
    expect(secondStepRule([row(SECOND_STEP_WRONG)])).toMatchObject([{ kind: 'second_step', key: 'acc-1', subject: { loginName: 'pos1', accountId: 'acc-1' } }]);
  });

  it('rate limit hit: any 429, one alert a limit and a caller, naming the path refused most', () => {
    const row = (path: string, method: string, hits: number, loginName = '', ip = '10.0.0.9') => ({ method, path, loginName, accountId: loginName ? `id-${loginName}` : null, ip, hits, ...events(hits) });
    expect(rateLimitRule([])).toEqual([]);
    expect(limitOf({ method: 'POST', path: '/auth/login' })).toBe('sign_in');
    expect(limitOf({ method: 'POST', path: '/auth/two-factor/verify' })).toBe('sign_in');
    expect(limitOf({ method: 'POST', path: '/v1/lines' })).toBe('session_writes');
    expect(limitOf({ method: 'GET', path: '/v1/lines' })).toBe('session_requests');
    const found = rateLimitRule([row('/auth/login', 'POST', 1), row('/v1/lines', 'GET', 3, 'pos1'), row('/v1/home', 'GET', 1, 'pos1'), row('/v1/lines', 'POST', 2, 'pos1')]);
    expect(keys(found).sort()).toEqual(['rate_limit session_requests account:pos1', 'rate_limit session_writes account:pos1', 'rate_limit sign_in ip:10.0.0.9']);
    expect(found.find((f) => f.key === 'session_requests account:pos1')).toMatchObject({ count: 4, subject: { loginName: 'pos1', accountId: 'id-pos1', ip: '', path: '/v1/lines', detail: 'session_requests' } });
    expect(found.find((f) => f.key === 'sign_in ip:10.0.0.9')).toMatchObject({ count: 1, subject: { loginName: '', ip: '10.0.0.9', path: '/auth/login', detail: 'sign_in' } });
  });

  it('probing: 404 or 401 answers to one address, one alert a status', () => {
    const row = (status: number, answers: number) => ({ ip: '10.0.0.9', status, answers, ...events(answers) });
    expect(probingRule([row(404, PROBING_ANSWERS - 1), row(401, PROBING_ANSWERS - 1)])).toEqual([]);
    expect(keys(probingRule([row(404, PROBING_ANSWERS), row(401, PROBING_ANSWERS)]))).toEqual(['probing 404 10.0.0.9', 'probing 401 10.0.0.9']);
  });

  it('wrong door or origin: refusals to one address', () => {
    const row = (refusals: number) => ({ ip: '10.0.0.9', refusals, ...events(refusals) });
    expect(wrongDoorRule([row(WRONG_DOOR_REFUSALS - 1)])).toEqual([]);
    expect(keys(wrongDoorRule([row(WRONG_DOOR_REFUSALS)]))).toEqual(['wrong_door 10.0.0.9']);
  });

  it('permission probing: 403 answers to one account', () => {
    const row = (refusals: number) => ({ accountId: 'acc-1', loginName: 'pos1', refusals, ...events(refusals) });
    expect(permissionRule([row(PERMISSION_REFUSALS - 1)])).toEqual([]);
    expect(permissionRule([row(PERMISSION_REFUSALS)])).toMatchObject([{ kind: 'permission_probing', key: 'acc-1', subject: { loginName: 'pos1' } }]);
  });

  it('the system is failing: 5xx over 5 % of enough requests, or 10 crashes of one route', () => {
    const all = (requests: number, failed: number) => ({ requests, failed, firstAt: at(0), lastAt: at(60) });
    const route = (crashes: number) => ({ method: 'GET', route: '/v1/lines/:id', crashes, ...events(crashes) });
    // 5 % is not over 5 %; one more is.
    expect(failingRule(all(100, 5), [])).toEqual([]);
    expect(keys(failingRule(all(100, 6), []))).toEqual(['system_failing share']);
    // One crash on a quiet system is not "the system is failing" (`FAILING_MIN_REQUESTS`).
    expect(failingRule(all(FAILING_MIN_REQUESTS - 1, FAILING_MIN_REQUESTS - 1), [])).toEqual([]);
    expect(failingRule(all(0, 0), [route(FAILING_ROUTE_CRASHES - 1)])).toEqual([]);
    expect(failingRule(all(0, 0), [route(FAILING_ROUTE_CRASHES)])).toMatchObject([{ key: 'route GET /v1/lines/:id', count: FAILING_ROUTE_CRASHES, subject: { method: 'GET', route: '/v1/lines/:id', detail: 'route' } }]);
  });

  it('a service is down: a part down without a break for two minutes', () => {
    const spell = (seconds: number) => ({ part: 'redis', since: at(0), lastDownAt: at(seconds) });
    expect(serviceDownRule([spell(SERVICE_DOWN_MINUTES * 60 - 1)])).toEqual([]);
    expect(serviceDownRule([spell(SERVICE_DOWN_MINUTES * 60)])).toMatchObject([{ kind: 'service_down', key: 'redis', recent: null, subject: { part: 'redis' } }]);
  });

  it('the API\'s watch on the worker (M.9): down past the status\'s limit, since its last beat; no heartbeat waits for the API\'s own first minutes', () => {
    expect(workerDownSpell({ lastBeatAgeS: 5 }, 3600, at(0))).toBeNull();
    expect(workerDownSpell({ lastBeatAgeS: WORKER_DOWN_AFTER_S }, 3600, at(0))).toBeNull();
    const late = workerDownSpell({ lastBeatAgeS: WORKER_DOWN_AFTER_S + 1 }, 3600, at(1000));
    expect(late).toEqual({ part: 'worker', since: at(1000 - WORKER_DOWN_AFTER_S - 1), lastDownAt: at(1000) });
    // Always past the rule's two minutes: opened on the first look.
    expect(serviceDownRule([late as NonNullable<typeof late>])).toMatchObject([{ kind: 'service_down', key: 'worker', subject: { part: 'worker' } }]);
    expect(workerDownSpell({ lastBeatAgeS: null }, WORKER_DOWN_AFTER_S - 1, at(1000))).toBeNull();
    expect(workerDownSpell({ lastBeatAgeS: null }, WORKER_DOWN_AFTER_S, at(1000))).toEqual({ part: 'worker', since: at(1000 - WORKER_DOWN_AFTER_S), lastDownAt: at(1000) });
  });

  it('slow: the 95th percentile of enough requests over 2 s', () => {
    const speed = (requests: number, p95Ms: number) => ({ requests, p95Ms, firstAt: at(0), lastAt: at(60) });
    expect(slowRule(speed(100, SLOW_P95_MS))).toEqual([]);
    expect(slowRule(speed(100, SLOW_P95_MS + 1))).toMatchObject([{ kind: 'slow', key: 'p95', subject: { detail: String(SLOW_P95_MS + 1) } }]);
    expect(slowRule(speed(SLOW_MIN_REQUESTS - 1, SLOW_P95_MS * 10))).toEqual([]);
  });

  it('findAlerts runs every rule over what one round counted', () => {
    const none: Counted = {
      signInFailures: [], addressSignIns: [], wrongCodes: [], rateLimited: [], probeAnswers: [], doorRefusals: [], permissionRefusals: [],
      requestFailures: { requests: 0, failed: 0, firstAt: T0, lastAt: T0 }, routeCrashes: [], downSpells: [], requestSpeed: { requests: 0, p95Ms: 0, firstAt: T0, lastAt: T0 },
    };
    expect(findAlerts(none)).toEqual([]);
    const found = findAlerts({ ...none, probeAnswers: [{ ip: '10.0.0.9', status: 404, answers: PROBING_ANSWERS, ...events(PROBING_ANSWERS) }], downSpells: [{ part: 'outbox', since: at(0), lastDownAt: at(600) }] });
    expect(keys(found)).toEqual(['probing 404 10.0.0.9', 'service_down outbox']);
  });
});

describe('the activity log\'s rows, counted', () => {
  // Newest first, as the repository reads them.
  const row = (seconds: number, actorLoginName: string, ip: string, reason = 'BAD_CREDENTIALS', actorId: string | null = null) => ({ at: at(seconds), actorId, actorLoginName, reason, ip });

  it('counts refused sign-ins by login name, case ignored, within the failures\' window, and the lock\'s refusals', () => {
    // `::ffff:10.0.0.1` is the address the request log writes as `10.0.0.1`.
    const rows = [row(50, 'Ghost', '::ffff:10.0.0.1', 'RATE_LIMITED'), row(40, 'ghost', '10.0.0.2', 'BAD_CREDENTIALS', 'acc-1'), row(5, 'ghost', '10.0.0.1'), row(30, 'other', '10.0.0.1')];
    const [ghost, other] = signInFailuresOf(rows, at(10));
    expect(ghost).toEqual({ loginName: 'ghost', accountId: 'acc-1', fails: 2, locked: 1, addresses: 2, ip: '10.0.0.1', firstAt: at(5), lastAt: at(50), recent: [at(50), at(40), at(5)] });
    expect(other).toMatchObject({ loginName: 'other', fails: 1, locked: 0, addresses: 1 });
    expect(signInFailuresOf([row(1, '  ', '10.0.0.1')], at(0))).toEqual([]);
  });

  it('counts refused sign-ins by address with the different login names, and wrong codes by account', () => {
    const rows = [row(3, 'a', '10.0.0.1'), row(2, 'A', '::ffff:10.0.0.1'), row(1, 'b', '10.0.0.1'), row(0, 'c', '')];
    expect(addressSignInsOf(rows)).toEqual([{ ip: '10.0.0.1', fails: 3, names: 2, firstAt: at(1), lastAt: at(3), recent: [at(3), at(2), at(1)] }]);
    expect(wrongCodesOf([row(2, 'pos1', '10.0.0.1', 'WRONG_CODE', 'acc-1'), row(1, 'pos1', '10.0.0.1', 'WRONG_CODE', 'acc-1')])).toEqual([{ accountId: 'acc-1', loginName: 'pos1', wrong: 2, firstAt: at(1), lastAt: at(2), recent: [at(2), at(1)] }]);
  });
});

describe('one round against the open alerts', () => {
  const finding = (kind: AlertFinding['kind'], key: string, n: number | null): AlertFinding => ({
    kind, key, count: n ?? 1, subject: { loginName: '', accountId: null, ip: '', method: '', route: '', path: '', part: '', detail: '' },
    ...(n === null ? { firstAt: at(0), lastAt: at(0), recent: null } : events(n)),
  });

  it('opens what is not open, once a kind and key, even when a rule finds it twice', () => {
    const plan = planRound([], [finding('probing', '404 a', 30), finding('probing', '404 a', 30), finding('slow', 'p95', null)], at(100));
    expect(keys(plan.open)).toEqual(['probing 404 a', 'slow p95']);
    expect([plan.raise, plan.close]).toEqual([[], []]);
  });

  it('raises an open alert by the events after its lastAt only, and a state by one round; nothing new, nothing written', () => {
    const open = [
      { id: 'a1', kind: 'probing', key: '404 a', count: 30, lastAt: at(29) },
      { id: 'a2', kind: 'slow', key: 'p95', count: 3, lastAt: at(10) },
      { id: 'a3', kind: 'wrong_door', key: 'b', count: 10, lastAt: at(39) },
    ];
    // 40 events at 0…39 s: the 10 after 29 s are new. The wrong door's ten end at 9 s: none after its lastAt.
    const plan = planRound(open, [finding('probing', '404 a', 40), { ...finding('slow', 'p95', null), lastAt: at(100) }, finding('wrong_door', 'b', 10)], at(100));
    expect(plan.open).toEqual([]);
    expect(plan.raise).toEqual([{ id: 'a1', add: 10, lastAt: at(39) }, { id: 'a2', add: 1, lastAt: at(100) }]);
    expect(plan.close).toEqual([]);
    // A state seen no later than the alert's lastAt adds nothing.
    expect(planRound(open, [finding('slow', 'p95', null)], at(100)).raise).toEqual([]);
  });

  it('closes an open alert whose rule was not passed for 30 minutes, and not a minute earlier', () => {
    const open = [{ id: 'a1', kind: 'probing', key: '404 a', count: 30, lastAt: at(0) }];
    expect(planRound(open, [], at(ALERT_QUIET_MINUTES * 60 - 1)).close).toEqual([]);
    expect(planRound(open, [], at(ALERT_QUIET_MINUTES * 60)).close).toEqual(['a1']);
    // Passed again, it stays open however old its lastAt.
    expect(planRound(open, [finding('probing', '404 a', 30)], at(ALERT_QUIET_MINUTES * 60 * 2)).close).toEqual([]);
  });
});

describe('the request-log filters behind an alert', () => {
  const base = { firstAt: at(60), lastAt: at(120), loginName: '', ip: '', method: '', route: '', path: '', detail: '' };
  const range = { from: at(0).toISOString(), to: at(180).toISOString() };

  it('names the rows by the alert\'s subject, a minute wider on each side', () => {
    expect(linkOf({ ...base, kind: 'password_cracking', loginName: 'ghost', ip: '10.0.0.9' })).toEqual({ ...range, route: '/auth/login', ip: '10.0.0.9' });
    expect(linkOf({ ...base, kind: 'many_accounts', ip: '10.0.0.9' })).toEqual({ ...range, route: '/auth/login', ip: '10.0.0.9' });
    expect(linkOf({ ...base, kind: 'second_step', loginName: 'pos1' })).toEqual({ ...range, account: 'pos1', code: 'WRONG_CODE' });
    expect(linkOf({ ...base, kind: 'rate_limit', loginName: 'pos1', detail: 'session_writes' })).toEqual({ ...range, status: '429', account: 'pos1' });
    expect(linkOf({ ...base, kind: 'rate_limit', ip: '10.0.0.9', detail: 'sign_in' })).toEqual({ ...range, status: '429', ip: '10.0.0.9' });
    expect(linkOf({ ...base, kind: 'probing', ip: '10.0.0.9', detail: '404' })).toEqual({ ...range, status: '404', ip: '10.0.0.9' });
    expect(linkOf({ ...base, kind: 'wrong_door', ip: '10.0.0.9' })).toEqual({ ...range, status: '403', ip: '10.0.0.9' });
    expect(linkOf({ ...base, kind: 'permission_probing', loginName: 'pos1' })).toEqual({ ...range, status: '403', account: 'pos1' });
    expect(linkOf({ ...base, kind: 'system_failing', detail: 'share' })).toEqual({ ...range, status: '5xx' });
    expect(linkOf({ ...base, kind: 'system_failing', detail: 'route', method: 'GET', route: '/v1/x' })).toEqual({ ...range, status: '5xx', method: 'GET', route: '/v1/x' });
    expect(linkOf({ ...base, kind: 'system_failing', detail: 'route', method: 'GET', route: '' })).toEqual({ ...range, status: '5xx', method: 'GET', unmatched: '1' });
    expect(linkOf({ ...base, kind: 'service_down' })).toEqual(range);
    expect(linkOf({ ...base, kind: 'slow' })).toEqual({ ...range, slowerThan: String(SLOW_P95_MS) });
  });
});
