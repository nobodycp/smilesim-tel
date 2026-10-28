import { Inject, Injectable } from '@nestjs/common';
import { decideLogin } from './decide-login';
import { AUTH_STORE, AuthStore, SessionRow, StoredUser } from './auth.store';
import { hashPassword, passwordMatches } from './password';
import { idsToRevoke, isListedAccountSession } from './sessions';
import { RATE_LIMIT_MESSAGE, loginBlocked, validateNewPassword, validateNickname } from './validators';

export type LoginResult =
  | { kind: 'error'; status: number; message: string }
  | { kind: 'ok'; status: 200; body: { next: string }; sessionId: string };

export type Failure = { kind: 'error'; status: 400 | 401 | 403 | 404; message: string };
export type Outcome<T> = Failure | ({ kind: 'ok' } & T);
type Meta = { userAgent: string; ip: string };
type Authed = { session: SessionRow; user: StoredUser };

export const NOT_SIGNED_IN = 'يلزم تسجيل الدخول';
export const FORBIDDEN = 'غير مسموح';
export const NOT_FOUND = 'غير موجود';
export const WRONG_CURRENT_PASSWORD = 'كلمة السر الحالية غير صحيحة';
export const EMAIL_ERROR = 'البريد الإلكتروني غير صحيح';
export const PHONE_ERROR = 'رقم الهاتف غير صحيح';
export const INVALID_BODY = 'بيانات غير صالحة';

const fail = (status: Failure['status'], message: string): Failure => ({ kind: 'error', status, message });
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9 ()-]{6,20}$/;

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

  /** Resolves the cookie's session and slides its expiry. Null when missing, revoked, or expired. */
  private async authenticate(sessionId: string | undefined): Promise<Authed | null> {
    if (!sessionId) return null;
    const found = await this.store.liveSession(sessionId);
    if (!found) return null;
    await this.store.touchSession(sessionId);
    return found;
  }

  async changePassword(
    sessionId: string | undefined,
    body: { password?: unknown; nextPassword?: unknown },
    meta: Meta,
  ): Promise<Outcome<{ body: { next: string }; sessionId: string }>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, NOT_SIGNED_IN);
    const { session, user } = authed;
    if (session.scope !== 'password_change' && session.scope !== 'full') return fail(403, FORBIDDEN);
    if (typeof body?.password !== 'string' || typeof body?.nextPassword !== 'string') return fail(400, INVALID_BODY);
    if (!(await passwordMatches(user.passwordHash, body.password))) return fail(401, WRONG_CURRENT_PASSWORD);
    const invalid = validateNewPassword(body.nextPassword);
    if (invalid) return fail(400, invalid);

    const passwordHash = await hashPassword(body.nextPassword);
    await this.store.updateUser(user.id, { passwordHash, mustChangePassword: false });
    const updated = (await this.store.findByLogin(user.loginName)) ?? { ...user, passwordHash, mustChangePassword: false };
    const decision = decideLogin({ user: updated, passwordMatches: true, policy: await this.store.policy() });
    if (decision.kind === 'error') return fail(decision.status, decision.message);

    await this.store.revokeSessions([session.id]);
    if (decision.scope === 'full') {
      const existing = await this.store.listFullSessions(user.id);
      await this.store.revokeSessions(idsToRevoke(existing, true));
    }
    const newSessionId = await this.store.saveSession({
      userId: user.id,
      scope: decision.scope,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    return { kind: 'ok', body: { next: decision.next }, sessionId: newSessionId };
  }

  async updateProfile(
    sessionId: string | undefined,
    body: { nickname?: unknown; email?: unknown; phone?: unknown; nextPassword?: unknown; currentPassword?: unknown },
  ): Promise<Outcome<{ profile: { nickname?: string; email?: string; phone?: string } }>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, NOT_SIGNED_IN);
    const { session, user } = authed;
    if (session.scope !== 'full') return fail(403, FORBIDDEN);
    const input = body ?? {};
    const { nickname, email, phone, nextPassword, currentPassword } = input;
    for (const value of [nickname, email, phone, nextPassword, currentPassword]) {
      if (value !== undefined && typeof value !== 'string') return fail(400, INVALID_BODY);
    }

    const sensitive = email !== undefined || phone !== undefined || nextPassword !== undefined;
    if (sensitive) {
      const ok = typeof currentPassword === 'string' && (await passwordMatches(user.passwordHash, currentPassword));
      if (!ok) return fail(401, WRONG_CURRENT_PASSWORD);
    }

    const patch: Parameters<AuthStore['updateUser']>[1] = {};
    if (typeof nickname === 'string') {
      const invalid = validateNickname(nickname);
      if (invalid) return fail(400, invalid);
      patch.nickname = nickname.trim();
    }
    if (typeof email === 'string') {
      if (!EMAIL_PATTERN.test(email.trim())) return fail(400, EMAIL_ERROR);
      patch.email = email.trim();
    }
    if (typeof phone === 'string') {
      if (!PHONE_PATTERN.test(phone.trim())) return fail(400, PHONE_ERROR);
      patch.phone = phone.trim();
    }
    if (typeof nextPassword === 'string') {
      const invalid = validateNewPassword(nextPassword);
      if (invalid) return fail(400, invalid);
      patch.passwordHash = await hashPassword(nextPassword);
    }

    await this.store.updateUser(user.id, patch);
    const stored = (await this.store.findByLogin(user.loginName)) ?? user;
    return { kind: 'ok', profile: { nickname: stored.nickname, email: stored.email, phone: stored.phone } };
  }

  async setUserPassword(
    sessionId: string | undefined,
    loginName: string,
    body: { password?: unknown },
  ): Promise<Outcome<unknown>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, NOT_SIGNED_IN);
    if (authed.session.scope !== 'full' || !authed.user.isBranchOwner) return fail(403, FORBIDDEN);
    if (typeof body?.password !== 'string') return fail(400, INVALID_BODY);
    const invalid = validateNewPassword(body.password);
    if (invalid) return fail(400, invalid);
    const target = await this.store.findByLogin(loginName);
    if (!target) return fail(404, NOT_FOUND);
    await this.store.updateUser(target.id, { passwordHash: await hashPassword(body.password), mustChangePassword: true });
    return { kind: 'ok' };
  }

  async listSessions(
    sessionId: string | undefined,
  ): Promise<Outcome<{ sessions: { id: string; userAgent: string; ip: string; createdAt: Date; lastSeenAt: Date; current: boolean }[] }>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, NOT_SIGNED_IN);
    if (authed.session.scope !== 'full') return fail(403, FORBIDDEN);
    const rows = (await this.store.listSessions(authed.user.id)).filter(isListedAccountSession);
    return {
      kind: 'ok',
      sessions: rows.map((row) => ({
        id: row.id,
        userAgent: row.userAgent,
        ip: row.ip,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
        current: row.id === authed.session.id,
      })),
    };
  }

  async revokeSession(sessionId: string | undefined, targetId: string): Promise<Outcome<{ current: boolean }>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, NOT_SIGNED_IN);
    if (authed.session.scope !== 'full') return fail(403, FORBIDDEN);
    const rows = (await this.store.listSessions(authed.user.id)).filter(isListedAccountSession);
    if (!rows.some((row) => row.id === targetId)) return fail(404, NOT_FOUND);
    await this.store.revokeSessions([targetId]);
    return { kind: 'ok', current: targetId === authed.session.id };
  }
}
