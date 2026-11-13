import { AUTH_STORE, type AuthStore } from '../../auth/auth.store';
import { Inject, Injectable } from '@nestjs/common';
import { parseInput } from '../../shared/input';
import { fail } from '../../shared/api-failure';
import type { Gate } from '../kernel/types';
import { HandoffBody } from './accounts.schemas';
import { handoffKey } from './handoff';

/** Opens an entered session on its door (handoff) and ends it (leave). The cookies are set by the controller. */
@Injectable()
export class AccountSessionService {
  constructor(@Inject(AUTH_STORE) private readonly auth: AuthStore) {}

  async leave(gate: Gate) {
    const live = gate.sessionId ? await this.auth.liveSession(gate.sessionId) : null;
    if (!live || live.session.kind !== 'impersonation') fail(400, 'INVALID');
    await this.auth.revokeSessions([live.session.id]);
    return { ok: true };
  }

  /** Trades a handoff code for the entered session and the owner's session; the code works once. */
  async handoff(body: HandoffBody): Promise<{ sessionId: string; homeId: string | null }> {
    const { code } = parseInput(HandoffBody, body);
    const key = handoffKey(code);
    // Read and removed in one step: two requests cannot both redeem one code.
    const kept = await this.auth.takeSecret(key);
    if (!kept) fail(400, 'INVALID');
    const parsed = JSON.parse(kept) as { sessionId: string; homeId: string | null };
    const live = await this.auth.liveSession(parsed.sessionId);
    if (!live || live.session.kind !== 'impersonation') fail(400, 'INVALID');
    return parsed;
  }
}
