import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PROVIDER_GATEWAY } from './modules/office/providers/gateway/provider-gateway';
import { SimulatedProviderGateway } from './modules/office/providers/gateway/simulated-gateway';
import {
  READY_TTL_MS, dispatchSettings, eligibility, mayOpenDispatch, maySend, workerReady, type DispatchSettings, type ProviderDispatchState, type ProviderTarget, type WorkerAttestation,
} from './modules/office/providers/dispatch/dispatch-policy';
import { SUPPORTED_ADAPTERS } from './modules/office/providers/dispatch/adapter-manifest';
import { ADAPTER_FACTORIES, buildAdapters, type AdapterFactory, type DispatchAdapter } from './modules/office/providers/dispatch/provider-adapters';
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
const DEPLOYMENT = 'staging-1';
const settingsOf = (over: { on?: boolean; listed?: boolean; target?: ProviderTarget | null; deployment?: string | null } = {}): DispatchSettings =>
  dispatchSettings({
    ...(over.deployment === null ? {} : { DEPLOYMENT_ID: over.deployment ?? DEPLOYMENT }),
    ...(over.on === false ? {} : { PROVIDER_DISPATCH: '1' }),
    ...(over.listed === false ? { PROVIDER_ADAPTERS: 'another' } : { PROVIDER_ADAPTERS: `${CODE},another` }),
    ...(over.target === null ? {} : { PROVIDER_TARGET: over.target ?? 'sandbox' }),
  });
/** One worker's word, as its row holds it: this deployment, sandbox, generation 3, five seconds old as the database computed it. */
const said = (over: Partial<WorkerAttestation> = {}): WorkerAttestation => ({ deployment: DEPLOYMENT, target: 'sandbox', generation: 3, ageMs: 5_000, ...over });
const providerOf = (over: Partial<ProviderDispatchState> = {}): ProviderDispatchState => ({
  code: CODE, dispatchApprovedAt: new Date('2026-11-12T09:00:00.000Z'), dispatchApprovedTarget: 'sandbox', dispatchApprovedDeployment: DEPLOYMENT, dispatchPausedAt: null,
  attestations: [said()], credentialGeneration: 3, ...over,
});
const notApproved = { dispatchApprovedAt: null, dispatchApprovedTarget: null, dispatchApprovedDeployment: null };
const notReady = { attestations: [] };
/** A stored credential as the worker opened it. */
const opened = (value: string, generation = 3) => ({ value, generation });

