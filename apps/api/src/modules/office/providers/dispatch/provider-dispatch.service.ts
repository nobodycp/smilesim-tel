import { Injectable } from '@nestjs/common';
import { wholeEnv } from '../../../../config';
import type { Prisma } from '../../../../generated/prisma/client';
import type { ErrorCode } from '../../../../errors';
import { parseInput } from '../../../shared/input';
import { fail } from '../../../shared/api-failure';
import { isSealed, seal, secretsKey } from '../../../shared/secret-box';
import type { Actor } from '../../kernel/types';
import { UnitOfWork } from '../../kernel/unit-of-work';
import { requireOwner } from '../../policy';
import { ProviderDispatchRepository } from './provider-dispatch.repository';
import { ProviderCredentialBody } from '../providers.schemas';
import { dispatchSettings, eligibility, mayOpenDispatch, workerReady, type DispatchRefusal, type DispatchSettings, type ProviderDispatchState, type ProviderTarget } from './dispatch-policy';

/** What the branch owner reads of a provider's dispatch: where each condition stands. Never a credential. */
export type DispatchStatus = {
  /** The deployment's own settings, as the API process was given them. */
  dispatchOn: boolean;
  target: string | null;
  /** Which deployment this is (`DEPLOYMENT_ID`). */
  deployment: string | null;
  listed: boolean;
  /** The owner's approval, and the target and the deployment it was given for. */
  approvedAt: string | null;
  approvedByLoginName: string | null;
  approvedTarget: string | null;
  approvedDeployment: string | null;
  pausedAt: string | null;
  /** Whether a credential is stored for the deployment's target. Its value is never answered. */
  hasCredential: boolean;
  /** Whether this deployment's worker attested, recently, for this target and the stored credential, that it holds an adapter. */
  workerReady: boolean;
  /** The four conditions as this process sees them, and the first that fails. */
  eligible: boolean;
  refusal: DispatchRefusal | null;
  /** Whether an automatic activation at this provider would be opened on the dispatch route now. */
  opens: boolean;
};

/** Why the deployment's own settings do not allow an approval or a resume, as the route answers it. */
const UNSET: Partial<Record<DispatchRefusal, ErrorCode>> = {
  'settings-invalid': 'DISPATCH_NOT_CONFIGURED',
  'dispatch-off': 'DISPATCH_NOT_CONFIGURED',
  'not-listed': 'DISPATCH_NOT_CONFIGURED',
  'no-target': 'DISPATCH_NOT_CONFIGURED',
};

/**
 * A provider's dispatch as the API holds it (ADR 0019, D18): whether a sale may be opened on the dispatch route,
 * and the branch owner's switch: approve, pause, resume, and the credential.
 *
 * The API decides nothing about sending and holds nothing to send with. It reads its own three settings and the
 * provider's row; it believes the worker only through the worker's attestation in that row. It seals a credential
 * and never opens one: there is no method here that reads `sealedValue`. It imports no adapter: what the build
 * supports is a list of codes (`adapter-manifest.ts`), read by the start-up check.
 */
@Injectable()
export class ProviderDispatchService {
  constructor(private readonly uow: UnitOfWork, private readonly repo: ProviderDispatchRepository) {}

  /** Conditions 1 to 3 as this process was given them. Read when asked, so a spec can set them. */
  private settings(): DispatchSettings {
    return dispatchSettings(wholeEnv());
  }

  /**
   * D13: whether an automatic activation at this provider is opened on the dispatch route. The four conditions
   * and the worker's fresh attestation; anything else, a provider that is not there included, is no.
   */
  async opens(providerCode: string): Promise<boolean> {
    const settings = this.settings();
    // Nothing is read from the database for a deployment that does not dispatch at all.
    if (!settings.on || settings.problems.length > 0) return false;
    // The age of each attestation comes with the state, computed by the database: this process's clock is not asked.
    return mayOpenDispatch(settings, await this.repo.state(this.uow.prisma, providerCode, settings.target));
  }

  async status(actor: Actor, code: string): Promise<DispatchStatus> {
    requireOwner(actor);
    const settings = this.settings();
    const provider = await this.repo.state(this.uow.prisma, code, settings.target);
    if (!provider) fail(404, 'NOT_FOUND');
    const judged = eligibility(settings, provider);
    const hasCredential = settings.target ? await this.repo.hasCredential(this.uow.prisma, provider.id, settings.target) : false;
    return {
      dispatchOn: settings.on,
      target: settings.target,
      deployment: settings.deployment,
      listed: settings.adapters.includes(code),
      approvedAt: provider.dispatchApprovedAt?.toISOString() ?? null,
      approvedByLoginName: provider.dispatchApprovedByLoginName,
      approvedTarget: provider.dispatchApprovedTarget,
      approvedDeployment: provider.dispatchApprovedDeployment,
      pausedAt: provider.dispatchPausedAt?.toISOString() ?? null,
      hasCredential,
      workerReady: settings.target && settings.deployment ? workerReady(provider, { target: settings.target, deployment: settings.deployment }) : false,
      eligible: judged.eligible,
      refusal: judged.eligible ? null : judged.refusal,
      opens: mayOpenDispatch(settings, provider),
    };
  }

