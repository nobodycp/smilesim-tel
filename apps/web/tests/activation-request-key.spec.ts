import { expect, test, type Page } from '@playwright/test';
import { serveOffice, type Reply } from './desk';

// The request key of an activation (ADR 0019, D14; plan 2026-11-10-activation-settlement, S.6 web step). Each
// activation is sent with its own `Idempotency-Key`. Sending the same activation again, after an answer that was
// lost or a refusal, reuses the key, so the API answers with the first task instead of opening a second one. A
// changed form is another activation and has another key; so has the next activation after one that succeeded.

const pack = {
  code: 'cell-400', name: '400 جيجا', companyName: 'سلكوم', providerName: 'سكاي', sellable: true, canActivate: true, activateInput: 'generated',
  sim: { length: null, prefix: '', esim: true }, price: 35, esimPrice: 0, dataGb: 400, smsCount: null, minutes: null, details: '', months: 1,
  sellPrice: null, sellRenewalPrice: null,
};
const opened = { applied: false, taskId: 'task-1' };
const down: Reply = { status: 500, body: { message: 'خطأ', code: 'GENERIC' } };

/** Serves a page with an activation form; `answers` are what `POST /office/lines` gives, in order (the last repeats). */
async function serve(page: Page, layer: 'branch' | 'pos', answers: Reply[]) {
  const sent: { key: string | undefined; body: Record<string, unknown> }[] = [];
  let at = 0;
  await serveOffice(page, layer, {
    'GET /lines': () => ({ body: { items: [], total: 0, nextCursor: null, poses: [{ loginName: 'pos', nickname: 'نقطة بيع' }] } }),
    'GET /packages': () => ({ body: { packages: [pack], companies: [] } }),
    'POST /lines': () => answers[Math.min(at++, answers.length - 1)],
    'GET /home': () => ({ body: { pendingTasks: 0, activeLines: 0, inactiveLines: 0, expiringLines: 0, operations: [] } }),
  });
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/office/lines')) sent.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
  });
  return sent;
}

const form = (page: Page) => page.locator('#activate-line');
const submit = (page: Page) => page.getByRole('button', { name: 'تفعيل', exact: true }).click();
async function openForm(page: Page) {
  await page.getByRole('button', { name: 'تفعيل رقم' }).first().click();
  await expect(form(page)).toBeVisible();
}
const serialField = (page: Page) => form(page).getByLabel('رقم الشريحة');

test('an activation sent again carries the same key; the next activation carries a new one', async ({ page }) => {
  const sent = await serve(page, 'branch', [down, { body: opened }]);
  await page.goto('http://admin.localhost:3910/numbers');
  await openForm(page);
  await serialField(page).fill('8997202000000000011');
  await submit(page);
  await expect.poll(() => sent.length).toBe(1);
  // The answer was an error: the form stays, and the same activation is sent again as it is.
  await expect(form(page)).toBeVisible();
  await submit(page);
  await expect.poll(() => sent.length).toBe(2);
  await expect(form(page)).toHaveCount(0);

  expect(sent[0].key).toMatch(/^[A-Za-z0-9._:-]{8,120}$/);
  expect(sent[1].key).toBe(sent[0].key);
  expect(sent[1].body).toEqual(sent[0].body);

  // It was answered: the next activation is another one, even with the very same serial typed again. Closing the
  // result leaves for the home page, so the form is opened anew.
  await page.locator('.dialog-result').getByRole('button', { name: 'موافق' }).last().click();
  await expect(page).toHaveURL('http://admin.localhost:3910/');
  await page.goto('http://admin.localhost:3910/numbers');
  await openForm(page);
  await serialField(page).fill('8997202000000000011');
  await submit(page);
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2].body).toEqual(sent[0].body);
  expect(sent[2].key).toMatch(/^[A-Za-z0-9._:-]{8,120}$/);
  expect(sent[2].key).not.toBe(sent[0].key);
});

test('a form changed after a refusal is another activation, with another key', async ({ page }) => {
  const sent = await serve(page, 'branch', [{ status: 409, body: { message: 'x', code: 'SIM_TAKEN' } }, { body: opened }]);
  await page.goto('http://admin.localhost:3910/numbers');
  await openForm(page);
  await serialField(page).fill('8997202000000000011');
  await submit(page);
  await expect.poll(() => sent.length).toBe(1);
  await serialField(page).fill('8997202000000000022');
  await submit(page);
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1].body.iccid).toBe('8997202000000000022');
  expect(sent[1].key).toBeTruthy();
  expect(sent[1].key).not.toBe(sent[0].key);
});

test('the key is kept nowhere but the page’s memory', async ({ page }) => {
  const sent = await serve(page, 'branch', [down]);
  await page.goto('http://admin.localhost:3910/numbers');
  await openForm(page);
  await serialField(page).fill('8997202000000000011');
  await submit(page);
  await expect.poll(() => sent.length).toBe(1);
  const key = sent[0].key ?? 'no key was sent';
  const kept = await page.evaluate(() => `${document.documentElement.outerHTML}\n${JSON.stringify(Object.entries(localStorage))}\n${JSON.stringify(Object.entries(sessionStorage))}\n${location.href}`);
  expect(kept).not.toContain(key);
});

test('the point of sale’s own activation form does the same', async ({ page }) => {
  const sent = await serve(page, 'pos', [down, { body: opened }, { body: { ...opened, taskId: 'task-2' } }]);
  await page.goto('http://pos.localhost:3910/packages');
  await page.locator('.company-card').first().click();
  await page.locator('.pack-card').first().click();
  const join = page.locator('form.pane');
  const serial = join.getByLabel('رقم الشريحة');
  await serial.fill('8997202000000000011');
  await join.getByRole('button', { name: 'تفعيل', exact: true }).click();
  await expect.poll(() => sent.length).toBe(1);
  await join.getByRole('button', { name: 'تفعيل', exact: true }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[0].key).toMatch(/^[A-Za-z0-9._:-]{8,120}$/);
  expect(sent[1].key).toBe(sent[0].key);
  // Answered: the same serial typed again is a new activation. Closing the result leaves for the home page.
  await page.locator('.dialog-result').getByRole('button', { name: 'موافق' }).last().click();
  await expect(page).toHaveURL('http://pos.localhost:3910/');
  await page.goto('http://pos.localhost:3910/packages');
  await page.locator('.company-card').first().click();
  await page.locator('.pack-card').first().click();
  await serial.fill('8997202000000000011');
  await join.getByRole('button', { name: 'تفعيل', exact: true }).click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2].key).toBeTruthy();
  expect(sent[2].key).not.toBe(sent[0].key);
});
