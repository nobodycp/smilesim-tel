import type { OutgoingOperation, SendEvidence } from '../operations/provider-operation.rules';
import type { DispatchSettings, ProviderTarget } from './dispatch-policy';

// The adapters a worker may build (ADR 0019, D18). An adapter is the only code that reaches a provider, and it
// exists in the worker only: the API imports none of this to send with.
//
// SLICE S.12a: THE LIST IS EMPTY. No adapter for any provider exists yet (S.12b adds the first, with its own
// spec and review). So a worker builds none, attests none, and sends nothing, whatever its settings say.

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

/** The provider codes an adapter exists for: what `PROVIDER_ADAPTERS` may name. */
export function knownAdapters(factories: Readonly<Record<string, AdapterFactory>> = ADAPTER_FACTORIES): string[] {
  return Object.keys(factories).sort();
}

export type BuiltAdapters = {
  /** The adapters that were built, by provider code. */
  readonly adapters: ReadonlyMap<string, DispatchAdapter>;
  /** Why a named provider got none: by provider code, a reason code, never a credential or an error's text. */
  readonly skipped: ReadonlyMap<string, 'dispatch-off' | 'settings-invalid' | 'no-target' | 'no-adapter' | 'no-credential' | 'credential-unreadable' | 'wrong-target' | 'build-failed'>;
};

/**
 * Builds the adapters a worker may use: only while dispatch is on and the settings hold together, only for a
 * provider named in `PROVIDER_ADAPTERS`, only when this code base has an adapter for it, only for the
 * deployment's target, and only with a credential for that target that opens. `credentialFor` answers the opened
 * credential, `null` when there is none, and throws when the stored one does not open; nothing of it is kept in
 * `skipped`. A credential that is missing or unreadable builds nothing: never an adapter with an empty secret.
 */
export function buildAdapters(
  settings: DispatchSettings,
  credentialFor: (providerCode: string, target: ProviderTarget) => string | null,
  factories: Readonly<Record<string, AdapterFactory>> = ADAPTER_FACTORIES,
): BuiltAdapters {
  const adapters = new Map<string, DispatchAdapter>();
  const skipped = new Map<string, 'dispatch-off' | 'settings-invalid' | 'no-target' | 'no-adapter' | 'no-credential' | 'credential-unreadable' | 'wrong-target' | 'build-failed'>();
  for (const code of settings.adapters) {
    if (settings.problems.length > 0) skipped.set(code, 'settings-invalid');
    else if (!settings.on) skipped.set(code, 'dispatch-off');
    else if (!settings.target) skipped.set(code, 'no-target');
    else if (!Object.prototype.hasOwnProperty.call(factories, code)) skipped.set(code, 'no-adapter');
    else {
      let credential: string | null;
      try {
        credential = credentialFor(code, settings.target);
      } catch {
        skipped.set(code, 'credential-unreadable');
        continue;
      }
      if (!credential) {
        skipped.set(code, 'no-credential');
        continue;
      }
      try {
        const adapter = factories[code](settings.target, credential);
        // What was built must be what was asked for: a sandbox deployment never holds a live client.
        if (adapter.providerCode !== code || adapter.target !== settings.target) skipped.set(code, 'wrong-target');
        else adapters.set(code, adapter);
      } catch {
        skipped.set(code, 'build-failed');
      }
    }
  }
  return { adapters, skipped };
}
