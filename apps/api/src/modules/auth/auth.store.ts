import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Layer, LoginUser } from './decide-login';
import { SESSION_TTL_SECONDS } from './sessions';

export const AUTH_STORE = Symbol('AUTH_STORE');

export type StoredUser = LoginUser & { passwordHash: string };
export type SessionScope = 'full' | 'password_change' | 'two_factor';
export type FullSessionRow = {
  id: string;
  createdAt: Date;
  scope: 'full';
  kind: 'account';
  revokedAt: Date | null;
};

export interface AuthStore {
  failedCount(loginName: string): Promise<number>;
  recordFailure(loginName: string): Promise<void>;
  clearFailures(loginName: string): Promise<void>;
  findByLogin(loginName: string): Promise<StoredUser | null>;
  policy(): Promise<Record<Layer, boolean>>;
  listFullSessions(userId: string): Promise<FullSessionRow[]>;
  saveSession(input: { userId: string; scope: SessionScope; userAgent: string; ip: string }): Promise<string>;
  revokeSessions(ids: string[]): Promise<void>;
  userBySession(sessionId: string): Promise<LoginUser | null>;
}

export type MemorySession = {
  id: string;
  userId: string;
  scope: SessionScope;
  kind: 'account';
  userAgent: string;
  ip: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

@Injectable()
export class MemoryAuthStore implements AuthStore {
  readonly users = new Map<string, StoredUser>();
  readonly sessions: MemorySession[] = [];
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
      expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000),
      revokedAt: null,
    });
    return id;
  }

  async revokeSessions(ids: string[]): Promise<void> {
    const now = new Date();
    for (const session of this.sessions) {
      if (ids.includes(session.id) && !session.revokedAt) session.revokedAt = now;
    }
  }

  async userBySession(sessionId: string): Promise<LoginUser | null> {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
    for (const user of this.users.values()) {
      if (user.id === session.userId) {
        const { passwordHash: _passwordHash, ...rest } = user;
        return rest;
      }
    }
    return null;
  }
}
