import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PROVIDER_GATEWAY } from './modules/office/providers/gateway/provider-gateway';
import { SimulatedProviderGateway } from './modules/office/providers/gateway/simulated-gateway';
import {
  READY_TTL_MS, dispatchSettings, eligibility, mayOpenDispatch, maySend, workerReady, type DispatchSettings, type ProviderDispatchState, type ProviderTarget,
} from './modules/office/providers/dispatch/dispatch-policy';
import { ADAPTER_FACTORIES, buildAdapters, knownAdapters, type AdapterFactory, type DispatchAdapter } from './modules/office/providers/dispatch/provider-adapters';
import { RoutingProviderGateway } from './modules/office/providers/dispatch/routing-gateway';
import { PROVIDERS_PROVIDERS } from './modules/office/providers/providers.module';
import { assertWorkerConfig, dispatchConfigProblems, productionConfigProblems, workerConfigProblems } from './production-config';

// How a provider is switched on (ADR 0019, D18; plan slice S.12a; spec items 25 and 26). It replaces
// `provider-dispatch-off.spec.ts`, which pinned a constant `false`: the answer now comes from four conditions,
// and this spec is the table of them. No database: the policy is pure, and the rest reads the shipped source.
// `providers/dispatch/provider-dispatch.db.spec.ts` runs the same rules over HTTP on PostgreSQL.
//
// Three things are kept apart, and each is tested on its own:
//   - the POLICY (four conditions) → `eligibility`;
//   - the ADAPTER (built by this worker, or attested by it to the API) → `buildAdapters`, `workerReady`;
//   - the SEND → `maySend`, the routing gateway.
// This build has no adapter (S.12b adds the first): with all four conditions set, nothing is built or sent.

const NOW = new Date('2026-11-13T10:00:00.000Z');
const CODE = 'lian';

/** A deployment's settings: every condition met unless switched off here. */
const settingsOf = (over: { on?: boolean; listed?: boolean; target?: ProviderTarget | null } = {}): DispatchSettings =>
  dispatchSettings({
    ...(over.on === false ? {} : { PROVIDER_DISPATCH: '1' }),
    ...(over.listed === false ? { PROVIDER_ADAPTERS: 'another' } : { PROVIDER_ADAPTERS: `${CODE},another` }),
    ...(over.target === null ? {} : { PROVIDER_TARGET: over.target ?? 'sandbox' }),
  });
const providerOf = (over: Partial<ProviderDispatchState> = {}): ProviderDispatchState => ({
  code: CODE, dispatchApprovedAt: new Date('2026-11-12T09:00:00.000Z'), dispatchApprovedTarget: 'sandbox', dispatchPausedAt: null,
  dispatchReadyAt: new Date(NOW.getTime() - 5_000), dispatchReadyTarget: 'sandbox', ...over,
});
const notApproved = { dispatchApprovedAt: null, dispatchApprovedTarget: null };

describe('the three settings, as a deployment states them', () => {
  it('reads each condition only when it is exactly what the rule says', () => {
    expect(dispatchSettings({})).toEqual({ on: false, adapters: [], target: null, problems: [] });
    expect(dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: 'lian, sky', PROVIDER_TARGET: 'sandbox' })).toEqual({ on: true, adapters: ['lian', 'sky'], target: 'sandbox', problems: [] });
    // Anything else is "not set", and is said to be wrong.
    for (const value of ['true', 'yes', 'on', '2', ' 1', 'TRUE']) {
      const read = dispatchSettings({ PROVIDER_DISPATCH: value, PROVIDER_ADAPTERS: 'lian', PROVIDER_TARGET: 'live' });
      expect([read.on, read.problems.some((problem) => problem.startsWith('PROVIDER_DISPATCH:'))]).toEqual([false, true]);
    }
    for (const value of ['prod', 'production', 'LIVE', 'Sandbox', 'staging', 'sandbox,live', '*']) {
      const read = dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: 'lian', PROVIDER_TARGET: value });
      expect([read.target, read.problems.some((problem) => problem.startsWith('PROVIDER_TARGET:'))]).toEqual([null, true]);
    }
    // A list that is malformed names nobody: a wildcard, a repeat, an empty entry, a name that is not a code.
    for (const value of ['*', 'lian,lian', 'lian,,sky', 'lian;sky', 'Lian', 'lian sky', ',']) {
      const read = dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: value, PROVIDER_TARGET: 'sandbox' });
      expect([read.adapters, read.problems.some((problem) => problem.startsWith('PROVIDER_ADAPTERS:'))]).toEqual([[], true]);
    }
  });

  it('dispatch on without a list or a target is a problem, and the policy refuses a deployment whose settings do not hold together', () => {
    expect(dispatchSettings({ PROVIDER_DISPATCH: '1' }).problems).toHaveLength(2);
    expect(dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: 'lian' }).problems).toHaveLength(1);
    expect(dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_TARGET: 'live' }).problems).toHaveLength(1);
    // Everything else right, one variable malformed: refused as a whole, in any environment.
    const broken = dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: `${CODE},${CODE}`, PROVIDER_TARGET: 'sandbox' });
    expect(eligibility(broken, providerOf())).toEqual({ eligible: false, refusal: 'settings-invalid' });
    const typo = dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: CODE, PROVIDER_TARGET: 'sandbox ', NODE_ENV: 'development' });
    expect(typo.target).toBeNull();
    expect(eligibility(typo, providerOf()).eligible).toBe(false);
  });
});

