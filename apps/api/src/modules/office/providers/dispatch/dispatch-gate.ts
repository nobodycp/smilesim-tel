import type { Db } from '../../kernel/unit-of-work';
import { maySend, type DispatchSettings, type ProviderDispatchState } from './dispatch-policy';

/**
 * The point where sending is allowed or not (ADR 0019, D18 "Pausing"). The dispatcher passes a gate to the two
 * writes that let a request leave: taking an attempt (`claim`) and marking it as about to be sent (`beginSend`).
 * Each runs in a transaction that first asks the gate, and the gate reads the provider's row **under a lock**.
 * Recovery asks it too, to know whether an unsent attempt counts.
 */
export interface SendGate {
  /** Whether an operation of this provider may be taken or marked now. Called inside the caller's transaction. */
  permits(tx: Db, providerId: string): Promise<boolean>;
}

type LockedProvider = Omit<ProviderDispatchState, 'credentialGeneration'> & { id: string };

/**
 * The gate of a deployment: the four conditions as this worker's settings and the provider's row state them, and
 * an adapter this worker built from the credential that is stored now.
 *
 * The row is read `FOR SHARE`. The owner's pause, resume and approval, and every write of the credential, hold
 * the same row `FOR UPDATE`, so the two cannot overlap: a change that committed first is what this reads, and one
 * that comes while this transaction is open waits until it has committed. That makes the mark of `beginSend` the
 * one atomic line:
 * - a pause (or a replaced credential) committed **before** the mark: the attempt is not marked, so the provider
 *   is not called, and the attempt is handed back uncounted;
 * - committed **after** the mark: that one attempt had leave to go and finishes as any attempt does (a verdict, or
 *   unknown). Nothing that left is recalled, and no later attempt is taken.
 *
 * The credential's generation is read by a second statement, after the lock is held. In one statement it would be
 * read from the snapshot taken before the wait for the lock, and a replacement that committed during the wait
 * would be missed.
 */
export class DeploymentSendGate implements SendGate {
  /** `heldGeneration`: the generation of the credential this worker's adapter for the provider was built with; null when it holds none. */
  constructor(private readonly settings: DispatchSettings, private readonly heldGeneration: (providerCode: string) => number | null) {}

  async permits(tx: Db, providerId: string): Promise<boolean> {
    const { target } = this.settings;
    // Nothing is locked for a deployment that cannot send at all.
    if (!target) return false;
    const rows = await tx.$queryRaw<LockedProvider[]>`
      SELECT "id", "code", "dispatchApprovedAt", "dispatchApprovedTarget", "dispatchApprovedDeployment", "dispatchPausedAt" FROM "Provider" WHERE "id" = ${providerId} FOR SHARE`;
    const provider = rows[0] ?? null;
    if (!provider) return false;
    const stored = await tx.$queryRaw<{ generation: number }[]>`SELECT "generation" FROM "ProviderCredential" WHERE "providerId" = ${provider.id} AND "target" = ${target}`;
    return maySend(this.settings, { ...provider, credentialGeneration: stored[0]?.generation ?? null }, this.heldGeneration(provider.code));
  }
}
