import type { Db } from '../../kernel/unit-of-work';
import { maySend, type DispatchSettings, type ProviderDispatchState } from './dispatch-policy';

/**
 * The point where sending is allowed or not (ADR 0019, D18 "Pausing"). The dispatcher passes a gate to the two
 * writes that let a request leave: taking an attempt (`claim`) and marking it as about to be sent (`beginSend`).
 * Each runs in a transaction that first asks the gate, and the gate reads the provider's row **under a lock**.
 */
export interface SendGate {
  /** Whether an operation of this provider may be taken or marked now. Called inside the caller's transaction. */
  permits(tx: Db, providerId: string): Promise<boolean>;
}

type LockedProvider = ProviderDispatchState;

/**
 * The gate of a deployment: the four conditions as this worker's settings and the provider's row state them, and
 * an adapter this worker built.
 *
 * The row is read `FOR SHARE`. The owner's pause, resume and approval are `UPDATE`s of the same row, so the two
 * cannot overlap: a pause that committed first is what this reads, and a pause that comes while this transaction
 * is open waits until it has committed. That makes the mark of `beginSend` the one atomic line:
 * - a pause committed **before** the mark: the attempt is not marked, so the provider is not called;
 * - a pause committed **after** the mark: that one attempt had leave to go and finishes as any attempt does (a
 *   verdict, or unknown). A pause recalls nothing that left, and no later attempt is taken.
 */
export class DeploymentSendGate implements SendGate {
  constructor(private readonly settings: DispatchSettings, private readonly holdsAdapter: (providerCode: string) => boolean) {}

  async permits(tx: Db, providerId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<LockedProvider[]>`
      SELECT "code", "dispatchApprovedAt", "dispatchApprovedTarget", "dispatchPausedAt" FROM "Provider" WHERE "id" = ${providerId} FOR SHARE`;
    const provider = rows[0] ?? null;
    return maySend(this.settings, provider, provider !== null && this.holdsAdapter(provider.code));
  }
}
