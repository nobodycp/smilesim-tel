import type { Action } from '../../kernel/types';

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

export interface ProviderGateway {
  /** Refuses (400) a request this gateway cannot run as it is written, before anything is read or written. */
  accept(hint: unknown): void;
  /** Runs the operation at the provider. Never throws for a provider refusal: it answers `ok: false`. */
  run(request: ProviderRequest): Promise<ProviderResult>;
}

export const PROVIDER_GATEWAY = Symbol('PROVIDER_GATEWAY');
