import { Injectable } from '@nestjs/common';
import { env, isProduction } from '../../../../config';
import { fail } from '../../../shared/office-failure';
import type { SendEvidence } from '../operations/provider-operation.rules';
import { NOT_CONNECTED, type ProviderGateway, type ProviderRequest, type ProviderResult } from './provider-gateway';

/**
 * Stands in for every provider until real adapters exist: outside production it answers what the request's `hint`
 * says (`success` or `fail`), so the office can be exercised end to end. It moves nothing at any provider.
 *
 * In production it never simulates, whatever the environment says (ADR 0016): the hint is ignored, the gateway
 * answers "not connected", and every operation becomes a branch task done by hand. `PROVIDER_SIMULATION=0` does the
 * same in any other environment.
 */
@Injectable()
export class SimulatedProviderGateway implements ProviderGateway {
  readonly simulated = !isProduction() && env('PROVIDER_SIMULATION') !== '0';

  accept(hint: unknown): void {
    if (this.simulated && hint !== 'success' && hint !== 'fail') fail(400, 'INVALID');
  }

  /**
   * Never: no provider is switched on (ADR 0019, D13 and D18; slice S.12a has not landed). A constant on purpose:
   * no environment variable, setting, database row or request field makes it true, so nothing that is deployed
   * today can put an activation on the dispatch route. `provider-dispatch-off.spec.ts` pins this.
   */
  dispatches(): boolean {
    return false;
  }

  async run(request: ProviderRequest): Promise<ProviderResult> {
    if (!this.simulated) return { ok: false, reason: NOT_CONNECTED };
    return request.hint === 'success' ? { ok: true } : { ok: false, reason: 'simulated-failure' };
  }

  /** No provider is connected: a recorded operation never leaves, in any environment. */
  async send(): Promise<SendEvidence> {
    return { left: false, error: NOT_CONNECTED };
  }
}
