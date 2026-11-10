import { Inject, Injectable } from '@nestjs/common';
import { Layer, decideLogin } from './decide-login';
import {
  ChangePasswordBody,
  ConfirmMethodBody,
  ExemptionBody,
  PolicyBody,
  SessionRulesBody,
  SetPasswordBody,
  TwoFactorCodeBody,
  TwoFactorMethodBody,
  UpdateProfileBody,
  UserContactBody,
  parseBody,
} from './auth.schemas';
import { AUTH_STORE, AuthStore, SessionRow, StoredUser, TwoFactorMethod } from './auth.store';
import { MESSAGE_SENDER, type MessageSender } from './message-sender';
import { CODE_TRIES, CODE_TTL_SECONDS, RESEND_SECONDS, codeMatches, hashCode, maskContact, newCode, type PendingCode } from './one-time-code';
import { hashPassword, passwordMatches } from './password';
import { SessionRuleValues, effectiveRules, idsToRevoke, isListedAccountSession } from './sessions';
import { createTotpSecret, totpKeyUri, totpMatches } from './totp';
import { addressProblem, cityProblem, fullNameProblem, loginBlocked, newPasswordProblem } from './validators';
import { ERROR_MESSAGES, type ErrorCode } from '../../errors';

export type LoginResult =
  | { kind: 'error'; status: number; message: string; code: ErrorCode }
  | { kind: 'ok'; status: 200; body: { next: string }; sessionId: string };

export type Failure = { kind: 'error'; status: 400 | 401 | 403 | 404 | 429; message: string; code: ErrorCode };
export type Outcome<T> = Failure | ({ kind: 'ok' } & T);
type Meta = { userAgent: string; ip: string };
export type Authed = { session: SessionRow; user: StoredUser };
type RuleView = { maxSessions: number; sessionMinutes: number };
const ruleView = (rules: { maxSessions: number; idleSeconds: number }): RuleView => ({ maxSessions: rules.maxSessions, sessionMinutes: rules.idleSeconds / 60 });
type CodeMethod = Exclude<TwoFactorMethod, 'app'>;
const codeKey = (userId: string) => `two-factor-code:${userId}`;
const sentKey = (userId: string) => `two-factor-sent:${userId}`;

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

