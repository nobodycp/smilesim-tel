import { hashSessionToken } from './session-token';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { passwordMatches } from './password';
import { PrismaAuthStore } from './prisma-auth.store';
import { DEFAULT_SESSION_MINUTES } from './sessions';

const SESSION_TTL_SECONDS = DEFAULT_SESSION_MINUTES * 60;
import { LOGIN_FAIL_WINDOW_SECONDS } from './validators';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Just enough Redis for the store: string keys, TTLs, and a clock the test moves by hand. */
class FakeRedis {
  now = 1_000_000;
  readonly data = new Map<string, { value: string; expiresAt: number | null }>();

  private live(key: string) {
    const entry = this.data.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= this.now) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  advance(seconds: number) {
    this.now += seconds * 1000;
  }

  ttl(key: string): number | null {
    const entry = this.live(key);
    return entry && entry.expiresAt !== null ? Math.round((entry.expiresAt - this.now) / 1000) : null;
  }

  async get(key: string) {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string | number, _ex: 'EX', seconds: number, mode?: 'NX') {
    if (mode === 'NX' && this.live(key)) return null;
    this.data.set(key, { value: String(value), expiresAt: this.now + seconds * 1000 });
    return 'OK';
  }

  async incr(key: string) {
    const entry = this.live(key);
    const next = Number(entry?.value ?? 0) + 1;
    this.data.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
    return next;
  }

  async del(...keys: string[]) {
    let removed = 0;
    for (const key of keys) if (this.live(key) && this.data.delete(key)) removed += 1;
    return removed;
  }

  async exists(key: string) {
    return this.live(key) ? 1 : 0;
  }

  async mget(keys: string[]) {
    return keys.map((key) => this.live(key)?.value ?? null);
  }

  async expire(key: string, seconds: number) {
    const entry = this.live(key);
    if (!entry) return 0;
    entry.expiresAt = this.now + seconds * 1000;
    return 1;
  }

  multi() {
    const steps: (() => Promise<unknown>)[] = [];
    const chain = {
      set: (...args: Parameters<FakeRedis['set']>) => (steps.push(() => this.set(...args)), chain),
      incr: (key: string) => (steps.push(() => this.incr(key)), chain),
      exec: async () => {
        const results: [null, unknown][] = [];
        for (const step of steps) results.push([null, await step()]);
        return results;
      },
    };
    return chain;
  }
}

/** Just enough Prisma for the store, backed by arrays. */
class FakePrisma {
  readonly users: Row[] = [];
  readonly sessions: Row[] = [];
  readonly policies: Row[] = [];

  private matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, condition]) => {
      if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
        if ('in' in condition) return condition.in.includes(row[key]);
        if ('gt' in condition) return row[key] > condition.gt;
      }
      return row[key] === condition;
    });
  }

  user = {
    count: async () => this.users.length,
    create: async ({ data }: { data: Row }) => {
      const row = { id: randomUUID(), disabledAt: null, twoFactorEnabled: false, twoFactorSecret: null, pendingTwoFactorSecret: null, ...data };
      this.users.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: Row }) => this.users.find((row) => this.matches(row, where)) ?? null,
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = this.users.find((candidate) => this.matches(candidate, where));
      if (!row) throw new Error('record not found');
      return Object.assign(row, data);
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      for (const row of this.users.filter((candidate) => this.matches(candidate, where))) Object.assign(row, data);
    },
  };

  session = {
    create: async ({ data }: { data: Row }) => {
      const row = { id: randomUUID(), revokedAt: null, ...data };
      this.sessions.push(row);
      return row;
    },
    findUnique: async ({ where, include }: { where: Row; include?: Row }) => {
      const row = this.sessions.find((candidate) => this.matches(candidate, where));
      if (!row) return null;
      return include?.user ? { ...row, user: this.users.find((u) => u.id === row.userId) } : row;
    },
    findMany: async ({ where }: { where: Row }) => this.sessions.filter((row) => this.matches(row, where)),
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      for (const row of this.sessions.filter((candidate) => this.matches(candidate, where))) Object.assign(row, data);
    },
  };

  layerPolicy = {
    findMany: async () => this.policies,
    upsert: async ({ where, update, create }: { where: Row; update: Row; create: Row }) => {
      const row = this.policies.find((candidate) => candidate.layer === where.layer);
      if (row) Object.assign(row, update);
      else this.policies.push({ ...create });
    },
  };

  $transaction = async <T>(work: (tx: FakePrisma) => Promise<T>) => work(this);
}

