import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Layer, LoginUser } from './decide-login';
import { SessionRuleValues, SessionRules, effectiveRules } from './sessions';
import { failureWindowExpired } from './validators';

export const AUTH_STORE = Symbol('AUTH_STORE');

export type StoredUser = LoginUser & {
  passwordHash: string;
  /** The full name; the field keeps its historical name. */
  nickname?: string;
  email?: string;
  phone?: string;
  /** A key from PALESTINE_CITIES, or null when unset. */
  city?: string | null;
  address?: string | null;
  /** Confirmed authenticator secret; only meaningful while twoFactorEnabled is true. */
  twoFactorSecret?: string | null;
  /** Secret issued by setup and not yet proven with a code. */
  pendingTwoFactorSecret?: string | null;
  /** How the second step is proven: the authenticator app (default), or a code sent by SMS or email. */
  twoFactorMethod?: TwoFactorMethod;
  /** This account's own session rules; null follows its layer. */
  maxSessions?: number | null;
  sessionMinutes?: number | null;
};
export type TwoFactorMethod = 'app' | 'sms' | 'email';
export const TWO_FACTOR_METHODS: readonly TwoFactorMethod[] = ['app', 'sms', 'email'];
export type PasskeyRow = {
  id: string;
  userId: string;
  /** Base64url, as the browser reports it. */
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};
export type NewPasskey = Pick<PasskeyRow, 'userId' | 'credentialId' | 'publicKey' | 'counter' | 'transports' | 'name'>;
export type UserPatch = Partial<
  Pick<
    StoredUser,
    | 'nickname'
    | 'email'
    | 'phone'
    | 'city'
    | 'address'
    | 'passwordHash'
    | 'mustChangePassword'
    | 'twoFactorEnabled'
    | 'twoFactorExempt'
    | 'twoFactorSecret'
    | 'pendingTwoFactorSecret'
    | 'twoFactorMethod'
    | 'maxSessions'
    | 'sessionMinutes'
    | 'disabledAt'
  >
