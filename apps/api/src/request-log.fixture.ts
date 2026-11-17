import 'reflect-metadata';
import { Body, Controller, Get, Module, Param, Post, Query, UseInterceptors, type INestApplication, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DoorMiddleware } from './door.middleware';
import { OriginMiddleware } from './origin.middleware';
import { RateLimitMiddleware } from './rate-limit.middleware';
import { RequestLogMiddleware } from './request-log.middleware';
import { AUTH_STORE } from './modules/auth/auth.store';
import { MemoryAuthStore } from './modules/auth/testing/memory-auth.store';
import { ActorInterceptor } from './modules/access/actor.interceptor';
import { ActorResolver } from './modules/access/actor-resolver';
import type { Actor } from './modules/access/types';
import { API_PROVIDERS } from './modules/platform/api-providers';
import { fail } from './modules/platform/api-failure';
import { RESOURCE_CONTROLLER_PREFIXES } from './modules/platform/route-prefixes';
import { ServerErrorRecorder } from './modules/platform/server-errors';
import { RequestLogWriter } from './modules/monitoring/request-log.writer';
import { RequestLogRepository } from './modules/monitoring/request-log.repository';

// Test-only (`*.fixture.ts`): the request log's middleware in front of probe routes, with the app's other three
// middleware in the app's order, and requests that carry secrets every way a request can carry them. Used by
// `request-log.middleware.spec.ts` (a stand-in writer) and `modules/monitoring/request-log.db.spec.ts` (PostgreSQL).

/** Values a request can carry that must never reach the log, sent every way a request carries them. */
export const SECRETS = {
  password: 'Pa55-word-NEVER-LOGGED',
  code: '771234',
  esimCode: 'LPA:1$smdp.example$ESIM-NEVER-LOGGED',
  session: 'sid-token-NEVER-LOGGED',
  home: 'home-token-NEVER-LOGGED',
  query: 'query-token-NEVER-LOGGED',
  bearer: 'bearer-NEVER-LOGGED',
  apiKey: 'api-key-NEVER-LOGGED',
  idempotency: 'idem-key-NEVER-LOGGED',
};

const OWNER: Actor = { id: 'owner-1', loginName: 'branch', nickname: 'branch', layer: 'branch', isBranchOwner: true, grants: [], operatorId: 'owner-1', impersonating: false };
const ENTERED: Actor = { id: 'pos-1', loginName: 'pos1', nickname: 'pos1', layer: 'pos', isBranchOwner: false, grants: [], operatorId: 'owner-1', impersonating: true };

/** Sessions the stand-in resolver knows: the owner's own, and the owner inside a point of sale. */
const resolver = {
  actor: async (gate: { sessionId?: string }) => {
    if (gate.sessionId === 'owner-sid' || gate.sessionId === SECRETS.session) return OWNER;
    if (gate.sessionId === 'entered-sid') return ENTERED;
    return fail(401, 'LOGIN_REQUIRED');
  },
};

@Controller(RESOURCE_CONTROLLER_PREFIXES)
@UseInterceptors(ActorInterceptor)
class SignedInProbe {
  @Get('probe/:id')
  read(@Param('id') id: string) {
    return { id };
  }

  @Post('probe/:id')
  write() {
    return { ok: true };
  }

  @Get('forbidden')
  forbidden() {
    return fail(403, 'FORBIDDEN');
  }

  @Get('crash')
  crash() {
    throw new Error('a bug');
  }

  /** A bug whose message quotes the request: its body, its query, and a line shaped like a stack frame. */
  @Post('probe/:id/crash')
  crashWithSecrets(@Body() body: unknown, @Query() query: unknown) {
    throw new TypeError(`cannot read ${JSON.stringify(body)} for ${JSON.stringify(query)}\n    at ${SECRETS.apiKey} (/app/dist/${SECRETS.bearer}.js:1:1)`);
  }
}

@Controller(RESOURCE_CONTROLLER_PREFIXES)
class OpenProbe {
  @Get('open')
  open() {
    return { ok: true };
  }

  @Get('notices/stream')
  stream() {
    return { ok: true };
  }
}

@Controller()
class HealthProbe {
  @Get('health')
  health() {
    return { ok: true };
  }
}

/** The app's four middleware in the app's order, over probe routes, with the given writer. */
export async function probeApp(writer: Partial<RequestLogWriter> | null, extra: unknown[] = []) {
  @Module({
    controllers: [SignedInProbe, OpenProbe, HealthProbe],
    providers: [
      RequestLogMiddleware, OriginMiddleware, RateLimitMiddleware, DoorMiddleware, ...API_PROVIDERS,
      { provide: AUTH_STORE, useValue: new MemoryAuthStore() },
      { provide: ActorResolver, useValue: resolver },
      ...(writer ? [{ provide: RequestLogWriter, useValue: writer }] : [RequestLogWriter, RequestLogRepository]),
      // The error filter records a 5xx through the platform's port, as the app binds it (MonitoringModule).
      { provide: ServerErrorRecorder, useExisting: RequestLogWriter },
      ...(extra as never[]),
    ],
  })
  class ProbeModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
      consumer.apply(RequestLogMiddleware, OriginMiddleware, RateLimitMiddleware, DoorMiddleware).forRoutes('*');
    }
  }
  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  return { app, moduleRef };
}

/** One write and one read that carry every secret: body, query, cookies, headers. */
export async function sendSecrets(app: INestApplication) {
  const cookie = `sid=${SECRETS.session}; home=${SECRETS.home}; other=${SECRETS.code}`;
  const headers = { Cookie: cookie, Authorization: `Bearer ${SECRETS.bearer}`, 'X-Api-Key': SECRETS.apiKey, 'Idempotency-Key': SECRETS.idempotency, 'X-Code': SECRETS.code };
  const write = await request(app.getHttpServer())
    .post(`/v1/probe/one?token=${SECRETS.query}&password=${SECRETS.password}`)
    .set(headers)
    .send({ password: SECRETS.password, code: SECRETS.code, esimCode: SECRETS.esimCode, nested: { secret: SECRETS.session } });
  const read = await request(app.getHttpServer()).get(`/v1/probe/two?code=${SECRETS.code}&esim=${encodeURIComponent(SECRETS.esimCode)}`).set(headers);
  return [write, read];
}

/** A write that crashes, carrying every secret: body, query, cookies, headers, and in the thrown error's message. */
export async function sendCrash(app: INestApplication) {
  const cookie = `sid=${SECRETS.session}; home=${SECRETS.home}; other=${SECRETS.code}`;
  return request(app.getHttpServer())
    .post(`/v1/probe/three/crash?token=${SECRETS.query}&password=${SECRETS.password}`)
    .set({ Cookie: cookie, Authorization: `Bearer ${SECRETS.bearer}`, 'X-Api-Key': SECRETS.apiKey, 'Idempotency-Key': SECRETS.idempotency, 'X-Code': SECRETS.code })
    .send({ password: SECRETS.password, code: SECRETS.code, esimCode: SECRETS.esimCode, nested: { secret: SECRETS.session } });
}

export function leaked(text: string): string[] {
  return Object.entries(SECRETS).filter(([, value]) => text.includes(value) || text.includes(encodeURIComponent(value))).map(([name]) => name);
}
