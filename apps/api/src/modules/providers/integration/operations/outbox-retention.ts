import { PUBLISHED_OUTBOX_RETENTION_DAYS, RETENTION_BATCH_ROWS, daysBefore, inBatches, type Db } from '../../../platform';
import { ProviderOperationsRepository } from './provider-operations.repository';

/**
 * The outbox's share of the worker's daily purge (plan DB.13, ADR 0024): the provider operations' messages published
 * more than `PUBLISHED_OUTBOX_RETENTION_DAYS` ago whose operation is applied, in statements of `batch` rows. Why
 * that condition keeps a second verdict refused once the unique key's row is gone is on
 * `ProviderOperationsRepository.deleteAppliedOutbox`. Answers how many messages went.
 */
export function purgeOutbox(db: Db, now: Date = new Date(), batch: number = RETENTION_BATCH_ROWS): Promise<number> {
  const before = daysBefore(PUBLISHED_OUTBOX_RETENTION_DAYS, now);
  const repo = new ProviderOperationsRepository();
  return inBatches((limit) => repo.deleteAppliedOutbox(db, before, limit), batch);
}
