import { errorCode, logger } from '../../../shared/log';
import { OfficeFailure } from '../../../shared/office-failure';
import type { ProviderGateway } from '../gateway/provider-gateway';
import { CALL_TIMEOUT_MS, outcomeOf, type OperationStatus, type OutgoingOperation, type SendEvidence } from './provider-operation.rules';
import { ProviderOperationsService } from './provider-operations.service';

const log = logger('Dispatcher');

/** What handling one queued message came to: the operation's new status, or why nothing was done. */
export type Dispatched = OperationStatus | 'skipped' | 'missing' | 'stale';

/**
 * Sends one recorded operation (ADR 0018): claim, mark, call the provider, settle. It coordinates only: what an
 * answer means and what state follows are the rules' (`outcomeOf`, `afterAttempt`), and every write is the
 * service's. The provider is called between two committed writes, never inside a transaction.
 *
 * A message may arrive twice, or after the operation moved on: `claim` answers null and nothing is sent.
 */
export class OperationDispatcher {
  constructor(private readonly operations: ProviderOperationsService, private readonly gateway: ProviderGateway, private readonly callTimeoutMs: number = CALL_TIMEOUT_MS) {}

  async handle(operationId: string): Promise<Dispatched> {
    const attempt = await this.claim(operationId);
    if (attempt === 'missing') return 'missing';
    if (attempt === null) return 'skipped';
    // From here the attempt is this worker's until its lease ends. No mark, no call.
    const outgoing = await this.operations.beginSend(operationId, attempt);
    if (!outgoing) return 'skipped';
    const outcome = outcomeOf(await this.send(outgoing));
    try {
      const status = await this.operations.settle(operationId, attempt, outcome);
      log.log(`operation ${operationId} attempt ${attempt}: ${outcome.kind} -> ${status}`);
      return status;
    } catch (error) {
      // The attempt is no longer the one in flight: its answer is dropped, the operation is untouched.
      if (error instanceof OfficeFailure && error.status === 409) {
        log.warn(`operation ${operationId} attempt ${attempt}: ${outcome.kind} arrived late and was not written`);
        return 'stale';
      }
      throw error;
    }
  }

  private async claim(operationId: string): Promise<number | null | 'missing'> {
    try {
      return await this.operations.claim(operationId);
    } catch (error) {
      if (error instanceof OfficeFailure && error.status === 404) {
        log.warn(`operation ${operationId} does not exist; its message is dropped`);
        return 'missing';
      }
      throw error;
    }
  }

  /**
   * The gateway's evidence, or null when there is none: it threw, or it did not answer in time. Null is read as
   * "the request may have left". A gateway's error may quote the request it sent, its headers or the
   * provider's reply: only a code is logged, and nothing of it is stored.
   */
  private async send(outgoing: OutgoingOperation): Promise<SendEvidence | null> {
    let timer: NodeJS.Timeout | undefined;
    const waited = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), this.callTimeoutMs);
    });
    try {
      return await Promise.race([this.gateway.send(outgoing), waited]);
    } catch (error) {
      log.warn(`operation attempt ${outgoing.attempt} for ${outgoing.providerCode}: the gateway failed without evidence (${errorCode(error)})`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Recovers pending attempts whose worker is gone, a batch at a time. Answers how many it changed. */
export async function recoverExpired(operations: ProviderOperationsService, now: Date = new Date(), limit = 100): Promise<number> {
  let changed = 0;
  for (const id of await operations.expiredPending(now, limit)) {
    const status = await operations.recover(id, now);
    if (status) {
      changed += 1;
      log.warn(`operation ${id}: recovered to ${status}`);
    }
  }
  return changed;
}
