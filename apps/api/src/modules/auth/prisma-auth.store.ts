import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { createPrismaClient } from '../../db';
import { PrismaService } from '../shared/prisma.service';
import { PrismaClient } from '../../generated/prisma/client';
import IORedis, { Redis } from 'ioredis';
import {
  AuthStore,
  FullSessionRow,
  SessionKind,
  SessionRow,
  SessionScope,
  StoredUser,
  UserPatch,
} from './auth.store';
import { Layer, LoginUser } from './decide-login';
import { hashPassword } from './password';
import { SESSION_TTL_SECONDS } from './sessions';
import { TRIAL_PASSWORD, buildTrialSeed, trialSeedDecision } from './trial-seed';
import { LOGIN_FAIL_WINDOW_SECONDS } from './validators';

/** Optional injection point so a test can hand the store its own clients. */
export const AUTH_STORE_CLIENTS = Symbol('AUTH_STORE_CLIENTS');
export type AuthStoreClients = { prisma: PrismaClient; redis: Redis };

const LAYERS: readonly Layer[] = ['branch', 'main_agent', 'agent', 'pos'];

const sessionKey = (sessionId: string) => `session:${sessionId}`;
const failureKey = (loginName: string) => `login-fail:${loginName}`;

type UserRecord = NonNullable<Awaited<ReturnType<PrismaClient['user']['findUnique']>>>;
type SessionRecord = NonNullable<Awaited<ReturnType<PrismaClient['session']['findUnique']>>>;

function toStoredUser(row: UserRecord): StoredUser {
  return {
    id: row.id,
    loginName: row.loginName,
    disabledAt: row.disabledAt,
    mustChangePassword: row.mustChangePassword,
    layer: row.layer as Layer,
    twoFactorExempt: row.twoFactorExempt,
    twoFactorEnabled: row.twoFactorEnabled,
    isBranchOwner: row.isBranchOwner,
    passwordHash: row.passwordHash,
    nickname: row.nickname,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    city: row.city,
    address: row.address,
    twoFactorSecret: row.twoFactorSecret,
    pendingTwoFactorSecret: row.pendingTwoFactorSecret,
  };
}

