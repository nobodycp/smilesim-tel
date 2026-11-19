import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { API_STATEMENT_TIMEOUT_MS, DATABASE_ROLES, EXPORT_STATEMENT_TIMEOUT_MS, IDLE_IN_TRANSACTION_TIMEOUT_MS, WORKER_STATEMENT_TIMEOUT_MS, createPrismaClient, poolConfigOf } from '../../db';
import type { PrismaClient } from '../../generated/prisma/client';
import { API_PROVIDERS } from './api-providers';
import { errorCode } from './log';
import { PrismaService, withExportLimit } from './prisma.service';
import { ServerErrorRecorder, type ServerErrorDraft } from './server-errors';
import { UnitOfWork } from './unit-of-work';

// The database settings of plan DB.15 (spec 2026-11-17-scale-speed-cleanup, "Database settings (DB.15)"): each
// client's limits, set on its connections when they open; the CSV exports on their own client with a longer limit;
// a statement cut by its limit answered as `TOO_SLOW` and kept by PostgreSQL's code only; the storage parameters of
// migration 20261117200000_table_settings. PostgreSQL only (see wallet-concurrency.db.spec.ts for how to give it one).

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const NO_NOTICES = { write: async () => [], publish: async () => undefined } as never;

/** One setting as this connection sees it. */
async function show(db: Pick<PrismaClient, '$queryRawUnsafe'>, name: string): Promise<string> {
  const rows = await db.$queryRawUnsafe<Record<string, string>[]>(`SHOW ${name}`);
  return Object.values(rows[0])[0];
}

describe('the pool settings of each client (db.ts)', () => {
  it('states the owner\'s values', () => {
    expect([API_STATEMENT_TIMEOUT_MS, IDLE_IN_TRANSACTION_TIMEOUT_MS, EXPORT_STATEMENT_TIMEOUT_MS, WORKER_STATEMENT_TIMEOUT_MS]).toEqual([15_000, 30_000, 90_000, 60_000]);
    const of = (role: keyof typeof DATABASE_ROLES, poolMax?: string) => poolConfigOf(role, 'postgresql://db/smilesim', poolMax);
    expect(of('api')).toMatchObject({ max: 20, statement_timeout: 15_000, idle_in_transaction_session_timeout: 30_000, application_name: 'smilesim-api' });
    expect(of('worker')).toMatchObject({ max: 10, statement_timeout: 60_000, idle_in_transaction_session_timeout: 30_000 });
    expect(of('export')).toMatchObject({ max: 2, statement_timeout: 90_000 });
    expect(of('purge')).toMatchObject({ max: 2, statement_timeout: 60_000 });
    expect(of('tool')).not.toHaveProperty('statement_timeout');
  });

  it('takes DATABASE_POOL_MAX for the main pools only, and refuses a value it cannot use', () => {
    const of = (role: keyof typeof DATABASE_ROLES, poolMax?: string) => poolConfigOf(role, 'postgresql://db/smilesim', poolMax).max;
    expect([of('api', '35'), of('worker', '4'), of('export', '35'), of('purge', '35')]).toEqual([35, 4, 2, 2]);
    for (const bad of ['0', '81', 'many']) expect(() => of('api', bad)).toThrow('DATABASE_POOL_MAX');
  });
});

