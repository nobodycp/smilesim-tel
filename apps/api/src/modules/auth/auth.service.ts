import { Inject, Injectable } from '@nestjs/common';
import { Layer, decideLogin } from './decide-login';
import { AUTH_STORE, AuthStore, SessionRow, StoredUser } from './auth.store';
import { hashPassword, passwordMatches } from './password';
import { idsToRevoke, isListedAccountSession } from './sessions';
import { createTotpSecret, totpKeyUri, totpMatches } from './totp';
import { addressProblem, cityProblem, fullNameProblem, loginBlocked, newPasswordProblem } from './validators';
import { ERROR_MESSAGES, type ErrorCode } from '../../errors';

export type LoginResult =
  | { kind: 'error'; status: number; message: string; code: ErrorCode }
  | { kind: 'ok'; status: 200; body: { next: string }; sessionId: string };

export type Failure = { kind: 'error'; status: 400 | 401 | 403 | 404; message: string; code: ErrorCode };
export type Outcome<T> = Failure | ({ kind: 'ok' } & T);
type Meta = { userAgent: string; ip: string };
type Authed = { session: SessionRow; user: StoredUser };

const TOTP_ISSUER = 'SmileSim';
const LAYERS: readonly Layer[] = ['branch', 'main_agent', 'agent', 'pos'];

const fail = (status: Failure['status'], code: ErrorCode): Failure => ({ kind: 'error', status, message: ERROR_MESSAGES[code], code });
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9 ()-]{6,20}$/;

/** The profile fields the owner reads and edits. `nickname` carries the full name. */
type ProfileView = { nickname?: string; email?: string; phone?: string; city?: string; address?: string };
const profileView = (user: StoredUser): ProfileView => ({
  nickname: user.nickname,
  email: user.email,
  phone: user.phone,
  city: user.city ?? undefined,
  address: user.address ?? undefined,
});

@Injectable()
export class AuthService {
  constructor(@Inject(AUTH_STORE) private readonly store: AuthStore) {}

  async login(
    body: { loginName: string; password: string },
    meta: { userAgent: string; ip: string },
    door: Layer | null = null,
  ): Promise<LoginResult> {
    if (loginBlocked(await this.store.failedCount(body.loginName))) {
      return { kind: 'error', status: 429, message: ERROR_MESSAGES.RATE_LIMITED, code: 'RATE_LIMITED' };
    }
    const found = await this.store.findByLogin(body.loginName);
    const matches = found ? await passwordMatches(found.passwordHash, body.password) : false;
    const decision = decideLogin({ user: found, passwordMatches: matches, policy: await this.store.policy() });
    if (decision.kind === 'error') {
      if (decision.status === 401) await this.store.recordFailure(body.loginName);
      return { kind: 'error', status: decision.status, message: decision.message, code: decision.code };
    }
    const user = found!;
    if (door && user.layer !== door) return { kind: 'error', status: 403, message: ERROR_MESSAGES.DOOR_MISMATCH, code: 'DOOR_MISMATCH' };
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
    if (!found || found.user.disabledAt) return null;
    await this.store.touchSession(sessionId);
    return found;
  }

  async changePassword(
    sessionId: string | undefined,
    body: { password?: unknown; nextPassword?: unknown },
    meta: Meta,
  ): Promise<Outcome<{ body: { next: string }; sessionId: string }>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    const { session, user } = authed;
    if (session.scope !== 'password_change' && session.scope !== 'full') return fail(403, 'FORBIDDEN');
    if (typeof body?.password !== 'string' || typeof body?.nextPassword !== 'string') return fail(400, 'INVALID');
    if (!(await passwordMatches(user.passwordHash, body.password))) return fail(401, 'WRONG_CURRENT_PASSWORD');
    const invalid = newPasswordProblem(body.nextPassword);
    if (invalid) return fail(400, invalid);

    const passwordHash = await hashPassword(body.nextPassword);
    await this.store.updateUser(user.id, { passwordHash, mustChangePassword: false });
    const updated = (await this.store.findByLogin(user.loginName)) ?? { ...user, passwordHash, mustChangePassword: false };
    const decision = decideLogin({ user: updated, passwordMatches: true, policy: await this.store.policy() });
    if (decision.kind === 'error') return fail(decision.status, decision.code);

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