describe('the three settings, as a deployment states them', () => {
  it('reads each condition only when it is exactly what the rule says', () => {
    expect(dispatchSettings({})).toEqual({ on: false, adapters: [], target: null, deployment: null, problems: [] });
    expect(dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: 'lian, sky', PROVIDER_TARGET: 'sandbox', DEPLOYMENT_ID: 'staging-1' })).toEqual({ on: true, adapters: ['lian', 'sky'], target: 'sandbox', deployment: 'staging-1', problems: [] });
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
    const named = { DEPLOYMENT_ID: DEPLOYMENT };
    expect(dispatchSettings({ PROVIDER_DISPATCH: '1' }).problems).toHaveLength(3);
    expect(dispatchSettings({ ...named, PROVIDER_DISPATCH: '1' }).problems).toHaveLength(2);
    expect(dispatchSettings({ ...named, PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: 'lian' }).problems).toHaveLength(1);
    expect(dispatchSettings({ ...named, PROVIDER_DISPATCH: '1', PROVIDER_TARGET: 'live' }).problems).toHaveLength(1);
    // Everything else right, one variable malformed: refused as a whole, in any environment.
    const broken = dispatchSettings({ ...named, PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: `${CODE},${CODE}`, PROVIDER_TARGET: 'sandbox' });
    expect(eligibility(broken, providerOf())).toEqual({ eligible: false, refusal: 'settings-invalid' });
    const typo = dispatchSettings({ ...named, PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: CODE, PROVIDER_TARGET: 'sandbox ', NODE_ENV: 'development' });
    expect(typo.target).toBeNull();
    expect(eligibility(typo, providerOf()).eligible).toBe(false);
  });

  it('a deployment says which one it is: with dispatch on, a missing or malformed DEPLOYMENT_ID refuses everything', () => {
    const full = { PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: CODE, PROVIDER_TARGET: 'sandbox' };
    const unnamed = dispatchSettings(full);
    expect([unnamed.deployment, unnamed.problems]).toEqual([null, [expect.stringMatching(/^DEPLOYMENT_ID: must name this deployment/)]]);
    expect(eligibility(unnamed, providerOf())).toEqual({ eligible: false, refusal: 'settings-invalid' });
    for (const value of ['Staging', 'a', 'ab', 'staging 1', 'staging_1', '-staging', 'x'.repeat(64), '*']) {
      const read = dispatchSettings({ ...full, DEPLOYMENT_ID: value });
      expect([value, read.deployment, read.problems.some((problem) => problem.startsWith('DEPLOYMENT_ID:')), eligibility(read, providerOf({ dispatchApprovedDeployment: value })).eligible]).toEqual([value, null, true, false]);
    }
    // Without dispatch, a deployment need not be named, and a name alone switches nothing on.
    expect(dispatchSettings({}).problems).toEqual([]);
    expect(dispatchSettings({ DEPLOYMENT_ID: DEPLOYMENT }).problems).toEqual([]);
    expect(eligibility(dispatchSettings({ DEPLOYMENT_ID: DEPLOYMENT }), providerOf())).toEqual({ eligible: false, refusal: 'dispatch-off' });
    // Even settings that were built by hand with no name (not through `dispatchSettings`) open nothing.
    expect(eligibility({ ...settingsOf(), deployment: null }, providerOf()).eligible).toBe(false);
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

  it('condition 4 is an approval of THIS deployment: the same target on another deployment, even on the same database, opens nothing', () => {
    // Two sandbox deployments read the same row (a shared database, or one restored from the other's backup).
    const approvedOnA = providerOf({ dispatchApprovedDeployment: 'staging-a', attestations: [said({ deployment: 'staging-a' })] });
    const a = settingsOf({ deployment: 'staging-a' });
    const b = settingsOf({ deployment: 'staging-b' });
    expect(eligibility(a, approvedOnA)).toEqual({ eligible: true, target: 'sandbox' });
    expect(eligibility(b, approvedOnA)).toEqual({ eligible: false, refusal: 'approved-for-other-deployment' });
    expect([mayOpenDispatch(a, approvedOnA), maySend(a, approvedOnA, 3)]).toEqual([true, true]);
    // B's API opens nothing and B's worker sends nothing, though B holds an adapter and the row says "approved, ready".
    expect([mayOpenDispatch(b, approvedOnA), maySend(b, approvedOnA, 3)]).toEqual([false, false]);
    // An approval with no deployment on record (as before this rule) is no approval.
    expect(eligibility(a, providerOf({ dispatchApprovedDeployment: null }))).toEqual({ eligible: false, refusal: 'not-approved' });
    // A's approval and B's worker: A's API does not believe an attestation another deployment wrote.
    expect(mayOpenDispatch(a, providerOf({ dispatchApprovedDeployment: 'staging-a', attestations: [said({ deployment: 'staging-b' })] }))).toBe(false);
    // A name is compared whole: no prefix, no case folding.
    for (const other of ['staging-a1', 'staging', 'STAGING-A', ' staging-a']) expect(eligibility(a, providerOf({ dispatchApprovedDeployment: other })).eligible).toBe(false);
  });

  it('no environment name is read: the same answers under production, staging, development and test', () => {
    for (const NODE_ENV of ['production', 'staging', 'development', 'test', undefined]) {
      const env = { NODE_ENV, PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: CODE, PROVIDER_TARGET: 'sandbox', PROVIDER_SIMULATION: '1', DEPLOYMENT_ID: DEPLOYMENT };
      expect(eligibility(dispatchSettings(env), providerOf()).eligible).toBe(true);
      expect(eligibility(dispatchSettings({ ...env, PROVIDER_DISPATCH: undefined }), providerOf()).eligible).toBe(false);
    }
  });
});