describe('the CSV exports', () => {
  it('every export route reads under withExportLimit', () => {
    // A controller's CSV call (`…Csv(` or `.csv(` on a service) not wrapped in `withExportLimit(() => …)`.
    const modules = join(__dirname, '..');
    const controllers = readdirSync(modules, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.controller.ts'));
    const calls: string[] = [];
    const unwrapped: string[] = [];
    for (const file of controllers) {
      const text = readFileSync(join(modules, file), 'utf8');
      for (const match of text.matchAll(/(withExportLimit\(\(\) => )?this\.\w+\.(\w*Csv|csv)\(/g)) {
        calls.push(`${file}: ${match[2]}`);
        if (!match[1]) unwrapped.push(`${file}: ${match[2]}`);
      }
    }
    expect(calls).toHaveLength(6);
    expect(unwrapped).toEqual([]);
  });
});

suite('the database settings on PostgreSQL (plan DB.15)', () => {
  jest.setTimeout(30_000);
  const previousUrl = process.env.DATABASE_URL;
  const previousPool = process.env.DATABASE_POOL_MAX;
  let service: PrismaService;
  let uow: UnitOfWork;

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    delete process.env.DATABASE_POOL_MAX;
    service = new PrismaService();
    uow = new UnitOfWork(NO_NOTICES, service);
  });

  afterAll(async () => {
    await service.onModuleDestroy();
    process.env.DATABASE_URL = previousUrl;
    if (previousPool === undefined) delete process.env.DATABASE_POOL_MAX;
    else process.env.DATABASE_POOL_MAX = previousPool;
  });

  it('the API\'s connections are limited to 15 s a statement and 30 s idle in a transaction', async () => {
    expect(await show(uow.prisma, 'statement_timeout')).toBe('15s');
    expect(await show(uow.prisma, 'idle_in_transaction_session_timeout')).toBe('30s');
    expect(await show(uow.prisma, 'application_name')).toBe('smilesim-api');
    // A transaction's connection is one of the pool's: the same limits.
    expect(await uow.runTx((tx) => show(tx, 'statement_timeout'))).toBe('15s');
  });

  it('an export reads on the export client, under its 90 s limit, and the API\'s client is left as it was', async () => {
    const inside = await withExportLimit(async () => ({
      timeout: await show(uow.prisma, 'statement_timeout'),
      name: await show(uow.prisma, 'application_name'),
      // Reads the export starts side by side keep the context.
      both: await Promise.all([show(uow.prisma, 'statement_timeout'), show(service.client, 'statement_timeout')]),
    }));
    expect(inside).toEqual({ timeout: '90s', name: 'smilesim-export', both: ['90s', '90s'] });
    expect(await show(uow.prisma, 'statement_timeout')).toBe('15s');
  });

  it('the worker\'s connections are limited to 60 s a statement; an operator\'s tool has no limit of ours', async () => {
    const worker = createPrismaClient('worker');
    const tool = createPrismaClient('tool');
    try {
      expect(await show(worker, 'statement_timeout')).toBe('1min');
      expect(await show(worker, 'idle_in_transaction_session_timeout')).toBe('30s');
      // The server's own default (0 in the test database): the tool sends none.
      expect(await show(tool, 'statement_timeout')).toBe('0');
    } finally {
      await Promise.all([worker.$disconnect(), tool.$disconnect()]);
    }
  });

  it('the pool opens at most DATABASE_POOL_MAX connections', async () => {
    process.env.DATABASE_POOL_MAX = '3';
    const small = createPrismaClient('api');
    try {
      const pids = await Promise.all(Array.from({ length: 6 }, () => small.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid, pg_sleep(0.3)::text AS slept`));
      expect(new Set(pids.map((rows) => rows[0].pid)).size).toBe(3);
    } finally {
      delete process.env.DATABASE_POOL_MAX;
      await small.$disconnect();
    }
  });

  it('the storage parameters and the validated checks of migration 20261117200000_table_settings are in place', async () => {
    const rows = await uow.prisma.$queryRaw<{ relname: string; reloptions: string[] }[]>`
      SELECT relname, reloptions FROM pg_class
      WHERE relkind = 'r' AND relname IN ('Wallet', 'Session', 'ActivityEvent', 'RequestLog', 'WalletEntry', 'PostpaidLine') ORDER BY relname`;
    expect(Object.fromEntries(rows.map((row) => [row.relname, row.reloptions]))).toEqual({
      ActivityEvent: ['autovacuum_vacuum_scale_factor=0.02'],
      PostpaidLine: ['autovacuum_analyze_scale_factor=0.02'],
      RequestLog: ['autovacuum_vacuum_scale_factor=0.02'],
      Session: ['fillfactor=80'],
      Wallet: ['fillfactor=70'],
      WalletEntry: ['autovacuum_analyze_scale_factor=0.02'],
    });
    const checks = await uow.prisma.$queryRaw<{ conname: string; convalidated: boolean }[]>`
      SELECT conname, convalidated FROM pg_constraint
      WHERE conname IN ('Wallet_held_not_negative', 'PostpaidLine_status_known', 'Task_status_known') ORDER BY conname`;
    expect(checks).toEqual([
      { conname: 'PostpaidLine_status_known', convalidated: true },
      { conname: 'Task_status_known', convalidated: true },
      { conname: 'Wallet_held_not_negative', convalidated: true },
    ]);
  });

  describe('a statement cut by its limit', () => {
    const kept: ServerErrorDraft[] = [];
    const id = randomUUID();
    let app: INestApplication;
    let holder: PrismaClient;

    // The limit is shortened for the one transaction (`SET LOCAL`), so the spec waits a fraction of a second; the
    // cut is PostgreSQL's whatever the value.
    @Controller('probe')
    class ProbeController {
      @Get('raw')
      async raw() {
        return uow.runTx(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL statement_timeout = 200');
          await tx.$queryRaw`SELECT pg_sleep(2)`;
        });
      }

      // A model query that waits for a row lock longer than its limit (Prisma `P2039`, not `P2010`).
      @Get('model')
      async model() {
        return uow.runTx(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL statement_timeout = 200');
          await tx.user.update({ where: { id }, data: { nickname: 'cut' } });
        });
      }
    }

    beforeAll(async () => {
      await uow.prisma.user.create({ data: { id, loginName: `db15-${id.slice(0, 8)}`, nickname: 'db15', passwordHash: 'x', layer: 'pos', isBranchOwner: false } });
      holder = createPrismaClient('tool');
      const moduleRef = await Test.createTestingModule({
        controllers: [ProbeController],
        providers: [...API_PROVIDERS, { provide: ServerErrorRecorder, useValue: { record: (draft: ServerErrorDraft) => kept.push(draft) } }],
      }).compile();
      app = moduleRef.createNestApplication({ logger: false });
      await app.init();
    });

    afterAll(async () => {
      await app.close();
      await holder.$disconnect();
      await uow.prisma.user.delete({ where: { id } });
    });

    it('a raw statement answers 500 TOO_SLOW and is kept by the code 57014 only', async () => {
      const response = await request(app.getHttpServer()).get('/probe/raw');
      expect(response.status).toBe(500);
      expect(response.body.code).toBe('TOO_SLOW');
      expect(kept.at(-1)).toMatchObject({ method: 'GET', route: '/probe/raw', message: '57014' });
    });

    it('a model query that waits past its limit answers the same', async () => {
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => (locked = resolve));
      const holding = holder.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${id} FOR UPDATE`;
        locked();
        await released;
      }, { timeout: 10_000 });
      await lockTaken;
      try {
        const response = await request(app.getHttpServer()).get('/probe/model');
        expect(response.status).toBe(500);
        expect(response.body.code).toBe('TOO_SLOW');
        expect(kept.at(-1)).toMatchObject({ route: '/probe/model', message: '57014' });
      } finally {
        release();
        await holding;
      }
    });

    it('the log names the code, never the driver\'s words', async () => {
      const error = await uow.runTx(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL statement_timeout = 100');
        await tx.$queryRaw`SELECT pg_sleep(1)`;
      }).then(() => null, (thrown: unknown) => thrown);
      expect(errorCode(error)).toBe('57014');
    });
  });
});
