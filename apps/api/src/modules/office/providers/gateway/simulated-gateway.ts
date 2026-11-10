import { Injectable } from '@nestjs/common';
import { env, isProduction } from '../../../../config';
import { fail } from '../../../shared/office-failure';
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

  async run(request: ProviderRequest): Promise<ProviderResult> {
    if (!this.simulated) return { ok: false, reason: NOT_CONNECTED };
    return request.hint === 'success' ? { ok: true } : { ok: false, reason: 'simulated-failure' };
  }
}