describe('the four conditions of D18 (item 25)', () => {
  // 1 dispatch on · 2 the provider named · 3 the target stated · 4 approved by the owner and not paused.
  const combos = Array.from({ length: 16 }, (_, bits) => ({ on: Boolean(bits & 1), listed: Boolean(bits & 2), target: Boolean(bits & 4), approved: Boolean(bits & 8) }));
  const judged = (combo: (typeof combos)[number]) =>
    eligibility(settingsOf({ on: combo.on, listed: combo.listed, target: combo.target ? 'sandbox' : null }), providerOf(combo.approved ? {} : notApproved));
  const count = (combo: (typeof combos)[number]) => [combo.on, combo.listed, combo.target, combo.approved].filter(Boolean).length;

  it('all sixteen combinations: eligible only with all four', () => {
    for (const combo of combos) expect([combo, judged(combo).eligible]).toEqual([combo, count(combo) === 4]);
    expect(combos.filter((combo) => judged(combo).eligible)).toHaveLength(1);
  });

  it('each condition alone opens nothing', () => {
    const alone = combos.filter((combo) => count(combo) === 1);
    expect(alone).toHaveLength(4);
    expect(alone.map((combo) => judged(combo).eligible)).toEqual([false, false, false, false]);
  });

  it('every three of the four open nothing, and the refusal names the one that is missing', () => {
    const three = combos.filter((combo) => count(combo) === 3);
    expect(three).toHaveLength(4);
    const missing = (combo: (typeof combos)[number]) => (!combo.on ? 'on' : !combo.listed ? 'listed' : !combo.target ? 'target' : 'approved');
    const refusals = Object.fromEntries(three.map((combo) => [missing(combo), judged(combo)]));
    expect(refusals.on.eligible).toBe(false);
    expect(refusals.listed).toEqual({ eligible: false, refusal: 'not-listed' });
    expect(refusals.approved).toEqual({ eligible: false, refusal: 'not-approved' });
    // With dispatch on, a missing target is itself incoherent settings; with dispatch off it is simply off.
    expect(refusals.target.eligible).toBe(false);
  });

  it('none, and every pair: nothing', () => {
    expect(combos.filter((combo) => count(combo) <= 2).map((combo) => judged(combo).eligible).every((eligible) => !eligible)).toBe(true);
  });

  it('condition 4 is the owner\'s approval for this target, not paused: missing, withdrawn, for the other target and paused all refuse', () => {
    const all = settingsOf();
    expect(eligibility(all, providerOf())).toEqual({ eligible: true, target: 'sandbox' });
    expect(eligibility(all, null)).toEqual({ eligible: false, refusal: 'not-listed' });
    expect(eligibility(all, providerOf(notApproved))).toEqual({ eligible: false, refusal: 'not-approved' });
    expect(eligibility(all, providerOf({ dispatchApprovedTarget: null }))).toEqual({ eligible: false, refusal: 'not-approved' });
    expect(eligibility(all, providerOf({ dispatchPausedAt: NOW }))).toEqual({ eligible: false, refusal: 'paused' });
    // Approved while the deployment was sandbox: it does not open live, and the reverse.
    expect(eligibility(settingsOf({ target: 'live' }), providerOf())).toEqual({ eligible: false, refusal: 'approved-for-other-target' });
    expect(eligibility(settingsOf({ target: 'sandbox' }), providerOf({ dispatchApprovedTarget: 'live' }))).toEqual({ eligible: false, refusal: 'approved-for-other-target' });
    expect(eligibility(settingsOf({ target: 'live' }), providerOf({ dispatchApprovedTarget: 'live' }))).toEqual({ eligible: true, target: 'live' });
    // Another provider's approval is not this one's.
    expect(eligibility(all, providerOf({ code: 'not-named' }))).toEqual({ eligible: false, refusal: 'not-listed' });
  });

  it('no environment name is read: the same answers under production, staging, development and test', () => {
    for (const NODE_ENV of ['production', 'staging', 'development', 'test', undefined]) {
      const env = { NODE_ENV, PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: CODE, PROVIDER_TARGET: 'sandbox', PROVIDER_SIMULATION: '1' };
      expect(eligibility(dispatchSettings(env), providerOf()).eligible).toBe(true);
      expect(eligibility(dispatchSettings({ ...env, PROVIDER_DISPATCH: undefined }), providerOf()).eligible).toBe(false);
    }
  });
});

