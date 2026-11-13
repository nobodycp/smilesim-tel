import { Injectable, Optional } from '@nestjs/common';
import { env, isProduction } from '../../../../config';
import { fail } from '../../../shared/api-failure';
import type { SendEvidence } from '../operations/provider-operation.rules';
import { ProviderDispatchService } from '../dispatch/provider-dispatch.service';
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

  constructor(@Optional() private readonly dispatch?: ProviderDispatchService) {}

  accept(hint: unknown): void {
    if (this.simulated && hint !== 'success' && hint !== 'fail') fail(400, 'INVALID');
  }

  /**
   * The dispatch route (ADR 0019, D13 and D18): what `ProviderDispatchService.opens` answers, the four conditions
   * and the worker's fresh attestation. A gateway built without that service (the worker's, a spec's) answers no.
   * It has nothing to do with the simulation: the request's hint is not read, and `simulated` does not matter.
   */
  async dispatches(providerCode: string): Promise<boolean> {
    return this.dispatch ? this.dispatch.opens(providerCode) : false;
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
