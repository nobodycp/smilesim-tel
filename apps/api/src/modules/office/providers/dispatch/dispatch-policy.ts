// When a provider's operations may be dispatched (ADR 0019, D18). Pure: no Nest, no Prisma, no environment read.
// The API and the worker are two processes with their own settings; both ask these functions, each with what it
// knows, and every question that cannot be answered "yes" for certain is answered "no".
//
// Three things are kept apart:
//   1. the POLICY: the four conditions of D18 (`eligibility`);
//   2. the ADAPTER: whether this process has built one for the provider from the credential now stored (the
//      worker's registry, `provider-adapters.ts`), or, for the API, whether the worker attested that it has
//      (`workerReady`);
//   3. the SEND: `maySend`, which needs both, and is asked under the provider's row lock (`dispatch-gate.ts`).
// No environment name relaxes any of them.
//
// "This deployment" is a name, `DEPLOYMENT_ID`, not a target: `sandbox` and `live` say which of the provider's
// systems is called, and two deployments may call the same one. An approval and a worker's attestation are
// written with the deployment's name and read back against it, so neither stands for another deployment that
// shares the database or was restored from its backup.

export const PROVIDER_TARGETS = ['sandbox', 'live'] as const;
export type ProviderTarget = (typeof PROVIDER_TARGETS)[number];

/** A provider code as it may be named in `PROVIDER_ADAPTERS`: what `Provider.code` holds. */
const ADAPTER_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A deployment's name as `DEPLOYMENT_ID` may state it: 3 to 63 lower-case letters, digits or `-`. The database checks the same. */
const DEPLOYMENT_NAME = /^[a-z0-9][a-z0-9-]{2,62}$/;

/** What a deployment says about dispatch: conditions 1 to 3, as its environment states them. */
export type DispatchSettings = {
  /** Condition 1: `PROVIDER_DISPATCH` is exactly `1`. */
  on: boolean;
  /** Condition 2: the provider codes named in `PROVIDER_ADAPTERS`. Empty when it is unset or malformed. */
  adapters: readonly string[];
  /** Condition 3: `PROVIDER_TARGET`, when it is exactly `sandbox` or `live`. */
  target: ProviderTarget | null;
  /** Which deployment this is: `DEPLOYMENT_ID`, when it is a name. What "this deployment" means in condition 4. */
  deployment: string | null;
  /** What is wrong with the three variables as written, by name and rule, never by value. Empty when coherent. */
  problems: readonly string[];
};

type Env = Record<string, string | undefined>;

/**
 * Reads conditions 1 to 3 from an environment. Anything that is not exactly what the rule says is "not set": a
 * malformed list names no adapter, a target that is not one of the two is no target, `true` is not `1`. The
 * settings are also judged as a whole (`problems`): dispatch on without a list, a target or the deployment's
 * name, a name repeated, a name that is not a provider code.
 */
export function dispatchSettings(env: Env): DispatchSettings {
  const raw = { on: env.PROVIDER_DISPATCH ?? '', adapters: env.PROVIDER_ADAPTERS ?? '', target: env.PROVIDER_TARGET ?? '', deployment: env.DEPLOYMENT_ID ?? '' };
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
  const deployment = DEPLOYMENT_NAME.test(raw.deployment) ? raw.deployment : null;
  if (raw.deployment !== '' && !deployment) problems.push('DEPLOYMENT_ID: must be 3 to 63 lower-case letters, digits or "-", starting with a letter or a digit.');

  if (on && !target) problems.push('PROVIDER_TARGET: must be "sandbox" or "live" when PROVIDER_DISPATCH is "1".');
  if (on && raw.deployment === '') problems.push('DEPLOYMENT_ID: must name this deployment when PROVIDER_DISPATCH is "1"; approvals are given to a deployment by name.');
  return { on, adapters, target, deployment, problems };
}

/** One worker process's word that it holds an adapter for a provider, as the database holds it. */
/**
 * `ageMs` is how long ago it was written, **as the database computed it** from its own clock: no process's clock
 * is part of it.
 */
export type WorkerAttestation = { deployment: string; target: string; generation: number; ageMs: number };

