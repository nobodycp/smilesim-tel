import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import IORedis from 'ioredis';
import request from 'supertest';
import { PrismaClient } from '../../generated/prisma/client';
import { hashSessionToken } from '../auth/session-token';
import { PrismaAuthStore } from '../auth/prisma-auth.store';
import { apiTestApp } from '../testing/api-test-app';

// PostgreSQL and Redis only (TEST_DATABASE_URL, TEST_REDIS_URL). What a signed-in request costs in SQL before and
// inside a cheap handler, counted from Prisma's own query log (plan 2026-11-17-speed, PF.9).
const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const suite = url && redisUrl ? describe : describe.skip;

suite('a signed-in request reads (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const before = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const u = { owner: randomUUID(), main: randomUUID(), agent: randomUUID(), pos: randomUUID() };
  const statements: string[] = [];
  let prisma: PrismaClient;
  let redis: IORedis;
  let app: INestApplication;
  let cookie: Record<'owner' | 'pos', string>;
  let tokens: Record<'owner' | 'pos', string>;

  /** The SQL statements one GET sent, the request's own answer checked. */
  async function count(who: 'owner' | 'pos', path: string): Promise<string[]> {
    statements.length = 0;
    const response = await request(app.getHttpServer()).get(path).set('Cookie', cookie[who]);
    expect(response.status).toBe(200);
    return [...statements];
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaClient({ adapter: new PrismaPg(url!), log: [{ emit: 'event', level: 'query' }] });
    (prisma as unknown as { $on(event: 'query', listen: (query: { query: string }) => void): void }).$on('query', (event) => void statements.push(event.query));
    redis = new IORedis(redisUrl!);
    const row = (id: string, name: string, layer: string, parentId: string | null, isBranchOwner = false) => ({ id, loginName: `cost-${tag}-${name}`, nickname: name, passwordHash: 'x', layer, parentId, isBranchOwner });
    for (const account of [row(u.owner, 'owner', 'branch', null, true), row(u.main, 'main', 'main_agent', u.owner), row(u.agent, 'agent', 'agent', u.main), row(u.pos, 'pos', 'pos', u.agent)]) {
      await prisma.user.create({ data: { ...account, twoFactorExempt: true, wallet: { create: { balance: 0, ceiling: 0 } } } });
    }
    const store = new PrismaAuthStore({ prisma, redis });
    tokens = {
      owner: await store.saveSession({ userId: u.owner, scope: 'full', userAgent: '', ip: '' }),
      pos: await store.saveSession({ userId: u.pos, scope: 'full', userAgent: '', ip: '' }),
    };
    cookie = { owner: `sid=${tokens.owner}`, pos: `sid=${tokens.pos}` };
    ({ app } = await apiTestApp(store, prisma as unknown as Record<string, unknown>));
    // The first request of a process may read what later ones keep; the counts below are of a running process.
    await count('pos', '/v1/me');
    await count('owner', '/v1/me');
  });

  afterAll(async () => {
    await app?.close();
    const ids = Object.values(u);
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: ids } } });
    for (const id of [u.pos, u.agent, u.main, u.owner]) await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
    redis.disconnect();
    process.env.DATABASE_URL = before;
  });

  /** What the sign-in itself sent: the session, the account and its roles, the policy rows, a session write. */
  const signIn = (sent: string[]) => sent.filter((sql) => /"public"\."(Session|LayerPolicy|Role|UserRole)"/.test(sql) || /FROM "public"\."User" WHERE \(?"public"\."User"\."id" = \$1/.test(sql));
  const wholeTree = (sent: string[]) => sent.filter((sql) => /FROM "public"\."User" WHERE 1=1 ORDER BY "public"\."User"\."loginName"/.test(sql));
  const writes = (sent: string[]) => sent.filter((sql) => /^(UPDATE|INSERT|DELETE)/.test(sql));

  // Before PF.9 (measured on 134f5531): GET /v1/me 11 statements for a point of sale and 11 for the owner, 9 and 8 of
  // them the sign-in's, one of them an UPDATE of the session on every request and one a read of the policy rows.
  it('a point of sale: 7 statements of sign-in, none a write, the tree read once', async () => {
    const me = await count('pos', '/v1/me');
    expect(signIn(me)).toHaveLength(7);
    expect(writes(me)).toEqual([]);
    expect(me.filter((sql) => sql.includes('"LayerPolicy"'))).toEqual([]);
    expect(wholeTree(me)).toHaveLength(1);
    expect(me).toHaveLength(9);
    const lines = await count('pos', '/v1/postpaid/lines');
    expect(signIn(lines)).toHaveLength(7);
    expect(writes(lines)).toEqual([]);
    expect(wholeTree(lines)).toHaveLength(1);
  });

  it('the branch owner: 3 statements of sign-in (the session, its account, the account again for its grants)', async () => {
    const me = await count('owner', '/v1/me');
    expect(signIn(me)).toHaveLength(3);
    expect(writes(me)).toEqual([]);
    expect(wholeTree(me)).toHaveLength(1);
    expect(me).toHaveLength(6);
    const lines = await count('owner', '/v1/postpaid/lines');
    expect(signIn(lines)).toHaveLength(3);
    expect(wholeTree(lines)).toHaveLength(1);
  });

  it('writes the session once its stored last-activity time is a minute old, and only then', async () => {
    await prisma.session.updateMany({ where: { tokenHash: hashSessionToken(tokens.pos) }, data: { lastSeenAt: new Date(Date.now() - 61_000) } });
    const due = await count('pos', '/v1/me');
    expect(writes(due)).toHaveLength(1);
    expect(writes(due)[0]).toMatch(/^UPDATE "public"\."Session"/);
    expect(writes(await count('pos', '/v1/me'))).toEqual([]);
  });
});
