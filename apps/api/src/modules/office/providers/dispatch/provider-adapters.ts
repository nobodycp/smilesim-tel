import type { OutgoingOperation, SendEvidence } from '../operations/provider-operation.rules';
import type { DispatchSettings, ProviderTarget } from './dispatch-policy';

// The REGISTRY: the adapters a worker may build (ADR 0019, D18). An adapter is the only code that reaches a
// provider, and it exists in the worker only. The API never imports this file: what it knows of adapters is the
// manifest of their codes (`adapter-manifest.ts`) and what a running worker attested in the database.
//
// SLICE S.12a: THE LIST IS EMPTY. No adapter for any provider exists yet (S.12b adds the first, with its own
// spec and review, here and in the manifest). So a worker builds none, attests none, and sends nothing, whatever
// its settings say.

/** One provider's client for one target. Its endpoints are constants in its own code, one set per target. */
export interface DispatchAdapter {
  readonly providerCode: string;
  readonly target: ProviderTarget;
  /** Sends one recorded operation and reports what is known about it; never throws for a provider refusal. */
  send(operation: OutgoingOperation): Promise<SendEvidence>;
}

/**
 * How an adapter is made: from the target it is built for and its credential, already opened. A factory for one
 * target must refuse to build for the other; `buildAdapters` also checks what it built.
 */
export type AdapterFactory = (target: ProviderTarget, credential: string) => DispatchAdapter;

/** Every adapter this code base has, by provider code. Empty until S.12b. */
export const ADAPTER_FACTORIES: Readonly<Record<string, AdapterFactory>> = Object.freeze({});

/** A stored credential as the worker opened it: its value, and the generation that write of it was given. */
export type OpenedCredential = { value: string; generation: number };

type Skipped = 'dispatch-off' | 'settings-invalid' | 'no-target' | 'no-adapter' | 'no-credential' | 'credential-unreadable' | 'wrong-target' | 'build-failed';

export type BuiltAdapters = {
  /** The adapters that were built, by provider code. */
  readonly adapters: ReadonlyMap<string, DispatchAdapter>;
  /** The generation of the credential each was built with, by provider code. */
  readonly generations: ReadonlyMap<string, number>;
  /** Why a named provider got none: by provider code, a reason code, never a credential or an error's text. */
  readonly skipped: ReadonlyMap<string, Skipped>;
};

/** A worker that holds no adapter: what it starts as, and what this build always is. */
export const NO_ADAPTERS: BuiltAdapters = { adapters: new Map(), generations: new Map(), skipped: new Map() };

/**
 * Builds the adapters a worker may use: only while dispatch is on and the settings hold together, only for a
 * provider named in `PROVIDER_ADAPTERS`, only when this code base has an adapter for it, only for the
 * deployment's target, and only with a credential for that target that opens. `credentialFor` answers the opened
 * credential and its generation, `null` when there is none, and throws when the stored one does not open; nothing
 * of it is kept in `skipped`. A credential that is missing or unreadable builds nothing: never an adapter with an
 * empty secret. Every adapter is built anew from what is stored now: none is carried over from an earlier build.
 */
export function buildAdapters(
  settings: DispatchSettings,
  credentialFor: (providerCode: string, target: ProviderTarget) => OpenedCredential | null,
  factories: Readonly<Record<string, AdapterFactory>> = ADAPTER_FACTORIES,
): BuiltAdapters {
  const adapters = new Map<string, DispatchAdapter>();
  const generations = new Map<string, number>();
  const skipped = new Map<string, Skipped>();
  for (const code of settings.adapters) {
    if (settings.problems.length > 0 || !settings.deployment) skipped.set(code, 'settings-invalid');
    else if (!settings.on) skipped.set(code, 'dispatch-off');
    else if (!settings.target) skipped.set(code, 'no-target');
    else if (!Object.prototype.hasOwnProperty.call(factories, code)) skipped.set(code, 'no-adapter');
    else {
      let credential: OpenedCredential | null;
      try {
        credential = credentialFor(code, settings.target);
      } catch {
        skipped.set(code, 'credential-unreadable');
        continue;
      }
      if (!credential || !credential.value) {
        skipped.set(code, 'no-credential');
        continue;
      }
      try {
        const adapter = factories[code](settings.target, credential.value);
        // What was built must be what was asked for: a sandbox deployment never holds a live client.
        if (adapter.providerCode !== code || adapter.target !== settings.target) skipped.set(code, 'wrong-target');
        else {
          adapters.set(code, adapter);
          generations.set(code, credential.generation);
        }
      } catch {
        skipped.set(code, 'build-failed');
      }
    }
  }
  return { adapters, generations, skipped };
}
