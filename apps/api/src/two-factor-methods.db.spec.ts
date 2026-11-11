import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './db';
import { capturedOutput } from './modules/shared/testing/captured-output';
import { report, storedFindings } from './two-factor-methods';

// PostgreSQL only (TEST_DATABASE_URL). Spec 2026-11-12-two-factor-available-methods: the report reads the stored
// two-step settings as they are, names accounts by id only, and changes nothing. It makes accounts of its own and
// no layer rule, so the rules other specs rely on are never touched.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('two-step methods report (PostgreSQL)', () => {
  jest.setTimeout(30_000);
  const before = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const PHONE = '+972 52-987-6543';
  const EMAIL = `held-${tag}@example.com`;
  const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const ids: Record<string, string> = { heldOwn: randomUUID(), enrolledSms: randomUUID(), free: randomUUID(), appUser: randomUUID(), disabled: randomUUID() };
  let prisma: ReturnType<typeof createPrismaClient>;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const user = (id: string, name: string, over: Record<string, unknown>) => ({ id, loginName: `tfm-${tag}-${name}`, nickname: name, passwordHash: 'x', layer: 'pos', phone: PHONE, email: EMAIL, ...over });
    await prisma.user.createMany({
      data: [
        user(ids.heldOwn, 'held', { twoFactorRequired: true, requiredMethod: 'email' }),
        user(ids.enrolledSms, 'sms', { twoFactorEnabled: true, twoFactorMethod: 'sms', twoFactorSecret: SECRET }),
        user(ids.free, 'free', {}),
        user(ids.appUser, 'app', { twoFactorEnabled: true, twoFactorMethod: 'app', twoFactorSecret: SECRET, twoFactorRequired: true, requiredMethod: 'app' }),
        user(ids.disabled, 'off', { twoFactorEnabled: true, twoFactorMethod: 'email', disabledAt: new Date() }),
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = before;
  });

  const mine = <T extends { id: string }>(rows: T[]) => rows.filter((row) => Object.values(ids).includes(row.id));
  const stored = () => prisma.user.findMany({ where: { id: { in: Object.values(ids) } }, orderBy: { id: 'asc' } });

  it('finds the account held to email and the one enrolled with SMS, and leaves the others out', async () => {
    const found = await storedFindings();
    expect(mine(found.held)).toEqual([{ id: ids.heldOwn, layer: 'pos', method: 'email', by: 'account' }]);
    expect(mine(found.enrolled)).toEqual([{ id: ids.enrolledSms, layer: 'pos', method: 'sms' }]);
  });

  it('prints ids only: no login name, phone, email or secret, and changes nothing', async () => {
    const first = await stored();
    let code = -1;
    const output = await capturedOutput(async () => {
      code = await report();
    });
    expect(code).toBe(1);
    expect(output).toContain(`account ${ids.heldOwn} (pos): has to enrol and is held to email by its own setting`);
    expect(output).toContain(`account ${ids.enrolledSms} (pos): enrolled with sms`);
    for (const part of [`tfm-${tag}`, PHONE, '987-6543', EMAIL, 'example.com', SECRET, SECRET.slice(0, 12)]) expect(output).not.toContain(part);
    expect(await stored()).toEqual(first);
  });
});