/** How long an accepted authenticator code is remembered: longer than the window it stays valid in. */
const TOTP_REPLAY_SECONDS = 120;

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_STORE) private readonly store: AuthStore,
    @Inject(MESSAGE_SENDER) private readonly sender: MessageSender,
  ) {}

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
    if (decision.scope === 'full') await this.makeRoom(user);
    const sessionId = await this.store.saveSession({
      userId: user.id,
      scope: decision.scope,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    return { kind: 'ok', status: 200, body: { next: decision.next }, sessionId };
  }

  /** Resolves the cookie's session and slides its expiry. Null when missing, revoked, or expired. */
  async authenticate(sessionId: string | undefined): Promise<Authed | null> {
    if (!sessionId) return null;
    const found = await this.store.liveSession(sessionId);
    if (!found || found.user.disabledAt) return null;
    await this.store.touchSession(sessionId, found.rules.idleSeconds);
    return { session: found.session, user: found.user };
  }

  /** Before a new full session: closes the oldest beyond the account's allowed count. */
  async makeRoom(user: StoredUser): Promise<void> {
    const { maxSessions } = await this.store.rulesFor(user);
    const existing = await this.store.listFullSessions(user.id);
    await this.store.revokeSessions(idsToRevoke(existing, true, maxSessions));
  }

  /** Branch owner: the defaults and each layer's own values. */
  async sessionRules(sessionId: string | undefined): Promise<Outcome<{ view: { defaults: RuleView; layers: Record<Layer, SessionRuleValues> } }>> {
    const owner = await this.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    return { kind: 'ok', view: { defaults: ruleView(effectiveRules(null, null)), layers: await this.store.sessionRules() } };
  }

  async setLayerSessionRules(sessionId: string | undefined, layerName: string, body: SessionRulesBody): Promise<Outcome<{ layers: Record<Layer, SessionRuleValues> }>> {
    const owner = await this.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    const layer = LAYERS.find((candidate) => candidate === layerName);
    const rules = parseBody(SessionRulesBody, body);
    if (!layer || !rules) return fail(400, 'INVALID');
    await this.store.setSessionRules(layer, rules);
    return { kind: 'ok', layers: await this.store.sessionRules() };
  }

  /** Branch owner: an account's own values, what its layer gives, and the result. */
  async userSessionRules(sessionId: string | undefined, loginName: string): Promise<Outcome<{ view: { own: SessionRuleValues; layer: RuleView; effective: RuleView } }>> {
    const owner = await this.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    const target = await this.store.findByLogin(loginName);
    if (!target) return fail(404, 'NOT_FOUND');
    return { kind: 'ok', view: await this.userRuleView(target) };
  }

  async setUserSessionRules(
    sessionId: string | undefined,
    loginName: string,
    body: SessionRulesBody,
  ): Promise<Outcome<{ view: { own: SessionRuleValues; layer: RuleView; effective: RuleView } }>> {
    const owner = await this.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    const own = parseBody(SessionRulesBody, body);
    if (!own) return fail(400, 'INVALID');
    const target = await this.store.findByLogin(loginName);
    if (!target) return fail(404, 'NOT_FOUND');
    await this.store.updateUser(target.id, own);
    return { kind: 'ok', view: await this.userRuleView({ ...target, ...own }) };
  }

  private async userRuleView(user: StoredUser) {
    const layer = (await this.store.sessionRules())[user.layer];
    return {
      own: { maxSessions: user.maxSessions ?? null, sessionMinutes: user.sessionMinutes ?? null },
      layer: ruleView(effectiveRules(null, layer)),
      effective: ruleView(effectiveRules(user, layer)),
    };
  }

  async changePassword(
    sessionId: string | undefined,
    body: ChangePasswordBody,
    meta: Meta,
  ): Promise<Outcome<{ body: { next: string }; sessionId: string }>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    const { session, user } = authed;
    if (session.scope !== 'password_change' && session.scope !== 'full') return fail(403, 'FORBIDDEN');
    // An entered session acts in the office as that account; it never touches its credentials (rule 3.3).
    if (authed.session.kind !== 'account') return fail(403, 'FORBIDDEN');
    const input = parseBody(ChangePasswordBody, body);
    if (!input) return fail(400, 'INVALID');
    if (!(await passwordMatches(user.passwordHash, input.password))) return fail(401, 'WRONG_CURRENT_PASSWORD');
    const invalid = newPasswordProblem(input.nextPassword);
    if (invalid) return fail(400, invalid);

    const passwordHash = await hashPassword(input.nextPassword);
    await this.store.updateUser(user.id, { passwordHash, mustChangePassword: false });
    const updated = (await this.store.findByLogin(user.loginName)) ?? { ...user, passwordHash, mustChangePassword: false };
    const decision = decideLogin({ user: updated, passwordMatches: true, policy: await this.store.policy() });
    if (decision.kind === 'error') return fail(decision.status, decision.code);

    // A new password ends every session opened with the old one (rule 3.6); this browser gets a fresh one below.
    await this.store.dropLiveSessions(user.id);
    if (decision.scope === 'full') await this.makeRoom(user);
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
    body: UpdateProfileBody,
  ): Promise<Outcome<{ profile: ProfileView }>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    const { session, user } = authed;
    if (session.scope !== 'full') return fail(403, 'FORBIDDEN');
    // An entered session acts in the office as that account; it never touches its credentials (rule 3.3).
    if (authed.session.kind !== 'account') return fail(403, 'FORBIDDEN');
    const input = parseBody(UpdateProfileBody, body);
    if (!input) return fail(400, 'INVALID');
    const { nickname, email, phone, city, address, nextPassword, currentPassword } = input;

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
    body: SetPasswordBody,
  ): Promise<Outcome<unknown>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    if (authed.session.scope !== 'full' || !authed.user.isBranchOwner) return fail(403, 'FORBIDDEN');
    // An entered session acts in the office as that account; it never touches its credentials (rule 3.3).
    if (authed.session.kind !== 'account') return fail(403, 'FORBIDDEN');
    const input = parseBody(SetPasswordBody, body);
    if (!input) return fail(400, 'INVALID');
    const invalid = newPasswordProblem(input.password);
    if (invalid) return fail(400, invalid);
    const target = await this.store.findByLogin(loginName);
    if (!target) return fail(404, 'NOT_FOUND');
    // The owner's own password changes through `changePassword`, which asks for the current one.
    if (target.id === authed.user.id) return fail(403, 'FORBIDDEN');
    await this.store.updateUser(target.id, { passwordHash: await hashPassword(input.password), mustChangePassword: true });
    await this.store.dropLiveSessions(target.id);
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
    // An entered session acts in the office as that account; it never touches its credentials (rule 3.3).
    if (authed.session.kind !== 'account') return fail(403, 'FORBIDDEN');
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
    // An entered session acts in the office as that account; it never touches its credentials (rule 3.3).
    if (authed.session.kind !== 'account') return fail(403, 'FORBIDDEN');
    const rows = await this.listedSessions(authed.user.id);
    if (!rows.some((row) => row.id === targetId)) return fail(404, 'NOT_FOUND');
    await this.store.revokeSessions([targetId]);
    return { kind: 'ok', current: targetId === authed.session.id };
  }

  /** Replaces a two-factor session with a full one, applying the session limit before the new one is kept. */
  async promoteToFull(session: SessionRow, user: StoredUser, meta: Meta): Promise<string> {
    await this.store.revokeSessions([session.id]);
    await this.makeRoom(user);
    return this.store.saveSession({ userId: user.id, scope: 'full', userAgent: meta.userAgent, ip: meta.ip });
  }

  /** Two-factor enrollment is open to a two-factor session (forced enrollment) or a full one (voluntary). */
  private async enrollmentSession(sessionId: string | undefined): Promise<Outcome<Authed>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    if (authed.session.scope !== 'two_factor' && authed.session.scope !== 'full') return fail(403, 'FORBIDDEN');
    // An entered session acts in the office as that account; it never touches its credentials (rule 3.3).
    if (authed.session.kind !== 'account') return fail(403, 'FORBIDDEN');
    // A password-only (two_factor scope) session of an account that already has two-factor on could swap the secret
    // and skip the code, so it may not enrol. A full session has passed the second step and may change its method.
    if (authed.user.twoFactorEnabled && authed.session.scope !== 'full') return fail(403, 'FORBIDDEN');
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
    body: TwoFactorCodeBody,
    meta: Meta,
  ): Promise<Outcome<{ sessionId?: string }>> {
    const enrolling = await this.enrollmentSession(sessionId);
    if (enrolling.kind === 'error') return enrolling;
    const { session, user } = enrolling;
    const input = parseBody(TwoFactorCodeBody, body);
    if (!input || !user.pendingTwoFactorSecret) return fail(400, 'INVALID');
    if (!totpMatches(user.pendingTwoFactorSecret, input.code)) return fail(401, 'WRONG_CODE');
    await this.store.updateUser(user.id, {
      twoFactorEnabled: true,
      twoFactorSecret: user.pendingTwoFactorSecret,
      pendingTwoFactorSecret: null,
      twoFactorMethod: 'app',
    });
    if (session.scope === 'full') return { kind: 'ok' };
    return { kind: 'ok', sessionId: await this.promoteToFull(session, user, meta) };
  }

  async verifyTwoFactor(
    sessionId: string | undefined,
    body: TwoFactorCodeBody,
    meta: Meta,
  ): Promise<Outcome<{ sessionId: string }>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    const { session, user } = authed;
    if (session.scope !== 'two_factor') return fail(403, 'FORBIDDEN');
    const input = parseBody(TwoFactorCodeBody, body);
    if (!input) return fail(400, 'INVALID');
    if (!user.twoFactorEnabled) return fail(403, 'FORBIDDEN');
    const method = user.twoFactorMethod ?? 'app';
    if (method === 'app') {
      if (!user.twoFactorSecret) return fail(403, 'FORBIDDEN');
      const refused = await this.checkAppCode(session, user, user.twoFactorSecret, input.code);
      if (refused) return refused;
    } else {
      const checked = await this.checkCode(user, 'challenge', method, input.code);
      if (checked) return checked;
    }
    return { kind: 'ok', sessionId: await this.promoteToFull(session, user, meta) };
  }

  /**
   * The authenticator's six digits at sign-in. Wrong guesses count with the account's wrong passwords, so the
   * six-digit space cannot be walked through fresh sessions (review 2026-11-10, S4): at the limit the pending
   * session is closed. A code that was accepted is not accepted again while it is still valid.
   */
  private async checkAppCode(session: SessionRow, user: StoredUser, secret: string, code: string): Promise<Failure | null> {
    if (loginBlocked(await this.store.failedCount(user.loginName))) {
      await this.store.revokeSessions([session.id]);
      return fail(429, 'RATE_LIMITED');
    }
    const usedKey = `totp-used:${user.id}`;
    if (!totpMatches(secret, code) || (await this.store.getSecret(usedKey)) === code) {
      await this.store.recordFailure(user.loginName);
      return fail(401, 'WRONG_CODE');
    }
    await this.store.putSecret(usedKey, code, TOTP_REPLAY_SECONDS);
    await this.store.clearFailures(user.loginName);
    return null;
  }

  /** Where a code for `method` goes: the account's phone or email. */
  private contactOf(user: StoredUser, method: CodeMethod): string | null {
    const value = method === 'sms' ? user.phone : user.email;
    return value?.trim() ? value.trim() : null;
  }

  /**
   * Sends a fresh six-digit code, at most once every RESEND_SECONDS. A code lives CODE_TTL_SECONDS, allows CODE_TRIES
   * tries and is kept hashed; a new one replaces the last.
   */
  private async sendCode(user: StoredUser, purpose: PendingCode['purpose'], method: CodeMethod): Promise<Outcome<{ sentTo: string; sent: boolean; retryIn: number }>> {
    const to = this.contactOf(user, method);
    if (!to) return fail(400, 'CONTACT_MISSING');
    const sentAt = Number(await this.store.getSecret(sentKey(user.id)));
    if (sentAt) {
      const retryIn = Math.max(1, Math.ceil((sentAt + RESEND_SECONDS * 1000 - Date.now()) / 1000));
      return { kind: 'ok', sentTo: maskContact(to, method), sent: false, retryIn };
    }
    const code = newCode();
    const pending: PendingCode = { hash: hashCode(user.id, code), tries: 0, purpose, method };
    await this.store.putSecret(codeKey(user.id), JSON.stringify(pending), CODE_TTL_SECONDS);
    await this.store.putSecret(sentKey(user.id), String(Date.now()), RESEND_SECONDS);
    await this.sender.send({
      channel: method,
      to,
      subject: TOTP_ISSUER,
      text: `${TOTP_ISSUER}: ${code} — رمز الدخول، صالح خمس دقائق. لا تشاركه مع أحد.`,
    });
    return { kind: 'ok', sentTo: maskContact(to, method), sent: true, retryIn: RESEND_SECONDS };
  }

  /** Null when the code is right (and spends it); otherwise the refusal. */
  private async checkCode(user: StoredUser, purpose: PendingCode['purpose'], method: CodeMethod, code: string): Promise<Failure | null> {
    const raw = await this.store.getSecret(codeKey(user.id));
    const pending = raw ? (JSON.parse(raw) as PendingCode) : null;
    if (!pending || pending.purpose !== purpose || pending.method !== method || pending.tries >= CODE_TRIES) return fail(401, 'CODE_EXPIRED');
    if (!codeMatches(pending.hash, user.id, code)) {
      const tries = pending.tries + 1;
      if (tries >= CODE_TRIES) await this.store.dropSecret(codeKey(user.id));
      else await this.store.putSecret(codeKey(user.id), JSON.stringify({ ...pending, tries }), 0);
      return fail(401, 'WRONG_CODE');
    }
    await this.store.dropSecret(codeKey(user.id));
    await this.store.dropSecret(sentKey(user.id));
    return null;
  }

  /** During the sign-in challenge: sends the code of an SMS or email account. The app method sends nothing. */
  async sendChallengeCode(sessionId: string | undefined): Promise<Outcome<{ method: TwoFactorMethod; sentTo?: string; sent?: boolean; retryIn?: number }>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    const { session, user } = authed;
    if (session.scope !== 'two_factor' || !user.twoFactorEnabled) return fail(403, 'FORBIDDEN');
    const method = user.twoFactorMethod ?? 'app';
    if (method === 'app') return { kind: 'ok', method };
    const sent = await this.sendCode(user, 'challenge', method);
    if (sent.kind === 'error') return sent;
    return { kind: 'ok', method, sentTo: sent.sentTo, sent: sent.sent, retryIn: sent.retryIn };
  }

  /** Enrolment by SMS or email: sends a code to the account's phone or email. */
  async chooseCodeMethod(sessionId: string | undefined, body: TwoFactorMethodBody): Promise<Outcome<{ sentTo: string; sent: boolean; retryIn: number }>> {
    const enrolling = await this.enrollmentSession(sessionId);
    if (enrolling.kind === 'error') return enrolling;
    const input = parseBody(TwoFactorMethodBody, body);
    if (!input) return fail(400, 'INVALID');
    return this.sendCode(enrolling.user, 'enroll', input.method);
  }

  /** The code sent by chooseCodeMethod turns two-factor on with that method. */
  async confirmCodeMethod(
    sessionId: string | undefined,
    body: ConfirmMethodBody,
    meta: Meta,
  ): Promise<Outcome<{ sessionId?: string }>> {
    const enrolling = await this.enrollmentSession(sessionId);
    if (enrolling.kind === 'error') return enrolling;
    const { session, user } = enrolling;
    const input = parseBody(ConfirmMethodBody, body);
    if (!input) return fail(400, 'INVALID');
    const checked = await this.checkCode(user, 'enroll', input.method, input.code);
    if (checked) return checked;
    await this.store.updateUser(user.id, {
      twoFactorEnabled: true,
      twoFactorMethod: input.method,
      twoFactorSecret: null,
      pendingTwoFactorSecret: null,
    });
    if (session.scope === 'full') return { kind: 'ok' };
    return { kind: 'ok', sessionId: await this.promoteToFull(session, user, meta) };
  }

  /** The settings view of how this account signs in. */
  async signInMethods(sessionId: string | undefined): Promise<
    Outcome<{
      view: {
        twoFactorEnabled: boolean;
        twoFactorMethod: TwoFactorMethod;
        canDisable: boolean;
        phone: string | null;
        email: string | null;
        passkeys: { id: string; name: string; createdAt: Date; lastUsedAt: Date | null }[];
      };
    }>
  > {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    if (authed.session.scope !== 'full') return fail(403, 'FORBIDDEN');
    const { user } = authed;
    const required = (await this.store.policy())[user.layer] && !user.twoFactorExempt;
    const phone = this.contactOf(user, 'sms');
    const email = this.contactOf(user, 'email');
    return {
      kind: 'ok',
      view: {
        twoFactorEnabled: user.twoFactorEnabled,
        twoFactorMethod: user.twoFactorMethod ?? 'app',
        canDisable: user.twoFactorEnabled && !required,
        phone: phone ? maskContact(phone, 'sms') : null,
        email: email ? maskContact(email, 'email') : null,
        passkeys: (await this.store.listPasskeys(user.id)).map((row) => ({ id: row.id, name: row.name, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt })),
      },
    };
  }

  private async clearTwoFactor(userId: string): Promise<void> {
    await this.store.updateUser(userId, { twoFactorEnabled: false, twoFactorSecret: null, pendingTwoFactorSecret: null, twoFactorMethod: 'app' });
  }

  async disableOwnTwoFactor(sessionId: string | undefined): Promise<Outcome<unknown>> {
    const authed = await this.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    if (authed.session.scope !== 'full') return fail(403, 'FORBIDDEN');
    // An entered session acts in the office as that account; it never touches its credentials (rule 3.3).
    if (authed.session.kind !== 'account') return fail(403, 'FORBIDDEN');
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
    // An entered session acts in the office as that account; it never touches its credentials (rule 3.3).
    if (authed.session.kind !== 'account') return fail(403, 'FORBIDDEN');
    return { kind: 'ok', ...authed };
  }

  /** «إعدادات المستخدم» (branch owner): another account's contact details and its second step. */
  async userSettings(sessionId: string | undefined, loginName: string): Promise<Outcome<{ settings: UserSettingsView }>> {
    const owner = await this.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    const target = await this.store.findByLogin(loginName);
    if (!target) return fail(404, 'NOT_FOUND');
    return { kind: 'ok', settings: userSettingsView(target) };
  }

  /** The branch owner sets another account's email and mobile; an empty string clears one. */
  async setUserContact(sessionId: string | undefined, loginName: string, body: UserContactBody): Promise<Outcome<{ settings: UserSettingsView }>> {
    const owner = await this.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    const target = await this.store.findByLogin(loginName);
    if (!target) return fail(404, 'NOT_FOUND');
    const input = parseBody(UserContactBody, body);
    if (!input) return fail(400, 'INVALID');
    const { email, phone } = input;
    const patch: Parameters<AuthStore['updateUser']>[1] = {};
    if (typeof email === 'string') {
      const value = email.trim();
      if (value && !EMAIL_PATTERN.test(value)) return fail(400, 'EMAIL_INVALID');
      patch.email = value;
    }
    if (typeof phone === 'string') {
      const value = phone.trim();
      if (value && !PHONE_PATTERN.test(value)) return fail(400, 'PHONE_INVALID');
      patch.phone = value;
    }
    await this.store.updateUser(target.id, patch);
    const stored = (await this.store.findByLogin(loginName)) ?? target;
    return { kind: 'ok', settings: userSettingsView(stored) };
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
    body: PolicyBody,
  ): Promise<Outcome<{ policy: Record<Layer, boolean> }>> {
    const owner = await this.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    const input = parseBody(PolicyBody, body);
    if (!input) return fail(400, 'INVALID');
    await this.store.setPolicy(input.layer, input.required);
    return { kind: 'ok', policy: await this.store.policy() };
  }

  async setExemption(
    sessionId: string | undefined,
    loginName: string,
    body: ExemptionBody,
  ): Promise<Outcome<{ twoFactorExempt: boolean }>> {
    const owner = await this.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    const input = parseBody(ExemptionBody, body);
    if (!input) return fail(400, 'INVALID');
    const target = await this.store.findByLogin(loginName);
    if (!target) return fail(404, 'NOT_FOUND');
    await this.store.updateUser(target.id, { twoFactorExempt: input.exempt });
    return { kind: 'ok', twoFactorExempt: input.exempt };
  }

  async disableUser(sessionId: string | undefined, loginName: string): Promise<Outcome<unknown>> {
    const owner = await this.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    const target = await this.store.findByLogin(loginName);
    if (!target) return fail(404, 'NOT_FOUND');
    // The owner cannot lock the office out of itself.
    if (target.isBranchOwner || target.id === owner.user.id) return fail(403, 'FORBIDDEN');
    await this.store.updateUser(target.id, { disabledAt: new Date() });
    await this.store.dropLiveSessions(target.id);
    return { kind: 'ok' };
  }
}

export type UserSettingsView = {
  loginName: string;
  email: string;
  phone: string;
  twoFactorEnabled: boolean;
  twoFactorExempt: boolean;
  twoFactorMethod: string;
};

function userSettingsView(user: StoredUser): UserSettingsView {
  return {
    loginName: user.loginName,
    email: user.email ?? '',
    phone: user.phone ?? '',
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    twoFactorExempt: Boolean(user.twoFactorExempt),
    twoFactorMethod: user.twoFactorMethod ?? 'app',
  };
}
