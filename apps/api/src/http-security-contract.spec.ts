import 'reflect-metadata';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Controller, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DuplicateGuardInterceptor, NotDuplicateGuarded } from './modules/platform/duplicate-guard.interceptor';
import { ROUTES } from './modules/testing/routes';
import { RESOURCE_PREFIXES, resourcePaths } from './modules/platform/route-prefixes';

// What protects a write route, and what a route would lose by moving (ADR 0020, slice R.0).
//
// Six protections, and what each is keyed on TODAY:
//
//   protection        where                               keyed on
//   ───────────────   ─────────────────────────────────   ─────────────────────────────────────────────
//   CSRF              OriginMiddleware, every route       the method (a write) and the Origin header
//   rate limit        RateLimitMiddleware, every route    the session; three sign-in paths; two exempt paths
//   door              DoorMiddleware, every route         the x-door header; four paths that start a session
//   authorization     ActorInterceptor on the controller  the controller's own decorator
//   activity          @Activity / @NoActivity, or by hand the handler's own decorator
//   duplicate write   DuplicateGuardInterceptor, global   the controller's declaration (slice R.11a)
//   idempotency key   the same interceptor                the controller's declaration (slice R.11a)
//
// Until slice R.11a the last two were keyed on the path prefix `/office/`: a write that left it would have kept
// its permission and its audit and silently lost its duplicate guard and its `Idempotency-Key`. Since R.11a every
// write of a signed-in session is guarded unless its controller (or the route) says `@NotDuplicateGuarded(why)`;
// the auth and branding controllers do, and their write routes are stated below with their standing. So all six
// follow a route wherever it goes.

const SRC = __dirname;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'generated' || name === 'node_modules' || name === 'testing') return [];
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.controller.ts') ? [path] : [];
  });
}

type Route = { method: string; path: string; file: string; controller: string; recorded: boolean; notGuarded: boolean };

