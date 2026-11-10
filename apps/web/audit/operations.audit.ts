import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  DOORS,
  NOTE_DEBITED,
  NOTE_DONE,
  NOTE_TASK,
  apiCall,
  balance,
  closeDb,
  lineByMsisdn,
  login,
  outcomeText,
  sql,
  type Door,
} from './kit';

const DAY_SHARE = 29;
const PERIOD = 30;
const FEE = 50;
const ESIM = 500;
const PREPAID = new Set(['activate', 'charge', 'extend', 'reactivate', 'switch']);

type Pack = {
  code: string;
  name: string;
  posPrice: number;
  renewalPosPrice: number;
  branchCost: number;
  months: number;
  company: string;
  companyCode: string;
};
type Entry = { id: string; kind: string; amount: number; note: string | null; packageName: string | null; periodDays: number | null };
type Snap = {
  balance: number;
  entries: Entry[];
  ops: { kind: string; cost: number }[];
  log: { action: string }[];
  finance: { kind: string }[];
};
type Line = { id: string; msisdn: string; owner: string };

const share = (price: number, days: number, months = 1) => Math.round((price * days) / (PERIOD * Math.max(1, months)));
const count = <T>(rows: T[], test: (row: T) => boolean) => rows.filter(test).length;

let admin: Page;
let pos: Page;
let P: Pack;
let Q: Pack;
let M: Pack;

async function catalog(): Promise<{ P: Pack; Q: Pack; M: Pack }> {
  const rows = await sql<Pack>(
    `SELECT p.code, p.name, p."posPrice", p."renewalPosPrice", p."branchCost", p.months, c.name AS company, c.code AS "companyCode"
       FROM "Package" p JOIN "Company" c ON c.id = p."companyId" JOIN "Provider" pr ON pr.id = p."providerId"
      WHERE p."forSale" AND p.enabled AND pr.code = 'lian' AND p.months = 1
      ORDER BY c.code, p."posPrice"`,
  );
  const byCompany = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) byCompany.set(row.companyCode, [...(byCompany.get(row.companyCode) ?? []), row]);
  const shelf = [...byCompany.values()].find((items) => items.length >= 2);
  if (!shelf) throw new Error('the lian catalog has no company with two one-month packages');
  const manual = rows.find((row) => row.companyCode !== shelf[0].companyCode);
  if (!manual) throw new Error('the lian catalog has a single company');
  return { P: shelf[0], Q: shelf[1], M: manual };
}

async function snap(line: Line): Promise<Snap> {
  const [ops, card, finance] = await Promise.all([
    apiCall<{ items: { kind: string; cost: number }[] }>(admin, 'admin', 'GET', `/office/provider-operations?q=${line.msisdn}`),
    apiCall<{ history: { action: string }[] }>(admin, 'admin', 'GET', `/office/lines/${line.id}`),
    apiCall<{ items: { kind: string }[] }>(admin, 'admin', 'GET', `/office/finance?q=${line.msisdn}`),
  ]);
  const entries = await sql<Entry>(`SELECT id, kind, amount, note, "packageName", "periodDays" FROM "WalletEntry" WHERE "lineId" = $1 ORDER BY "createdAt"`, [line.id]);
  return {
    balance: await balance(line.owner),
    entries: entries.map((row) => ({ ...row, amount: Number(row.amount) })),
    ops: ops.items,
    log: card.history,
    finance: finance.items,
  };
}

