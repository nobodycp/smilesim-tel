import { expect, test, type Page } from '@playwright/test';
import { serveOffice } from './desk';

// The result of an activation made at once (plan 2026-11-10-activation-settlement, S.5c web step): the eSIM code
// shown is the one the answer of `POST /office/lines` carries. No detail is asked for, no list row is read for it
// (the list is served WITHOUT `esimQr`), and nothing of it stays once the result is closed.

const QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const listRow = {
  id: 'old1', msisdn: '0550000001', iccid: '8997202000000000001', esim: true, status: 'active', suspended: false,
  packageCode: 'cell-400', packageName: '400 جيجا', companyName: 'سلكوم', posLoginName: 'pos', posPrice: 30,
  createdAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-12-12T00:00:00.000Z',
};
const pack = { code: 'cell-400', name: '400 جيجا', companyName: 'سلكوم', providerName: 'سكاي', sellable: true, activateInput: 'generated', sim: { length: null, prefix: '', esim: true } };

/** Serves the numbers page for the branch; `answer` is what `POST /office/lines` gives. Returns the calls and the bodies sent. */
async function serve(page: Page, answer: unknown) {
  const sent: unknown[] = [];
  const calls = await serveOffice(page, 'branch', {
    'GET /lines': () => ({ body: { items: [listRow], total: 1, nextCursor: null, poses: [{ loginName: 'pos', nickname: 'نقطة بيع' }] } }),
    'GET /packages': () => ({ body: { packages: [pack], companies: [] } }),
    'POST /lines': () => ({ body: answer }),
    'GET /home': () => ({ body: { pendingTasks: 0, activeLines: 1, inactiveLines: 0, expiringLines: 0, operations: [] } }),
  });
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/office/lines')) sent.push(request.postDataJSON());
  });
  await page.goto('http://admin.localhost:3910/numbers');
  await expect(page.locator('table.data tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'تفعيل رقم' }).first().click();
  await expect(page.locator('#activate-line')).toBeVisible();
  return { calls, sent };
}
const result = (page: Page) => page.locator('.dialog-result');

test('an eSIM activated at once shows the code its own answer carries, asks for no detail, and keeps nothing once closed', async ({ page }) => {
  const { calls, sent } = await serve(page, { applied: true, debited: true, line: { id: 'new1', msisdn: '0550000099', iccid: '8997202000000000099', esim: true, esimQr: QR } });
  await page.locator('#activate-line label.check').click();
  await expect(page.locator('#activate-line').getByRole('checkbox', { name: 'eSIM' })).toBeChecked();
  await page.getByRole('button', { name: 'تفعيل', exact: true }).click();

  await expect(result(page)).toBeVisible();
  await expect(result(page)).toContainText('تم التفعيل');
  await expect(result(page).locator('.qr-tile img')).toHaveAttribute('src', QR);
  await expect(result(page)).toContainText('0550000099');
  await expect(result(page)).toContainText('8997202000000000099');
  await expect(result(page)).toContainText('eSIM');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ esim: true, packageCode: 'cell-400', posLoginName: 'pos' });
  // The code came with the answer: no line's detail was asked for, for the new line or any other.
  expect(calls.filter((call) => /^GET \/lines\/[^?]+/.test(call))).toEqual([]);

  // Closed: the result leaves, and nothing of the code is left on the page, in the address or in storage.
  await result(page).getByRole('button', { name: 'موافق' }).last().click();
  await expect(result(page)).toHaveCount(0);
  await expect(page).toHaveURL('http://admin.localhost:3910/');
  const kept = await page.evaluate(() => ({
    html: document.documentElement.outerHTML,
    local: JSON.stringify(Object.entries(localStorage)),
    session: JSON.stringify(Object.entries(sessionStorage)),
    address: location.href,
  }));
  for (const text of Object.values(kept)) expect(text).not.toContain(QR.slice(30));
  // Back on the numbers page, the result does not come back and no code is on screen.
  await page.goto('http://admin.localhost:3910/numbers');
  await expect(page.locator('table.data tbody tr')).toHaveCount(1);
  await expect(result(page)).toHaveCount(0);
  await expect(page.locator('.qr-tile')).toHaveCount(0);
  expect(calls.filter((call) => /^GET \/lines\/[^?]+/.test(call))).toEqual([]);
});

test('a plain SIM activated at once shows its number and serial, and no QR', async ({ page }) => {
  const { calls, sent } = await serve(page, { applied: true, debited: true, line: { id: 'new2', msisdn: '0550000088', iccid: '8997202000000000088', esim: false, esimQr: null } });
  await page.locator('#activate-line').getByLabel('رقم الشريحة').fill('8997202000000000088');
  await page.getByRole('button', { name: 'تفعيل', exact: true }).click();

  await expect(result(page)).toBeVisible();
  await expect(result(page)).toContainText('تم التفعيل');
  await expect(result(page)).toContainText('0550000088');
  await expect(result(page)).toContainText('8997202000000000088');
  await expect(result(page).locator('.facts, dl').first()).toContainText('SIM');
  await expect(result(page).locator('.qr-tile')).toHaveCount(0);
  expect(sent[0]).toMatchObject({ esim: false, iccid: '8997202000000000088' });
  expect(calls.filter((call) => /^GET \/lines\/[^?]+/.test(call))).toEqual([]);
});

test('an activation that became a branch task says so and shows no code', async ({ page }) => {
  await serve(page, { applied: false, taskId: 't9' });
  await page.locator('#activate-line label.check').click();
  await expect(page.locator('#activate-line').getByRole('checkbox', { name: 'eSIM' })).toBeChecked();
  await page.getByRole('button', { name: 'تفعيل', exact: true }).click();
  await expect(result(page)).toContainText('أُرسل التفعيل للفرع');
  await expect(result(page).locator('.qr-tile')).toHaveCount(0);
});
