// When a provider's operations may be dispatched (ADR 0019, D18). Pure: no Nest, no Prisma, no environment read.
// The API and the worker are two processes with their own settings; both ask these functions, each with what it
// knows, and every question that cannot be answered "yes" for certain is answered "no".
//
// Three things are kept apart:
//   1. the POLICY: the four conditions of D18 (`eligibility`);
//   2. the ADAPTER: whether this process has built one for the provider (the worker's `AdapterRegistry`), or, for
//      the API, whether the worker attested that it has (`workerReady`);
//   3. the SEND: `maySend`, which needs both, and is asked under the provider's row lock (`dispatch-gate.ts`).
// No environment name relaxes any of them.

export const PROVIDER_TARGETS = ['sandbox', 'live'] as const;
export type ProviderTarget = (typeof PROVIDER_TARGETS)[number];

/** A provider code as it may be named in `PROVIDER_ADAPTERS`: what `Provider.code` holds. */
const ADAPTER_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** What a deployment says about dispatch: conditions 1 to 3, as its environment states them. */
export type DispatchSettings = {
  /** Condition 1: `PROVIDER_DISPATCH` is exactly `1`. */
  on: boolean;
  /** Condition 2: the provider codes named in `PROVIDER_ADAPTERS`. Empty when it is unset or malformed. */
  adapters: readonly string[];
  /** Condition 3: `PROVIDER_TARGET`, when it is exactly `sandbox` or `live`. */
  target: ProviderTarget | null;
  /** What is wrong with the three variables as written, by name and rule, never by value. Empty when coherent. */
  problems: readonly string[];
};

type Env = Record<string, string | undefined>;

/**
 * Reads conditions 1 to 3 from an environment. Anything that is not exactly what the rule says is "not set": a
 * malformed list names no adapter, a target that is not one of the two is no target, `true` is not `1`. The
 * settings are also judged as a whole (`problems`): dispatch on without a list or a target, a list or a target
 * with dispatch off, a name repeated, a name that is not a provider code.
 */
export function dispatchSettings(env: Env): DispatchSettings {
  const raw = { on: env.PROVIDER_DISPATCH ?? '', adapters: env.PROVIDER_ADAPTERS ?? '', target: env.PROVIDER_TARGET ?? '' };
  const problems: string[] = [];
  const on = raw.on === '1';
  if (raw.on !== '' && raw.on !== '1' && raw.on !== '0') problems.push('PROVIDER_DISPATCH: must be unset, "0" or "1".');

  const names = raw.adapters === '' ? [] : raw.adapters.split(',').map((name) => name.trim());
  const wellFormed = names.every((name) => ADAPTER_NAME.test(name)) && new Set(names).size === names.length;
  if (!wellFormed) problems.push('PROVIDER_ADAPTERS: must be a comma-separated list of provider codes, each named once.');
  const adapters = wellFormed ? names : [];

  const target = (PROVIDER_TARGETS as readonly string[]).includes(raw.target) ? (raw.target as ProviderTarget) : null;
  if (raw.target !== '' && !target) problems.push('PROVIDER_TARGET: must be "sandbox" or "live".');

  if (on && adapters.length === 0) problems.push('PROVIDER_ADAPTERS: must name at least one provider when PROVIDER_DISPATCH is "1".');
  if (on && !target) problems.push('PROVIDER_TARGET: must be "sandbox" or "live" when PROVIDER_DISPATCH is "1".');
  return { on, adapters, target, problems };
}

/** What the database says of one provider: condition 4, and the worker's attestation. */
export type ProviderDispatchState = {
  code: string;
  dispatchApprovedAt: Date | null;
  dispatchApprovedTarget: string | null;
  dispatchPausedAt: Date | null;
  dispatchReadyAt?: Date | null;
  dispatchReadyTarget?: string | null;
};

/** Why a provider is not eligible, the first condition that fails, in D18's order. */
export type DispatchRefusal =
  /** The settings are incoherent as a whole: nothing is dispatched on a deployment that is set up wrongly. */
  | 'settings-invalid'
  /** Condition 1. */
  | 'dispatch-off'
  /** Condition 2. */
  | 'not-listed'
  /** Condition 3. */
  | 'no-target'
  /** Condition 4: never approved on this deployment. */
  | 'not-approved'
  /** Condition 4: approved, for the other target. */
  | 'approved-for-other-target'
  /** Condition 4: approved and paused. */
  | 'paused';

export type Eligibility = { eligible: true; target: ProviderTarget } | { eligible: false; refusal: DispatchRefusal };

/**
 * The four conditions of D18, all of them: dispatch is on, the provider is named, the target is stated, and the
 * owner approved this provider for this target and has not paused it. One that is missing is a refusal; so are
 * settings that do not hold together. Nothing else is read: no environment name, no request field.
 */
export function eligibility(settings: DispatchSettings, provider: ProviderDispatchState | null): Eligibility {
  const refuse = (refusal: DispatchRefusal): Eligibility => ({ eligible: false, refusal });
  if (settings.problems.length > 0) return refuse('settings-invalid');
  if (!settings.on) return refuse('dispatch-off');
  if (!provider || !settings.adapters.includes(provider.code)) return refuse('not-listed');
  if (!settings.target) return refuse('no-target');
  if (!provider.dispatchApprovedAt || !provider.dispatchApprovedTarget) return refuse('not-approved');
  if (provider.dispatchApprovedTarget !== settings.target) return refuse('approved-for-other-target');
  if (provider.dispatchPausedAt) return refuse('paused');
  return { eligible: true, target: settings.target };
}

/** How often the worker repeats its attestation, and how long one is believed. */
export const READY_EVERY_MS = 20_000;
export const READY_TTL_MS = 60_000;

/**
 * Whether the worker has said, recently and for this target, that it holds an adapter for the provider. The API
 * cannot see the worker's settings or what it built, so this is the only thing it believes about them. A worker
 * that stopped, was set up for another target, or was never given the adapter leaves no fresh attestation.
 */
export function workerReady(provider: ProviderDispatchState, target: ProviderTarget, now: Date): boolean {
  if (!provider.dispatchReadyAt || provider.dispatchReadyTarget !== target) return false;
  const age = now.getTime() - provider.dispatchReadyAt.getTime();
  return age >= 0 && age <= READY_TTL_MS;
}

/**
 * The API's question (D13): may an activation at this provider be opened on the dispatch route? The four
 * conditions as the API's own settings and the database state them, **and** the worker's fresh attestation for
 * the same target. Any disagreement between the two processes answers no, and the sale takes the manual route.
 */
export function mayOpenDispatch(settings: DispatchSettings, provider: ProviderDispatchState | null, now: Date): boolean {
  const judged = eligibility(settings, provider);
  return judged.eligible && provider !== null && workerReady(provider, judged.target, now);
}

/**
 * The worker's question, asked under the provider's row lock before an attempt is claimed and again before it is
 * marked as sent: the four conditions as the worker's own settings and the database state them, **and** an adapter
 * this worker built for that provider. Without one there is nothing to send with, whatever the conditions say.
 */
export function maySend(settings: DispatchSettings, provider: ProviderDispatchState | null, adapterBuilt: boolean): boolean {
  return eligibility(settings, provider).eligible && adapterBuilt;
}
