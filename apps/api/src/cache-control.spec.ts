import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { DEFAULT_CACHE_CONTROL, cacheControl } from './cache-control';
import { HealthController } from './health.controller';
import { OriginMiddleware } from './origin.middleware';
import { RATE_LIMIT_ALL, RateLimitMiddleware } from './rate-limit.middleware';
import { ActivityModule } from './modules/auditing/activity.module';
import { AuthModule } from './modules/auth/auth.module';
import { AUTH_STORE } from './modules/auth/auth.store';
import { MemoryAuthStore } from './modules/auth/testing/memory-auth.store';
import { BrandingModule } from './modules/branding/branding.module';
import { BRANDING_STORE, MemoryBrandingStore } from './modules/branding/branding.store';
import { apiTestApp } from './modules/testing/api-test-app';

// What every answer says about caching (speed plan PF.11, spec decision 12): one route of each class, served
// through the default as `main.ts` puts it in front of everything, and through the middlewares that refuse before a
// handler where the class is a refusal.

type Step = (req: Request, res: Response, next: NextFunction) => unknown;

type Express = ((req: IncomingMessage, res: ServerResponse) => void) & { request: object; response: object };

/**
 * The app as a request handler with `steps` in front of it, in order, as `main.ts` and `app.module.ts` chain them.
 * The request and the answer are given Express's own methods first, as Express does when a request comes in, so a
 * step can answer (`res.status(…).json(…)`) before the app's routes are reached.
 */
function served(app: INestApplication, ...steps: Step[]) {
  const nest = app.getHttpAdapter().getInstance() as Express;
  return (req: IncomingMessage, res: ServerResponse) => {
    Object.assign(req, { res });
    Object.assign(res, { req });
    Object.setPrototypeOf(req, nest.request);
    Object.setPrototypeOf(res, nest.response);
    const asExpress = req as Request;
    asExpress.originalUrl ??= req.url ?? '/';
    const run = (index: number): unknown => (index === steps.length ? nest(req, res) : steps[index](asExpress, res as Response, () => void run(index + 1)));
    void run(0);
  };
}

describe('Cache-Control on every answer', () => {
  describe('the resource routes, their errors and the refusals before a handler', () => {
    let app: INestApplication;
    let session: string;

    beforeAll(async () => {
      const store = new MemoryAuthStore();
      store.addUser({
        id: 'pos1', loginName: 'pos1', nickname: 'نقطة', disabledAt: null, mustChangePassword: false, layer: 'pos',
        twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: false, passwordHash: 'x',
      });
      session = await store.saveSession({ userId: 'pos1', scope: 'full', userAgent: '', ip: '' });
      const tables = {
        user: { findUnique: async () => ({ liveGrants: '', isBranchOwner: false }) },
        notice: { findMany: async () => [], count: async () => 0, updateMany: async () => ({ count: 1 }) },
      };
      ({ app } = await apiTestApp(store, tables, { subscribe: async () => async () => undefined }));
    });

    afterAll(async () => {
      await app.close();
    });

    const handler = () => served(app, cacheControl());

    it('a JSON read and a write say private, no-cache', async () => {
      const read = await request(handler()).get('/v1/notices').set('Cookie', `sid=${session}`);
      expect([read.status, read.headers['cache-control']]).toEqual([200, DEFAULT_CACHE_CONTROL]);
      const write = await request(handler()).post('/v1/notices/read').set('Cookie', `sid=${session}`).send({});
      expect([write.status < 300, write.headers['cache-control']]).toEqual([true, DEFAULT_CACHE_CONTROL]);
    });

    it('a 401 and a 404 say it too', async () => {
      const signedOut = await request(handler()).get('/v1/notices');
      expect([signedOut.status, signedOut.headers['cache-control']]).toEqual([401, DEFAULT_CACHE_CONTROL]);
      const missing = await request(handler()).get('/v1/no-such-route').set('Cookie', `sid=${session}`);
      expect([missing.status, missing.headers['cache-control']]).toEqual([404, DEFAULT_CACHE_CONTROL]);
    });

    it('a refusal sent by a middleware before any handler says it too: the origin\'s 403, the rate limit\'s 429', async () => {
      const limit = new RateLimitMiddleware();
      limit.counter = { hit: async () => ({ count: RATE_LIMIT_ALL + 1, ttl: 60 }) };
      const origin = new OriginMiddleware();
      const chain = () => served(app, cacheControl(), (req, res, next) => origin.use(req, res, next), (req, res, next) => limit.use(req, res, next));
      const foreign = await request(chain()).post('/v1/notices/read').set('Origin', 'https://elsewhere.example').send({});
      expect([foreign.status, foreign.headers['cache-control']]).toEqual([403, DEFAULT_CACHE_CONTROL]);
      const limited = await request(chain()).get('/v1/notices').set('Cookie', `sid=${session}`);
      expect([limited.status, limited.headers['cache-control']]).toEqual([429, DEFAULT_CACHE_CONTROL]);
    });

    it('the notices stream keeps its own headers', async () => {
      const server = handler();
      const headers = await new Promise<Record<string, string | string[] | undefined>>((resolve, reject) => {
        const call = request(server).get('/v1/notices/stream').set('Cookie', `sid=${session}`).buffer(false);
        call.parse((res, done) => {
          resolve(res.headers);
          (res as unknown as { destroy: () => void }).destroy();
          done(null, null);
        });
        call.end((error) => {
          if (error && !/aborted|socket hang up|ECONNRESET/i.test(String(error))) reject(error);
        });
      });
      expect([headers['content-type'], headers['cache-control'], headers['x-accel-buffering']]).toEqual(['text/event-stream', 'no-cache, no-transform', 'no']);
    });
  });

  describe('the branding pictures and the health probe', () => {
    let app: INestApplication;
    let version: number;

    beforeAll(async () => {
      const branding = new MemoryBrandingStore();
      await branding.save({ siteName: 'Pro Sim', tagline: '', logo: `data:image/png;base64,${Buffer.alloc(64, 7).toString('base64')}`, logoDark: null, favicon: null });
      const moduleRef = await Test.createTestingModule({ imports: [ActivityModule, AuthModule, BrandingModule], controllers: [HealthController] })
        .overrideProvider(AUTH_STORE)
        .useValue(new MemoryAuthStore())
        .overrideProvider(BRANDING_STORE)
        .useValue(branding)
        .compile();
      app = moduleRef.createNestApplication();
      await app.init();
      version = (await request(app.getHttpServer()).get('/branding')).body.version as number;
    });

    afterAll(async () => {
      await app.close();
    });

    const get = (path: string) => request(served(app, cacheControl())).get(path);

    it('the identity read says the default', async () => {
      const summary = await get('/branding');
      expect([summary.status, summary.headers['cache-control']]).toEqual([200, DEFAULT_CACHE_CONTROL]);
    });

    it('a picture keeps its own policy: immutable under the current ?v=, no-cache otherwise (PF.1)', async () => {
      expect(version).toBeGreaterThan(0);
      const named = await get(`/branding/logo?v=${version}`);
      expect([named.status, named.headers['cache-control']]).toEqual([200, 'public, max-age=31536000, immutable']);
      const unnamed = await get('/branding/logo');
      expect([unnamed.status, unnamed.headers['cache-control']]).toEqual([200, 'no-cache']);
      const missing = await get('/branding/favicon');
      expect([missing.status, missing.headers['cache-control']]).toEqual([404, DEFAULT_CACHE_CONTROL]);
    });

    it('the health probe says no-store', async () => {
      const health = await get('/health');
      expect([health.status, health.headers['cache-control']]).toEqual([200, 'no-store']);
    });
  });
});