>;
export type SessionScope = 'full' | 'password_change' | 'two_factor';
export type SessionKind = 'account' | 'impersonation';
export type FullSessionRow = {
  id: string;
  createdAt: Date;
  scope: 'full';
  kind: 'account';
  revokedAt: Date | null;
};
export type SessionRow = {
  id: string;
  userId: string;
  scope: SessionScope;
  kind: SessionKind;
  /** On an entered session: the account that entered. */
  operatorId?: string | null;
  userAgent: string;
  ip: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

export interface AuthStore {
  failedCount(loginName: string): Promise<number>;
  recordFailure(loginName: string): Promise<void>;
  clearFailures(loginName: string): Promise<void>;
  findByLogin(loginName: string): Promise<StoredUser | null>;
  policy(): Promise<Record<Layer, boolean>>;
  setPolicy(layer: Layer, required: boolean): Promise<void>;
  listFullSessions(userId: string): Promise<FullSessionRow[]>;
  saveSession(input: { userId: string; scope: SessionScope; userAgent: string; ip: string }): Promise<string>;
  /** A full session that does not take one of the account's three slots. */
  saveImpersonation(input: { userId: string; operatorId: string; userAgent: string; ip: string }): Promise<string>;
  revokeSessions(ids: string[]): Promise<void>;
  userBySession(sessionId: string): Promise<LoginUser | null>;
  /** The live session, its owner and the owner's rules; null when missing, revoked, expired, or idle past the rules. */
  liveSession(sessionId: string): Promise<{ session: SessionRow; user: StoredUser; rules: SessionRules } | null>;
  /** Sets lastSeenAt to now and pushes the expiry the owner's idle time ahead (given, or read from the rules). */
  touchSession(sessionId: string, idleSeconds?: number): Promise<void>;
  /** Each layer's own session values (null follows the default). */
  sessionRules(): Promise<Record<Layer, SessionRuleValues>>;
  setSessionRules(layer: Layer, values: SessionRuleValues): Promise<void>;
  /** The account's effective rules: account, then layer, then default. */
  rulesFor(user: Pick<StoredUser, 'layer' | 'maxSessions' | 'sessionMinutes'>): Promise<SessionRules>;
  listSessions(userId: string): Promise<SessionRow[]>;
  updateUser(userId: string, patch: UserPatch): Promise<void>;
  /** Revokes every session of the user, whatever its scope, and deletes their live keys. */
  dropLiveSessions(userId: string): Promise<void>;
  /** A short-lived value (codes, passkey challenges). `ttlSeconds` 0 keeps the current expiry. */
  putSecret(key: string, value: string, ttlSeconds: number): Promise<void>;
  getSecret(key: string): Promise<string | null>;
  dropSecret(key: string): Promise<void>;
  listPasskeys(userId: string): Promise<PasskeyRow[]>;
  passkeyByCredential(credentialId: string): Promise<{ passkey: PasskeyRow; user: StoredUser } | null>;
  addPasskey(input: NewPasskey): Promise<PasskeyRow>;
  /** Records a sign-in with the passkey and its new signature counter. */
  usePasskey(id: string, counter: number): Promise<void>;
  /** False when the passkey is not the user's. */
  removePasskey(userId: string, id: string): Promise<boolean>;
}

export type MemorySession = {
  id: string;
  userId: string;
  scope: SessionScope;
  kind: SessionKind;
  operatorId?: string | null;
  userAgent: string;
  ip: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

@Injectable()
export class MemoryAuthStore implements AuthStore {
  readonly users = new Map<string, StoredUser>();
  readonly sessions: MemorySession[] = [];
  /** Stands in for the live session keys: a session is usable only while its key is present. */
  private readonly liveSessionKeys = new Set<string>();
  /** Login names that still own at least one live session key. */
  readonly liveKeys = new Set<string>();
  /** Failed attempts per login name; the window opens at the first failure and closes after LOGIN_FAIL_WINDOW_SECONDS. */
  private readonly failures = new Map<string, { count: number; startedAt: Date }>();
  private readonly layerPolicy: Record<Layer, boolean> = {
    branch: false,
    main_agent: false,
    agent: false,
    pos: false,
  };

  addUser(user: StoredUser): void {
    this.users.set(user.loginName, user);
  }

  /** Seeds a failure count whose window opened at `startedAt` (default: now). */
  setFailedCount(loginName: string, count: number, startedAt: Date = new Date()): void {
    this.failures.set(loginName, { count, startedAt });
  }

  private openFailures(loginName: string): { count: number; startedAt: Date } | null {
    const entry = this.failures.get(loginName);
    if (!entry) return null;
    if (failureWindowExpired(entry.startedAt)) {
      this.failures.delete(loginName);
      return null;
    }
    return entry;
  }

  async failedCount(loginName: string): Promise<number> {
    return this.openFailures(loginName)?.count ?? 0;
  }

  async recordFailure(loginName: string): Promise<void> {
    const entry = this.openFailures(loginName);
    if (entry) entry.count += 1;
    else this.failures.set(loginName, { count: 1, startedAt: new Date() });
  }

  async clearFailures(loginName: string): Promise<void> {
    this.failures.delete(loginName);
  }

  async findByLogin(loginName: string): Promise<StoredUser | null> {
    return this.users.get(loginName) ?? null;
  }

  async policy(): Promise<Record<Layer, boolean>> {
    return { ...this.layerPolicy };
  }

  async setPolicy(layer: Layer, required: boolean): Promise<void> {
    this.layerPolicy[layer] = required;
  }

  async listFullSessions(userId: string): Promise<FullSessionRow[]> {
    return this.sessions
      .filter((s) => s.userId === userId && s.scope === 'full' && s.kind === 'account')
      .map((s) => ({ id: s.id, createdAt: s.createdAt, scope: 'full' as const, kind: 'account' as const, revokedAt: s.revokedAt }));
  }

  private readonly layerRules: Record<Layer, SessionRuleValues> = {
    branch: { maxSessions: null, sessionMinutes: null },
    main_agent: { maxSessions: null, sessionMinutes: null },
    agent: { maxSessions: null, sessionMinutes: null },
    pos: { maxSessions: null, sessionMinutes: null },
  };

  async sessionRules(): Promise<Record<Layer, SessionRuleValues>> {
    return structuredClone(this.layerRules);
  }

  async setSessionRules(layer: Layer, values: SessionRuleValues): Promise<void> {
    this.layerRules[layer] = { ...values };
  }

  async rulesFor(user: Pick<StoredUser, 'layer' | 'maxSessions' | 'sessionMinutes'>): Promise<SessionRules> {
    return effectiveRules(user, this.layerRules[user.layer]);
  }

  private async idleOf(userId: string): Promise<number> {
    const owner = this.userById(userId);
    return owner ? (await this.rulesFor(owner)).idleSeconds : effectiveRules(null, null).idleSeconds;
  }

  async saveSession(input: { userId: string; scope: SessionScope; userAgent: string; ip: string }): Promise<string> {
    const now = new Date();
    const id = randomUUID();
    const idle = await this.idleOf(input.userId);
    this.sessions.push({
      id,
      userId: input.userId,
      scope: input.scope,
      kind: 'account',
      userAgent: input.userAgent,
      ip: input.ip,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + idle * 1000),
      revokedAt: null,
    });
    this.liveSessionKeys.add(id);
    const owner = this.userById(input.userId);
    if (owner) this.liveKeys.add(owner.loginName);
    return id;
  }

  async saveImpersonation(input: { userId: string; operatorId: string; userAgent: string; ip: string }): Promise<string> {
    const now = new Date();
    const id = randomUUID();
    const idle = await this.idleOf(input.userId);
    this.sessions.push({
      id,
      userId: input.userId,
      scope: 'full',
      kind: 'impersonation',
      operatorId: input.operatorId,
      userAgent: input.userAgent,
      ip: input.ip,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + idle * 1000),
      revokedAt: null,
    });
    this.liveSessionKeys.add(id);
    return id;
  }

  async revokeSessions(ids: string[]): Promise<void> {
    const now = new Date();
    for (const session of this.sessions) {
      if (ids.includes(session.id) && !session.revokedAt) session.revokedAt = now;
    }
    for (const id of ids) this.liveSessionKeys.delete(id);
    this.refreshLiveOwners();
  }

  async dropLiveSessions(userId: string): Promise<void> {
    await this.revokeSessions(this.sessions.filter((s) => s.userId === userId).map((s) => s.id));
  }

  private refreshLiveOwners(): void {
    this.liveKeys.clear();
    for (const session of this.sessions) {
      if (!this.liveSessionKeys.has(session.id)) continue;
      const owner = this.userById(session.userId);
      if (owner) this.liveKeys.add(owner.loginName);
    }
  }

  private userById(userId: string): StoredUser | null {
    for (const user of this.users.values()) {
      if (user.id === userId) return user;
    }
    return null;
  }

  private liveRow(sessionId: string): MemorySession | null {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session || !this.liveSessionKeys.has(sessionId) || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
    return session;
  }

  async userBySession(sessionId: string): Promise<LoginUser | null> {
    const session = this.liveRow(sessionId);
    if (!session) return null;
    const user = this.userById(session.userId);
    if (!user) return null;
    return {
      id: user.id,
      loginName: user.loginName,
      disabledAt: user.disabledAt,
      mustChangePassword: user.mustChangePassword,
      layer: user.layer,
      twoFactorExempt: user.twoFactorExempt,
      twoFactorEnabled: user.twoFactorEnabled,
      isBranchOwner: user.isBranchOwner,
    };
  }

  async liveSession(sessionId: string): Promise<{ session: SessionRow; user: StoredUser; rules: SessionRules } | null> {
    const session = this.liveRow(sessionId);
    if (!session) return null;
    const user = this.userById(session.userId);
    if (!user) return null;
    const rules = await this.rulesFor(user);
    // A lowered idle time closes a session already idle longer than it.
    if (session.lastSeenAt.getTime() + rules.idleSeconds * 1000 <= Date.now()) return null;
    return { session: { ...session }, user, rules };
  }

  async touchSession(sessionId: string, idleSeconds?: number): Promise<void> {
    const session = this.liveRow(sessionId);
    if (!session) return;
    const idle = idleSeconds ?? (await this.idleOf(session.userId));
    const now = new Date();
    session.lastSeenAt = now;
    session.expiresAt = new Date(now.getTime() + idle * 1000);
  }

  async listSessions(userId: string): Promise<SessionRow[]> {
    return this.sessions
      .filter((s) => s.userId === userId)
      .map((row) => ({ ...row }));
  }

  private readonly secrets = new Map<string, { value: string; expiresAt: number }>();
  readonly passkeys: PasskeyRow[] = [];

  async putSecret(key: string, value: string, ttlSeconds: number): Promise<void> {
    const kept = this.secrets.get(key);
    const expiresAt = ttlSeconds > 0 || !kept ? Date.now() + Math.max(ttlSeconds, 1) * 1000 : kept.expiresAt;
    this.secrets.set(key, { value, expiresAt });
  }

  async getSecret(key: string): Promise<string | null> {
    const found = this.secrets.get(key);
    if (!found) return null;
    if (found.expiresAt <= Date.now()) {
      this.secrets.delete(key);
      return null;
    }
    return found.value;
  }

  async dropSecret(key: string): Promise<void> {
    this.secrets.delete(key);
  }

  async listPasskeys(userId: string): Promise<PasskeyRow[]> {
    return this.passkeys.filter((row) => row.userId === userId).map((row) => ({ ...row }));
  }

  async passkeyByCredential(credentialId: string): Promise<{ passkey: PasskeyRow; user: StoredUser } | null> {
    const passkey = this.passkeys.find((row) => row.credentialId === credentialId);
    const user = passkey ? this.userById(passkey.userId) : null;
    return passkey && user ? { passkey: { ...passkey }, user } : null;
  }

  async addPasskey(input: NewPasskey): Promise<PasskeyRow> {
    const row: PasskeyRow = { ...input, id: randomUUID(), createdAt: new Date(), lastUsedAt: null };
    this.passkeys.push(row);
    return { ...row };
  }

  async usePasskey(id: string, counter: number): Promise<void> {
    const row = this.passkeys.find((candidate) => candidate.id === id);
    if (row) Object.assign(row, { counter, lastUsedAt: new Date() });
  }

  async removePasskey(userId: string, id: string): Promise<boolean> {
    const at = this.passkeys.findIndex((row) => row.id === id && row.userId === userId);
    if (at < 0) return false;
    this.passkeys.splice(at, 1);
    return true;
  }

  async updateUser(userId: string, patch: UserPatch): Promise<void> {
    const user = this.userById(userId);
    if (!user) return;
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) (user as Record<string, unknown>)[key] = value;
    }
  }
}
