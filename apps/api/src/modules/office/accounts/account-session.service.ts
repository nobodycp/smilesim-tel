import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Gate } from '../kernel/types';
import { handoffKey } from './handoff';

/** Opens an entered session on its door (handoff) and ends it (leave). The cookies are set by the controller. */
@Injectable()
export class AccountSessionService {
  constructor(private readonly kernel: OfficeKernel) {}

  async leave(gate: Gate) {
    const live = gate.sessionId ? await this.kernel.auth.liveSession(gate.sessionId) : null;
    if (!live || live.session.kind !== 'impersonation') fail(400, 'INVALID');
    await this.kernel.auth.revokeSessions([live.session.id]);
    return { ok: true };
  }

  /** Trades a handoff code for the entered session and the owner's session; the code works once. */
  async handoff(body: unknown): Promise<{ sessionId: string; homeId: string | null }> {
    const code = body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string' ? (body as { code: string }).code : '';
    if (!code || code.length > 100) fail(400, 'INVALID');
    const key = handoffKey(code);
    const kept = await this.kernel.auth.getSecret(key);
    if (!kept) fail(400, 'INVALID');
    await this.kernel.auth.dropSecret(key);
    const parsed = JSON.parse(kept) as { sessionId: string; homeId: string | null };
    const live = await this.kernel.auth.liveSession(parsed.sessionId);
    if (!live || live.session.kind !== 'impersonation') fail(400, 'INVALID');
    return parsed;
  }
}
