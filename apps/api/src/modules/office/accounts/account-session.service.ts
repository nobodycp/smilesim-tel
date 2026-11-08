import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Gate } from '../kernel/types';

/** Ends an entered (impersonation) session. The cookies are put back by the controller. */
@Injectable()
export class AccountSessionService {
  constructor(private readonly kernel: OfficeKernel) {}

  async leave(gate: Gate) {
    const live = gate.sessionId ? await this.kernel.auth.liveSession(gate.sessionId) : null;
    if (!live || live.session.kind !== 'impersonation') fail(400, 'INVALID');
    await this.kernel.auth.revokeSessions([live.session.id]);
    return { ok: true };
  }
}
