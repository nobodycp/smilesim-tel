import { Injectable } from '@nestjs/common';
import type { Db } from '../../kernel/unit-of-work';
import type { ProviderTarget } from './dispatch-policy';

/** What the dispatch switch reads of a provider: the approval, the pause and the worker's attestation. */
const STATE = { id: true, code: true, dispatchApprovedAt: true, dispatchApprovedByLoginName: true, dispatchApprovedTarget: true, dispatchPausedAt: true, dispatchReadyAt: true, dispatchReadyTarget: true } as const;

/**
 * A provider's dispatch state and its credential as the API's database holds them (ADR 0019, D18). Every method
 * takes the client. A credential is written here and never read: no method selects `sealedValue`; the worker's
 * own reader (`provider-dispatch.ts`) is the only code that does.
 */
@Injectable()
export class ProviderDispatchRepository {
  state(db: Db, code: string) {
    return db.provider.findUnique({ where: { code }, select: STATE });
  }

  /**
   * The provider's row, held until the transaction ends. The worker's gate reads the same row `FOR SHARE`, so an
   * approval, a pause or a resume and the taking or marking of an attempt never overlap.
   */
  async lockedState(tx: Db, code: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Provider" WHERE "code" = ${code} FOR UPDATE`;
    return rows[0] ? tx.provider.findUnique({ where: { id: rows[0].id }, select: STATE }) : null;
  }

  approve(tx: Db, id: string, loginName: string, target: ProviderTarget, at: Date) {
    return tx.provider.update({ where: { id }, data: { dispatchApprovedAt: at, dispatchApprovedByLoginName: loginName, dispatchApprovedTarget: target } });
  }

  setPaused(tx: Db, id: string, at: Date | null) {
    return tx.provider.update({ where: { id }, data: { dispatchPausedAt: at } });
  }

  /** Whether a credential is stored for the provider and the target. The value is not read. */
  async hasCredential(db: Db, providerId: string, target: ProviderTarget): Promise<boolean> {
    return (await db.providerCredential.count({ where: { providerId, target } })) > 0;
  }

  /** Stores or replaces the sealed credential in one statement, so no reader finds half of a replacement. */
  async saveCredential(db: Db, providerId: string, target: ProviderTarget, sealedValue: string, loginName: string): Promise<void> {
    await db.providerCredential.upsert({
      where: { providerId_target: { providerId, target } },
      create: { providerId, target, sealedValue, updatedByLoginName: loginName },
      update: { sealedValue, updatedByLoginName: loginName },
    });
  }
}
