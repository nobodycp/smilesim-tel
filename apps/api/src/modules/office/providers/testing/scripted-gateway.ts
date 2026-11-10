import type { ProviderGateway, ProviderResult } from '../gateway/provider-gateway';
import { NOT_CONNECTED } from '../gateway/provider-gateway';
import type { OutgoingOperation, SendEvidence } from '../operations/provider-operation.rules';

/** One scripted answer: evidence, or a function that produces it (to hold a call open, or to throw). */
export type Scripted = SendEvidence | ((operation: OutgoingOperation) => Promise<SendEvidence>);

/**
 * A gateway for specs only: it reaches nothing. `send` answers the next scripted step and records what it was
 * asked, so a spec can count how often the "provider" was called and with which key and attempt.
 */
export class ScriptedGateway implements ProviderGateway {
  readonly simulated = false;
  readonly calls: OutgoingOperation[] = [];
  private readonly script: Scripted[] = [];

  /** Queues answers for the next calls, in order. With nothing queued, `send` confirms. */
  next(...steps: Scripted[]): this {
    this.script.push(...steps);
    return this;
  }

  accept(): void {}

  async run(): Promise<ProviderResult> {
    return { ok: false, reason: NOT_CONNECTED };
  }

  async send(operation: OutgoingOperation): Promise<SendEvidence> {
    this.calls.push(operation);
    const step = this.script.shift() ?? { left: true, answer: 'confirmed', providerRef: `REF-${this.calls.length}` };
    return typeof step === 'function' ? step(operation) : step;
  }
}
