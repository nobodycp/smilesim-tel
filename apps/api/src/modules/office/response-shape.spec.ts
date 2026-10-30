import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryAuthStore } from '../auth/auth.store';
import { hashPassword } from '../auth/password';
import { OfficeService } from './office.service';

// The web app keeps its own copy of the shape of these answers (apps/web/lib/api.ts: OfficeMe,
// HomePayload, LineRow, PosChoice). There is no shared package, so this test is the guard: the key
// lists below are written by hand, the service must answer with exactly them, and the web types must
// declare exactly them. Change a shape on one side and this fails until the other side and the list follow.

const ME_KEYS = ['loginName', 'nickname', 'layer', 'isBranchOwner', 'grants', 'impersonating', 'balance', 'ceiling'];
const HOME_KEYS = ['pendingTasks', 'activeLines', 'inactiveLines', 'canPost', 'operations', 'announcements'];
const HOME_OPERATION_KEYS = ['id', 'at', 'kind', 'amount', 'note', 'loginName'];
const HOME_ANNOUNCEMENT_KEYS = ['id', 'body', 'at', 'authorName', 'authorLayer'];
const LINES_KEYS = ['lines', 'poses', 'nextCursor'];
const LINE_KEYS = ['id', 'msisdn', 'iccid', 'esim', 'status', 'packageCode', 'packageName', 'companyName', 'posLogin', 'posPrice', 'createdAt', 'endsAt'];
const LINE_OPTIONAL_KEYS = ['opsLocked'];
const POS_CHOICE_KEYS = ['loginName', 'nickname'];

const sorted = (list: string[]) => [...list].sort();
const keysOf = (value: object) => sorted(Object.keys(value));

const accounts = [
  { id: 'admin', loginName: 'admin', nickname: 'الإدارة', layer: 'branch', parentId: null },
  { id: 'pos1', loginName: 'pos1', nickname: 'نقطة', layer: 'pos', parentId: 'admin' },
];

async function serviceWith(tables: Record<string, unknown>) {
  const auth = new MemoryAuthStore();
  auth.addUser({
    id: 'admin',
    loginName: 'admin',
    nickname: 'الإدارة',
    disabledAt: null,
    mustChangePassword: false,
    layer: 'branch',
    twoFactorExempt: true,
    twoFactorEnabled: false,
    isBranchOwner: true,
    passwordHash: await hashPassword('ownerpass1'),
  });
  const sessionId = await auth.saveSession({ userId: 'admin', scope: 'full', userAgent: '', ip: '' });
  const service = new OfficeService(auth);
  (service as unknown as { prismaClient: unknown }).prismaClient = {
    user: { findUnique: async () => ({ liveGrants: '', isBranchOwner: true }), findMany: async () => accounts },
    ...tables,
  };
  return { service, gate: { sessionId } };
}

const at = new Date(Date.UTC(2026, 9, 1));

describe('office response shapes', () => {
  it('answers /office/me with the keys of OfficeMe', async () => {
    const { service, gate } = await serviceWith({ wallet: { findUnique: async () => ({ balance: 10, ceiling: 100 }) } });
    expect(keysOf(await service.me(gate))).toEqual(sorted(ME_KEYS));
  });

  it('answers /office/home with the keys of HomePayload and of its rows', async () => {
    const { service, gate } = await serviceWith({
      officeTask: { count: async () => 2 },
      line: { count: async () => 3 },
      walletEntry: {
        findMany: async () => [{ id: 'e1', createdAt: at, kind: 'activate', amount: -5, note: null, user: { loginName: 'pos1' } }],
      },
      announcement: {
        findMany: async () => [{ id: 'a1', body: 'hello', createdAt: at, author: { nickname: 'الإدارة', loginName: 'admin', layer: 'branch' } }],
      },
    });
    const home = await service.home(gate);
    expect(keysOf(home)).toEqual(sorted(HOME_KEYS));
    expect(keysOf(home.operations[0])).toEqual(sorted(HOME_OPERATION_KEYS));
    expect(keysOf(home.announcements[0])).toEqual(sorted(HOME_ANNOUNCEMENT_KEYS));
  });

  it('answers /office/lines with the keys of its envelope, of LineRow and of PosChoice', async () => {
    const row = {
      id: 'ln-1',
      msisdn: '0550000001',
      iccid: null,
      esim: false,
      status: 'active',
      posId: 'pos1',
      createdAt: at,
      endsAt: at,
      package: { code: 'pk', name: '400', posPrice: 30, company: { name: 'سلكوم' } },
      pos: { loginName: 'pos1' },
    };
    const { service, gate } = await serviceWith({ line: { findMany: async () => [row] } });
    const listed = await service.lines(gate);
    expect(keysOf(listed)).toEqual(sorted(LINES_KEYS));
    expect(keysOf(listed.lines[0])).toEqual(sorted(LINE_KEYS));
    expect(listed.poses.length).toBeGreaterThan(0);
    expect(keysOf(listed.poses[0])).toEqual(sorted(POS_CHOICE_KEYS));
  });
});

