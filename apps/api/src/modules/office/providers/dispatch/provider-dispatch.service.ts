import { Injectable } from '@nestjs/common';
import { wholeEnv } from '../../../../config';
import type { Prisma } from '../../../../generated/prisma/client';
import type { ErrorCode } from '../../../../errors';
import { parseInput } from '../../../shared/input';
import { fail } from '../../../shared/office-failure';
import { isSealed, seal, secretsKey } from '../../../shared/secret-box';
import type { Actor } from '../../kernel/types';
import { UnitOfWork } from '../../kernel/unit-of-work';
import { requireOwner } from '../../policy';
import { ProviderDispatchRepository } from './provider-dispatch.repository';
import { ProviderCredentialBody } from '../providers.schemas';
import { dispatchSettings, eligibility, mayOpenDispatch, workerReady, type DispatchRefusal, type DispatchSettings, type ProviderDispatchState } from './dispatch-policy';

/** What the branch owner reads of a provider's dispatch: where each condition stands. Never a credential. */
export type DispatchStatus = {
  /** The deployment's own settings, as the API process was given them. */
  dispatchOn: boolean;
  target: string | null;
  listed: boolean;
  /** The owner's approval, and the target it was given for. */
  approvedAt: string | null;
  approvedByLoginName: string | null;
  approvedTarget: string | null;
  pausedAt: string | null;
  /** Whether a credential is stored for the deployment's target. Its value is never answered. */
  hasCredential: boolean;
  /** Whether the worker attested, recently and for this target, that it holds an adapter for the provider. */
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
 * and never opens one: there is no method here that reads `sealedValue`.
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
  async opens(providerCode: string, now: Date = new Date()): Promise<boolean> {
    const settings = this.settings();
    // Nothing is read from the database for a deployment that does not dispatch at all.
    if (!settings.on || settings.problems.length > 0) return false;
    return mayOpenDispatch(settings, await this.repo.state(this.uow.prisma, providerCode), now);
  }

  async status(actor: Actor, code: string): Promise<DispatchStatus> {
    requireOwner(actor);
    const provider = await this.repo.state(this.uow.prisma, code);
    if (!provider) fail(404, 'NOT_FOUND');
    const settings = this.settings();
    const judged = eligibility(settings, provider);
    const now = new Date();
    const hasCredential = settings.target ? await this.repo.hasCredential(this.uow.prisma, provider.id, settings.target) : false;
    return {
      dispatchOn: settings.on,
      target: settings.target,
      listed: settings.adapters.includes(code),
      approvedAt: provider.dispatchApprovedAt?.toISOString() ?? null,
      approvedByLoginName: provider.dispatchApprovedByLoginName,
      approvedTarget: provider.dispatchApprovedTarget,
      pausedAt: provider.dispatchPausedAt?.toISOString() ?? null,
      hasCredential,
      workerReady: settings.target ? workerReady(provider, settings.target, now) : false,
      eligible: judged.eligible,
      refusal: judged.eligible ? null : judged.refusal,
      opens: mayOpenDispatch(settings, provider, now),
    };
  }

  /**
   * The owner approves dispatching this provider **on this deployment, for its target**. Refused unless the
   * deployment itself is set up for it (dispatch on, the provider named, the target stated) and a credential for
   * that target is stored: an approval is the last of the conditions, never the first. It records the target, so
   * it does not stand for the other one. It does not lift a pause.
   */
  async approve(actor: Actor, code: string): Promise<{ ok: true }> {
    requireOwner(actor);
    await this.uow.runTx(async (tx) => {
      const { provider, target } = await this.lockedForSwitch(tx, code);
      await this.repo.approve(tx, provider.id, actor.loginName, target, new Date());
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
      const provider = await this.locked(tx, code);
      if (!provider.dispatchPausedAt) await this.repo.setPaused(tx, provider.id, new Date());
    });
    return { ok: true };
  }

  /**
   * The owner lifts the pause, after the conditions are judged again: the deployment is still set up for this
   * provider and target, a credential for the target is stored, and the approval on record is for this target.
   */
  async resume(actor: Actor, code: string): Promise<{ ok: true }> {
    requireOwner(actor);
    await this.uow.runTx(async (tx) => {
      const { provider, target } = await this.lockedForSwitch(tx, code);
      if (!provider.dispatchApprovedAt || provider.dispatchApprovedTarget !== target) fail(409, 'DISPATCH_NOT_APPROVED');
      await this.repo.setPaused(tx, provider.id, null);
    });
    return { ok: true };
  }

  /**
   * Stores, or replaces, the provider's credential for this deployment's target, sealed. One statement, so a
   * reader never finds half of a replacement. The value is not answered, logged or kept anywhere else, and a
   * deployment with no valid `SECRETS_KEY` stores nothing. A deployment stores a credential for its own target
   * only: a sandbox deployment cannot be handed a live one.
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
    const provider = await this.repo.state(this.uow.prisma, code);
    if (!provider) fail(404, 'NOT_FOUND');
    await this.repo.saveCredential(this.uow.prisma, provider.id, target, sealedValue, actor.loginName);
    return { ok: true };
  }

  /** The provider's row, held until the transaction ends: the worker's gate waits on it, and it on the gate. */
  private async locked(tx: Prisma.TransactionClient, code: string) {
    const provider = await this.repo.lockedState(tx, code);
    if (!provider) fail(404, 'NOT_FOUND');
    return provider;
  }

  /** The locked provider and the deployment's target, once conditions 1 to 3 hold here and a credential is stored. */
  private async lockedForSwitch(tx: Prisma.TransactionClient, code: string) {
    const provider = await this.locked(tx, code);
    const settings = this.settings();
    // Judged as if approved and not paused: only what the deployment itself must say.
    const asked: ProviderDispatchState = { code, dispatchApprovedAt: new Date(0), dispatchApprovedTarget: settings.target, dispatchPausedAt: null };
    const judged = eligibility(settings, asked);
    if (!judged.eligible) fail(409, UNSET[judged.refusal] ?? 'DISPATCH_NOT_CONFIGURED');
    if (!(await this.repo.hasCredential(tx, provider.id, judged.target))) fail(409, 'DISPATCH_CREDENTIAL_MISSING');
    return { provider, target: judged.target };
  }
}