/** One operation that ran: the money moved once, and every record that should show it does. */
function expectRecorded(label: string, before: Snap, after: Snap, kind: string, delta: number, cost?: number) {
  expect.soft(after.balance - before.balance, `${label}: balance moves by the rule`).toBe(delta);
  const fresh = after.entries.filter((row) => !before.entries.some((old) => old.id === row.id));
  expect.soft(fresh.map((row) => row.kind), `${label}: one wallet row of that kind`).toEqual([kind]);
  expect.soft(fresh[0]?.amount, `${label}: the wallet row carries the moved amount`).toBe(delta);
  expect.soft(fresh[0]?.packageName, `${label}: the wallet row names its package`).toBeTruthy();
  expect.soft(fresh[0]?.note ?? null, `${label}: the note does not repeat the package column`).not.toBe(fresh[0]?.packageName);
  if (PREPAID.has(kind)) expect.soft(fresh[0]?.periodDays, `${label}: the prepaid row records its period`).toBeGreaterThan(0);
  expect.soft(count(after.ops, (row) => row.kind === kind) - count(before.ops, (row) => row.kind === kind), `${label}: one provider operation`).toBe(1);
  if (cost !== undefined) {
    expect.soft(after.ops.find((row) => row.kind === kind)?.cost, `${label}: provider cost`).toBe(cost);
  }
  expect.soft(count(after.log, (row) => row.action === kind) - count(before.log, (row) => row.action === kind), `${label}: one row in the number log`).toBe(1);
  expect.soft(
    count(after.finance, (row) => row.kind === kind) - count(before.finance, (row) => row.kind === kind),
    `${label}: finance only when money moved`,
  ).toBe(delta === 0 ? 0 : 1);
}

/** A failed provider call: a task is open, nothing moved, and nothing was reported as done. */
function expectHeld(label: string, before: Snap, after: Snap, kind: string) {
  expect.soft(after.balance, `${label}: no money before the task is done`).toBe(before.balance);
  expect.soft(after.entries.length, `${label}: no wallet row before the task is done`).toBe(before.entries.length);
  expect.soft(count(after.ops, (row) => row.kind === kind), `${label}: no provider operation yet`).toBe(count(before.ops, (row) => row.kind === kind));
  expect.soft(count(after.finance, (row) => row.kind === kind), `${label}: no finance row yet`).toBe(count(before.finance, (row) => row.kind === kind));
}

function expectNote(label: string, text: string, delta: number) {
  const wanted = delta < 0 ? NOTE_DEBITED : NOTE_DONE;
  expect.soft(text, `${label}: the note says what happened to the money`).toBe(wanted);
}

async function openCard(page: Page, door: Door, line: Line) {
  await page.goto(`${DOORS[door]}/numbers/${line.id}`);
  await expect(page.locator('.line-number')).toHaveText(line.msisdn);
}

async function pickOutcome(scope: Page | Locator, outcome: 'نجاح' | 'فشل') {
  await scope.getByRole('group', { name: 'نتيجة المزود' }).getByRole('button', { name: outcome, exact: true }).click();
}

/** Runs one operation from the line card and returns the page message. */
async function onCard(page: Page, door: Door, line: Line, label: string, options: { outcome?: 'نجاح' | 'فشل'; fill?: (page: Page) => Promise<void> } = {}) {
  await openCard(page, door, line);
  if (options.outcome) await pickOutcome(page, options.outcome);
  await page.locator('.line-ops').getByRole('button', { name: label, exact: true }).click();
  if (options.fill) await options.fill(page);
  return outcomeText(page);
}

const swapSimTo = (iccid: string) => async (page: Page) => {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('الشريحة الجديدة').fill(iccid);
  await dialog.getByRole('button', { name: 'تبديل الشريحة', exact: true }).click();
};
const switchTo = (pack: Pack) => async (page: Page) => {
  const dialog = page.getByRole('dialog');
  await dialog.locator('.pack-pick', { hasText: pack.name }).click();
  await dialog.getByRole('button', { name: 'تبديل الرزمة', exact: true }).click();
};
/** What the disconnect dialog showed before it was confirmed. */
let quoted: { amount: number; asTask: boolean } | null = null;
async function confirmDisconnect(page: Page) {
  quoted = null;
  const dialog = page.getByRole('dialog', { name: 'فصل الرقم' });
  const money = dialog.locator('.detail-rows .money');
  await expect(money).toBeVisible();
  const takes = (await dialog.getByText('يُخصم من رصيد نقطة البيع').count()) > 0;
  const agorot = Math.round(Number((await money.innerText()).replace(/[^\d.]/g, '')) * 100);
  quoted = { amount: takes ? -agorot : agorot, asTask: (await dialog.getByText('يُرسل الفصل مهمة للفرع').count()) > 0 };
  await dialog.getByRole('button', { name: 'فصل', exact: true }).click();
}