// The same lists against the web declarations. Skipped where the web app is not checked out beside the API.
const webApi = join(__dirname, '../../../../web/lib/api.ts');
const describeWeb = existsSync(webApi) ? describe : describe.skip;

/** The text between `export type NAME = {` and the `};` that closes it. */
function typeBody(source: string, name: string): string {
  const start = source.indexOf(`export type ${name} = {`);
  if (start < 0) throw new Error(`apps/web/lib/api.ts has no exported type ${name}`);
  const open = source.indexOf('{', start);
  const end = source.indexOf('\n};', open);
  return source.slice(open + 1, end);
}

/** Keys declared at the top level of a type body, split into required and optional. */
function declared(body: string) {
  const required: string[] = [];
  const optional: string[] = [];
  for (const match of body.matchAll(/^ {2}(\w+)(\?)?:/gm)) (match[2] ? optional : required).push(match[1]);
  return { required: sorted(required), optional: sorted(optional) };
}

/** Keys of the object type written inline after `field:` (`field: { a: string; b: number }[];`). */
function inlineKeys(body: string, field: string): string[] {
  const line = new RegExp(`^ {2}${field}: \\{(.*)\\}\\[\\];`, 'm').exec(body);
  if (!line) throw new Error(`no inline object type for ${field}`);
  return sorted([...line[1].matchAll(/(\w+):/g)].map((match) => match[1]));
}

describeWeb('web types match the pinned shapes', () => {
  const source = existsSync(webApi) ? readFileSync(webApi, 'utf8') : '';

  it('OfficeMe', () => {
    expect(declared(typeBody(source, 'OfficeMe'))).toEqual({ required: sorted(ME_KEYS), optional: [] });
  });

  it('HomePayload and its rows', () => {
    const body = typeBody(source, 'HomePayload');
    expect(declared(body)).toEqual({ required: sorted(HOME_KEYS), optional: [] });
    expect(inlineKeys(body, 'operations')).toEqual(sorted(HOME_OPERATION_KEYS));
    expect(inlineKeys(body, 'announcements')).toEqual(sorted(HOME_ANNOUNCEMENT_KEYS));
  });

  it('LineRow, PosChoice and the officeLines envelope', () => {
    expect(declared(typeBody(source, 'LineRow'))).toEqual({ required: sorted(LINE_KEYS), optional: sorted(LINE_OPTIONAL_KEYS) });
    const pos = /export type PosChoice = \{([^}]*)\}/.exec(source);
    expect(sorted([...(pos?.[1] ?? '').matchAll(/(\w+):/g)].map((match) => match[1]))).toEqual(sorted(POS_CHOICE_KEYS));
    const envelope = /officeLines:[\s\S]*?request<\{([^}]*)\}>/.exec(source);
    expect(sorted([...(envelope?.[1] ?? '').matchAll(/(\w+):/g)].map((match) => match[1]))).toEqual(sorted(LINES_KEYS));
  });
});