describe('the adapter is a separate question from the policy', () => {
  it('all four conditions and no adapter: the worker may not send, and the API may not open the route', () => {
    const all = settingsOf();
    expect(eligibility(all, providerOf()).eligible).toBe(true);
    expect(maySend(all, providerOf(), null)).toBe(false);
    // The API believes the worker only through a fresh attestation of its own deployment, for the same target.
    expect(mayOpenDispatch(all, providerOf(notReady))).toBe(false);
    expect(mayOpenDispatch(all, providerOf({ attestations: [said({ ageMs: READY_TTL_MS + 1 })] }))).toBe(false);
    expect(mayOpenDispatch(all, providerOf({ attestations: [said({ target: 'live' })] }))).toBe(false);
    expect(mayOpenDispatch(all, providerOf({ attestations: [said({ deployment: 'another-one' })] }))).toBe(false);
    expect(mayOpenDispatch(all, providerOf({ attestations: [said({ ageMs: -60_000 })] }))).toBe(false);
    expect(mayOpenDispatch(all, null)).toBe(false);
    // And an adapter, or an attestation, without the policy is nothing either.
    expect(maySend(settingsOf({ on: false }), providerOf(), 3)).toBe(false);
    expect(maySend(all, providerOf({ dispatchPausedAt: NOW }), 3)).toBe(false);
    expect(maySend(all, providerOf(notApproved), 3)).toBe(false);
    expect(maySend(all, null, 3)).toBe(false);
    expect(mayOpenDispatch(settingsOf({ listed: false }), providerOf())).toBe(false);
    expect(mayOpenDispatch(all, providerOf({ dispatchPausedAt: NOW }))).toBe(false);
    // Only everything together.
    expect([maySend(all, providerOf(), 3), mayOpenDispatch(all, providerOf())]).toEqual([true, true]);
    expect(workerReady(providerOf(), { target: 'sandbox', deployment: DEPLOYMENT })).toBe(true);
  });

  it('an adapter is one built from the credential stored NOW: any other generation neither sends nor counts as ready', () => {
    const all = settingsOf();
    // The credential was replaced (generation 4) and approved again; this worker still holds generation 3.
    const replaced = providerOf({ credentialGeneration: 4 });
    expect(eligibility(all, replaced).eligible).toBe(true);
    expect(maySend(all, replaced, 3)).toBe(false);
    expect(maySend(all, replaced, 4)).toBe(true);
    expect(maySend(all, replaced, 5)).toBe(false);
    // No credential stored at all: nothing to have built from.
    expect(maySend(all, providerOf({ credentialGeneration: null }), 3)).toBe(false);
    expect(maySend(all, providerOf({ credentialGeneration: undefined }), 3)).toBe(false);
    // The API: an attestation for generation 3 is not one for the credential stored now.
    expect(mayOpenDispatch(all, replaced)).toBe(false);
    expect(mayOpenDispatch(all, providerOf({ credentialGeneration: 4, attestations: [said({ generation: 4 })] }))).toBe(true);
    expect(mayOpenDispatch(all, providerOf({ attestations: [] }))).toBe(false);
    expect(mayOpenDispatch(all, providerOf({ credentialGeneration: null, attestations: [] }))).toBe(false);
  });

  it('each worker has a row of its own: one that passes is enough, and the others, whatever they say, neither help nor harm', () => {
    const all = settingsOf();
    const stale = said({ ageMs: READY_TTL_MS + 1 });
    const elsewhere = said({ deployment: 'another-one' });
    const live = said({ target: 'live' });
    const old = said({ generation: 2 });
    // None of these alone, nor all of them together, is a worker of this deployment holding the stored credential.
    for (const rows of [[], [stale], [elsewhere], [live], [old], [stale, elsewhere, live, old]]) expect(mayOpenDispatch(all, providerOf({ attestations: rows }))).toBe(false);
    // One good row among them is enough; a worker that stopped (its row gone) does not take the other's away.
    expect(mayOpenDispatch(all, providerOf({ attestations: [stale, elsewhere, said(), old] }))).toBe(true);
    expect(mayOpenDispatch(all, providerOf({ attestations: [said(), said()] }))).toBe(true);
    expect(mayOpenDispatch(all, providerOf({ attestations: [said()] }))).toBe(true);
    // Rows that nobody read (the worker's own question) are no attestation.
    expect(mayOpenDispatch(all, providerOf({ attestations: undefined }))).toBe(false);
  });

  it('the age of an attestation is judged at the edges of the minute, as the database computed it: no clock is read here', () => {
    const all = settingsOf();
    const at = (ageMs: number) => providerOf({ attestations: [said({ ageMs })] });
    expect([0, 1, READY_TTL_MS - 1, READY_TTL_MS].map((age) => mayOpenDispatch(all, at(age)))).toEqual([true, true, true, true]);
    expect([READY_TTL_MS + 1, 10 * READY_TTL_MS, -1, -60_000, Number.NaN, Number.POSITIVE_INFINITY].map((age) => mayOpenDispatch(all, at(age)))).toEqual([false, false, false, false, false, false]);
    // The policy has no clock of its own: its source names none.
    expect(text('modules/office/providers/dispatch/dispatch-policy.ts').split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n')).not.toMatch(/new Date\(|Date\.now\(/);
  });

  it('this build has no adapter: the list is empty and frozen, so a worker builds none whatever it is told', () => {
    expect(Object.keys(ADAPTER_FACTORIES)).toEqual([]);
    expect(Object.isFrozen(ADAPTER_FACTORIES)).toBe(true);
    const credential = jest.fn(() => opened('a-credential'));
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
    const credentials = (code: string) => (code === CODE ? opened('opened-credential', 7) : null);
    expect([...buildAdapters(settingsOf(), credentials, factories).adapters.keys()]).toEqual([CODE]);
    expect([...buildAdapters(settingsOf(), credentials, factories).skipped]).toEqual([['another', 'no-credential']]);
    // What was built remembers the generation of the credential it was built with.
    expect([...buildAdapters(settingsOf(), credentials, factories).generations]).toEqual([[CODE, 7]]);
    // Not named: not built, whatever the factories and the credentials say.
    expect([...buildAdapters(dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: 'another', PROVIDER_TARGET: 'sandbox', DEPLOYMENT_ID: DEPLOYMENT }), () => opened('x'), factories).adapters.keys()]).toEqual(['another']);
    // Dispatch off, no target, incoherent settings: nothing, and no credential asked for.
    const asked = jest.fn(() => opened('x'));
    expect(buildAdapters(settingsOf({ on: false }), asked, factories).adapters.size).toBe(0);
    expect(buildAdapters(dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: CODE, DEPLOYMENT_ID: DEPLOYMENT }), asked, factories).adapters.size).toBe(0);
    expect(buildAdapters(dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: `${CODE},${CODE}`, PROVIDER_TARGET: 'live', DEPLOYMENT_ID: DEPLOYMENT }), asked, factories).adapters.size).toBe(0);
    // A deployment that does not say which one it is builds nothing either.
    expect([...buildAdapters(settingsOf({ deployment: null }), asked, factories).skipped.values()]).toEqual(['settings-invalid', 'settings-invalid']);
    expect(asked).not.toHaveBeenCalled();
  });

  it('a credential that is missing, empty or does not open builds nothing: never an adapter with an empty secret', () => {
    const made = jest.fn(factories[CODE]);
    const only = { [CODE]: made as AdapterFactory };
    const one = dispatchSettings({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: CODE, PROVIDER_TARGET: 'sandbox', DEPLOYMENT_ID: DEPLOYMENT });
    expect([...buildAdapters(one, () => null, only).skipped]).toEqual([[CODE, 'no-credential']]);
    expect([...buildAdapters(one, () => opened(''), only).skipped]).toEqual([[CODE, 'no-credential']]);
    expect([...buildAdapters(one, () => { throw new Error('bad key: SECRET-TEXT'); }, only).skipped]).toEqual([[CODE, 'credential-unreadable']]);
    expect(made).not.toHaveBeenCalled();
    // A factory that fails says so by a code; its error, which might quote the credential, goes nowhere.
    const failing = buildAdapters(one, () => opened('opened'), { [CODE]: () => { throw new Error('cannot use opened'); } });
    expect([[...failing.adapters], [...failing.skipped]]).toEqual([[], [[CODE, 'build-failed']]]);
  });

  it('a sandbox deployment cannot hold a live client: an adapter built for the other target is thrown away', () => {
    const live = { [CODE]: () => adapterFor(CODE, 'live') };
    const built = buildAdapters(settingsOf({ target: 'sandbox' }), () => opened('opened'), live);
    expect([[...built.adapters], built.skipped.get(CODE)]).toEqual([[], 'wrong-target']);
    // And one that names another provider than it was asked for.
    expect(buildAdapters(settingsOf(), () => opened('opened'), { [CODE]: (target) => adapterFor('someone-else', target) }).skipped.get(CODE)).toBe('wrong-target');
    // The factory is told the deployment's target, and nothing else chooses it.
    const told = jest.fn((target: ProviderTarget) => adapterFor(CODE, target));
    buildAdapters(settingsOf({ target: 'live' }), () => opened('opened'), { [CODE]: told });
    expect(told).toHaveBeenCalledWith('live', 'opened');
  });

  it('the worker\'s gateway sends only through an adapter it holds: without one, the request did not leave, and nothing is simulated', async () => {
    const operation = { idempotencyKey: 'activate:t1', attempt: 1, action: 'activate' as const, providerCode: CODE, packageCode: 'p', msisdn: null, iccid: null };
    const empty = new RoutingProviderGateway();
    expect([empty.holds(CODE), empty.generation(CODE), empty.simulated, await empty.dispatches()]).toEqual([false, null, false, false]);
    expect(await empty.send(operation)).toEqual({ left: false, error: 'not-connected' });
    expect(await empty.run()).toEqual({ ok: false, reason: 'not-connected' });
    const send = jest.fn(async () => ({ left: true as const, answer: 'confirmed' as const, providerRef: 'R1' }));
    const holding = new RoutingProviderGateway({ adapters: new Map([[CODE, { providerCode: CODE, target: 'sandbox' as const, send }]]), generations: new Map([[CODE, 3]]) });
    expect([holding.holds(CODE), holding.generation(CODE), holding.generation('another'), holding.held()]).toEqual([true, 3, null, [CODE]]);
    expect(await holding.send({ ...operation, providerCode: 'another' })).toEqual({ left: false, error: 'not-connected' });
    expect(send).not.toHaveBeenCalled();
    expect(await holding.send(operation)).toEqual({ left: true, answer: 'confirmed', providerRef: 'R1' });
    expect(send).toHaveBeenCalledTimes(1);
    // Rebuilt after a credential was written: the old adapter, with the credential it was given, is dropped whole.
    const next = jest.fn(async () => ({ left: true as const, answer: 'confirmed' as const, providerRef: 'R2' }));
    holding.use({ adapters: new Map([[CODE, { providerCode: CODE, target: 'sandbox' as const, send: next }]]), generations: new Map([[CODE, 4]]) });
    expect(holding.generation(CODE)).toBe(4);
    expect(await holding.send(operation)).toEqual({ left: true, answer: 'confirmed', providerRef: 'R2' });
    expect([send.mock.calls.length, next.mock.calls.length]).toEqual([1, 1]);
    holding.use({ adapters: new Map(), generations: new Map([[CODE, 4]]) });
    expect([holding.holds(CODE), holding.generation(CODE), await holding.send(operation)]).toEqual([false, null, { left: false, error: 'not-connected' }]);
  });
});