const transferTo = (nickname: string) => async (page: Page) => {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('نقل').selectOption({ label: nickname });
  // The dialog asks what happens to the number's renewal price and has no default; this audit keeps it.
  await dialog.getByRole('radio', { name: 'تبقى كما هي' }).check();
  await dialog.getByRole('button', { name: 'نقل', exact: true }).click();
};

async function newestTask(where: { lineId?: string; msisdn?: string }) {
  const rows = await sql<{ id: string; status: string; action: string }>(
    `SELECT id, status, action FROM "OfficeTask" WHERE ${where.lineId ? '"lineId" = $1' : 'msisdn = $1'} ORDER BY "createdAt" DESC LIMIT 1`,
    [where.lineId ?? where.msisdn],
  );
  if (!rows[0]) throw new Error('no task was opened');
  return rows[0];
}

/** The branch takes the task and completes it on the task screen. */
async function completeOnScreen(taskId: string) {
  await admin.goto(`${DOORS.admin}/tasks/${taskId}`);
  await admin.getByRole('button', { name: 'استلام', exact: true }).click();
  await expect(admin.locator('.task-toolbar').getByRole('button', { name: 'إتمام', exact: true })).toBeVisible();
  await admin.locator('.task-toolbar').getByRole('button', { name: 'إتمام', exact: true }).click();
  await admin.getByLabel('ملاحظة الإغلاق').fill('تم عند المزود');
  await admin.locator('.task-close-row').getByRole('button', { name: 'إتمام', exact: true }).click();
  await expect.poll(async () => (await sql<{ status: string }>(`SELECT status FROM "OfficeTask" WHERE id = $1`, [taskId]))[0]?.status).toBe('done');
}

async function newestLine(owner: string): Promise<Line> {
  const rows = await sql<{ id: string; msisdn: string }>(
    `SELECT l.id, l.msisdn FROM "Line" l JOIN "User" u ON u.id = l."posId" WHERE u."loginName" = $1 ORDER BY l."createdAt" DESC LIMIT 1`,
    [owner],
  );
  if (!rows[0]) throw new Error(`no line for ${owner}`);
  return { ...rows[0], owner };
}

async function lineCount(owner: string) {
  const rows = await sql<{ n: string }>(`SELECT count(*) AS n FROM "Line" l JOIN "User" u ON u.id = l."posId" WHERE u."loginName" = $1`, [owner]);
  return Number(rows[0]?.n ?? 0);
}

/** The point of sale activates from its catalog: company, package, then the SIM. */
async function posActivate(pack: Pack, sim: { esim: true } | { iccid: string }) {
  await pos.goto(`${DOORS.pos}/packages`);
  await pos.locator('.company-card', { hasText: pack.company }).click();
  const price = `${Math.floor(pack.posPrice / 100)}.${String(pack.posPrice % 100).padStart(2, '0')} ₪`;
  await pos.locator('.pack-card', { hasText: pack.name }).filter({ hasText: price }).first().click();
  const form = pos.locator('form');
  await expect(form.getByLabel('رقم الخط'), 'the office generates the number; the point of sale does not type it').toHaveCount(0);
  await expect(form.getByRole('group', { name: 'نتيجة المزود' }), 'the point of sale never picks a provider outcome').toHaveCount(0);
  if ('esim' in sim) await form.getByLabel('شريحة إلكترونية').check();
  else await form.getByLabel('رقم الشريحة').fill(sim.iccid);
  await form.getByRole('button', { name: 'تفعيل', exact: true }).click();
  return outcomeText(pos);
}

