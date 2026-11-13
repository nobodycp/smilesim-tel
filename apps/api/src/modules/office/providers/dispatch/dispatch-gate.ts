import type { Db } from '../../kernel/unit-of-work';
import type { OutgoingOperation, SendEvidence } from '../operations/provider-operation.rules';
import { maySend, type DispatchSettings, type ProviderDispatchState } from './dispatch-policy';

/**
 * Leave to send, as the gate gave it: it **is** the way to send. `send` goes through the one adapter the gate
 * judged, built from the generation of the credential that was stored at that moment. The dispatcher calls it
 * after the mark is committed and the transaction is over; it has no other way to reach a provider, so what is
 * sent cannot come from an adapter the gate did not see. It carries no credential that can be read, and it is
 * never stored, queued or logged: it lives in the worker's memory for one attempt.
 */
export interface SendPermit {
  send(operation: OutgoingOperation): Promise<SendEvidence>;
}

/**
 * The point where sending is allowed or not (ADR 0019, D18 "Pausing"). The dispatcher passes a gate to the two
 * writes that let a request leave: taking an attempt (`claim`) and marking it as about to be sent (`beginSend`).
 * Each runs in a transaction that first asks the gate, and the gate reads the provider's row **under a lock**.
 * Recovery asks it too, to know whether an unsent attempt counts.
 */
export interface SendGate {
  /**
   * Leave for an operation of this provider to be taken or marked now, or null. Called inside the caller's
   * transaction. The permit answered at the mark is the one the request is then sent with.
   */
  permits(tx: Db, providerId: string): Promise<SendPermit | null>;
}

type LockedProvider = Omit<ProviderDispatchState, 'credentialGeneration' | 'attestations'> & { id: string };

/** What a worker holds for one provider at one moment: the adapter and the generation it was built from, as one thing. */
export type HeldSender = { readonly generation: number; send(operation: OutgoingOperation): Promise<SendEvidence> };

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
 *
 * What the worker holds is read **once**, as one object (the adapter with its generation), judged, and handed
 * back as the permit. The worker may build its adapters again a moment later: the request that was marked under
 * this permit still goes through the adapter that was judged, never through the newer one, and no lock is held
 * while it does.
 */
export class DeploymentSendGate implements SendGate {
  /** `held`: what this worker holds for the provider right now; null when it holds no adapter for it. */
  constructor(private readonly settings: DispatchSettings, private readonly held: (providerCode: string) => HeldSender | null) {}

  async permits(tx: Db, providerId: string): Promise<SendPermit | null> {
    const { target } = this.settings;
    // Nothing is locked for a deployment that cannot send at all.
    if (!target) return null;
    const rows = await tx.$queryRaw<LockedProvider[]>`
      SELECT "id", "code", "dispatchApprovedAt", "dispatchApprovedTarget", "dispatchApprovedDeployment", "dispatchPausedAt" FROM "Provider" WHERE "id" = ${providerId} FOR SHARE`;
    const provider = rows[0] ?? null;
    if (!provider) return null;
    const stored = await tx.$queryRaw<{ generation: number }[]>`SELECT "generation" FROM "ProviderCredential" WHERE "providerId" = ${provider.id} AND "target" = ${target}`;
    // One read of what is held: the generation that is judged and the adapter that will send are the same object's.
    const sender = this.held(provider.code);
    if (!maySend(this.settings, { ...provider, credentialGeneration: stored[0]?.generation ?? null }, sender ? sender.generation : null)) return null;
    return sender;
  }
}
