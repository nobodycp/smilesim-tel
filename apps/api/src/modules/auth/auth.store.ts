import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Layer, LoginUser } from './decide-login';
import { SESSION_TTL_SECONDS } from './sessions';

export const AUTH_STORE = Symbol('AUTH_STORE');

export type StoredUser = LoginUser & {
  passwordHash: string;
  nickname?: string;
  email?: string;
  phone?: string;
  /** Confirmed authenticator secret; only meaningful while twoFactorEnabled is true. */
  twoFactorSecret?: string | null;
  /** Secret issued by setup and not yet proven with a code. */
  pendingTwoFactorSecret?: string | null;
};
export type UserPatch = Partial<
  Pick<
    StoredUser,
    | 'nickname'
    | 'email'
    | 'phone'
    | 'passwordHash'
    | 'mustChangePassword'
    | 'twoFactorEnabled'
    | 'twoFactorExempt'
    | 'twoFactorSecret'
    | 'pendingTwoFactorSecret'
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
  revokeSessions(ids: string[]): Promise<void>;
  userBySession(sessionId: string): Promise<LoginUser | null>;
  /** The live session and its owner, or null when missing, revoked, or expired. */
  liveSession(sessionId: string): Promise<{ session: SessionRow; user: StoredUser } | null>;
  /** Sets lastSeenAt to now and pushes the expiry SESSION_TTL_SECONDS ahead. */
  touchSession(sessionId: string): Promise<void>;
  listSessions(userId: string): Promise<SessionRow[]>;
  updateUser(userId: string, patch: UserPatch): Promise<void>;
}

export type MemorySession = {
  id: string;
  userId: string;
  scope: SessionScope;
  kind: SessionKind;
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
  private readonly liveKeys = new Set<string>();
  private readonly failures = new Map<string, number>();
  private readonly layerPolicy: Record<Layer, boolean> = {
    branch: false,
    main_agent: false,
    agent: false,
    pos: false,
  };

  addUser(user: StoredUser): void {
    this.users.set(user.loginName, user);
  }

  setFailedCount(loginName: string, count: number): void {
    this.failures.set(loginName, count);
  }

  async failedCount(loginName: string): Promise<number> {
    return this.failures.get(loginName) ?? 0;
  }

  async recordFailure(loginName: string): Promise<void> {
    this.failures.set(loginName, (this.failures.get(loginName) ?? 0) + 1);
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

  async saveSession(input: { userId: string; scope: SessionScope; userAgent: string; ip: string }): Promise<string> {
    const now = new Date();
    const id = randomUUID();
    this.sessions.push({
      id,
      userId: input.userId,
      scope: input.scope,
      kind: 'account',
      userAgent: input.userAgent,
      ip: input.ip,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000),
      revokedAt: null,
    });
    this.liveKeys.add(id);
    return id;
  }

  async revokeSessions(ids: string[]): Promise<void> {
    const now = new Date();
    for (const session of this.sessions) {
      if (ids.includes(session.id) && !session.revokedAt) session.revokedAt = now;
    }
    for (const id of ids) this.liveKeys.delete(id);
  }

  private userById(userId: string): StoredUser | null {
    for (const user of this.users.values()) {
      if (user.id === userId) return user;
    }
    return null;
  }

  private liveRow(sessionId: string): MemorySession | null {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session || !this.liveKeys.has(sessionId) || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
    return session;
  }

  async userBySession(sessionId: string): Promise<LoginUser | null> {
    const session = this.liveRow(sessionId);
    if (!session) return null;
    const user = this.userById(session.userId);
    if (!user) return null;
    const {
      passwordHash: _passwordHash,
      nickname: _n,
      email: _e,
      phone: _p,
      twoFactorSecret: _s,
      pendingTwoFactorSecret: _ps,
      ...rest
    } = user;
    return rest;
  }

  async liveSession(sessionId: string): Promise<{ session: SessionRow; user: StoredUser } | null> {
    const session = this.liveRow(sessionId);
    if (!session) return null;
    const user = this.userById(session.userId);
    if (!user) return null;
    return { session: { ...session }, user };
  }

  async touchSession(sessionId: string): Promise<void> {
    const session = this.liveRow(sessionId);
    if (!session) return;
    const now = new Date();
    session.lastSeenAt = now;
    session.expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  }

  async listSessions(userId: string): Promise<SessionRow[]> {
    return this.sessions
      .filter((s) => s.userId === userId)
      .map((row) => ({ ...row }));
  }

  async updateUser(userId: string, patch: UserPatch): Promise<void> {
    const user = this.userById(userId);
    if (!user) return;
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) (user as Record<string, unknown>)[key] = value;
    }
  }
}
