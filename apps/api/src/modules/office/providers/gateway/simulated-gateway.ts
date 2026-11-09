import { Injectable, Logger } from '@nestjs/common';
import { env, isProduction } from '../../../../config';
import { fail } from '../../../shared/office-failure';
import type { ProviderGateway, ProviderRequest, ProviderResult } from './provider-gateway';

/**
 * Stands in for every provider until real adapters exist: it answers what the request's `hint` says
 * (`success` or `fail`), so the office can be exercised end to end. It moves nothing at any provider.
 *
 * `PROVIDER_SIMULATION=0` switches the hint off: the gateway then answers "not connected" and every operation
 * goes to a branch task. A production process that runs with the simulation on says so at boot.
 */
@Injectable()
export class SimulatedProviderGateway implements ProviderGateway {
  private readonly logger = new Logger(SimulatedProviderGateway.name);
  private readonly enabled = env('PROVIDER_SIMULATION') !== '0';

  constructor() {
    if (this.enabled && isProduction()) {
      this.logger.warn('Provider operations are SIMULATED: the client states the outcome. Set PROVIDER_SIMULATION=0 or connect a real gateway before real sales.');
    }
  }

  accept(hint: unknown): void {
    if (this.enabled && hint !== 'success' && hint !== 'fail') fail(400, 'INVALID');
  }

  async run(request: ProviderRequest): Promise<ProviderResult> {
    if (!this.enabled) return { ok: false, reason: 'not-connected' };
    return request.hint === 'success' ? { ok: true } : { ok: false, reason: 'simulated-failure' };
  }
}