/** What the database says of one provider: condition 4, the worker's attestation, and its credential's generation. */
export type ProviderDispatchState = {
  code: string;
  dispatchApprovedAt: Date | null;
  dispatchApprovedTarget: string | null;
  dispatchApprovedDeployment: string | null;
  dispatchPausedAt: Date | null;
  /** What workers attested for this provider: one row a worker process. Absent where nobody asked for them. */
  attestations?: readonly WorkerAttestation[];
  /** The generation of the credential stored for the asking deployment's target; null when none is stored. */
  credentialGeneration?: number | null;
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
  /** Condition 4: approved, on another deployment. */
  | 'approved-for-other-deployment'
  /** Condition 4: approved, for the other target. */
  | 'approved-for-other-target'
  /** Condition 4: approved and paused. */
  | 'paused';

export type Eligibility = { eligible: true; target: ProviderTarget } | { eligible: false; refusal: DispatchRefusal };

/**
 * The four conditions of D18, all of them: dispatch is on, the provider is named, the target is stated, and the
 * owner approved this provider **on this deployment, for this target** and has not paused it. One that is missing
 * is a refusal; so are settings that do not hold together, and a deployment that does not say which one it is.
 * Nothing else is read: no environment name, no request field.
 */
export function eligibility(settings: DispatchSettings, provider: ProviderDispatchState | null): Eligibility {
  const refuse = (refusal: DispatchRefusal): Eligibility => ({ eligible: false, refusal });
  if (settings.problems.length > 0) return refuse('settings-invalid');
  if (!settings.on) return refuse('dispatch-off');
  if (!provider || !settings.adapters.includes(provider.code)) return refuse('not-listed');
  if (!settings.target) return refuse('no-target');
  // A deployment with no name cannot be the one an approval was given to.
  if (!settings.deployment) return refuse('settings-invalid');
  if (!provider.dispatchApprovedAt || !provider.dispatchApprovedTarget || !provider.dispatchApprovedDeployment) return refuse('not-approved');
  if (provider.dispatchApprovedDeployment !== settings.deployment) return refuse('approved-for-other-deployment');
  if (provider.dispatchApprovedTarget !== settings.target) return refuse('approved-for-other-target');
  if (provider.dispatchPausedAt) return refuse('paused');
  return { eligible: true, target: settings.target };
}

/** How often the worker repeats its attestation, and how long one is believed. */
export const READY_EVERY_MS = 20_000;
export const READY_TTL_MS = 60_000;

/** Which deployment asks: its target and its name. */
export type Deployment = { target: ProviderTarget; deployment: string };

/**
 * Whether some worker **of this deployment** has said, recently, for this target and for the credential now
 * stored, that it holds an adapter for the provider. The API cannot see a worker's settings or what it built, so
 * this is the only thing it believes about them. Each worker process has a row of its own: one that stopped took
 * its row with it, one that belongs to another deployment or target, or built its adapter from a credential that
 * has since been replaced, has no row that passes, and none of them touches another worker's.
 *
 * The age of a row is computed by the database from its own clock (the worker writes it with `now()`, and the
 * read subtracts it from `clock_timestamp()`), so a process whose own clock is ahead or behind neither shortens
 * nor stretches the time allowed, and nothing here reads a clock at all.
 *
 * A worker that is killed leaves its last row behind: it passes for at most `READY_TTL_MS`. A sale opened on the
 * dispatch route in that window is recorded and waits: nothing sends it until a worker is back, and its submitter
 * may cancel it meanwhile (D7).
 */
export function workerReady(provider: ProviderDispatchState, asking: Deployment): boolean {
  const stored = provider.credentialGeneration ?? null;
  if (stored === null) return false;
  return (provider.attestations ?? []).some(
    (said) => said.deployment === asking.deployment && said.target === asking.target && said.generation === stored && Number.isFinite(said.ageMs) && said.ageMs >= 0 && said.ageMs <= READY_TTL_MS,
  );
}

/**
 * The API's question (D13): may an activation at this provider be opened on the dispatch route? The four
 * conditions as the API's own settings and the database state them, **and** the fresh attestation of one of this
 * deployment's workers for the same target and the stored credential. `now` is the database's clock. Any disagreement between the two processes
 * answers no, and the sale takes the manual route.
 */
export function mayOpenDispatch(settings: DispatchSettings, provider: ProviderDispatchState | null): boolean {
  const judged = eligibility(settings, provider);
  return judged.eligible && provider !== null && settings.deployment !== null && workerReady(provider, { target: judged.target, deployment: settings.deployment });
}

/**
 * The worker's question, asked under the provider's row lock before an attempt is claimed and again before it is
 * marked as sent: the four conditions as the worker's own settings and the database state them, **and** an adapter
 * this worker built from the credential that is stored now. `heldGeneration` is the generation of the credential
 * the worker's adapter was built with, null when it holds none: without an adapter there is nothing to send with,
 * and with one built from a replaced credential there is nothing it may send with, whatever the conditions say.
 */
export function maySend(settings: DispatchSettings, provider: ProviderDispatchState | null, heldGeneration: number | null): boolean {
  if (!eligibility(settings, provider).eligible || provider === null) return false;
  return heldGeneration !== null && heldGeneration === (provider.credentialGeneration ?? null);
}
