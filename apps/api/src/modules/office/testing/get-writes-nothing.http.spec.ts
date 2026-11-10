import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { officeTestApp } from './office-test-app';
import { ROUTES } from './office-routes';
import { hashOnce } from './test-hash';

// A GET reads (backend-engineering.mdc 4.10): it can be retried, cached and served by a read-only database. Every
// GET route is called here as the branch owner over tables that answer every read with nothing and record every
// write. A route that writes on a read fails with the table and method it wrote to.

const WRITES = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
const owner = { id: 'admin', loginName: 'admin', nickname: 'الإدارة', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null, isBranchOwner: true, liveGrants: '', role: null };

/** Routes left writing on purpose, each with its reason. None today; a new entry needs one. */
const ALLOWED: Record<string, string[]> = {};

describe('a GET route writes nothing', () => {
  let app: INestApplication;
  let session: string;
  const written: string[] = [];

  const table = (model: string) =>
    new Proxy({}, {
      get: (_target, method: string) => async () => {
        if (WRITES.has(method)) {
          written.push(`${model}.${method}`);
          return {};
        }
        if (method === 'findMany') return model === 'user' ? [owner] : [];
        if (method === 'findUnique' || method === 'findFirst') return model === 'user' ? owner : null;
        if (method === 'count') return 0;
        if (method === 'groupBy') return [];
        if (method === 'aggregate') return { _sum: {}, _count: {}, _max: {}, _min: {}, _avg: {} };
        return null;
      },
    });
  const tables: Record<string, unknown> = new Proxy({}, {
    get: (_target, model: string) => {
      if (model === '$transaction') return async (run: (client: unknown) => Promise<unknown>) => run(tables);
      if (model === '$queryRaw' || model === '$executeRaw') return async () => [];
      if (model === 'then') return undefined;
      return table(model);
    },
  });

  beforeAll(async () => {
    const store = new MemoryAuthStore();
    store.addUser({
      id: 'admin', loginName: 'admin', nickname: 'الإدارة', disabledAt: null, mustChangePassword: false, layer: 'branch',
      twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: true, passwordHash: await hashOnce('ownerpass1'),
    });
    session = await store.saveSession({ userId: 'admin', scope: 'full', userAgent: '', ip: '' });
    ({ app } = await officeTestApp(store, tables));
  });

  afterAll(async () => {
    await app.close();
  });

  const reads = ROUTES.filter(([method, path]) => method === 'GET' && path !== '/office/notices/stream');

  it.each(reads)('%s %s', async (method, path) => {
    written.length = 0;
    const response = await request(app.getHttpServer()).get(path).set('Cookie', `sid=${session}`);
    // Whatever it answers over empty tables (a list, 404 for the sample id), it was let in and it read.
    expect(response.status).not.toBe(401);
    const allowed = ALLOWED[`${method} ${path}`] ?? [];
    expect(written.filter((write) => !allowed.includes(write))).toEqual([]);
  });
});