describe('the API and the worker are two processes, and a difference between them is never a send (item 26)', () => {
  // What each process believes, from its own settings; the worker attests only for what it may send with.
  const held = (adapter: boolean) => (adapter ? 3 : null);
  const attested = (worker: DispatchSettings, adapter: boolean, provider: ProviderDispatchState): ProviderDispatchState =>
    maySend(worker, provider, held(adapter)) && worker.target && worker.deployment
      ? { ...provider, attestations: [said({ ageMs: 1_000, target: worker.target, deployment: worker.deployment, generation: 3 })] }
      : { ...provider, ...notReady };
  const approved = providerOf(notReady);
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
    ['the worker is another deployment\'s', settingsOf(), settingsOf({ deployment: 'staging-2' }), true, false],
    ['the API is another deployment\'s', settingsOf({ deployment: 'staging-2' }), settingsOf(), true, false],
    ['the API does not say which deployment it is', settingsOf({ deployment: null }), settingsOf(), true, false],
    ['the worker does not say which deployment it is', settingsOf(), settingsOf({ deployment: null }), true, false],
  ];
  it.each(cases)('%s', (_name, api, worker, adapter, opens) => {
    const seen = attested(worker, adapter, approved);
    // The sale is opened on the dispatch route only when the API's own conditions hold AND the worker said it can send.
    expect(mayOpenDispatch(api, seen)).toBe(opens);
    // And whatever the API did, the worker sends only by its own conditions and its own adapter.
    expect(maySend(worker, approved, held(adapter))).toBe(eligibility(worker, approved).eligible && adapter);
    if (opens) expect(maySend(worker, approved, held(adapter))).toBe(true);
  });
});

