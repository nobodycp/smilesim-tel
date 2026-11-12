import { NOT_CONNECTED, type ProviderGateway, type ProviderResult } from '../gateway/provider-gateway';
import type { OutgoingOperation, SendEvidence } from '../operations/provider-operation.rules';
import type { DispatchAdapter } from './provider-adapters';

/**
 * The worker's gateway (ADR 0019, D18): it picks the adapter by provider code, among the ones this worker built.
 * For a provider it holds no adapter for, nothing is sent: it answers that no connection was opened, which the
 * dispatcher reads as "the request did not leave". It never falls back to a simulation and never reports a send
 * it did not make. It answers nothing inside a request: `run` and `dispatches` are the API's side.
 */
export class RoutingProviderGateway implements ProviderGateway {
  readonly simulated = false;

  constructor(private readonly adapters: ReadonlyMap<string, DispatchAdapter>) {}

  /** Whether this worker built an adapter for the provider. */
  holds(providerCode: string): boolean {
    return this.adapters.has(providerCode);
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
    const adapter = this.adapters.get(operation.providerCode);
    if (!adapter) return { left: false, error: NOT_CONNECTED };
    return adapter.send(operation);
  }
}