describe('the adapter is a separate question from the policy', () => {
  it('all four conditions and no adapter: the worker may not send, and the API may not open the route', () => {
    const all = settingsOf();
    expect(eligibility(all, providerOf()).eligible).toBe(true);
    expect(maySend(all, providerOf(), false)).toBe(false);
    // The API believes the worker only through a fresh attestation for the same target.
    expect(mayOpenDispatch(all, providerOf({ dispatchReadyAt: null, dispatchReadyTarget: null }), NOW)).toBe(false);
    expect(mayOpenDispatch(all, providerOf({ dispatchReadyAt: new Date(NOW.getTime() - READY_TTL_MS - 1) }), NOW)).toBe(false);
    expect(mayOpenDispatch(all, providerOf({ dispatchReadyTarget: 'live' }), NOW)).toBe(false);
    expect(mayOpenDispatch(all, providerOf({ dispatchReadyAt: new Date(NOW.getTime() + 60_000) }), NOW)).toBe(false);
    expect(mayOpenDispatch(all, null, NOW)).toBe(false);
    // And an adapter, or an attestation, without the policy is nothing either.
    expect(maySend(settingsOf({ on: false }), providerOf(), true)).toBe(false);
    expect(maySend(all, providerOf({ dispatchPausedAt: NOW }), true)).toBe(false);
    expect(maySend(all, providerOf(notApproved), true)).toBe(false);
    expect(mayOpenDispatch(settingsOf({ listed: false }), providerOf(), NOW)).toBe(false);
    expect(mayOpenDispatch(all, providerOf({ dispatchPausedAt: NOW }), NOW)).toBe(false);
    // Only everything together.
    expect([maySend(all, providerOf(), true), mayOpenDispatch(all, providerOf(), NOW)]).toEqual([true, true]);
    expect(workerReady(providerOf(), 'sandbox', NOW)).toBe(true);
  });

  it('this build has no adapter: the list is empty and frozen, so a worker builds none whatever it is told', () => {
    expect(knownAdapters()).toEqual([]);
    expect(Object.isFrozen(ADAPTER_FACTORIES)).toBe(true);
    const credential = jest.fn(() => 'a-credential');
    for (const target of ['sandbox', 'live'] as const) {
      const built = buildAdapters(settingsOf({ target }), credential);
      expect([...built.adapters.keys()]).toEqual([]);
      expect([...built.skipped]).toEqual([[CODE, 'no-adapter'], ['another', 'no-adapter']]);
    }
    // No credential was even asked for: there was nothing to build with it.
    expect(credential).not.toHaveBeenCalled();
  });

  // A spec's own adapter, to exercise the rules of building one. It reaches nothing.
  const adapterFor = (code: string, target: ProviderTarget): DispatchAdapter => ({ providerCode: code, target, send: async () => ({ left: false, error: 'not-connected' }) });
  const factories: Record<string, AdapterFactory> = { [CODE]: (target) => adapterFor(CODE, target), another: (target) => adapterFor('another', target) };

  it('an adapter is built only when dispatch is on, the provider is named, the target is stated and its credential opens', () => {
    const credentials = (code: string) => (code === CODE ? 'opened-credential' : null);
    expect([...buildAdapters(settingsOf(), credentials, factories).adapters.keys()]).toEqual([CODE]);
    expect([...buildAdapters(settingsOf(), credentials, factories).skipped]).toEqual([['another', 'no-credential']]);
    // Not named: not built, whatever the factories and the credentials say.
    expect([...buildAdapters(dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: 'another', PROVIDER_TARGET: 'sandbox' }), () => 'x', factories).adapters.keys()]).toEqual(['another']);
    // Dispatch off, no target, incoherent settings: nothing, and no credential asked for.
    const asked = jest.fn(() => 'x');
    expect(buildAdapters(settingsOf({ on: false }), asked, factories).adapters.size).toBe(0);
    expect(buildAdapters(dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: CODE }), asked, factories).adapters.size).toBe(0);
    expect(buildAdapters(dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: `${CODE},${CODE}`, PROVIDER_TARGET: 'live' }), asked, factories).adapters.size).toBe(0);
    expect(asked).not.toHaveBeenCalled();
  });

  it('a credential that is missing, empty or does not open builds nothing: never an adapter with an empty secret', () => {
    const made = jest.fn(factories[CODE]);
    const only = { [CODE]: made as AdapterFactory };
    const one = dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: CODE, PROVIDER_TARGET: 'sandbox' });
    expect([...buildAdapters(one, () => null, only).skipped]).toEqual([[CODE, 'no-credential']]);
    expect([...buildAdapters(one, () => '', only).skipped]).toEqual([[CODE, 'no-credential']]);
    expect([...buildAdapters(one, () => { throw new Error('bad key: SECRET-TEXT'); }, only).skipped]).toEqual([[CODE, 'credential-unreadable']]);
    expect(made).not.toHaveBeenCalled();
    // A factory that fails says so by a code; its error, which might quote the credential, goes nowhere.
    const failing = buildAdapters(one, () => 'opened', { [CODE]: () => { throw new Error('cannot use opened'); } });
    expect([[...failing.adapters], [...failing.skipped]]).toEqual([[], [[CODE, 'build-failed']]]);
  });

  it('a sandbox deployment cannot hold a live client: an adapter built for the other target is thrown away', () => {
    const live = { [CODE]: () => adapterFor(CODE, 'live') };
    const built = buildAdapters(settingsOf({ target: 'sandbox' }), () => 'opened', live);
    expect([[...built.adapters], built.skipped.get(CODE)]).toEqual([[], 'wrong-target']);
    // And one that names another provider than it was asked for.
    expect(buildAdapters(settingsOf(), () => 'opened', { [CODE]: (target) => adapterFor('someone-else', target) }).skipped.get(CODE)).toBe('wrong-target');
    // The factory is told the deployment's target, and nothing else chooses it.
    const told = jest.fn((target: ProviderTarget) => adapterFor(CODE, target));
    buildAdapters(settingsOf({ target: 'live' }), () => 'opened', { [CODE]: told });
    expect(told).toHaveBeenCalledWith('live', 'opened');
  });

  it('the worker\'s gateway sends only through an adapter it holds: without one, the request did not leave, and nothing is simulated', async () => {
    const operation = { idempotencyKey: 'activate:t1', attempt: 1, action: 'activate' as const, providerCode: CODE, packageCode: 'p', msisdn: null, iccid: null };
    const empty = new RoutingProviderGateway(new Map());
    expect([empty.holds(CODE), empty.simulated, await empty.dispatches()]).toEqual([false, false, false]);
    expect(await empty.send(operation)).toEqual({ left: false, error: 'not-connected' });
    expect(await empty.run()).toEqual({ ok: false, reason: 'not-connected' });
    const send = jest.fn(async () => ({ left: true as const, answer: 'confirmed' as const, providerRef: 'R1' }));
    const holding = new RoutingProviderGateway(new Map([[CODE, { providerCode: CODE, target: 'sandbox' as const, send }]]));
    expect(await holding.send({ ...operation, providerCode: 'another' })).toEqual({ left: false, error: 'not-connected' });
    expect(send).not.toHaveBeenCalled();
    expect(await holding.send(operation)).toEqual({ left: true, answer: 'confirmed', providerRef: 'R1' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('the API and the worker are two processes, and a difference between them is never a send (item 26)', () => {
  // What each process believes, from its own settings; the worker attests only for what it may send with.
  const attested = (worker: DispatchSettings, adapter: boolean, provider: ProviderDispatchState): ProviderDispatchState =>
    maySend(worker, provider, adapter) && worker.target ? { ...provider, dispatchReadyAt: new Date(NOW.getTime() - 1_000), dispatchReadyTarget: worker.target } : { ...provider, dispatchReadyAt: null, dispatchReadyTarget: null };
  const approved = providerOf({ dispatchReadyAt: null, dispatchReadyTarget: null });
  const cases: [string, DispatchSettings, DispatchSettings, boolean, boolean][] = [
    ['both set alike, the worker holds an adapter', settingsOf(), settingsOf(), true, true],
    ['both set alike, the worker holds no adapter (this build)', settingsOf(), settingsOf(), false, false],
    ['the API is on, the worker is off', settingsOf(), settingsOf({ on: false }), true, false],
    ['the API is off, the worker is on', settingsOf({ on: false }), settingsOf(), true, false],
    ['the API names the provider, the worker does not', settingsOf(), settingsOf({ listed: false }), true, false],
    ['the worker names the provider, the API does not', settingsOf({ listed: false }), settingsOf(), true, false],
    ['the API is sandbox, the worker is live', settingsOf({ target: 'sandbox' }), settingsOf({ target: 'live' }), true, false],
    ['the API is live, the worker is sandbox', settingsOf({ target: 'live' }), settingsOf({ target: 'sandbox' }), true, false],
    ['the API has no target', settingsOf({ target: null }), settingsOf(), true, false],
    ['the worker has no target', settingsOf(), settingsOf({ target: null }), true, false],
  ];
  it.each(cases)('%s', (_name, api, worker, adapter, opens) => {
    const seen = attested(worker, adapter, approved);
    // The sale is opened on the dispatch route only when the API's own conditions hold AND the worker said it can send.
    expect(mayOpenDispatch(api, seen, NOW)).toBe(opens);
    // And whatever the API did, the worker sends only by its own conditions and its own adapter.
    expect(maySend(worker, approved, adapter)).toBe(eligibility(worker, approved).eligible && adapter);
    if (opens) expect(maySend(worker, approved, adapter)).toBe(true);
  });
});

describe('a production process that is set up for dispatch wrongly does not start', () => {
  const api = { NODE_ENV: 'production', COOKIE_SECURE: 'true', WEB_ORIGIN: 'https://admin.example.com', REDIS_URL: 'redis://redis:6379', TRUST_PROXY: '1', SECRETS_KEY: Buffer.alloc(32, 7).toString('base64') };
  const worker = { NODE_ENV: 'production', REDIS_URL: 'redis://redis:6379', DATABASE_URL: 'postgresql://user:PASSWORD-IN-URL@db:5432/smilesim' };

  it('a deployment that does not dispatch names none of the three, and starts', () => {
    expect(productionConfigProblems(api)).toEqual([]);
    expect(workerConfigProblems(worker)).toEqual([]);
    expect(() => assertWorkerConfig(worker)).not.toThrow();
    // Outside production the start-up check says nothing; the policy still refuses (above).
    expect(workerConfigProblems({ ...worker, NODE_ENV: 'development', PROVIDER_DISPATCH: '1' })).toEqual([]);
  });

  it('PROVIDER_DISPATCH=1 needs the list, the target and, on the worker, the key: each missing one is named', () => {
    const names = (problems: string[]) => problems.map((problem) => problem.split(':')[0]).sort();
    expect(names(workerConfigProblems({ ...worker, PROVIDER_DISPATCH: '1' }))).toEqual(['PROVIDER_ADAPTERS', 'PROVIDER_TARGET', 'SECRETS_KEY']);
    expect(names(productionConfigProblems({ ...api, PROVIDER_DISPATCH: '1' }))).toEqual(['PROVIDER_ADAPTERS', 'PROVIDER_TARGET']);
    expect(names(workerConfigProblems({ ...worker, PROVIDER_DISPATCH: '1', PROVIDER_TARGET: 'sandbox', SECRETS_KEY: 'too-short' }))).toEqual(['PROVIDER_ADAPTERS', 'SECRETS_KEY']);
    expect(() => assertWorkerConfig({ ...worker, PROVIDER_DISPATCH: '1' })).toThrow('Refusing to start');
  });

  it('a provider this build has no adapter for cannot be named: so today no production process starts with dispatch on', () => {
    const full = { PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: 'lian', PROVIDER_TARGET: 'sandbox' };
    expect(dispatchConfigProblems(full)).toEqual([expect.stringMatching(/^PROVIDER_ADAPTERS: names 1 provider\(s\) this build has no adapter for/)]);
    expect(productionConfigProblems({ ...api, ...full })).toHaveLength(1);
    expect(workerConfigProblems({ ...worker, ...full, SECRETS_KEY: api.SECRETS_KEY })).toHaveLength(1);
    // With an adapter in the build (S.12b), the same settings pass.
    expect(dispatchConfigProblems(full, ['lian'])).toEqual([]);
    expect(dispatchConfigProblems({ ...full, PROVIDER_ADAPTERS: 'lian,sky' }, ['lian'])).toHaveLength(1);
  });

  it('settings that contradict each other, or are not what the rule says, are refused', () => {
    expect(dispatchConfigProblems({ PROVIDER_ADAPTERS: 'lian' }, ['lian'])).toEqual([expect.stringMatching(/^PROVIDER_DISPATCH: must be "1" when/)]);
    expect(dispatchConfigProblems({ PROVIDER_TARGET: 'live' }, ['lian'])).toEqual([expect.stringMatching(/^PROVIDER_DISPATCH: must be "1" when/)]);
    expect(dispatchConfigProblems({ PROVIDER_DISPATCH: 'yes', PROVIDER_ADAPTERS: 'lian', PROVIDER_TARGET: 'live' }, ['lian']).length).toBeGreaterThan(0);
    expect(dispatchConfigProblems({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: 'lian', PROVIDER_TARGET: 'production' }, ['lian']).length).toBeGreaterThan(0);
    expect(workerConfigProblems({ ...worker, PROVIDER_SIMULATION: '1' })).toEqual([expect.stringMatching(/^PROVIDER_SIMULATION:/)]);
    expect(workerConfigProblems({ NODE_ENV: 'production' }).map((problem) => problem.split(':')[0])).toEqual(['REDIS_URL', 'DATABASE_URL']);
  });

  it('no message quotes a value: not the key, not a password in an address, not what was typed', () => {
    const secret = 'S12A-SECRET-VALUE-THAT-MUST-NOT-BE-PRINTED';
    const said = [
      ...workerConfigProblems({ NODE_ENV: 'production', REDIS_URL: `not-a-url-${secret}`, DATABASE_URL: `mysql://user:${secret}@db/x`, PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: secret.toLowerCase(), PROVIDER_TARGET: secret, SECRETS_KEY: secret, PROVIDER_SIMULATION: secret }),
      ...productionConfigProblems({ ...api, PROVIDER_DISPATCH: secret, PROVIDER_ADAPTERS: `${secret},x`, PROVIDER_TARGET: secret }),
    ].join('\n');
    expect(said).not.toContain(secret);
    expect(said.toLowerCase()).not.toContain(secret.toLowerCase());
    expect(said).not.toContain('PASSWORD-IN-URL');
  });
});

// ── What ships ────────────────────────────────────────────────────────────────────────────────────────────

const src = __dirname;
/** Every source file the application ships: no spec, nothing under a `testing` folder, not the generated client. */
function shipped(dir: string = src): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'testing' || name === 'generated' ? [] : shipped(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}
const files = shipped().map((path) => ({ path: relative(src, path), text: readFileSync(path, 'utf8') }));
const text = (path: string) => files.find((file) => file.path === path)?.text ?? '';
const code = files.flatMap((file) => file.text.split('\n').map((line) => ({ path: file.path, text: line }))).filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line.text));
const paths = (lines: { path: string }[]) => [...new Set(lines.map((line) => line.path))].sort();
/** The worker's own files: the only ones that may build an adapter or open a credential. */
const WORKER_ONLY = ['provider-dispatch.ts', 'worker.ts'];

describe('what ships: the API can decide a route and nothing more; only the worker can build an adapter', () => {
  it('the API binds one gateway by class, with no factory or setting to choose another, and no test gateway is in the build', () => {
    const binding = PROVIDERS_PROVIDERS.find((provider) => typeof provider === 'object' && 'provide' in provider && provider.provide === PROVIDER_GATEWAY);
    expect(binding).toEqual({ provide: PROVIDER_GATEWAY, useClass: SimulatedProviderGateway });
    expect(text('modules/office/providers/providers.module.ts')).not.toMatch(/useFactory|useValue|env\(|process\.env/);
    expect(paths(files.filter((file) => /implements\s+ProviderGateway/.test(file.text)))).toEqual(['modules/office/providers/dispatch/routing-gateway.ts', 'modules/office/providers/gateway/simulated-gateway.ts']);
    // Nothing shipped imports a `testing` folder (the scripted gateway, the open gate), and the build leaves them out.
    expect(paths(files.filter((file) => /from '[^']*\/testing\/[^']*'/.test(file.text) || /import\([^)]*\/testing\//.test(file.text)))).toEqual([]);
    const build = JSON.parse(readFileSync(join(src, '../tsconfig.build.json'), 'utf8')) as { exclude: string[] };
    expect(build.exclude).toEqual(expect.arrayContaining(['src/**/testing/**', 'src/**/*.spec.ts']));
  });

  it('the API\'s gateway answers the policy and sends nothing: `send` opens no connection, whatever the environment says', async () => {
    const saved = { ...process.env };
    try {
      for (const NODE_ENV of ['production', 'development', 'test']) {
        Object.assign(process.env, { NODE_ENV, PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: CODE, PROVIDER_TARGET: 'live', PROVIDER_SIMULATION: '1' });
        const gateway = new SimulatedProviderGateway();
        expect(await gateway.send()).toEqual({ left: false, error: 'not-connected' });
        // Built without the dispatch service (as a spec or a script would): it opens no dispatch route.
        expect(await gateway.dispatches(CODE)).toBe(false);
      }
    } finally {
      for (const key of ['NODE_ENV', 'PROVIDER_DISPATCH', 'PROVIDER_ADAPTERS', 'PROVIDER_TARGET', 'PROVIDER_SIMULATION']) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
    // `dispatches` is asked in one place, for the activation, and the request's hint is not part of the question.
    expect(paths(code.filter((line) => /\.dispatches\(/.test(line.text)))).toEqual(['modules/office/lines/lines.service.ts']);
    expect(text('modules/office/lines/lines.service.ts')).toContain("if (runsNow(pkg, 'activate') && (await this.gateway.dispatches(pkg.provider.code))) {");
    expect(text('modules/office/providers/gateway/simulated-gateway.ts')).toMatch(/async dispatches\(providerCode: string\): Promise<boolean> \{\n\s+return this\.dispatch \? this\.dispatch\.opens\(providerCode\) : false;/);
  });

  it('only the worker builds adapters, reads a stored credential or opens one', () => {
    // Building adapters, the routing gateway and the deployment's gate are used by the worker's two files alone.
    const users = (pattern: RegExp) => paths(code.filter((line) => pattern.test(line.text))).filter((path) => !path.startsWith('modules/office/providers/dispatch/'));
    expect(users(/\bbuildAdapters\(|\bRoutingProviderGateway\b|\bDeploymentSendGate\b|\breadCredentials\(|\bstartReadiness\(/)).toEqual(WORKER_ONLY);
    // The sealed value is selected in one place, the worker's reader; the API's service writes it and never reads it.
    expect(paths(code.filter((line) => /sealedValue: true/.test(line.text)))).toEqual(['provider-dispatch.ts']);
    expect(paths(code.filter((line) => /providerCredential\b/.test(line.text)))).toEqual(['modules/office/providers/dispatch/provider-dispatch.repository.ts', 'provider-dispatch.ts']);
    // The API's side counts and writes; it has no statement that reads the value, and nothing there opens one.
    const repository = text('modules/office/providers/dispatch/provider-dispatch.repository.ts');
    expect(repository.match(/providerCredential\.(\w+)/g)?.sort()).toEqual(['providerCredential.count', 'providerCredential.upsert']);
    for (const path of ['modules/office/providers/dispatch/provider-dispatch.repository.ts', 'modules/office/providers/dispatch/provider-dispatch.service.ts']) {
      expect(text(path)).not.toMatch(/\bopen\(|tryOpen\(|sealedValue: true|select: \{[^}]*sealedValue/);
    }
    // No adapter exists, and nothing under the providers domain or the dispatch wiring opens an outgoing connection.
    const outgoing = /\bfetch\(|from 'node:https?'|from 'https?'|from 'axios'|from 'undici'|from 'got'|XMLHttpRequest|net\.connect\(|tls\.connect\(/;
    expect(code.filter((line) => (line.path.startsWith('modules/office/providers/') || WORKER_ONLY.includes(line.path)) && outgoing.test(line.text))).toEqual([]);
    expect(text('modules/office/providers/dispatch/provider-adapters.ts')).toContain('export const ADAPTER_FACTORIES: Readonly<Record<string, AdapterFactory>> = Object.freeze({});');
  });

  it('nothing sends ungated, and the three settings are read through the policy alone', () => {
    // The dispatcher is built in one place, with the gate; it has no default; `claim` and `beginSend` are given it.
    expect(paths(code.filter((line) => /new OperationDispatcher\(/.test(line.text)))).toEqual(['provider-dispatch.ts']);
    expect(text('provider-dispatch.ts')).toContain('new OperationDispatcher(operations, gateway, gate)');
    expect(text('provider-dispatch.ts')).toMatch(/export function buildProviderDispatch\(prisma: PrismaClient, connection: IORedis, gateway: ProviderGateway, gate: SendGate, /);
    const dispatcher = text('modules/office/providers/operations/operation-dispatcher.ts');
    expect(dispatcher).toContain('this.operations.claim(operationId, new Date(), this.gate)');
    expect(dispatcher).toContain('this.operations.beginSend(operationId, attempt, new Date(), this.gate)');
    expect(text('worker.ts')).toContain('new DeploymentSendGate(settings, (code) => gateway.holds(code))');
    // The gate reads the provider's row under a lock.
    expect(text('modules/office/providers/dispatch/dispatch-gate.ts')).toMatch(/FROM "Provider" WHERE "id" = \$\{providerId\} FOR SHARE/);
    // The variables are named by the policy (which is handed an environment), the list of known names and the
    // start-up check's messages; no other file reads them.
    const readers = paths(code.filter((line) => /PROVIDER_DISPATCH\b|PROVIDER_ADAPTERS|PROVIDER_TARGETS?\b/.test(line.text) && !/PROVIDER_DISPATCH_NOTE|PROVIDER_TARGETS/.test(line.text)));
    expect(readers).toEqual(['config.ts', 'modules/office/providers/dispatch/dispatch-policy.ts', 'production-config.ts']);
    expect(paths(code.filter((line) => /\bdispatchSettings\(/.test(line.text)))).toEqual(['modules/office/providers/dispatch/dispatch-policy.ts', 'modules/office/providers/dispatch/provider-dispatch.service.ts', 'production-config.ts', 'worker.ts']);
    expect(paths(code.filter((line) => /isProduction\(\)|NODE_ENV/.test(line.text))).filter((path) => path.startsWith('modules/office/providers/dispatch/'))).toEqual([]);
  });

  it('the worker checks its settings before it opens anything', () => {
    const worker = text('worker.ts');
    const at = (needle: string) => worker.indexOf(needle);
    expect(at('assertWorkerConfig(environment);')).toBeGreaterThan(0);
    for (const opening of ['new IORedis(', 'createPrismaClient()', 'new Worker(', 'buildProviderDispatch(']) expect(at(opening)).toBeGreaterThan(at('assertWorkerConfig(environment);'));
    expect(worker.match(/buildProviderDispatch\(/g)).toHaveLength(1);
  });

  it('T1\'s step inside the opening still has one caller, and it writes through the recorder alone', () => {
    expect(paths(files.filter((file) => /\balongside\b/.test(file.text)))).toEqual(['modules/office/lines/lines.service.ts', 'modules/office/tasks/tasks.service.ts']);
    const step = /alongside: async \(tx, opened\) => \{([\s\S]*?)\n {6}\},/.exec(text('modules/office/lines/lines.service.ts'))?.[1] ?? '';
    expect(step).toContain('await this.operations.recordIn(');
    expect(step).not.toMatch(/this\.uow|runTx|prisma|this\.gateway|\.record\(/);
  });
});
