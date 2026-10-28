import { Inject, Injectable } from '@nestjs/common';
import { decideLogin } from './decide-login';
import { AUTH_STORE, AuthStore } from './auth.store';
import { passwordMatches } from './password';
import { idsToRevoke } from './sessions';
import { RATE_LIMIT_MESSAGE, loginBlocked } from './validators';

export type LoginResult =
  | { kind: 'error'; status: number; message: string }
  | { kind: 'ok'; status: 200; body: { next: string }; sessionId: string };

@Injectable()
export class AuthService {
  constructor(@Inject(AUTH_STORE) private readonly store: AuthStore) {}

  async login(body: { loginName: string; password: string }, meta: { userAgent: string; ip: string }): Promise<LoginResult> {
    if (loginBlocked(await this.store.failedCount(body.loginName))) {
      return { kind: 'error', status: 429, message: RATE_LIMIT_MESSAGE };
    }
    const found = await this.store.findByLogin(body.loginName);
    const matches = found ? await passwordMatches(found.passwordHash, body.password) : false;
    const decision = decideLogin({ user: found, passwordMatches: matches, policy: await this.store.policy() });
    if (decision.kind === 'error') {
      if (decision.status === 401) await this.store.recordFailure(body.loginName);
      return { kind: 'error', status: decision.status, message: decision.message };
    }
    const user = found!;
    await this.store.clearFailures(body.loginName);
    if (decision.scope === 'full') {
      const existing = await this.store.listFullSessions(user.id);
      await this.store.revokeSessions(idsToRevoke(existing, true));
    }
    const sessionId = await this.store.saveSession({
      userId: user.id,
      scope: decision.scope,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    return { kind: 'ok', status: 200, body: { next: decision.next }, sessionId };
  }
}