function toSessionRow(row: SessionRecord): SessionRow {
  return {
    id: row.id,
    userId: row.userId,
    scope: row.scope as SessionScope,
    kind: row.kind as SessionKind,
    userAgent: row.userAgent,
    ip: row.ip,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

function createRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is required');
  const client = new IORedis(url);
  client.on('error', (error) => console.error('auth redis error:', error.message));
  return client;
}

/**
 * Accounts, session rows, and the layer policy live in PostgreSQL.
 * The live session key and the failed-login counter live in Redis.
 */
@Injectable()
export class PrismaAuthStore implements AuthStore, OnModuleInit, OnModuleDestroy {
  private readonly prisma: PrismaClient;
  private readonly redis: Redis;
  private readonly ownsClients: boolean;
  private readonly logger = new Logger(PrismaAuthStore.name);

  private readonly ownsPrisma: boolean;

  constructor(@Optional() @Inject(AUTH_STORE_CLIENTS) clients?: AuthStoreClients, @Optional() db?: PrismaService) {
    this.ownsClients = !clients;
    // The shared client belongs to PrismaService; only a client opened here is closed here.
    this.ownsPrisma = !clients && !db;
    this.prisma = clients?.prisma ?? db?.client ?? createPrismaClient();
    this.redis = clients?.redis ?? createRedis();
  }

  async onModuleInit(): Promise<void> {
    await this.seedTrialAccountsIfAllowed();
  }

  /**
   * Boot-time entry for the trial accounts. They are created only when the environment asks for it
   * (see trialSeedDecision). When it does not, an empty users table is reported, never filled.
   */
  async seedTrialAccountsIfAllowed(env: Record<string, string | undefined> = process.env): Promise<boolean> {
    const decision = trialSeedDecision(env);
    if (!decision.allowed) {
      if (decision.reason === 'production-blocked') {
        this.logger.warn(
          'TRIAL_SEED=true is ignored because NODE_ENV=production. Set TRIAL_SEED_ALLOW_PRODUCTION=true only if you really want accounts with a published password.',
        );
      }
      if ((await this.prisma.user.count()) === 0) {
        this.logger.warn(
          'The users table is empty and trial seeding is off: there are no accounts and no way to sign in. Create the first branch owner out of band, or set TRIAL_SEED=true for local development.',
        );
      }
      return false;
    }
    const seeded = await this.seedTrialAccountsIfEmpty();
    if (seeded && decision.production) {
      this.logger.warn('Trial accounts (branch, main, agent, pos) were created in PRODUCTION with the published password. Change or disable them now.');
    }
    return seeded;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.ownsClients) return;
    if (this.ownsPrisma) await this.prisma.$disconnect();
    this.redis.disconnect();
  }

  /** The raw seeder: an empty users table gets the four trial accounts (password 123456, no forced change, 2FA exempt). Boot goes through seedTrialAccountsIfAllowed. */
  async seedTrialAccountsIfEmpty(): Promise<boolean> {
    if ((await this.prisma.user.count()) > 0) return false;
    const passwordHash = await hashPassword(TRIAL_PASSWORD);
    try {
      await this.prisma.$transaction(async (tx) => {
        const ids = new Map<string, string>();
        for (const account of buildTrialSeed()) {
          const created = await tx.user.create({
            data: {
              loginName: account.loginName,
              nickname: account.loginName,
              email: account.email,
              phone: account.phone,
              passwordHash,
              mustChangePassword: account.mustChangePassword,
              layer: account.layer,
              parentId: account.parentLogin ? (ids.get(account.parentLogin) ?? null) : null,
              isBranchOwner: account.isBranchOwner,
              twoFactorExempt: account.twoFactorExempt,
            },
          });
          ids.set(account.loginName, created.id);
        }
      });
    } catch (error) {
      // Another instance seeded the table first.
      if ((error as { code?: string }).code === 'P2002') return false;
      throw error;
    }
    return true;
  }

  async failedCount(loginName: string): Promise<number> {
    const value = await this.redis.get(failureKey(loginName));
    return value ? Number(value) : 0;
  }

  /** The counter's window opens at the first failure: the key is created with its TTL and never extended. */
  async recordFailure(loginName: string): Promise<void> {
    const key = failureKey(loginName);
    await this.redis.multi().set(key, 0, 'EX', LOGIN_FAIL_WINDOW_SECONDS, 'NX').incr(key).exec();
  }

  async clearFailures(loginName: string): Promise<void> {
    await this.redis.del(failureKey(loginName));
  }

  async findByLogin(loginName: string): Promise<StoredUser | null> {
    const row = await this.prisma.user.findUnique({ where: { loginName } });
    return row ? toStoredUser(row) : null;
  }

  async policy(): Promise<Record<Layer, boolean>> {
    const result: Record<Layer, boolean> = { branch: false, main_agent: false, agent: false, pos: false };
    for (const row of await this.prisma.layerPolicy.findMany()) {
      const layer = LAYERS.find((candidate) => candidate === row.layer);
      if (layer) result[layer] = row.required;
    }
    return result;
  }

  async setPolicy(layer: Layer, required: boolean): Promise<void> {
    await this.prisma.layerPolicy.upsert({
      where: { layer },
      update: { required },
      create: { layer, required },
    });
  }

  /** Keeps only the ids whose live key is still present in Redis. */
  private async withLiveKey<T extends { id: string }>(rows: T[]): Promise<T[]> {
    if (rows.length === 0) return rows;
    const values = await this.redis.mget(rows.map((row) => sessionKey(row.id)));
    return rows.filter((_, index) => values[index] !== null);
  }

  async listFullSessions(userId: string): Promise<FullSessionRow[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId, scope: 'full', kind: 'account', revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
    });
    return (await this.withLiveKey(rows)).map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      scope: 'full' as const,
      kind: 'account' as const,
      revokedAt: row.revokedAt,
    }));
  }

  async saveSession(input: { userId: string; scope: SessionScope; userAgent: string; ip: string }): Promise<string> {
    const now = new Date();
    const row = await this.prisma.session.create({
      data: {
        userId: input.userId,
        scope: input.scope,
        kind: 'account',
        userAgent: input.userAgent,
        ip: input.ip,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000),
      },
    });
    await this.redis.set(sessionKey(row.id), input.userId, 'EX', SESSION_TTL_SECONDS);
    if (input.scope === 'full') await this.freezeGrants(input.userId);
    return row.id;
  }

  private async freezeGrants(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
    if (!user) return;
    const grants = user.isBranchOwner
      ? 'read,edit,accounting,tasks,reports,staff,enter'
      : (['read', 'edit', 'accounting', 'tasks', 'reports', 'staff', 'enter'] as const).filter((key) => user.role?.[key]).join(',');
    await this.prisma.user.update({ where: { id: userId }, data: { liveGrants: grants } });
  }

  async saveImpersonation(input: { userId: string; userAgent: string; ip: string }): Promise<string> {
    const now = new Date();
    const row = await this.prisma.session.create({
      data: {
        userId: input.userId,
        scope: 'full',
        kind: 'impersonation',
        userAgent: input.userAgent,
        ip: input.ip,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000),
      },
    });
    await this.redis.set(sessionKey(row.id), input.userId, 'EX', SESSION_TTL_SECONDS);
    return row.id;
  }

  async revokeSessions(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.session.updateMany({ where: { id: { in: ids }, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.redis.del(...ids.map(sessionKey));
  }

  async dropLiveSessions(userId: string): Promise<void> {
    const rows = await this.prisma.session.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
    await this.revokeSessions(rows.map((row) => row.id));
  }

  async liveSession(sessionId: string): Promise<{ session: SessionRow; user: StoredUser } | null> {
    if (!(await this.redis.exists(sessionKey(sessionId)))) return null;
    const row = await this.prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return null;
    return { session: toSessionRow(row), user: toStoredUser(row.user) };
  }

  async userBySession(sessionId: string): Promise<LoginUser | null> {
    const found = await this.liveSession(sessionId);
    if (!found) return null;
    const { user } = found;
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

  /** Renews the key's TTL, and only for a key that still exists; the row follows. */
  async touchSession(sessionId: string): Promise<void> {
    if ((await this.redis.expire(sessionKey(sessionId), SESSION_TTL_SECONDS)) !== 1) return;
    const now = new Date();
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000) },
    });
  }

  /** Every unrevoked session of the user that still has its live key. */
  async listSessions(userId: string): Promise<SessionRow[]> {
    const rows = await this.prisma.session.findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: 'asc' } });
    return (await this.withLiveKey(rows)).map(toSessionRow);
  }

  async updateUser(userId: string, patch: UserPatch): Promise<void> {
    await this.prisma.user.updateMany({ where: { id: userId }, data: patch });
  }
}
