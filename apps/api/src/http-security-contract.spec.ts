import 'reflect-metadata';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Controller, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DuplicateGuardInterceptor } from './modules/shared/duplicate-guard.interceptor';
import { ROUTES } from './modules/office/testing/office-routes';

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
//   duplicate write   DuplicateGuardInterceptor, global   **the path prefix `/office/`**
//   idempotency key   the same interceptor                **the path prefix `/office/`**
//
// So four of them follow a route wherever it goes, and the last two do not: a write that leaves `/office/` keeps
// its permission and its audit and silently loses its duplicate guard and its `Idempotency-Key`. This spec makes
// that loud. It changes no route and no guard. Before any route leaves the prefix (plan R.11), the guard is
// separated from the prefix (every authenticated write, less a stated list), and the last test here is replaced
// by its opposite in that same change.

const SRC = __dirname;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'generated' || name === 'node_modules' || name === 'testing') return [];
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.controller.ts') ? [path] : [];
  });
}

type Route = { method: string; path: string; file: string; controller: string; recorded: boolean };

/** Every route of every controller in the source, read from the decorators. */
function routesOf(): { routes: Route[]; controllers: { file: string; prefix: string; interceptors: string }[] } {
  const routes: Route[] = [];
  const controllers: { file: string; prefix: string; interceptors: string }[] = [];
  for (const path of walk(SRC)) {
    const file = relative(SRC, path);
    const text = readFileSync(path, 'utf8');
    const prefix = /@Controller\(\s*'?([^')]*)'?\s*\)/.exec(text)?.[1] ?? '';
    const head = text.slice(0, text.indexOf('export class'));
    controllers.push({ file, prefix, interceptors: /@UseInterceptors\(([^)]*)\)/.exec(head)?.[1] ?? '' });
    const decorator = /\n {2}@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/g;
    for (let match = decorator.exec(text); match; match = decorator.exec(text)) {
      const end = text.slice(match.index + 1).search(/\n {2}@(Get|Post|Put|Patch|Delete)\(/);
      const handler = end < 0 ? text.slice(match.index) : text.slice(match.index, match.index + 1 + end);
      routes.push({
        method: match[1].toUpperCase(),
        path: `/${[prefix, match[2] ?? ''].filter(Boolean).join('/')}`,
        file,
        controller: prefix,
        recorded: /@Activity\(|@NoActivity\(|\b(recordOwner|activity\.record\w+)\(/.test(handler),
      });
    }
  }
  return { routes, controllers };
}

const { routes, controllers } = routesOf();
const isWrite = (route: { method: string }) => route.method !== 'GET';
const writes = routes.filter(isWrite);

/** The prefix the duplicate guard and the idempotency key are keyed on today. One place: this constant. */
const GUARDED_PREFIX = '/office/';
const guarded = (path: string) => path.startsWith(GUARDED_PREFIX);

/**
 * How a write route outside the guarded prefix stands without the duplicate guard (reviewed 2026-11-13):
 * - `needs`: a repeat does something the first did not, or answers differently: it needs protection of its own.
 * - `equivalent`: something else already makes a repeat harmless (a one-time code or challenge, a send limit, a
 *   stated value or state, a delete).
 * - `no-replay`: an authentication step. Its answer carries a session or a secret, so it must never be kept and
 *   handed to a second request; a repeat is judged afresh. The duplicate guard is NOT to be widened to these.
 */
type Standing = 'needs' | 'equivalent' | 'no-replay';

/**
 * The write routes outside the guarded prefix, one by one. A write route that is not under the prefix and not
 * here fails the spec. Widening the guard is a decision per route (plan R.11a), never a change of the prefix test
 * alone: sign-in, passkeys and one-time codes stay out of it.
 */
const UNGUARDED_WRITES: Record<string, [standing: Standing, why: string]> = {
  // A repeat answers differently.
  'PATCH /auth/profile': ['needs', 'with a new password the first request succeeds and the same request sent again is refused (WRONG_CURRENT_PASSWORD): a double submit shows an error for a change that was made'],
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
const UNRECORDED_WRITES: Record<string, ['gap' | 'step', string]> = {
  'PATCH /auth/profile': ['gap', 'changes the e-mail, the phone and the password with no record; POST /auth/password records the same change'],
  'DELETE /auth/two-factor': ['gap', 'an account turns its own second step off with no record; the owner clearing another account is recorded'],
  'POST /auth/two-factor/setup': ['step', 'issues a secret; POST /auth/two-factor/confirm records the enrolment'],
  'POST /auth/two-factor/method': ['step', 'sends a code; POST /auth/two-factor/method/confirm records the enrolment'],
  'POST /auth/two-factor/send': ['step', 'sends a code; POST /auth/two-factor/verify records the outcome'],
  'POST /auth/passkeys/options': ['step', 'issues a challenge; POST /auth/passkeys records the passkey'],
  'POST /auth/passkey-login/options': ['step', 'issues a challenge; POST /auth/passkey-login records the sign-in'],
};

const named = (route: Route) => `${route.method} ${route.path}`;

describe('the write routes, as the source has them', () => {
  it('reads the real controllers: twenty-one of them, their prefixes, and the write routes of each', () => {
    expect(controllers).toHaveLength(21);
    // The empty prefix is the health probe: one read, no write.
    expect([...new Set(controllers.map((controller) => controller.prefix))].sort()).toEqual(['', 'auth', 'branding', 'office']);
    const count = (prefix: string) => writes.filter((route) => route.controller === prefix).length;
    expect({ office: count('office'), auth: count('auth'), branding: count('branding'), all: writes.length }).toEqual({ office: 76, auth: 26, branding: 1, all: 103 });
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
  it('the guard is keyed on the prefix, and on nothing else: its condition is the one this spec reads', () => {
    const guard = readFileSync(join(SRC, 'modules/shared/duplicate-guard.interceptor.ts'), 'utf8');
    expect(guard).toContain(`!path.startsWith('${GUARDED_PREFIX}')`);
    expect(guard.match(/path\.startsWith\(/g)).toHaveLength(1);
  });

  it('every write route is under the guarded prefix, or is stated here with its reason', () => {
    const stray = writes.filter((route) => !guarded(route.path) && !(named(route) in UNGUARDED_WRITES)).map(named);
    expect(stray).toEqual([]);
  });

  it('the stated list holds no route that does not exist, and none that is guarded', () => {
    const all = new Set(writes.map(named));
    expect(Object.keys(UNGUARDED_WRITES).filter((name) => !all.has(name))).toEqual([]);
    expect(Object.keys(UNGUARDED_WRITES).filter((name) => guarded(name.split(' ')[1]))).toEqual([]);
    expect(Object.keys(UNGUARDED_WRITES)).toHaveLength(27);
  });

  it('each stated route has a standing: one needs protection, sixteen have an equivalent, ten are never replayed', () => {
    const count = (standing: Standing) => Object.values(UNGUARDED_WRITES).filter(([its]) => its === standing).length;
    expect({ needs: count('needs'), equivalent: count('equivalent'), noReplay: count('no-replay') }).toEqual({ needs: 1, equivalent: 16, noReplay: 10 });
    // Sign-in, passkey and one-time-code steps are never among the routes to be guarded by replaying an answer.
    const authSteps = Object.keys(UNGUARDED_WRITES).filter((name) => /\/(login|logout|passkey-login|two-factor\/(setup|confirm|verify|method\/confirm)|passkeys\/options)/.test(name));
    for (const name of authSteps) expect({ name, standing: UNGUARDED_WRITES[name][0] }).toEqual({ name, standing: 'no-replay' });
  });

  it('a write route moved out of the prefix is caught: the check fails for it until it is stated', () => {
    // The same check as above, on the real routes with one of them moved the way plan R.11 would move it.
    const moved = writes.map((route) => (named(route) === 'POST /office/lines' ? { ...route, path: '/v1/lines' } : route));
    expect(moved.filter((route) => !guarded(route.path) && !(named(route) in UNGUARDED_WRITES)).map(named)).toEqual(['POST /v1/lines']);
    // And with every office route moved, every one of them is caught: 76, none lost on the way.
    const all = writes.map((route) => ({ ...route, path: route.path.replace(/^\/office\//, '/v1/') }));
    expect(all.filter((route) => !guarded(route.path) && !(named(route) in UNGUARDED_WRITES))).toHaveLength(76);
  });
});

describe('authorization and activity follow the controller, not the path', () => {
  it('every controller of the office resolves the actor, but the one that starts and ends an entered session', () => {
    const office = controllers.filter((controller) => controller.prefix === 'office');
    expect(office).toHaveLength(18);
    const without = office.filter((controller) => !/ActivityInterceptor,\s*ActorInterceptor/.test(controller.interceptors)).map((controller) => controller.file);
    // `handoff` has no session yet and `leave` ends one: the service checks the session itself.
    expect(without).toEqual(['modules/office/accounts/account-session.controller.ts']);
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

  it('every write route records its activity, or says why not; seven of sign-in record nothing today: two gaps, five steps', () => {
    expect(writes.filter((route) => !route.recorded).map(named).sort()).toEqual(Object.keys(UNRECORDED_WRITES).sort());
    const kinds = Object.values(UNRECORDED_WRITES).map(([kind]) => kind);
    expect({ gaps: kinds.filter((kind) => kind === 'gap').length, steps: kinds.filter((kind) => kind === 'step').length }).toEqual({ gaps: 2, steps: 5 });
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
    for (const route of ['POST /auth/login', 'POST /auth/passkey-login', 'POST /auth/passkey-login/options', 'POST /office/handoff', 'GET /office/notices/stream']) {
      expect({ route, exists: all.has(route) }).toEqual({ route, exists: true });
    }
    const limit = readFileSync(join(SRC, 'rate-limit.middleware.ts'), 'utf8');
    expect(limit).toContain('const SIGN_IN = [/^\\/auth\\/login$/, /^\\/auth\\/passkey-login(\\/options)?$/, /^\\/office\\/handoff$/];');
    expect(limit).toContain('const EXEMPT = [/\\/office\\/notices\\/stream$/, /^\\/health$/];');
    const door = readFileSync(join(SRC, 'door.middleware.ts'), 'utf8');
    expect(door).toContain("const STARTS_SESSION = new Set(['/auth/login', '/auth/passkey-login/options', '/auth/passkey-login', '/office/handoff']);");
  });
});

// ── The guard itself, over HTTP: what the prefix decides ────────────────────────────────────────────────────

let ran: Record<string, number> = {};

@Controller()
class Probe {
  @Post('office/probe')
  inside() {
    ran.inside = (ran.inside ?? 0) + 1;
    return { ok: true };
  }

  @Post('v1/probe')
  outside() {
    ran.outside = (ran.outside ?? 0) + 1;
    return { ok: true };
  }
}

describe('what the prefix decides today (the guard over HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [Probe] }).compile();
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

  it('under the prefix: the same write sent twice runs once, with or without a key', async () => {
    await send('/office/probe');
    await send('/office/probe');
    expect(ran.inside).toBe(1);
    await send('/office/probe', 'contract-key-0001');
    await send('/office/probe', 'contract-key-0001');
    expect(ran.inside).toBe(2);
  });

  it('OUTSIDE THE PREFIX THE SAME WRITE RUNS TWICE, and its key is ignored: the hazard of moving a route', async () => {
    // This is what the code does today, written down so that nobody finds it by accident. It is not what is
    // wanted for a route that moves: before plan R.11 this test is replaced by "runs once" in the change that
    // separates the guard from the prefix.
    await send('/v1/probe');
    await send('/v1/probe');
    expect(ran.outside).toBe(2);
    await send('/v1/probe', 'contract-key-0002');
    await send('/v1/probe', 'contract-key-0002');
    expect(ran.outside).toBe(4);
  });
});
