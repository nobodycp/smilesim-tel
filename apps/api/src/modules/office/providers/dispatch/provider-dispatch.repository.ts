import { Injectable } from '@nestjs/common';
import type { Db } from '../../kernel/unit-of-work';
import type { ProviderTarget } from './dispatch-policy';

/** What the dispatch switch reads of a provider: the approval, the pause and the worker's attestation. */
const STATE = {
  id: true, code: true, dispatchApprovedAt: true, dispatchApprovedByLoginName: true, dispatchApprovedTarget: true, dispatchApprovedDeployment: true, dispatchPausedAt: true,
  dispatchReadyAt: true, dispatchReadyTarget: true, dispatchReadyDeployment: true, dispatchReadyGeneration: true,
} as const;

/** The same, with the generation of the credential stored for one target (never its value); null when none is. */
function stateFor(target: ProviderTarget | null) {
  return { ...STATE, credentials: { where: { target: target ?? '' }, select: { generation: true } } } as const;
}

/**
 * A provider's dispatch state and its credential as the API's database holds them (ADR 0019, D18). Every method
 * takes the client. A credential is written here and never read: no method selects `sealedValue`; the worker's
 * own reader (`provider-dispatch.ts`) is the only code that does.
 */
@Injectable()
export class ProviderDispatchRepository {
  /** The provider's state as a deployment of `target` asks for it: with the generation of that target's credential. */
  async state(db: Db, code: string, target: ProviderTarget | null) {
    const row = await db.provider.findUnique({ where: { code }, select: stateFor(target) });
    if (!row) return null;
    const { credentials, ...state } = row;
    return { ...state, credentialGeneration: credentials[0]?.generation ?? null };
  }

  /**
   * The provider's row, held until the transaction ends. The worker's gate reads the same row `FOR SHARE`, so an
   * approval, a pause, a resume or a write of the credential and the taking or marking of an attempt never overlap.
   */
  async lockedState(tx: Db, code: string, target: ProviderTarget | null) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Provider" WHERE "code" = ${code} FOR UPDATE`;
    return rows[0] ? this.state(tx, code, target) : null;
  }

  approve(tx: Db, id: string, loginName: string, to: { target: ProviderTarget; deployment: string }, at: Date) {
    return tx.provider.update({ where: { id }, data: { dispatchApprovedAt: at, dispatchApprovedByLoginName: loginName, dispatchApprovedTarget: to.target, dispatchApprovedDeployment: to.deployment } });
  }

  setPaused(tx: Db, id: string, at: Date | null) {
    return tx.provider.update({ where: { id }, data: { dispatchPausedAt: at } });
  }

  /**
   * Closes the provider's dispatch for a credential that is being written: the approval on record is withdrawn
   * and the worker's attestation with it. A pause, if there is one, stays.
   */
  closeForNewCredential(tx: Db, id: string) {
    return tx.provider.update({
      where: { id },
      data: {
        dispatchApprovedAt: null, dispatchApprovedByLoginName: null, dispatchApprovedTarget: null, dispatchApprovedDeployment: null,
        dispatchReadyAt: null, dispatchReadyTarget: null, dispatchReadyDeployment: null, dispatchReadyGeneration: null,
      },
    });
  }

  /** Whether a credential is stored for the provider and the target. The value is not read. */
  async hasCredential(db: Db, providerId: string, target: ProviderTarget): Promise<boolean> {
    return (await db.providerCredential.count({ where: { providerId, target } })) > 0;
  }

  /**
   * Stores or replaces the sealed credential in one statement, so no reader finds half of a replacement. Every
   * write raises the generation: an adapter built from an earlier one is no longer one the gate lets send.
   */
  async saveCredential(tx: Db, providerId: string, target: ProviderTarget, sealedValue: string, loginName: string): Promise<void> {
    await tx.providerCredential.upsert({
      where: { providerId_target: { providerId, target } },
      create: { providerId, target, sealedValue, updatedByLoginName: loginName },
      update: { sealedValue, updatedByLoginName: loginName, generation: { increment: 1 } },
    });
  }
}
