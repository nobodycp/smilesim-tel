import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// Line add-ons (spec 2026-11-09-offers-tasks-addons-wallet-esim, 3): named on the package, asked for on a number's
// card, each becoming a manual task.
const admin = 'http://admin.localhost:3910';
const line = {
  id: 'ln1', msisdn: '0550000001', iccid: null, esim: false, status: 'active', packageCode: 'cell-400', packageName: '400 جيجا',
  companyName: 'سلكوم', posLoginName: 'pos', posPrice: 26, createdAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-12-12T00:00:00.000Z',
  addons: [{ id: 'ad1', name: '10 جيجا إضافية', price: 1500 }, { id: 'ad2', name: 'تجوال أسبوع', price: 2500 }],
};

test('a number asks for one of its package\'s extra operations, which becomes a task', async ({ page }) => {
  const sent: unknown[] = [];
  await serveOffice(page, 'branch', {
    'GET /lines/ln1': () => ({ body: { line, history: [] } }),
    'GET /packages': () => ({ body: { packages: [], companies: [] } }),
    'GET /users': () => ({ body: { users: [] } }),
    'POST /lines/ln1/addon': () => ({ body: { applied: false, taskId: 't9' } }),
  });
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/office/lines/ln1/addon')) sent.push(request.postDataJSON());
  });
  await page.goto(`${admin}/numbers/ln1`);
  await page.getByRole('button', { name: 'العمليات الإضافية' }).click();
  const dialog = page.getByRole('dialog', { name: 'العمليات الإضافية' });
  await expect(dialog.getByRole('radio')).toHaveCount(2);
  await dialog.getByRole('radio', { name: /تجوال أسبوع/ }).check();
  await expect(dialog).toContainText('25.00 ₪');
  await dialog.getByRole('button', { name: 'اطلب العملية' }).click();
  await expect.poll(() => sent).toEqual([{ addonId: 'ad2' }]);
});

test('a number with no extra operations shows no such tile', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /lines/ln1': () => ({ body: { line: { ...line, addons: [] }, history: [] } }),
    'GET /packages': () => ({ body: { packages: [], companies: [] } }),
    'GET /users': () => ({ body: { users: [] } }),
  });
  await page.goto(`${admin}/numbers/ln1`);
  await expect(page.locator('.line-op-grid').getByRole('button', { name: 'تمديد', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'العمليات الإضافية' })).toHaveCount(0);
});
