import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// Session rules (spec 2026-11-08-session-rules): the branch owner sets them per layer in settings and per account on
// the user page; an empty choice follows the next level.

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const none = { maxSessions: null, sessionMinutes: null };
const listed = {
  loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos', roleName: '', parentLogin: 'admin', balance: 0, ceiling: 0, frozen: false,
  self: false, directChild: true, canEnter: true, canFreeze: true, canDelete: true, held: 0,
};
const account = {
  loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos', parentLogin: 'admin', frozen: false, isBranchOwner: false, staff: false,
  roleId: '', roleName: '', roleGrants: [], extraGrants: [], deniedGrants: [], extraRoleIds: [], grants: [], roles: [], canEdit: true, listed,
};

test('the owner sets a layer’s sessions and idle time in settings', async ({ page }) => {
  await serveOffice(page, 'branch');
  const saved: unknown[] = [];
  await page.route('**/auth/session-rules', (route) => route.fulfill(json({ defaults: { maxSessions: 3, sessionMinutes: 360 }, layers: { branch: none, main_agent: none, agent: none, pos: none } })));
  await page.route('**/auth/session-rules/pos', (route) => {
    saved.push(route.request().postDataJSON());
    return route.fulfill(json({ layers: {} }));
  });
  await page.goto('http://admin.localhost:3910/settings');
  const pane = page.locator('.pane', { has: page.getByRole('heading', { name: 'الجلسات حسب الطبقة' }) });
  const row = pane.locator('li', { hasText: 'نقطة بيع' });
  await expect(row.getByLabel('تنتهي بعد عدم نشاط')).toHaveValue('');
  await expect(row.getByLabel('تنتهي بعد عدم نشاط').locator('option').first()).toHaveText('الافتراضي (6 ساعات)');
  await expect(row.getByRole('button', { name: 'حفظ' })).toBeDisabled();
  await row.getByLabel('الجلسات المسموحة').selectOption('1');
  await row.getByLabel('تنتهي بعد عدم نشاط').selectOption('30');
  await row.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم حفظ قواعد الجلسات')).toBeVisible();
  expect(saved).toEqual([{ maxSessions: 1, sessionMinutes: 30 }]);
});

test('settings shows no session rules to an account that is not the branch owner', async ({ page }) => {
  await serveOffice(page, 'pos');
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'الجلسات', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'الجلسات حسب الطبقة' })).toHaveCount(0);
});

test('the owner gives one account its own values from the user page', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /users/pos1': () => ({ body: account }),
    'GET /users/pos1/packages': () => ({ body: { summary: { total: 0, visible: 0, custom: 0 }, companies: [] } }),
    'GET /users/pos1/ops': () => ({ body: { denied: [], deniedAbove: [] } }),
  });
  const saved: unknown[] = [];
  await page.route('**/auth/users/pos1/session-rules', (route) => {
    if (route.request().method() === 'PATCH') {
      saved.push(route.request().postDataJSON());
      return route.fulfill(json({ own: { maxSessions: 2, sessionMinutes: null }, layer: { maxSessions: 3, sessionMinutes: 360 }, effective: { maxSessions: 2, sessionMinutes: 360 } }));
    }
    return route.fulfill(json({ own: none, layer: { maxSessions: 3, sessionMinutes: 360 }, effective: { maxSessions: 3, sessionMinutes: 360 } }));
  });
  await page.goto('http://admin.localhost:3910/users/pos1');
  await page.locator('.page-head').getByRole('button', { name: 'إجراءات أخرى' }).click();
  await page.getByRole('menuitem', { name: 'الجلسات' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('الجلسات المسموحة').locator('option').first()).toHaveText('حسب الطبقة (3)');
  await expect(dialog.getByText('المطبّق الآن: الجلسات المسموحة 3 · 6 ساعات')).toBeVisible();
  await dialog.getByLabel('الجلسات المسموحة').selectOption('2');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('تم حفظ قواعد الجلسات')).toBeVisible();
  expect(saved).toEqual([{ maxSessions: 2, sessionMinutes: null }]);
});
