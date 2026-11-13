import { NOT_CONNECTED, type ProviderGateway, type ProviderResult } from '../gateway/provider-gateway';
import type { OutgoingOperation, SendEvidence } from '../operations/provider-operation.rules';
import { NO_ADAPTERS, type BuiltAdapters } from './provider-adapters';

/**
 * The worker's gateway (ADR 0019, D18): it picks the adapter by provider code, among the ones this worker built.
 * For a provider it holds no adapter for, nothing is sent: it answers that no connection was opened, which the
 * dispatcher reads as "the request did not leave". It never falls back to a simulation and never reports a send
 * it did not make. It answers nothing inside a request: `run` and `dispatches` are the API's side.
 *
 * What it holds is replaced as a whole (`use`) when a credential was written since the adapters were built: the
 * new set is built from what is stored now, and the old adapters, with the credentials they were given, are
 * dropped. A send that was already handed to an old adapter finishes with it; the gate lets no new one start
 * until the worker holds the stored generation.
 */
export class RoutingProviderGateway implements ProviderGateway {
  readonly simulated = false;

  constructor(private built: Pick<BuiltAdapters, 'adapters' | 'generations'> = NO_ADAPTERS) {}

  /** Replaces every adapter this worker holds with a newly built set. */
  use(built: Pick<BuiltAdapters, 'adapters' | 'generations'>): void {
    this.built = built;
  }

  /** Whether this worker built an adapter for the provider. */
  holds(providerCode: string): boolean {
    return this.built.adapters.has(providerCode);
  }

  /** The generation of the credential the provider's adapter was built with; null when this worker holds none. */
  generation(providerCode: string): number | null {
    return this.built.adapters.has(providerCode) ? this.built.generations.get(providerCode) ?? null : null;
  }

  /** The codes this worker holds an adapter for. */
  held(): string[] {
    return [...this.built.adapters.keys()];
  }

  accept(): void {}

  /** The worker opens no task: which route a sale takes is the API's question. */
  async dispatches(): Promise<boolean> {
    return false;
  }

  async run(): Promise<ProviderResult> {
    return { ok: false, reason: NOT_CONNECTED };
  }

  async send(operation: OutgoingOperation): Promise<SendEvidence> {
    const adapter = this.built.adapters.get(operation.providerCode);
    if (!adapter) return { left: false, error: NOT_CONNECTED };
    return adapter.send(operation);
  }
}
