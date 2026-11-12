import type { Action } from '../../kernel/types';
import type { OutgoingOperation, SendEvidence } from '../operations/provider-operation.rules';

// The port every line operation goes through to reach the provider (backend-engineering.mdc 4.5). The office
// never takes the provider's answer from the client: it asks the gateway, and the gateway answers.

/** One operation asked of a provider. */
export type ProviderRequest = {
  action: Action;
  providerCode: string;
  packageCode: string;
  msisdn: string | null;
  iccid?: string | null;
  /**
   * Simulation only: what the simulated provider should answer. A real gateway ignores it. It is the request's
   * `outcome` field, kept while no real provider is connected.
   */
  hint?: unknown;
};

/** The provider's answer: done, or refused with its own reason. */
export type ProviderResult = { ok: true } | { ok: false; reason: string };

/** The refusal of a gateway that reaches no provider: the operation is a plain branch task, not a provider failure. */
export const NOT_CONNECTED = 'not-connected';

export interface ProviderGateway {
  /** True only while answers are made up from the request's hint. A real gateway, and any gateway in production, is false. */
  readonly simulated: boolean;
  /** Refuses (400) a request this gateway cannot run as it is written, before anything is read or written. */
  accept(hint: unknown): void;
  /**
   * Whether an automatic activation at this provider is recorded as an operation for the dispatcher, instead of
   * being answered inside the request (ADR 0019, D13). True only where every condition of D18 holds, and those
   * are the worker's to establish (slice S.12a): until then no gateway the application builds answers true. It
   * reads nothing from the request: the simulation's hint never chooses this route.
   */
  dispatches(providerCode: string): boolean;
  /** Runs the operation at the provider. Never throws for a provider refusal: it answers `ok: false`. */
  run(request: ProviderRequest): Promise<ProviderResult>;
  /**
   * Sends a recorded operation for the dispatcher (ADR 0018) and reports what is known about it. `left: false`
   * only when no connection was opened; the idempotency key goes to the provider with every attempt.
   */
  send(operation: OutgoingOperation): Promise<SendEvidence>;
}

export const PROVIDER_GATEWAY = Symbol('PROVIDER_GATEWAY');