describe('a production process that is set up for dispatch wrongly does not start', () => {
  const api = { NODE_ENV: 'production', COOKIE_SECURE: 'true', WEB_ORIGIN: 'https://admin.example.com', REDIS_URL: 'redis://redis:6379', TRUST_PROXY: '1', SECRETS_KEY: Buffer.alloc(32, 7).toString('base64') };
  // The worker's own variables, and nothing of the HTTP API's (no cookie, origin or proxy setting).
  const worker = { NODE_ENV: 'production', REDIS_URL: 'redis://redis:6379', DATABASE_URL: 'postgresql://user:PASSWORD-IN-URL@db:5432/smilesim', SECRETS_KEY: Buffer.alloc(32, 9).toString('base64') };

  it('a deployment that does not dispatch names none of the three, and starts', () => {
    expect(productionConfigProblems(api)).toEqual([]);
    expect(workerConfigProblems(worker)).toEqual([]);
    expect(() => assertWorkerConfig(worker)).not.toThrow();
    // Outside production the start-up check says nothing; the policy still refuses (above).
    expect(workerConfigProblems({ ...worker, NODE_ENV: 'development', PROVIDER_DISPATCH: '1' })).toEqual([]);
  });

  it('a production worker needs SECRETS_KEY whether or not it dispatches: it settles eSIM activations, whose codes are stored sealed', () => {
    const noKey = (value: string | undefined) => workerConfigProblems({ ...worker, SECRETS_KEY: value });
    // Sending off, and no key, an empty one, one that is not base64 of 32 bytes: each stops the worker.
    for (const value of [undefined, '', 'not-a-key', Buffer.alloc(16, 1).toString('base64'), Buffer.alloc(33, 1).toString('base64'), Buffer.alloc(31, 1).toString('base64')]) {
      expect([value, noKey(value)]).toEqual([value, [expect.stringMatching(/^SECRETS_KEY: must be 32 random bytes in base64/)]]);
      expect(() => assertWorkerConfig({ ...worker, SECRETS_KEY: value })).toThrow('Refusing to start');
    }
    expect(noKey(Buffer.alloc(32, 200).toString('base64'))).toEqual([]);
    // The message names the rule and never the value.
    expect(noKey('S12B0-A-KEY-THAT-IS-NOT-ONE').join(' ')).not.toContain('S12B0-');
    // Outside production the check says nothing, as for every other setting.
    expect(workerConfigProblems({ ...worker, NODE_ENV: 'development', SECRETS_KEY: undefined })).toEqual([]);
    // Nothing of the HTTP API's is asked of the worker, set or not.
    const httpOnly = { COOKIE_SECURE: 'false', WEB_ORIGIN: 'http://not-https', TRUST_PROXY: 'nonsense', COOKIE_DOMAIN: '', WEBAUTHN_RP_ID: '', PORT: 'x', TRIAL_SEED: 'true' };
    expect(workerConfigProblems({ ...worker, ...httpOnly })).toEqual([]);
    // And the API's own check is not relaxed or tightened by this: it always needed the key.
    expect(productionConfigProblems({ ...api, SECRETS_KEY: undefined }).map((problem) => problem.split(':')[0])).toEqual(['SECRETS_KEY']);
  });

  it('PROVIDER_DISPATCH=1 needs the list, the target, the deployment\'s name and, on the worker, the key: each missing one is named', () => {
    const names = (problems: string[]) => problems.map((problem) => problem.split(':')[0]).sort();
    expect(names(workerConfigProblems({ ...worker, PROVIDER_DISPATCH: '1', SECRETS_KEY: undefined }))).toEqual(['DEPLOYMENT_ID', 'PROVIDER_ADAPTERS', 'PROVIDER_TARGET', 'SECRETS_KEY']);
    expect(names(productionConfigProblems({ ...api, PROVIDER_DISPATCH: '1' }))).toEqual(['DEPLOYMENT_ID', 'PROVIDER_ADAPTERS', 'PROVIDER_TARGET']);
    expect(names(workerConfigProblems({ ...worker, PROVIDER_DISPATCH: '1', PROVIDER_TARGET: 'sandbox', SECRETS_KEY: 'too-short', DEPLOYMENT_ID: 'staging-1' }))).toEqual(['PROVIDER_ADAPTERS', 'SECRETS_KEY']);
    expect(names(productionConfigProblems({ ...api, PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: 'lian', PROVIDER_TARGET: 'sandbox', DEPLOYMENT_ID: 'Not A Name' }))).toEqual(['DEPLOYMENT_ID', 'PROVIDER_ADAPTERS']);
    // A name alone, on a deployment that does not dispatch, is no problem.
    expect(productionConfigProblems({ ...api, DEPLOYMENT_ID: 'production-1' })).toEqual([]);
    expect(() => assertWorkerConfig({ ...worker, PROVIDER_DISPATCH: '1' })).toThrow('Refusing to start');
  });

  it('a provider this build has no adapter for cannot be named: so today no production process starts with dispatch on', () => {
    const full = { PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: 'lian', PROVIDER_TARGET: 'sandbox', DEPLOYMENT_ID: 'staging-1' };
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
    expect(dispatchConfigProblems({ PROVIDER_DISPATCH: 'yes', PROVIDER_ADAPTERS: 'lian', PROVIDER_TARGET: 'live', DEPLOYMENT_ID: 'staging-1' }, ['lian']).length).toBeGreaterThan(0);
    expect(dispatchConfigProblems({ PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: 'lian', PROVIDER_TARGET: 'production', DEPLOYMENT_ID: 'staging-1' }, ['lian']).length).toBeGreaterThan(0);
    expect(workerConfigProblems({ ...worker, PROVIDER_SIMULATION: '1' })).toEqual([expect.stringMatching(/^PROVIDER_SIMULATION:/)]);
    expect(workerConfigProblems({ NODE_ENV: 'production' }).map((problem) => problem.split(':')[0])).toEqual(['REDIS_URL', 'DATABASE_URL', 'SECRETS_KEY']);
  });

  it('no message quotes a value: not the key, not a password in an address, not what was typed', () => {
    const secret = 'S12A-SECRET-VALUE-THAT-MUST-NOT-BE-PRINTED';
    const said = [
      ...workerConfigProblems({ NODE_ENV: 'production', REDIS_URL: `not-a-url-${secret}`, DATABASE_URL: `mysql://user:${secret}@db/x`, PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: secret.toLowerCase(), PROVIDER_TARGET: secret, SECRETS_KEY: secret, PROVIDER_SIMULATION: secret, DEPLOYMENT_ID: secret }),
      ...productionConfigProblems({ ...api, PROVIDER_DISPATCH: secret, PROVIDER_ADAPTERS: `${secret},x`, PROVIDER_TARGET: secret, DEPLOYMENT_ID: `${secret} x` }),
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

/**
 * Every shipped file a process loads when it starts from `entry`: the files it imports, and theirs. An
 * `import type` loads nothing and is not followed; any other import or re-export is.
 */
function loadedFrom(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    const source = text(path);
    for (const found of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;'"]*?from\s+'(\.[^']+)'|(?:^|\n)\s*import\s+'(\.[^']+)'|(?:require|import)\(\s*'(\.[^']+)'\s*\)/g)) {
      if (found[1]) continue;
      const target = join(src, path, '..', found[2] ?? found[3] ?? found[4]);
      const file = [`${target}.ts`, join(target, 'index.ts')].map((candidate) => relative(src, candidate)).find((candidate) => files.some((known) => known.path === candidate));
      if (file) visit(file);
    }
  };
  visit(entry);
  return [...seen].sort();
}

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
        Object.assign(process.env, { NODE_ENV, PROVIDER_DISPATCH: '1', PROVIDER_ADAPTERS: CODE, PROVIDER_TARGET: 'live', PROVIDER_SIMULATION: '1', DEPLOYMENT_ID: DEPLOYMENT });
        const gateway = new SimulatedProviderGateway();
        expect(await gateway.send()).toEqual({ left: false, error: 'not-connected' });
        // Built without the dispatch service (as a spec or a script would): it opens no dispatch route.
        expect(await gateway.dispatches(CODE)).toBe(false);
      }
    } finally {
      for (const key of ['NODE_ENV', 'PROVIDER_DISPATCH', 'PROVIDER_ADAPTERS', 'PROVIDER_TARGET', 'PROVIDER_SIMULATION', 'DEPLOYMENT_ID']) {
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
    // The table is read by SQL in two places, both the worker's and both for the generation alone: the gate and the attestation.
    const rawReads = code.filter((line) => /FROM "ProviderCredential"/.test(line.text));
    expect(paths(rawReads)).toEqual(['modules/office/providers/dispatch/dispatch-gate.ts', 'provider-dispatch.ts']);
    expect(rawReads.every((line) => /SELECT "generation" FROM "ProviderCredential"/.test(line.text))).toBe(true);
    // The API's side counts and writes; it has no statement that reads the value, and nothing there opens one.
    const repository = text('modules/office/providers/dispatch/provider-dispatch.repository.ts');
    expect(repository.match(/providerCredential\.(\w+)/g)?.sort()).toEqual(['providerCredential.count', 'providerCredential.upsert']);
    expect(repository).toContain('credentials: { where: { target: target ?? \'\' }, select: { generation: true } }');
    for (const path of ['modules/office/providers/dispatch/provider-dispatch.repository.ts', 'modules/office/providers/dispatch/provider-dispatch.service.ts']) {
      expect(text(path)).not.toMatch(/\bopen\(|tryOpen\(|sealedValue: true|select: \{[^}]*sealedValue/);
    }
    // No adapter exists, and nothing under the providers domain or the dispatch wiring opens an outgoing connection.
    const outgoing = /\bfetch\(|from 'node:https?'|from 'https?'|from 'axios'|from 'undici'|from 'got'|XMLHttpRequest|net\.connect\(|tls\.connect\(/;
    expect(code.filter((line) => (line.path.startsWith('modules/office/providers/') || WORKER_ONLY.includes(line.path)) && outgoing.test(line.text))).toEqual([]);
    expect(text('modules/office/providers/dispatch/provider-adapters.ts')).toContain('export const ADAPTER_FACTORIES: Readonly<Record<string, AdapterFactory>> = Object.freeze({});');
  });

  it('the manifest of codes, the worker\'s registry and the worker\'s attestation are three things, and the API loads only the first', () => {
    const REGISTRY = 'modules/office/providers/dispatch/provider-adapters.ts';
    const MANIFEST = 'modules/office/providers/dispatch/adapter-manifest.ts';
    // The manifest is names and nothing else: it imports nothing, and is the registry's keys exactly.
    expect(text(MANIFEST)).not.toMatch(/^\s*(import|export)\s[^;]*from\s|\brequire\(/m);
    expect(Object.isFrozen(SUPPORTED_ADAPTERS)).toBe(true);
    expect([...SUPPORTED_ADAPTERS].sort()).toEqual(Object.keys(ADAPTER_FACTORIES).sort());
    // Everything the API process loads, from its entry point: not the registry, not the routing gateway, not the
    // worker's wiring. So an adapter added to the registry (S.12b), and whatever it imports to reach its provider,
    // never becomes part of the API.
    const api = loadedFrom('main.ts');
    expect(api.length).toBeGreaterThan(100);
    expect(api).toEqual(expect.arrayContaining(['app.module.ts', 'production-config.ts', MANIFEST, 'modules/office/providers/dispatch/dispatch-policy.ts', 'modules/office/providers/dispatch/provider-dispatch.service.ts']));
    const workerSide = [REGISTRY, 'modules/office/providers/dispatch/routing-gateway.ts', 'modules/office/providers/dispatch/dispatch-gate.ts', 'provider-dispatch.ts', 'worker.ts'];
    expect(api.filter((path) => workerSide.includes(path))).toEqual([]);
    // The worker loads all of them.
    expect(loadedFrom('worker.ts')).toEqual(expect.arrayContaining(workerSide));
    // The registry has one importer that loads it, the worker; the start-up check reads the manifest.
    const importers = (file: string) => paths(files.filter((other) => other.path !== file && loadedFrom(other.path).includes(file) && new RegExp(`from '[^']*/${file.split('/').pop()?.replace('.ts', '')}'`).test(other.text) && !new RegExp(`import type [^;]*from '[^']*/${file.split('/').pop()?.replace('.ts', '')}'`).test(other.text)));
    expect(importers(REGISTRY)).toEqual(['modules/office/providers/dispatch/routing-gateway.ts', 'worker.ts']);
    expect(text('production-config.ts')).toContain("import { SUPPORTED_ADAPTERS } from './modules/office/providers/dispatch/adapter-manifest';");
    expect(text('production-config.ts')).not.toMatch(/provider-adapters|ADAPTER_FACTORIES/);
    // The API needs no provider credential to start: its check names no such thing, and it has no reader of one.
    expect(productionConfigProblems({ NODE_ENV: 'production', COOKIE_SECURE: 'true', WEB_ORIGIN: 'https://admin.example.com', REDIS_URL: 'redis://redis:6379', TRUST_PROXY: '1', SECRETS_KEY: Buffer.alloc(32, 7).toString('base64') })).toEqual([]);
    expect(api.filter((path) => /sealedValue: true/.test(text(path)))).toEqual([]);
    // The API's own answer comes from the worker's word in the database, not from the manifest: nothing on the
    // API's side reads the list to decide a route.
    expect(paths(code.filter((line) => /SUPPORTED_ADAPTERS/.test(line.text)))).toEqual([MANIFEST, 'production-config.ts']);
  });

  it('nothing sends ungated, and the three settings are read through the policy alone', () => {
    // The dispatcher is built in one place, with the gate; it has no default; `claim` and `beginSend` are given it.
    expect(paths(code.filter((line) => /new OperationDispatcher\(/.test(line.text)))).toEqual(['provider-dispatch.ts']);
    expect(text('provider-dispatch.ts')).toContain('new OperationDispatcher(operations, gate)');
    expect(text('provider-dispatch.ts')).toMatch(/export function buildProviderDispatch\(prisma: PrismaClient, connection: IORedis, gate: SendGate, /);
    const dispatcher = text('modules/office/providers/operations/operation-dispatcher.ts');
    expect(dispatcher).toContain('this.operations.claim(operationId, new Date(), this.gate)');
    expect(dispatcher).toContain('this.operations.beginSend(operationId, attempt, new Date(), this.gate)');
    expect(text('worker.ts')).toContain('new DeploymentSendGate(settings, (code) => gateway.sender(code))');
    // The dispatcher holds no gateway: the one way it has to a provider is the permit the gate gave at the mark.
    const dispatcherCode = code.filter((line) => line.path === 'modules/office/providers/operations/operation-dispatcher.ts').map((line) => line.text).join('\n');
    expect(dispatcherCode).not.toMatch(/gateway/i);
    expect(dispatcherCode.match(/\.send\(/g)).toEqual(['.send(', '.send(']);
    expect(dispatcher).toContain('Promise.race([permit.send(outgoing), waited])');
    expect(dispatcher).toContain('constructor(private readonly operations: ProviderOperationsService, private readonly gate: SendGate, private readonly callTimeoutMs: number = CALL_TIMEOUT_MS) {}');
    // The permit is the one answered in the transaction that wrote the mark.
    expect(text('modules/office/providers/operations/provider-operations.service.ts')).toMatch(/const permit = await gate\.permits\(tx, row\.providerId\);\n\s+if \(permit !== null\) return \(await this\.repo\.markSent\(tx, id, attempt, now\)\) \? \{ permit \} : null;\n\s+await this\.handBack\(tx, id, attempt\);/);
    // What the worker holds is read once in the gate, after the lock and the stored generation.
    const gate = text('modules/office/providers/dispatch/dispatch-gate.ts');
    expect(gate.match(/this\.held\(/g)).toHaveLength(1);
    expect(gate.indexOf('this.held(')).toBeGreaterThan(gate.indexOf('FROM "ProviderCredential"'));
    // The gate reads the provider's row under a lock.
    expect(text('modules/office/providers/dispatch/dispatch-gate.ts')).toMatch(/FROM "Provider" WHERE "id" = \$\{providerId\} FOR SHARE/);
    // An attempt the gate refuses at the mark is handed back in the same transaction, and recovery is given the gate.
    expect(text('provider-dispatch.ts')).toContain('recoverExpired(parts.operations, new Date(), 100, parts.gate)');
    // The variables are named by the policy (which is handed an environment), the list of known names and the
    // start-up check's messages; no other file reads them.
    const readers = paths(code.filter((line) => /PROVIDER_DISPATCH\b|PROVIDER_ADAPTERS|PROVIDER_TARGETS?\b|DEPLOYMENT_ID/.test(line.text) && !/PROVIDER_DISPATCH_NOTE|PROVIDER_TARGETS/.test(line.text)));
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
