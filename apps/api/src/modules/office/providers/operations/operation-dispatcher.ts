import type { SendGate, SendPermit } from '../dispatch/dispatch-gate';
import { errorCode, logger } from '../../../shared/log';
import { ApiFailure } from '../../../shared/api-failure';
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
  /**
   * `gate` is required: every attempt is taken and marked through it (ADR 0019, D18), and the request is sent
   * **through the permit the gate gave at the mark**, the only way this class has to a provider. It holds no
   * gateway: there is nothing here to send with but what the gate handed over for that one attempt.
   */
  constructor(private readonly operations: ProviderOperationsService, private readonly gate: SendGate, private readonly callTimeoutMs: number = CALL_TIMEOUT_MS) {}

  async handle(operationId: string): Promise<Dispatched> {
    const attempt = await this.claim(operationId);
    if (attempt === 'missing') return 'missing';
    if (attempt === null) return 'skipped';
    // From here the attempt is this worker's until its lease ends. No mark, no call.
    const marked = await this.operations.beginSend(operationId, attempt, new Date(), this.gate);
    if (!marked) return 'skipped';
    const { permit, ...outgoing } = marked;
    // Marked with no permit cannot happen with a gate; if it did, nothing is sent and the attempt ends as
    // "may have left" (the mark is written), never as a send through something that was not judged.
    const outcome = outcomeOf(permit ? await this.send(permit, outgoing) : null);
    try {
      const status = await this.operations.settle(operationId, attempt, outcome);
      log.log(`operation ${operationId} attempt ${attempt}: ${outcome.kind} -> ${status}`);
      return status;
    } catch (error) {
      // The attempt is no longer the one in flight: its answer is dropped, the operation is untouched.
      if (error instanceof ApiFailure && error.status === 409) {
        log.warn(`operation ${operationId} attempt ${attempt}: ${outcome.kind} arrived late and was not written`);
        return 'stale';
      }
      throw error;
    }
  }

  private async claim(operationId: string): Promise<number | null | 'missing'> {
    try {
      return await this.operations.claim(operationId, new Date(), this.gate);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) {
        log.warn(`operation ${operationId} does not exist; its message is dropped`);
        return 'missing';
      }
      throw error;
    }
  }

  /**
   * The adapter's evidence, or null when there is none: it threw, or it did not answer in time. Null is read as
   * "the request may have left". An adapter's error may quote the request it sent, its headers or the
   * provider's reply: only a code is logged, and nothing of it is stored.
   */
  private async send(permit: SendPermit, outgoing: OutgoingOperation): Promise<SendEvidence | null> {
    let timer: NodeJS.Timeout | undefined;
    const waited = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), this.callTimeoutMs);
    });
    try {
      return await Promise.race([permit.send(outgoing), waited]);
    } catch (error) {
      log.warn(`operation attempt ${outgoing.attempt} for ${outgoing.providerCode}: the adapter failed without evidence (${errorCode(error)})`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Recovers pending attempts whose worker is gone, a batch at a time. Answers how many it changed. The worker
 * passes its gate, so an unsent attempt found while its provider's gate is closed is not counted (ADR 0018, amended).
 */
export async function recoverExpired(operations: ProviderOperationsService, now: Date = new Date(), limit = 100, gate?: SendGate): Promise<number> {
  let changed = 0;
  for (const id of await operations.expiredPending(now, limit)) {
    const status = await operations.recover(id, now, gate);
    if (status) {
      changed += 1;
      log.warn(`operation ${id}: recovered to ${status}`);
    }
  }
  return changed;
}

/** How many operations one page of the pass reads, how many pages one round may walk, and how many it may send. */
export const WAITING_PAGE = 100;
export const WAITING_PAGES_A_ROUND = 20;
export const WAITING_SENT_A_ROUND = 100;

/**
 * The pass over operations that wait to be sent (ADR 0019, D18): the ones a gate left where they were. It walks
 * them **by id, a page at a time, and remembers where it stopped**, so the operations of a provider that is
 * closed, however many, never keep another provider's from being looked at:
 *
 * - each operation goes through `handle`, so each is taken only if the gate says yes at that moment, and marked
 *   only if it still says yes then; a closed provider's operation is looked at and left, uncounted;
 * - one round reads at most `pages` pages of `page` rows, and **sends at most `sends` operations**: it never
 *   loads the table, and it does not keep recovery (which runs on the same timer) waiting behind a long run of
 *   calls to a provider. Looking at a closed provider's operation is one short transaction; sending is a call;
 * - a round that ends before the end of the list starts the next round after the last id it looked at; one that
 *   reaches the end starts the next from the beginning. So every waiting operation is looked at within a
 *   bounded number of rounds, and none twice in one walk;
 * - an operation that starts waiting behind the place the walk has reached (handed back, recovered) is met on
 *   the next walk; one that is taken, sent or cancelled meanwhile is simply no longer in the list;
 * - an operation whose handling fails is logged by a code and passed: it does not end the round for the others.
 */
export class WaitingPass {
  /** The last id the walk looked at; null at the start of a walk. */
  private after: string | null = null;
  private stopped = false;

  constructor(
    private readonly dispatcher: OperationDispatcher, private readonly operations: ProviderOperationsService,
    private readonly page: number = WAITING_PAGE, private readonly pages: number = WAITING_PAGES_A_ROUND, private readonly sends: number = WAITING_SENT_A_ROUND,
  ) {}

  /** The worker is stopping: the round in flight takes no further operation. */
  stop(): void {
    this.stopped = true;
  }

  /** One round. Answers how many operations were handled to a result (sent, or settled as not sent). */
  async round(): Promise<number> {
    let sent = 0;
    for (let turn = 0; turn < this.pages && !this.stopped; turn += 1) {
      const ids = await this.operations.waitingToSend(this.after, this.page);
      for (const id of ids) {
        if (this.stopped || sent >= this.sends) return sent;
        try {
          const outcome = await this.dispatcher.handle(id);
          if (outcome !== 'skipped' && outcome !== 'missing') sent += 1;
        } catch (error) {
          log.warn(`operation ${id}: the pass over waiting operations could not handle it (${errorCode(error)})`);
        }
        this.after = id;
      }
      // A short page is the end of the list: the next round starts a new walk.
      if (ids.length < this.page) {
        this.after = null;
        break;
      }
    }
    return sent;
  }
}