/** The branch activates from the numbers list dialog for a point of sale. */
async function branchActivate(pack: Pack, posLoginName: string, iccid: string, outcome: 'نجاح' | 'فشل') {
  await admin.goto(`${DOORS.admin}/numbers`);
  await admin.getByRole('button', { name: 'تفعيل رقم' }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('نقطة البيع').selectOption(posLoginName);
  await dialog.getByLabel('الرزمة').selectOption(pack.code);
  await dialog.getByLabel('رقم الشريحة').fill(iccid);
  await pickOutcome(dialog, outcome);
  await dialog.getByRole('button', { name: 'تفعيل', exact: true }).click();
  return outcomeText(admin);
}

async function fundOnScreen(loginName: string, shekels: number, note: string) {
  await admin.goto(`${DOORS.admin}/users`);
  await admin.getByRole('button', { name: `إجراءات ${loginName}`, exact: true }).click();
  await admin.getByRole('menuitem', { name: 'تمويل', exact: true }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('المبلغ').fill(String(shekels));
  await dialog.getByLabel('ملاحظة').fill(note);
  await dialog.getByRole('button', { name: 'تمويل', exact: true }).click();
  return outcomeText(admin);
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ locale: 'ar', viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  admin = await context.newPage();
  pos = await context.newPage();
  await login(admin, 'admin', 'branch');
  await login(pos, 'pos', 'pos');
  await apiCall(admin, 'admin', 'GET', '/office/packages');
  ({ P, Q, M } = await catalog());
  const keys = ['activate', 'charge', 'extend', 'disconnect', 'freeze', 'switch', 'rename', 'sim'];
  for (const pack of [P, Q, M]) {
    for (const action of keys) {
      await apiCall(admin, 'admin', 'PATCH', `/office/packages/${pack.code}/mode`, {
        action,
        mode: pack === M && action === 'activate' ? 'manual' : 'auto',
      });
    }
  }
  await apiCall(admin, 'admin', 'PUT', `/office/packages/${P.code}/switches`, { targets: [Q.code] });
  const made = await sql(`SELECT 1 FROM "User" WHERE "loginName" = 'pos2'`);
  if (made.length === 0) {
    await apiCall(admin, 'admin', 'POST', '/office/users', { loginName: 'pos2', nickname: 'pos2', password: 'audit-pos2-pass', layer: 'pos', parentLoginName: 'agent' });
  }
});

test.afterAll(async () => {
  await closeDb();
});

test('the branch funds itself and the point of sale from the users screen', async () => {
  const branchBefore = await balance('branch');
  expect.soft(await fundOnScreen('branch', 5000, 'تمويل تدقيق')).toBe('تم التمويل');
  expect.soft(await balance('branch') - branchBefore, 'self fund').toBe(500_000);
  expect.soft(await fundOnScreen('pos', 1000, 'رصيد نقطة البيع')).toBe('تم التمويل');
  expect.soft(await balance('pos'), 'the point of sale holds the funded amount').toBe(100_000);
  expect.soft(await balance('branch') - branchBefore, 'the branch paid what it funded').toBe(400_000);
});

test('the point of sale runs every operation on one number from its own screens', async () => {
  test.setTimeout(300_000);
  const before = await lineCount('pos');
  const startBalance = await balance('pos');
  const note = await posActivate(P, { iccid: '8997201000000001' });
  expect.soft(note, 'activate note').toBe(NOTE_DEBITED);
  expect(await lineCount('pos'), 'a line was created').toBe(before + 1);
  const line = await newestLine('pos');
  const created = await snap(line);
  expect.soft(created.balance - startBalance, 'activate debits the subscription price').toBe(-P.posPrice);
  expect.soft(created.entries.map((row) => row.kind), 'activate wallet row').toEqual(['activate']);
  expect.soft(count(created.ops, (row) => row.kind === 'activate'), 'activate in provider operations').toBe(1);
  expect.soft(created.ops.find((row) => row.kind === 'activate')?.cost, 'activate provider cost').toBe(P.branchCost);
  expect.soft(count(created.log, (row) => row.action === 'activate'), 'activate in the number log').toBe(1);
  expect.soft(count(created.finance, (row) => row.kind === 'activate'), 'activate in finance').toBe(1);

  const steps: { label: string; kind: string; delta: () => number; cost?: number; fill?: (page: Page) => Promise<void> }[] = [
    { label: 'تحديث الرقم', kind: 'refresh', delta: () => 0, cost: 0 },
    { label: 'تبديل الشريحة', kind: 'sim', delta: () => 0, cost: 0, fill: swapSimTo('8997201000000002') },
    { label: 'تجميد', kind: 'freeze', delta: () => 0, cost: 0 },
    { label: 'فك تجميد', kind: 'unfreeze', delta: () => 0, cost: 0 },
    {
      label: 'تبديل الرزمة',
      kind: 'switch',
      delta: () => -(share(Q.renewalPosPrice, DAY_SHARE, Q.months) - share(P.posPrice, DAY_SHARE, P.months)),
      fill: switchTo(Q),
    },
    { label: 'فصل', kind: 'disconnect', delta: () => share(Q.renewalPosPrice, DAY_SHARE) - FEE, fill: confirmDisconnect },
    { label: 'شحن', kind: 'charge', delta: () => -Q.posPrice },
  ];
  let last = created;
  for (const step of steps) {
    await test.step(step.label, async () => {
      const text = await onCard(pos, 'pos', line, step.label, { fill: step.fill });
      const after = await snap(line);
      const delta = step.delta();
      expectNote(`pos ${step.kind}`, text, delta);
      expectRecorded(`pos ${step.kind}`, last, after, step.kind, delta, step.cost);
      if (step.kind === 'disconnect') expect.soft(quoted, 'pos disconnect: the dialog showed the amount that moved').toEqual({ amount: delta, asTask: false });
      last = after;
    });
  }
});

test('the point of sale activates an eSIM, extends, then disconnects with every prepaid day refunded', async () => {
  test.setTimeout(180_000);
  const startBalance = await balance('pos');
  expect.soft(await posActivate(P, { esim: true }), 'esim note').toBe(NOTE_DEBITED);
  const line = await newestLine('pos');
  const created = await snap(line);
  expect.soft(created.balance - startBalance, 'eSIM adds its fee').toBe(-(P.posPrice + ESIM));

  const extendText = await onCard(pos, 'pos', line, 'تمديد');
  const extended = await snap(line);
  expectNote('pos extend', extendText, -P.renewalPosPrice);
  expectRecorded('pos extend', created, extended, 'extend', -P.renewalPosPrice);

  const disconnectText = await onCard(pos, 'pos', line, 'فصل', { fill: confirmDisconnect });
  const disconnected = await snap(line);
  const refund = share(P.posPrice, DAY_SHARE) + P.renewalPosPrice - FEE;
  expectNote('pos disconnect after extend', disconnectText, refund);
  expectRecorded('pos disconnect after extend', extended, disconnected, 'disconnect', refund);
  expect.soft(quoted?.amount, 'the dialog showed every paid day').toBe(refund);
});

test('a switch after an extend reprices every paid day, and the disconnect returns them at the new price', async () => {
  test.setTimeout(180_000);
  await posActivate(P, { iccid: '8997201000000007' });
  const line = await newestLine('pos');
  const created = await snap(line);
  await onCard(pos, 'pos', line, 'تمديد');
  const extended = await snap(line);
  expectRecorded('stacked extend', created, extended, 'extend', -P.renewalPosPrice);

  const held = share(P.posPrice, DAY_SHARE) + P.renewalPosPrice;
  const moved = -(share(Q.renewalPosPrice, DAY_SHARE + PERIOD, Q.months) - held);
  const switchText = await onCard(pos, 'pos', line, 'تبديل الرزمة', { fill: switchTo(Q) });
  const switched = await snap(line);
  expectNote('stacked switch', switchText, moved);
  expectRecorded('stacked switch', extended, switched, 'switch', moved);

  const refund = Q.renewalPosPrice + share(Q.renewalPosPrice, DAY_SHARE) - FEE;
  const disconnectText = await onCard(pos, 'pos', line, 'فصل', { fill: confirmDisconnect });
  const disconnected = await snap(line);
  expectNote('disconnect after a stacked switch', disconnectText, refund);
  expectRecorded('disconnect after a stacked switch', switched, disconnected, 'disconnect', refund);
  expect.soft(quoted?.amount, 'the dialog showed the repriced days').toBe(refund);
});

test('the point of sale activates a manual package as a task the branch completes', async () => {
  test.setTimeout(120_000);
  const startBalance = await balance('pos');
  const lines = await lineCount('pos');
  expect.soft(await posActivate(M, { iccid: '8997201000000003' }), 'manual activate note').toBe(NOTE_TASK);
  expect.soft(await balance('pos'), 'no money while the task is open').toBe(startBalance);
  expect.soft(await lineCount('pos'), 'no line while the task is open').toBe(lines);
  const task = await sql<{ id: string; msisdn: string }>(
    `SELECT t.id, t.msisdn FROM "OfficeTask" t WHERE t.action = 'activate' AND t.status = 'pending' ORDER BY t."createdAt" DESC LIMIT 1`,
  );
  expect(task[0], 'an activation task is open').toBeTruthy();
  await completeOnScreen(task[0].id);
  expect.soft(await balance('pos') - startBalance, 'the task debits once').toBe(-M.posPrice);
  const line = await newestLine('pos');
  expect.soft(line.msisdn, 'the line carries the task number').toBe(task[0].msisdn);
  const done = await snap(line);
  expect.soft(done.entries.map((row) => row.kind), 'one activate row').toEqual(['activate']);
  expect.soft(count(done.ops, (row) => row.kind === 'activate'), 'activate in provider operations').toBe(1);
  const again = await admin.request.post(`${DOORS.admin}/api/office/tasks/${task[0].id}/complete`, {
    headers: { 'x-door': new URL(DOORS.admin).host },
    data: { note: 'مرة ثانية' },
  });
  expect.soft(again.ok(), 'completing a done task again is refused').toBe(false);
  expect.soft(await balance('pos') - startBalance, 'still debited once').toBe(-M.posPrice);
});

test('the branch activates for the point of sale, then every failed operation goes through a task', async () => {
  test.setTimeout(480_000);
  const startBalance = await balance('pos');
  expect.soft(await branchActivate(P, 'pos', '8997201000000004', 'نجاح'), 'branch activate note').toBe(NOTE_DEBITED);
  const line = await newestLine('pos');
  let last = await snap(line);
  expect.soft(last.balance - startBalance, 'branch activate debits the point of sale').toBe(-P.posPrice);

  const steps: { label: string; kind: string; delta: () => number; cost?: number; fill?: (page: Page) => Promise<void> }[] = [
    { label: 'تحديث الرقم', kind: 'refresh', delta: () => 0, cost: 0 },
    { label: 'تبديل الشريحة', kind: 'sim', delta: () => 0, cost: 0, fill: swapSimTo('8997201000000005') },
    { label: 'تجميد', kind: 'freeze', delta: () => 0, cost: 0 },
    { label: 'فك تجميد', kind: 'unfreeze', delta: () => 0, cost: 0 },
    {
      label: 'تبديل الرزمة',
      kind: 'switch',
      delta: () => -(share(Q.renewalPosPrice, DAY_SHARE, Q.months) - share(P.posPrice, DAY_SHARE, P.months)),
      fill: switchTo(Q),
    },
    { label: 'فصل', kind: 'disconnect', delta: () => share(Q.renewalPosPrice, DAY_SHARE) - FEE, fill: confirmDisconnect },
    { label: 'شحن', kind: 'charge', delta: () => -Q.posPrice },
  ];
  for (const step of steps) {
    await test.step(`${step.label} fails, then the task`, async () => {
      const text = await onCard(admin, 'admin', line, step.label, { outcome: 'فشل', fill: step.fill });
      expect.soft(text, `branch ${step.kind}: a failed call opens a task`).toBe(NOTE_TASK);
      if (step.kind === 'disconnect') expect.soft(quoted, 'branch disconnect: the dialog said a task opens').toEqual({ amount: step.delta(), asTask: true });
      const held = await snap(line);
      expectHeld(`branch ${step.kind}`, last, held, step.kind);
      const task = await newestTask({ lineId: line.id });
      expect.soft(task.action, `branch ${step.kind}: the task names the operation`).toBe(step.kind);
      await completeOnScreen(task.id);
      const after = await snap(line);
      expectRecorded(`branch ${step.kind} task`, last, after, step.kind, step.delta(), step.cost);
      last = after;
    });
  }

  await test.step('extend succeeds from the branch', async () => {
    const text = await onCard(admin, 'admin', line, 'تمديد', { outcome: 'نجاح' });
    const after = await snap(line);
    expectNote('branch extend', text, -Q.renewalPosPrice);
    expectRecorded('branch extend', last, after, 'extend', -Q.renewalPosPrice);
    last = after;
  });

  await test.step('transfer to another point of sale', async () => {
    const text = await onCard(admin, 'admin', line, 'نقل', { fill: transferTo('pos2') });
    expect.soft(text, 'transfer note').not.toBe(NOTE_DEBITED);
    const after = await snap(line);
    expectRecorded('branch transfer', last, after, 'transfer', 0, 0);
    expect.soft(await balance('pos2'), 'the new point of sale is not charged').toBe(0);
    const owner = await sql<{ loginName: string }>(
      `SELECT u."loginName" FROM "Line" l JOIN "User" u ON u.id = l."posId" WHERE l.id = $1`,
      [line.id],
    );
    expect.soft(owner[0]?.loginName, 'the line now belongs to pos2').toBe('pos2');
  });
});

test('a failed branch activation opens a task and the line appears only when it is done', async () => {
  test.setTimeout(120_000);
  const startBalance = await balance('pos');
  const lines = await lineCount('pos');
  expect.soft(await branchActivate(P, 'pos', '8997201000000006', 'فشل'), 'failed activate note').toBe(NOTE_TASK);
  expect.soft(await balance('pos'), 'no money while the task is open').toBe(startBalance);
  expect.soft(await lineCount('pos'), 'no line while the task is open').toBe(lines);
  const task = await sql<{ id: string }>(
    `SELECT id FROM "OfficeTask" WHERE action = 'activate' AND status = 'pending' ORDER BY "createdAt" DESC LIMIT 1`,
  );
  await completeOnScreen(task[0].id);
  expect.soft(await balance('pos') - startBalance, 'the task debits once').toBe(-P.posPrice);
  expect.soft(await lineCount('pos'), 'the line exists after the task').toBe(lines + 1);
});

test('a company SIM rule set on the company page holds on activation and SIM swap', async () => {
  test.setTimeout(180_000);
  const LENGTH = 19;
  const PREFIX = '8997202';
  const good = (n: number) => `${PREFIX}${String(n).padStart(LENGTH - PREFIX.length, '0')}`;
  try {
    await admin.goto(`${DOORS.admin}/companies/${P.companyCode}`);
    await expect(admin.getByRole('tab', { name: 'إعدادات الشركة', exact: true })).toHaveAttribute('aria-selected', 'true');
    await admin.getByLabel('عدد خانات الشريحة').fill(String(LENGTH));
    await admin.getByLabel('مقدّمة الشريحة').fill(PREFIX);
    await admin.getByLabel('تقبل الشريحة الإلكترونية').uncheck();
    await expect(admin.locator('.sim-sample bdi')).toHaveText(`${PREFIX}${'•'.repeat(LENGTH - PREFIX.length)}`);
    await admin.getByRole('button', { name: 'حفظ', exact: true }).click();
    expect.soft(await outcomeText(admin), 'the company page confirms the save').toBe('حُفظت إعدادات الشركة.');
    const stored = await sql<{ iccidLength: number | null; iccidPrefix: string | null; esim: boolean }>(
      `SELECT "iccidLength", "iccidPrefix", esim FROM "Company" WHERE code = $1`,
      [P.companyCode],
    );
    expect.soft(stored[0], 'the rule is stored on the company').toEqual({ iccidLength: LENGTH, iccidPrefix: PREFIX, esim: false });

    const startBalance = await balance('pos');
    const body = { packageCode: P.code, posLoginName: 'pos', msisdn: '', currentDetails: '', outcome: 'success' };
    await expect(apiCall(pos, 'pos', 'POST', '/office/lines', { ...body, esim: false, iccid: `${PREFIX}0001` }), 'short SIM').rejects.toThrow(/400 .*SIM_LENGTH/);
    await expect(apiCall(pos, 'pos', 'POST', '/office/lines', { ...body, esim: false, iccid: good(1).replace(PREFIX, '8997201') }), 'other prefix').rejects.toThrow(/400 .*SIM_PREFIX/);
    await expect(apiCall(pos, 'pos', 'POST', '/office/lines', { ...body, esim: true, iccid: '' }), 'eSIM where the company has none').rejects.toThrow(/400 .*ESIM_UNSUPPORTED/);
    expect.soft(await balance('pos'), 'a refused SIM moves no money').toBe(startBalance);

    await pos.goto(`${DOORS.pos}/packages`);
    await pos.locator('.company-card', { hasText: P.company }).click();
    const price = `${Math.floor(P.posPrice / 100)}.${String(P.posPrice % 100).padStart(2, '0')} ₪`;
    await pos.locator('.pack-card', { hasText: P.name }).filter({ hasText: price }).first().click();
    const form = pos.locator('form');
    const field = form.getByLabel('رقم الشريحة');
    const submit = form.getByRole('button', { name: 'تفعيل', exact: true });
    await expect(field, 'the SIM field starts with the company prefix').toHaveValue(PREFIX);
    await expect(form.getByText(`${LENGTH} خانة، تبدأ بـ ${PREFIX}`), 'the form names the rule').toBeVisible();
    await expect(form.getByLabel('شريحة إلكترونية'), 'no eSIM choice for this company').toHaveCount(0);
    await expect(submit, 'an unfinished SIM cannot be sent').toBeDisabled();
    await field.fill(good(1).replace(PREFIX, '8997201'));
    await expect(submit, 'a SIM with another prefix cannot be sent').toBeDisabled();
    await field.fill(good(1));
    await expect(submit).toBeEnabled();
    await submit.click();
    expect.soft(await outcomeText(pos), 'a fitting SIM activates').toBe(NOTE_DEBITED);
    const line = await newestLine('pos');
    expect.soft((await lineByMsisdn(line.msisdn))?.iccid, 'the line holds the typed SIM').toBe(good(1));

    await expect(apiCall(pos, 'pos', 'POST', `/office/lines/${line.id}/sim`, { iccid: good(2).replace(PREFIX, '8997201'), outcome: 'success' }), 'swap to another prefix')
      .rejects.toThrow(/400 .*SIM_PREFIX/);
    const note = await onCard(pos, 'pos', line, 'تبديل الشريحة', {
      fill: async (page) => {
        const dialog = page.getByRole('dialog');
        const next = dialog.getByLabel('الشريحة الجديدة');
        const swap = dialog.getByRole('button', { name: 'تبديل الشريحة', exact: true });
        await expect(next, 'the new SIM starts with the company prefix').toHaveValue(PREFIX);
        await expect(dialog.getByText(`${LENGTH} خانة، تبدأ بـ ${PREFIX}`)).toBeVisible();
        await expect(swap).toBeDisabled();
        await next.fill(good(2));
        await swap.click();
      },
    });
    expect.soft(note, 'a fitting SIM swaps').toBe(NOTE_DONE);
    expect.soft((await lineByMsisdn(line.msisdn))?.iccid, 'the line holds the new SIM').toBe(good(2));
  } finally {
    await apiCall(admin, 'admin', 'PUT', `/office/companies/${P.companyCode}/sim`, { length: null, prefix: '', esim: true });
  }
});