describe('PrismaAuthStore', () => {
  let prisma: FakePrisma;
  let redis: FakeRedis;
  let store: PrismaAuthStore;

  beforeEach(() => {
    prisma = new FakePrisma();
    redis = new FakeRedis();
    store = new PrismaAuthStore({ prisma: prisma as unknown as PrismaClient, redis: redis as unknown as Redis });
  });

  describe('trial accounts', () => {
    it('inserts the four accounts into an empty users table', async () => {
      expect(await store.seedTrialAccountsIfEmpty()).toBe(true);
      expect(prisma.users.map((u) => u.loginName)).toEqual(['branch', 'main', 'agent', 'pos']);
      expect(prisma.users.map((u) => u.layer)).toEqual(['branch', 'main_agent', 'agent', 'pos']);
      const parentLogins = prisma.users.map((u) => prisma.users.find((p) => p.id === u.parentId)?.loginName ?? null);
      expect(parentLogins).toEqual([null, 'branch', 'main', 'agent']);
      expect(prisma.users.map((u) => u.isBranchOwner)).toEqual([true, false, false, false]);
      for (const user of prisma.users) {
        expect(user.mustChangePassword).toBe(false);
        expect(user.twoFactorExempt).toBe(true);
        expect(await passwordMatches(user.passwordHash, '123456')).toBe(true);
      }
    });

    it('leaves a table that already has users alone', async () => {
      prisma.users.push({ id: 'u1', loginName: 'someone' });
      expect(await store.seedTrialAccountsIfEmpty()).toBe(false);
      expect(prisma.users).toHaveLength(1);
    });

    describe('boot gate', () => {
      const keys = ['NODE_ENV', 'TRIAL_SEED', 'TRIAL_SEED_ALLOW_PRODUCTION'] as const;
      const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
      let warn: jest.SpyInstance;

      beforeEach(() => {
        delete process.env.TRIAL_SEED;
        delete process.env.TRIAL_SEED_ALLOW_PRODUCTION;
        process.env.NODE_ENV = 'test';
        warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      });

      afterEach(() => {
        warn.mockRestore();
        for (const key of keys) {
          if (saved[key] === undefined) delete process.env[key];
          else process.env[key] = saved[key];
        }
      });

      it('seeds on module init when TRIAL_SEED=true, and the account can be found', async () => {
        process.env.TRIAL_SEED = 'true';
        await store.onModuleInit();
        const pos = await store.findByLogin('pos');
        expect(pos).toMatchObject({ loginName: 'pos', layer: 'pos', twoFactorExempt: true, isBranchOwner: false });
        expect(warn).not.toHaveBeenCalled();
      });

      it.each([undefined, '', 'false', '1', 'yes'])('creates nothing when TRIAL_SEED=%p, and says the table is empty', async (value) => {
        if (value !== undefined) process.env.TRIAL_SEED = value;
        await store.onModuleInit();
        expect(prisma.users).toHaveLength(0);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toMatch(/users table is empty/);
      });

      it('stays quiet when the seed is off but accounts already exist', async () => {
        prisma.users.push({ id: 'u1', loginName: 'owner' });
        await store.onModuleInit();
        expect(prisma.users).toHaveLength(1);
        expect(warn).not.toHaveBeenCalled();
      });

      it('creates nothing in production with only TRIAL_SEED=true, and warns about both reasons', async () => {
        process.env.NODE_ENV = 'production';
        process.env.TRIAL_SEED = 'true';
        await store.onModuleInit();
        expect(prisma.users).toHaveLength(0);
        const messages = warn.mock.calls.map((call) => String(call[0]));
        expect(messages.some((m) => /NODE_ENV=production/.test(m))).toBe(true);
        expect(messages.some((m) => /users table is empty/.test(m))).toBe(true);
      });

      it('creates nothing in production when only the second flag is set', async () => {
        process.env.NODE_ENV = 'production';
        process.env.TRIAL_SEED_ALLOW_PRODUCTION = 'true';
        await store.onModuleInit();
        expect(prisma.users).toHaveLength(0);
      });

      it('seeds in production only with both flags, and warns loudly', async () => {
        process.env.NODE_ENV = 'production';
        process.env.TRIAL_SEED = 'true';
        process.env.TRIAL_SEED_ALLOW_PRODUCTION = 'true';
        await store.onModuleInit();
        expect(prisma.users.map((u) => u.loginName)).toEqual(['branch', 'main', 'agent', 'pos']);
        expect(String(warn.mock.calls[0][0])).toMatch(/PRODUCTION/);
      });

      it('takes the environment as an argument, so a caller can decide without touching process.env', async () => {
        expect(await store.seedTrialAccountsIfAllowed({ TRIAL_SEED: 'true', NODE_ENV: 'production' })).toBe(false);
        expect(await store.seedTrialAccountsIfAllowed({ TRIAL_SEED: 'true', NODE_ENV: 'development' })).toBe(true);
        expect(prisma.users).toHaveLength(4);
      });
    });
  });

  describe('failed attempts', () => {
    it('opens a 900 second window at the first failure and does not extend it', async () => {
      await store.recordFailure('pos');
      expect(redis.ttl('login-fail:pos')).toBe(LOGIN_FAIL_WINDOW_SECONDS);
      redis.advance(600);
      await store.recordFailure('pos');
      expect(await store.failedCount('pos')).toBe(2);
      expect(redis.ttl('login-fail:pos')).toBe(300);
    });

    it('forgets the count when the window ends, and a success clears it early', async () => {
      for (let i = 0; i < 10; i += 1) await store.recordFailure('pos');
      expect(await store.failedCount('pos')).toBe(10);
      redis.advance(LOGIN_FAIL_WINDOW_SECONDS);
      expect(await store.failedCount('pos')).toBe(0);
      await store.recordFailure('pos');
      expect(await store.failedCount('pos')).toBe(1);
      await store.clearFailures('pos');
      expect(await store.failedCount('pos')).toBe(0);
    });
  });

  describe('sessions', () => {
    let userId: string;

    beforeEach(async () => {
      await store.seedTrialAccountsIfEmpty();
      userId = prisma.users.find((u) => u.loginName === 'pos')!.id;
    });

    const save = (scope: 'full' | 'two_factor' = 'full') => store.saveSession({ userId, scope, userAgent: 'ua', ip: '127.0.0.1' });

    // What is stored for a token: its hash names the Redis key and the row; the row's id is a different value.
    const keyOf = (token: string) => `session:${hashSessionToken(token)}`;
    const idOf = (token: string) => prisma.sessions.find((row) => row.tokenHash === hashSessionToken(token))!.id as string;

    it('keeps the row in PostgreSQL and the live key in Redis with the session TTL', async () => {
      const token = await save();
      expect(prisma.sessions).toHaveLength(1);
      expect(redis.ttl(keyOf(token))).toBe(SESSION_TTL_SECONDS);
      const live = await store.liveSession(token);
      expect(live?.session).toMatchObject({ id: idOf(token), userId, scope: 'full', kind: 'account' });
      expect(live?.user.loginName).toBe('pos');
    });

    it('stores the token nowhere: not in the row, not in the key, and the id opens nothing (review 2026-11-10, S6)', async () => {
      const token = await save();
      expect(JSON.stringify(prisma.sessions)).not.toContain(token);
      expect(await redis.exists(`session:${token}`)).toBe(0);
      expect(idOf(token)).not.toBe(token);
      expect(await store.liveSession(idOf(token))).toBeNull();
    });

    it('renews the key on touch', async () => {
      const token = await save();
      redis.advance(1000);
      expect(redis.ttl(keyOf(token))).toBe(SESSION_TTL_SECONDS - 1000);
      await store.touchSession(token);
      expect(redis.ttl(keyOf(token))).toBe(SESSION_TTL_SECONDS);
    });

    it('treats a session whose key has expired as gone, and does not revive it on touch', async () => {
      const token = await save();
      redis.advance(SESSION_TTL_SECONDS);
      expect(await store.liveSession(token)).toBeNull();
      await store.touchSession(token);
      expect(await redis.exists(keyOf(token))).toBe(0);
      expect(await store.listSessions(userId)).toEqual([]);
    });

    it('deletes the key and marks the row revoked when a session ends', async () => {
      const first = await save();
      const second = await save();
      await store.revokeSessions([idOf(first)]);
      expect(await redis.exists(keyOf(first))).toBe(0);
      expect(await redis.exists(keyOf(second))).toBe(1);
      expect(prisma.sessions.find((s) => s.id === idOf(first))!.revokedAt).toBeInstanceOf(Date);
      expect(await store.liveSession(first)).toBeNull();
      expect((await store.listFullSessions(userId)).map((s) => s.id)).toEqual([idOf(second)]);
    });

    it('deletes every key of a user whose account is disabled', async () => {
      const full = await save();
      const pending = await save('two_factor');
      await store.dropLiveSessions(userId);
      expect(await redis.exists(keyOf(full))).toBe(0);
      expect(await redis.exists(keyOf(pending))).toBe(0);
      expect(await store.liveSession(full)).toBeNull();
    });
  });

  describe('users and policy', () => {
    it('stores the pending authenticator secret apart from the confirmed one', async () => {
      await store.seedTrialAccountsIfEmpty();
      const id = prisma.users.find((u) => u.loginName === 'pos')!.id;
      await store.updateUser(id, { pendingTwoFactorSecret: 'PENDING' });
      expect(await store.findByLogin('pos')).toMatchObject({ pendingTwoFactorSecret: 'PENDING', twoFactorSecret: null });
      await store.updateUser(id, { twoFactorEnabled: true, twoFactorSecret: 'PENDING', pendingTwoFactorSecret: null });
      expect(await store.findByLogin('pos')).toMatchObject({ twoFactorEnabled: true, twoFactorSecret: 'PENDING', pendingTwoFactorSecret: null });
    });

    it('seals an authenticator secret at rest when a key is set, reads it back plain, and still reads an old plain row (review 2026-11-10, S12)', async () => {
      const previous = process.env.SECRETS_KEY;
      process.env.SECRETS_KEY = Buffer.alloc(32, 3).toString('base64');
      try {
        await store.seedTrialAccountsIfEmpty();
        const row = prisma.users.find((u) => u.loginName === 'pos')!;
        await store.updateUser(row.id as string, { twoFactorEnabled: true, twoFactorSecret: 'JBSWY3DPEHPK3PXP' });
        expect(row.twoFactorSecret).toMatch(/^v1:/);
        expect(String(row.twoFactorSecret)).not.toContain('JBSWY3DPEHPK3PXP');
        expect((await store.findByLogin('pos'))?.twoFactorSecret).toBe('JBSWY3DPEHPK3PXP');
        // A row written before sealing existed.
        row.twoFactorSecret = 'OLDPLAINSECRET';
        expect((await store.findByLogin('pos'))?.twoFactorSecret).toBe('OLDPLAINSECRET');
      } finally {
        if (previous === undefined) delete process.env.SECRETS_KEY;
        else process.env.SECRETS_KEY = previous;
      }
    });

    it('defaults every layer to not required and saves a change', async () => {
      expect(await store.policy()).toEqual({ branch: false, main_agent: false, agent: false, pos: false });
      await store.setPolicy('agent', true);
      await store.setPolicy('agent', true);
      expect(await store.policy()).toEqual({ branch: false, main_agent: false, agent: true, pos: false });
      expect(await store.layerMethods()).toEqual({ branch: 'app', main_agent: 'app', agent: 'app', pos: 'app' });
      await store.setLayerMethod('agent', 'sms');
      expect((await store.layerMethods()).agent).toBe('sms');
      expect((await store.policy()).agent).toBe(true);
    });
  });
});