  async getProfile(
    sessionId: string | undefined,
  ): Promise<Outcome<{ profile: ProfileView & { loginName: string } }>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    if (authed.session.scope !== 'full') return fail(403, 'FORBIDDEN');
    return { kind: 'ok', profile: { loginName: authed.user.loginName, ...profileView(authed.user) } };
  }

  async updateProfile(
    sessionId: string | undefined,
    body: { nickname?: unknown; email?: unknown; phone?: unknown; city?: unknown; address?: unknown; nextPassword?: unknown; currentPassword?: unknown },
  ): Promise<Outcome<{ profile: ProfileView }>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    const { session, user } = authed;
    if (session.scope !== 'full') return fail(403, 'FORBIDDEN');
    const input = body ?? {};
    const { nickname, email, phone, city, address, nextPassword, currentPassword } = input;
    for (const value of [nickname, email, phone, city, address, nextPassword, currentPassword]) {
      if (value !== undefined && typeof value !== 'string') return fail(400, 'INVALID');
    }

    const sensitive = email !== undefined || phone !== undefined || nextPassword !== undefined;
    if (sensitive) {
      const ok = typeof currentPassword === 'string' && (await passwordMatches(user.passwordHash, currentPassword));
      if (!ok) return fail(401, 'WRONG_CURRENT_PASSWORD');
    }

    const patch: Parameters<AuthStore['updateUser']>[1] = {};
    if (typeof nickname === 'string') {
      const invalid = fullNameProblem(nickname);
      if (invalid) return fail(400, invalid);
      patch.nickname = nickname.trim();
    }
    if (typeof city === 'string') {
      const invalid = cityProblem(city);
      if (invalid) return fail(400, invalid);
      patch.city = city.trim() || null;
    }
    if (typeof address === 'string') {
      const invalid = addressProblem(address);
      if (invalid) return fail(400, invalid);
      patch.address = address.trim() || null;
    }
    if (typeof email === 'string') {
      if (!EMAIL_PATTERN.test(email.trim())) return fail(400, 'EMAIL_INVALID');
      patch.email = email.trim();
    }
    if (typeof phone === 'string') {
      if (!PHONE_PATTERN.test(phone.trim())) return fail(400, 'PHONE_INVALID');
      patch.phone = phone.trim();
    }
    if (typeof nextPassword === 'string') {
      const invalid = newPasswordProblem(nextPassword);
      if (invalid) return fail(400, invalid);
      patch.passwordHash = await hashPassword(nextPassword);
    }

    await this.store.updateUser(user.id, patch);
    const stored = (await this.store.findByLogin(user.loginName)) ?? user;
    return { kind: 'ok', profile: profileView(stored) };
  }

  async setUserPassword(
    sessionId: string | undefined,
    loginName: string,
    body: { password?: unknown },
  ): Promise<Outcome<unknown>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    if (authed.session.scope !== 'full' || !authed.user.isBranchOwner) return fail(403, 'FORBIDDEN');
    if (typeof body?.password !== 'string') return fail(400, 'INVALID');
    const invalid = newPasswordProblem(body.password);
    if (invalid) return fail(400, invalid);
    const target = await this.store.findByLogin(loginName);
    if (!target) return fail(404, 'NOT_FOUND');
    await this.store.updateUser(target.id, { passwordHash: await hashPassword(body.password), mustChangePassword: true });
    return { kind: 'ok' };
  }

  /** Full account sessions that are not revoked and have not expired. */
  private async listedSessions(userId: string): Promise<SessionRow[]> {
    const now = Date.now();
    return (await this.store.listSessions(userId)).filter((row) => isListedAccountSession(row) && row.expiresAt.getTime() > now);
  }

  async listSessions(
    sessionId: string | undefined,
  ): Promise<Outcome<{ sessions: { id: string; userAgent: string; ip: string; createdAt: Date; lastSeenAt: Date; current: boolean }[] }>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    if (authed.session.scope !== 'full') return fail(403, 'FORBIDDEN');
    const rows = await this.listedSessions(authed.user.id);
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
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    if (authed.session.scope !== 'full') return fail(403, 'FORBIDDEN');
    const rows = await this.listedSessions(authed.user.id);
    if (!rows.some((row) => row.id === targetId)) return fail(404, 'NOT_FOUND');
    await this.store.revokeSessions([targetId]);
    return { kind: 'ok', current: targetId === authed.session.id };
  }

  /** Replaces a two-factor session with a full one, applying the session limit before the new one is kept. */
  private async promoteToFull(session: SessionRow, user: StoredUser, meta: Meta): Promise<string> {
    await this.store.revokeSessions([session.id]);
    const existing = await this.store.listFullSessions(user.id);
    await this.store.revokeSessions(idsToRevoke(existing, true));
    return this.store.saveSession({ userId: user.id, scope: 'full', userAgent: meta.userAgent, ip: meta.ip });
  }

  /** Two-factor enrollment is open to a two-factor session (forced enrollment) or a full one (voluntary). */
  private async enrollmentSession(sessionId: string | undefined): Promise<Outcome<Authed>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    if (authed.session.scope !== 'two_factor' && authed.session.scope !== 'full') return fail(403, 'FORBIDDEN');
    // An account that already has two-factor on must switch it off before enrolling again.
    // Otherwise a password-only (two_factor scope) session could swap the secret and skip the code.
    if (authed.user.twoFactorEnabled) return fail(403, 'FORBIDDEN');
    return { kind: 'ok', ...authed };
  }

  async setupTwoFactor(sessionId: string | undefined): Promise<Outcome<{ otpauth: string }>> {
    const enrolling = await this.enrollmentSession(sessionId);
    if (enrolling.kind === 'error') return enrolling;
    const secret = createTotpSecret();
    await this.store.updateUser(enrolling.user.id, { pendingTwoFactorSecret: secret });
    return { kind: 'ok', otpauth: totpKeyUri(secret, enrolling.user.loginName, TOTP_ISSUER) };
  }

  async confirmTwoFactor(
    sessionId: string | undefined,
    body: { code?: unknown },
    meta: Meta,
  ): Promise<Outcome<{ sessionId?: string }>> {
    const enrolling = await this.enrollmentSession(sessionId);
    if (enrolling.kind === 'error') return enrolling;
    const { session, user } = enrolling;
    if (typeof body?.code !== 'string') return fail(400, 'INVALID');
    if (!user.pendingTwoFactorSecret) return fail(400, 'INVALID');
    if (!totpMatches(user.pendingTwoFactorSecret, body.code)) return fail(401, 'WRONG_CODE');
    await this.store.updateUser(user.id, {
      twoFactorEnabled: true,
      twoFactorSecret: user.pendingTwoFactorSecret,
      pendingTwoFactorSecret: null,
    });
    if (session.scope === 'full') return { kind: 'ok' };
    return { kind: 'ok', sessionId: await this.promoteToFull(session, user, meta) };
  }

  async verifyTwoFactor(
    sessionId: string | undefined,
    body: { code?: unknown },
    meta: Meta,
  ): Promise<Outcome<{ sessionId: string }>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    const { session, user } = authed;
    if (session.scope !== 'two_factor') return fail(403, 'FORBIDDEN');
    if (typeof body?.code !== 'string') return fail(400, 'INVALID');
    if (!user.twoFactorEnabled || !user.twoFactorSecret) return fail(403, 'FORBIDDEN');
    if (!totpMatches(user.twoFactorSecret, body.code)) return fail(401, 'WRONG_CODE');
    return { kind: 'ok', sessionId: await this.promoteToFull(session, user, meta) };
  }

  private async clearTwoFactor(userId: string): Promise<void> {
    await this.store.updateUser(userId, { twoFactorEnabled: false, twoFactorSecret: null, pendingTwoFactorSecret: null });
  }

  async disableOwnTwoFactor(sessionId: string | undefined): Promise<Outcome<unknown>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    if (authed.session.scope !== 'full') return fail(403, 'FORBIDDEN');
    const { user } = authed;
    const required = (await this.store.policy())[user.layer];
    if (required && !user.twoFactorExempt) return fail(403, 'FORBIDDEN');
    await this.clearTwoFactor(user.id);
    return { kind: 'ok' };
  }

  private async ownerSession(sessionId: string | undefined): Promise<Outcome<Authed>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    if (authed.session.scope !== 'full' || !authed.user.isBranchOwner) return fail(403, 'FORBIDDEN');
    return { kind: 'ok', ...authed };
  }

  async clearUserTwoFactor(sessionId: string | undefined, loginName: string): Promise<Outcome<unknown>> {
    const owner = await this.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    const target = await this.store.findByLogin(loginName);
    if (!target) return fail(404, 'NOT_FOUND');
    await this.clearTwoFactor(target.id);
    return { kind: 'ok' };
  }

  async setPolicy(
    sessionId: string | undefined,
    body: { layer?: unknown; required?: unknown },
  ): Promise<Outcome<{ policy: Record<Layer, boolean> }>> {
    const owner = await this.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    const layer = LAYERS.find((candidate) => candidate === body?.layer);
    if (!layer || typeof body?.required !== 'boolean') return fail(400, 'INVALID');
    await this.store.setPolicy(layer, body.required);
    return { kind: 'ok', policy: await this.store.policy() };
  }

  async setExemption(
    sessionId: string | undefined,
    loginName: string,
    body: { exempt?: unknown },
  ): Promise<Outcome<{ twoFactorExempt: boolean }>> {
    const owner = await this.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    if (typeof body?.exempt !== 'boolean') return fail(400, 'INVALID');
    const target = await this.store.findByLogin(loginName);
    if (!target) return fail(404, 'NOT_FOUND');
    await this.store.updateUser(target.id, { twoFactorExempt: body.exempt });
    return { kind: 'ok', twoFactorExempt: body.exempt };
  }

  async disableUser(sessionId: string | undefined, loginName: string): Promise<Outcome<unknown>> {
    const owner = await this.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    const target = await this.store.findByLogin(loginName);
    if (!target) return fail(404, 'NOT_FOUND');
    await this.store.updateUser(target.id, { disabledAt: new Date() });
    await this.store.dropLiveSessions(target.id);
    return { kind: 'ok' };
  }
}