/** Every route of every controller in the source, read from the decorators. */
function routesOf(): { routes: Route[]; controllers: { file: string; prefix: string; interceptors: string }[] } {
  const routes: Route[] = [];
  const controllers: { file: string; prefix: string; interceptors: string }[] = [];
  for (const path of walk(SRC)) {
    const file = relative(SRC, path);
    const text = readFileSync(path, 'utf8');
    const declared = /@Controller\(\s*'?([^')]*)'?\s*\)/.exec(text)?.[1] ?? '';
    // A resource controller is served under every resource prefix (slice R.11b): `/v1/…` and the old `/office/…`.
    const prefixes = declared === 'RESOURCE_CONTROLLER_PREFIXES' ? [...RESOURCE_PREFIXES] as string[] : [declared];
    const prefix = prefixes.includes('office') ? 'office' : declared;
    const head = text.slice(0, text.indexOf('export class'));
    const classNotGuarded = /@NotDuplicateGuarded\(/.test(head);
    controllers.push({ file, prefix, interceptors: /@UseInterceptors\(([^)]*)\)/.exec(head)?.[1] ?? '' });
    const decorator = /\n {2}@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/g;
    for (let match = decorator.exec(text); match; match = decorator.exec(text)) {
      const end = text.slice(match.index + 1).search(/\n {2}@(Get|Post|Put|Patch|Delete)\(/);
      const handler = end < 0 ? text.slice(match.index) : text.slice(match.index, match.index + 1 + end);
      for (const served of prefixes) {
        routes.push({
          method: match[1].toUpperCase(),
          path: `/${[served, match[2] ?? ''].filter(Boolean).join('/')}`,
          file,
          controller: served,
          recorded: /@Activity\(|@NoActivity\(|\b(recordOwner|activity\.record\w*)\(/.test(handler),
          notGuarded: classNotGuarded || /@NotDuplicateGuarded\(/.test(handler),
        });
      }
    }
  }
  return { routes, controllers };
}

const { routes, controllers } = routesOf();
const isWrite = (route: { method: string }) => route.method !== 'GET';
const writes = routes.filter(isWrite);

/** Whether the duplicate guard and the idempotency key apply to a route: decided by its controller, never its path. */
const guarded = (route: Route) => !route.notGuarded;

/**
 * How a write route that is not guarded stands without the duplicate guard (reviewed 2026-11-13; R.11a judged the one
 * that `needs` it):
 * - `needs`: a repeat does something the first did not, or answers differently: it needs protection of its own.
 * - `equivalent`: something else already makes a repeat harmless (a one-time code or challenge, a send limit, a
 *   stated value or state, a delete).
 * - `no-replay`: an authentication step. Its answer carries a session or a secret, so it must never be kept and
 *   handed to a second request; a repeat is judged afresh. The duplicate guard is NOT to be widened to these.
 */
type Standing = 'needs' | 'equivalent' | 'no-replay';

/**
 * The write routes that are not guarded, one by one. A write route that is not guarded and not here fails the
 * spec. Sign-in, passkeys and one-time codes stay out of the guard.
 */
const UNGUARDED_WRITES: Record<string, [standing: Standing, why: string]> = {
  // A repeat answers differently.
  // Judged in R.11a: the current password it must carry is its equivalent. A repeat after a change of password is
  // refused (WRONG_CURRENT_PASSWORD) and changes nothing; a repeat of a contact change states the same value. Its
  // answer (the profile, with the e-mail and the phone) is not one to keep in Redis for a replay.
  'PATCH /auth/profile': ['equivalent', 'needs the current password: a repeat after the change is refused and changes nothing; a contact change states a value'],
  // Authentication steps: never replayed.
  'POST /auth/login': ['no-replay', 'answers a session; failed sign-ins are counted per login and per address'],
  'POST /auth/passkey-login/options': ['no-replay', 'issues a challenge; no session yet'],
  'POST /auth/passkey-login': ['no-replay', 'answers a session; the challenge is used once'],
  'POST /auth/logout': ['no-replay', 'ends the session it is sent with'],
  'POST /auth/password': ['no-replay', 'answers a new session; needs the current password'],
  'POST /auth/two-factor/setup': ['no-replay', 'answers a secret to enrol with'],
  'POST /auth/two-factor/confirm': ['no-replay', 'a one-time code; answers a session'],
  'POST /auth/two-factor/verify': ['no-replay', 'a one-time code; answers a session'],
  'POST /auth/two-factor/method/confirm': ['no-replay', 'a one-time code; answers a session'],
  'POST /auth/passkeys/options': ['no-replay', 'issues a challenge'],
  // Something else already makes a repeat harmless.
  'POST /auth/two-factor/method': ['equivalent', 'sends a code: one every 30 seconds'],
  'POST /auth/two-factor/send': ['equivalent', 'sends a code: one every 30 seconds'],
  'POST /auth/passkeys': ['equivalent', 'the challenge is used once: a repeat adds nothing'],
  'DELETE /auth/sessions/:id': ['equivalent', 'deleting twice is deleting once'],
  'DELETE /auth/two-factor': ['equivalent', 'removing twice is removing once'],
  'DELETE /auth/two-factor/:loginName': ['equivalent', 'removing twice is removing once'],
  'DELETE /auth/passkeys/:id': ['equivalent', 'deleting twice is deleting once'],
  'POST /auth/users/:loginName/password': ['equivalent', 'a stated new value'],
  'POST /auth/users/:loginName/disable': ['equivalent', 'a stated state, not a toggle'],
  'PATCH /auth/policy': ['equivalent', 'a stated value'],
  'PATCH /auth/exemptions/:loginName': ['equivalent', 'a stated value'],
  'PATCH /auth/session-rules/:layer': ['equivalent', 'a stated value'],
  'PATCH /auth/users/:loginName/two-factor': ['equivalent', 'a stated value'],
  'PATCH /auth/users/:loginName/contact': ['equivalent', 'a stated value'],
  'PATCH /auth/users/:loginName/session-rules': ['equivalent', 'a stated value'],
  'PUT /branding': ['equivalent', 'replaces the identity with a stated one'],
};

/**
 * Write routes that record no activity today (`write-without-activity` counts the same seven; reviewed
 * 2026-11-13). Nothing records them anywhere: the auth service and its store write no activity, only the
 * controller does. `gap`: a change to an account that leaves no trace. `step`: a step whose outcome is recorded
 * by the route that finishes it, success and failure both; the rule has no way to be told so, because the auth
 * controller has no `@NoActivity`. What a record of any of them may hold is the action and the account, never a
 * password, a code, a secret or a challenge.
 */
// Slice R.A closed the seven writes of sign-in that recorded nothing: the two gaps are recorded (`PATCH /auth/profile`
// as a password change or the account's contact, `DELETE /auth/two-factor` as `two_factor`), and the five steps say
// why they record nothing (`@NoActivity`: each only issues a secret, a challenge or a code; the step that follows
// records the outcome). The record of a gap holds the action and the account only.
const DECLARED_STEPS: Record<string, string> = {
  'POST /auth/two-factor/setup': 'issues a secret',
  'POST /auth/two-factor/method': 'sends a code',
  'POST /auth/two-factor/send': 'sends a code',
  'POST /auth/passkeys/options': 'issues a challenge',
  'POST /auth/passkey-login/options': 'issues a challenge',
};

const named = (route: Route) => `${route.method} ${route.path}`;

describe('the write routes, as the source has them', () => {
  it('reads the real controllers: twenty-two of them, their prefixes, and the write routes of each', () => {
    // Twenty-two since slice R.8: the priced shelf and the sell prices have a controller of their own in pricing
    // (`PackageShelfController`); the routes are the same three, under the same prefix.
    expect(controllers).toHaveLength(22);
    // The empty prefix is the health probe: one read, no write.
    expect([...new Set(controllers.map((controller) => controller.prefix))].sort()).toEqual(['', 'auth', 'branding', 'office']);
    // The same routes under both prefixes, one for one.
    const under = (prefix: string) => writes.filter((route) => route.controller === prefix).map((route) => `${route.method} ${route.path.slice(prefix.length + 2)}`).sort();
    expect(under('v1')).toEqual(under('office'));
    const count = (prefix: string) => writes.filter((route) => route.controller === prefix).length;
    // Every resource write is served twice during the overlap (slice R.11b): under `/v1/` and under `/office/`.
    expect({ office: count('office'), v1: count('v1'), auth: count('auth'), branding: count('branding'), all: writes.length }).toEqual({ office: 76, v1: 76, auth: 26, branding: 1, all: 179 });
  });

  it('agrees with the route table of the office (testing/office-routes.ts): the same write routes, by method and shape', () => {
    // The table names sample values (ID1, CODE1, LOGIN1 …); the controllers name parameters. Both become `:x`.
    const shape = (path: string) => path.replace(/\/:[A-Za-z]+/g, '/:x').replace(/\/(ID|CODE|LOGIN|MSISDN|LAYER|KEY)\d*[A-Z0-9]*(?=\/|$)/g, '/:x');
    const fromSource = writes.filter((route) => route.controller === 'office').map((route) => `${route.method} ${shape(route.path)}`).sort();
    const fromTable = ROUTES.filter(([method]) => method !== 'GET').map(([method, path]) => `${method} ${shape(path)}`).sort();
    expect(fromSource).toEqual(fromTable);
  });
});

describe('the duplicate guard and the idempotency key', () => {
  it('the guard is keyed on the controller\'s declaration, and on nothing else: no path in its condition', () => {
    const guard = readFileSync(join(SRC, 'modules/platform/duplicate-guard.interceptor.ts'), 'utf8');
    expect(guard).not.toMatch(/startsWith\(|originalUrl\.split|\/office\//);
    expect(guard).toContain('Reflect.getMetadata(NOT_GUARDED, context.getHandler()) ?? Reflect.getMetadata(NOT_GUARDED, context.getClass())');
  });

  it('every write route is guarded, or is stated here with its reason, and only the auth and branding controllers say otherwise', () => {
    const stray = writes.filter((route) => !guarded(route) && !(named(route) in UNGUARDED_WRITES)).map(named);
    expect(stray).toEqual([]);
    expect([...new Set(writes.filter((route) => !guarded(route)).map((route) => route.file))].sort()).toEqual(['modules/auth/auth.controller.ts', 'modules/branding/branding.controller.ts']);
  });

  it('the stated list holds no route that does not exist, and none that is guarded', () => {
    const all = new Map(writes.map((route) => [named(route), route]));
    expect(Object.keys(UNGUARDED_WRITES).filter((name) => !all.has(name))).toEqual([]);
    expect(Object.keys(UNGUARDED_WRITES).filter((name) => guarded(all.get(name) as Route))).toEqual([]);
    expect(Object.keys(UNGUARDED_WRITES)).toHaveLength(27);
  });

  it('each stated route has a standing: none needs protection (R.11a), seventeen have an equivalent, ten are never replayed', () => {
    const count = (standing: Standing) => Object.values(UNGUARDED_WRITES).filter(([its]) => its === standing).length;
    expect({ needs: count('needs'), equivalent: count('equivalent'), noReplay: count('no-replay') }).toEqual({ needs: 0, equivalent: 17, noReplay: 10 });
    // Sign-in, passkey and one-time-code steps are never among the routes to be guarded by replaying an answer.
    const authSteps = Object.keys(UNGUARDED_WRITES).filter((name) => /\/(login|logout|passkey-login|two-factor\/(setup|confirm|verify|method\/confirm)|passkeys\/options)/.test(name));
    for (const name of authSteps) expect({ name, standing: UNGUARDED_WRITES[name][0] }).toEqual({ name, standing: 'no-replay' });
  });

  it('a write route that moves keeps its guard: the guarded routes are the same whatever their paths', () => {
    // The plan R.11 move, made on the real routes: every `/office/` route given another path. The guard is decided
    // by the controller, so the same 152 (76 under each prefix) are guarded and nothing new is unguarded.
    const before = writes.filter(guarded).map((route) => `${route.file} ${route.method}`).sort();
    const moved = writes.map((route) => ({ ...route, path: route.path.replace(/^\/office\//, '/v1/') }));
    expect(moved.filter(guarded).map((route) => `${route.file} ${route.method}`).sort()).toEqual(before);
    expect(moved.filter(guarded)).toHaveLength(152);
  });
});

describe('authorization and activity follow the controller, not the path', () => {
  it('every controller of the office resolves the actor, but the one that starts and ends an entered session', () => {
    const office = controllers.filter((controller) => controller.prefix === 'office');
    expect(office).toHaveLength(19);
    const without = office.filter((controller) => !/ActivityInterceptor,\s*ActorInterceptor/.test(controller.interceptors)).map((controller) => controller.file);
    // `handoff` has no session yet and `leave` ends one: the service checks the session itself.
    expect(without).toEqual(['modules/access/accounts/account-session.controller.ts']);
    expect(office.find((controller) => controller.file.endsWith('account-session.controller.ts'))?.interceptors).toBe('ActivityInterceptor');
  });

  it('the controllers outside the office have no interceptor: they check the session and record by hand', () => {
    const others = controllers.filter((controller) => controller.prefix !== 'office');
    expect(others.map((controller) => [controller.file, controller.interceptors])).toEqual([
      ['health.controller.ts', ''],
      ['modules/auth/auth.controller.ts', ''],
      ['modules/branding/branding.controller.ts', ''],
    ]);
  });

  it('every write route records its activity, or says why not (slice R.A: none records nothing); the five steps of sign-in say why', () => {
    expect(writes.filter((route) => !route.recorded).map(named)).toEqual([]);
    const auth = readFileSync(join(SRC, 'modules/auth/auth.controller.ts'), 'utf8');
    for (const [route, what] of Object.entries(DECLARED_STEPS)) {
      const path = route.split(' ')[1].replace('/auth/', '');
      const declared = new RegExp(`@Post\\('${path.replace(/\//g, '\\/')}'\\)\\n\\s+@NoActivity\\('a step: ${what}`).test(auth);
      expect({ route, declared }).toEqual({ route, declared: true });
    }
  });

});

describe('the protections that are on every route', () => {
  it('origin, rate limit and door are applied to every route, in that order', () => {
    const app = readFileSync(join(SRC, 'app.module.ts'), 'utf8');
    expect(app).toContain("consumer.apply(OriginMiddleware, RateLimitMiddleware, DoorMiddleware).forRoutes('*')");
  });

  it('the paths the middleware names are routes that exist', () => {
    // A route renamed without its line in the middleware would lose its rule (a sign-in limit, the stream's
    // exemption, the right to start a session) with no error.
    const all = new Set(routes.map(named));
    for (const route of ['POST /auth/login', 'POST /auth/passkey-login', 'POST /auth/passkey-login/options', 'POST /office/handoff', 'POST /v1/handoff', 'GET /office/notices/stream', 'GET /v1/notices/stream']) {
      expect({ route, exists: all.has(route) }).toEqual({ route, exists: true });
    }
    // The single-route rules name the route under every prefix it is served under (slice R.11b), from the one list.
    const limit = readFileSync(join(SRC, 'rate-limit.middleware.ts'), 'utf8');
    expect(limit).toContain("const SIGN_IN = [/^\\/auth\\/login$/, /^\\/auth\\/passkey-login(\\/options)?$/, ...resourcePaths('handoff').map((path) => new RegExp(`^${path}$`))];");
    expect(limit).toContain("const EXEMPT = [...resourcePaths('notices/stream').map((path) => new RegExp(`${path}$`)), /^\\/health$/];");
    const door = readFileSync(join(SRC, 'door.middleware.ts'), 'utf8');
    expect(door).toContain("const STARTS_SESSION = new Set(['/auth/login', '/auth/passkey-login/options', '/auth/passkey-login', ...resourcePaths('handoff')]);");
    expect(resourcePaths('handoff')).toEqual(['/v1/handoff', '/office/handoff']);
  });
});

// ── The guard itself, over HTTP: what the controller decides (slice R.11a) ─────────────────────────────────────

let ran: Record<string, number> = {};

@Controller()
class Probe {
  @Post('office/probe-old')
  inside() {
    ran.inside = (ran.inside ?? 0) + 1;
    return { ok: true };
  }

  @Post('v1/probe-new')
  outside() {
    ran.outside = (ran.outside ?? 0) + 1;
    return { ok: true };
  }

  /** One route under both prefixes, as every resource controller is declared since slice R.11b. */
  @Post(['v1/probe-both', 'office/probe-both'])
  both() {
    ran.both = (ran.both ?? 0) + 1;
    return { ok: true };
  }
}

/** A controller that says it is not guarded, as the auth and branding controllers do. */
@NotDuplicateGuarded('a probe of the declaration')
@Controller()
class UnguardedProbe {
  @Post('v1/unguarded-probe')
  unguarded() {
    ran.unguarded = (ran.unguarded ?? 0) + 1;
    return { ok: true };
  }
}

describe('what the controller decides (the guard over HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [Probe, UnguardedProbe] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new DuplicateGuardInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    ran = {};
  });

  const send = (path: string, key?: string) => {
    const call = request(app.getHttpServer()).post(path).set('Cookie', 'sid=contract-session').send({ amount: 1 });
    return key ? call.set('Idempotency-Key', key) : call;
  };

  it('under the old prefix: the same write sent twice runs once, with or without a key', async () => {
    await send('/office/probe-old');
    await send('/office/probe-old');
    expect(ran.inside).toBe(1);
    await send('/office/probe-old', 'contract-key-0001');
    await send('/office/probe-old', 'contract-key-0001');
    expect(ran.inside).toBe(2);
  });

  it('outside the prefix, the same: a route that moves keeps its guard and its key (slice R.11a)', async () => {
    // Before R.11a this test said the opposite: outside `/office/` the same write ran twice and its key was ignored.
    await send('/v1/probe-new');
    const repeat = await send('/v1/probe-new');
    expect(ran.outside).toBe(1);
    expect(repeat.headers['idempotent-replay']).toBe('true');
    await send('/v1/probe-new', 'contract-key-0002');
    await send('/v1/probe-new', 'contract-key-0002');
    expect(ran.outside).toBe(2);
  });

  it('the same write sent to its two paths is one write (slice R.11b: the guard keys the canonical path)', async () => {
    await send('/v1/probe-both');
    const repeat = await send('/office/probe-both');
    expect(ran.both).toBe(1);
    expect(repeat.headers['idempotent-replay']).toBe('true');
    await send('/office/probe-both', 'contract-key-0004');
    await send('/v1/probe-both', 'contract-key-0004');
    expect(ran.both).toBe(2);
  });

  it('a controller that says it is not guarded runs every repeat: nothing is kept or replayed for it', async () => {
    const first = await send('/v1/unguarded-probe', 'contract-key-0003');
    const second = await send('/v1/unguarded-probe', 'contract-key-0003');
    expect(ran.unguarded).toBe(2);
    expect([first.headers['idempotent-replay'], second.headers['idempotent-replay']]).toEqual([undefined, undefined]);
  });
});