  /**
   * The owner approves dispatching this provider **on this deployment, for its target**. Refused unless the
   * deployment itself is set up for it (dispatch on, the provider named, the target stated, the deployment named)
   * and a credential for that target is stored: an approval is the last of the conditions, never the first. It
   * records the target and the deployment's name, so it stands for no other target and no other deployment, even
   * one that shares this database. A provider has one approval: giving it here takes it from wherever it was. It
   * approves the credential that is stored now: writing another withdraws it. It does not lift a pause.
   */
  async approve(actor: Actor, code: string): Promise<{ ok: true }> {
    requireOwner(actor);
    await this.uow.runTx(async (tx) => {
      const { provider, target, deployment } = await this.lockedForSwitch(tx, code);
      await this.repo.approve(tx, provider.id, actor.loginName, { target, deployment }, new Date());
    });
    return { ok: true };
  }

  /**
   * The owner pauses the provider. From this commit no attempt of its operations is taken or marked as sent (the
   * worker's gate reads this row under a lock), and new sales take the manual route. Nothing is released, nothing
   * that left is recalled, and what is pending or unknown finishes as usual. Pausing twice is the same pause.
   */
  async pause(actor: Actor, code: string): Promise<{ ok: true }> {
    requireOwner(actor);
    await this.uow.runTx(async (tx) => {
      const provider = await this.locked(tx, code, null);
      if (!provider.dispatchPausedAt) await this.repo.setPaused(tx, provider.id, new Date());
    });
    return { ok: true };
  }

  /**
   * The owner lifts the pause, after the conditions are judged again: the deployment is still set up for this
   * provider and target, a credential for the target is stored, and the approval on record is for this target on
   * this deployment. A resume is not an approval: after a credential was replaced there is none to resume.
   */
  async resume(actor: Actor, code: string): Promise<{ ok: true }> {
    requireOwner(actor);
    await this.uow.runTx(async (tx) => {
      const { provider, target, deployment } = await this.lockedForSwitch(tx, code);
      if (!provider.dispatchApprovedAt || provider.dispatchApprovedTarget !== target || provider.dispatchApprovedDeployment !== deployment) fail(409, 'DISPATCH_NOT_APPROVED');
      await this.repo.setPaused(tx, provider.id, null);
    });
    return { ok: true };
  }

  /**
   * Stores, or replaces, the provider's credential for this deployment's target, sealed. The value is not
   * answered, logged or kept anywhere else, and a deployment with no valid `SECRETS_KEY` stores nothing. A
   * deployment stores a credential for its own target only: a sandbox deployment cannot be handed a live one.
   *
   * One transaction, under the provider's row lock (the lock the worker's gate reads under), does all of:
   * 1. writes the new sealed value and raises its generation, in one statement;
   * 2. **withdraws the owner's approval**: the approval was given for the credential that was there, so sending
   *    with another needs the owner's word again (`approve`; a `resume` is not enough);
   * 3. **withdraws the worker's attestation**: the adapter it speaks of was built from the old credential.
   * From that commit no attempt is taken or marked for the provider, by any worker; a worker that still holds the
   * old credential can neither attest nor send, even after the new approval, until it has built its adapter again
   * from the stored one. An attempt already marked finishes as any attempt does; nothing is released or recalled.
   */
  async saveCredential(actor: Actor, code: string, body: unknown): Promise<{ ok: true }> {
    requireOwner(actor);
    const { value } = parseInput(ProviderCredentialBody, body);
    const { target } = this.settings();
    if (!target) fail(409, 'DISPATCH_NOT_CONFIGURED');
    // A value that already has the sealed form is not a credential, and `seal` would store it as it is.
    if (isSealed(value)) fail(400, 'INVALID');
    if (!secretsKey()) fail(500, 'CREDENTIAL_UNSEALABLE');
    const sealedValue = seal(value);
    if (!isSealed(sealedValue) || sealedValue.includes(value)) fail(500, 'CREDENTIAL_UNSEALABLE');
    await this.uow.runTx(async (tx) => {
      const provider = await this.locked(tx, code, target);
      await this.repo.saveCredential(tx, provider.id, target, sealedValue, actor.loginName);
      await this.repo.closeForNewCredential(tx, provider.id);
    });
    return { ok: true };
  }

  /** The provider's row, held until the transaction ends: the worker's gate waits on it, and it on the gate. */
  private async locked(tx: Prisma.TransactionClient, code: string, target: ProviderTarget | null) {
    const provider = await this.repo.lockedState(tx, code, target);
    if (!provider) fail(404, 'NOT_FOUND');
    return provider;
  }

  /** The locked provider with the deployment's target and name, once conditions 1 to 3 hold here and a credential is stored. */
  private async lockedForSwitch(tx: Prisma.TransactionClient, code: string) {
    const settings = this.settings();
    const provider = await this.locked(tx, code, settings.target);
    // Judged as if approved here and not paused: only what the deployment itself must say.
    const asked: ProviderDispatchState = { code, dispatchApprovedAt: new Date(0), dispatchApprovedTarget: settings.target, dispatchApprovedDeployment: settings.deployment, dispatchPausedAt: null };
    const judged = eligibility(settings, asked);
    if (!judged.eligible || !settings.deployment) fail(409, (judged.eligible ? undefined : UNSET[judged.refusal]) ?? 'DISPATCH_NOT_CONFIGURED');
    if (!(await this.repo.hasCredential(tx, provider.id, judged.target))) fail(409, 'DISPATCH_CREDENTIAL_MISSING');
    return { provider, target: judged.target, deployment: settings.deployment };
  }
}
