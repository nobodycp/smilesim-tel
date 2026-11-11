import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// Session rules (spec 2026-11-08-session-rules): the branch owner sets them per layer on «قواعد الدخول» (spec
// 2026-11-09-admin-review, 5; out of the owner's own settings) and per account on the user page; an empty choice
// follows the next level.

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const none = { maxSessions: null, sessionMinutes: null };
const listed = {
  loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos', roleName: '', parentLoginName: 'admin', balance: 0, ceiling: 0, frozen: false,
  self: false, directChild: true, canEnter: true, canFreeze: true, canDelete: true, held: 0,
};
const account = {
  loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos', parentLoginName: 'admin', frozen: false, isBranchOwner: false, staff: false,
  roleId: '', roleName: '', roleGrants: [], extraGrants: [], deniedGrants: [], extraRoleIds: [], grants: [], roles: [], canEdit: true, listed,
};

test('the owner sets a layer’s sessions and idle time on that layer\'s role', async ({ page }) => {
  const saved: unknown[] = [];
  const posRole = { id: 'r-pos', name: 'pos', kind: 'layer', layer: 'pos', grants: ['read'], read: true, edit: false, accounting: false, tasks: false, reports: false, staff: false, enter: false };
  await serveOffice(page, 'branch', {
    'GET /roles': () => ({ body: { roles: [posRole] } }),
    'PUT /roles/r-pos': () => ({ body: { ok: true } }),
  });
  await page.route('**/auth/session-rules', (route) => route.fulfill(json({ defaults: { maxSessions: 3, sessionMinutes: 360 }, layers: { branch: none, main_agent: none, agent: none, pos: none } })));
  await page.route('**/auth/session-rules/pos', (route) => {
    saved.push(route.request().postDataJSON());
    return route.fulfill(json({ layers: {} }));
  });
  // The layer's defaults live on its role (spec 2026-11-09-admin-review, 6.1); «قواعد الدخول» is gone.
  await page.goto('http://admin.localhost:3910/settings/access');
  await expect(page).toHaveURL(/\/roles$/);
  await expect(page.locator('.sidebar').getByRole('link', { name: 'قواعد الدخول' })).toHaveCount(0);
  await page.getByRole('button', { name: /إجراءات نقطة بيع/ }).click();
  await page.getByRole('menuitem').first().click();
  const dialog = page.getByRole('dialog');
  const group = dialog.getByRole('group', { name: 'الجلسات حسب الطبقة' });
  // Number fields, not lists (owner 2026-11-11): a count and hours; empty follows the default, shown as placeholder.
  await expect(group.getByLabel('تنتهي بعد عدم نشاط (ساعات)')).toHaveAttribute('placeholder', 'الافتراضي (6 ساعات)');
  await group.getByLabel('الجلسات المسموحة').fill('1');
  await group.getByLabel('تنتهي بعد عدم نشاط (ساعات)').fill('0.5');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => saved).toEqual([{ maxSessions: 1, sessionMinutes: 30 }]);
});

test('the owner\'s own settings hold only the account: no layer rules there any more', async ({ page }) => {
  await serveOffice(page, 'branch');
  await page.route('**/auth/session-rules', (route) => route.fulfill(json({ defaults: { maxSessions: 3, sessionMinutes: 360 }, layers: { branch: none, main_agent: none, agent: none, pos: none } })));
  await page.goto('http://admin.localhost:3910/settings');
  await expect(page.getByRole('heading', { name: 'الجلسات', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'الجلسات حسب الطبقة' })).toHaveCount(0);
});

test('the owner edits one account from its page\'s «إعدادات الحساب»: contact, two-step and its own session values', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /users/pos1': () => ({ body: account }),
    'GET /users/pos1/packages': () => ({ body: { summary: { total: 0, visible: 0, custom: 0 }, companies: [] } }),
    'GET /users/pos1/ops': () => ({ body: { denied: [], deniedAbove: [] } }),
  });
  const saved: unknown[] = [];
  const contact: unknown[] = [];
  const modes: unknown[] = [];
  let settings = {
    loginName: 'pos1', email: 'shop@example.com', phone: '', twoFactorEnabled: false, twoFactorExempt: true, twoFactorMethod: 'app',
    twoFactorMode: 'optional', requiredMethod: null, effective: { required: false, method: null as string | null },
  };
  const rule = { required: false, method: 'app' };
  await page.route('**/auth/policy', (route) => route.fulfill(json({ policy: { branch: rule, main_agent: rule, agent: rule, pos: rule } })));
  await page.route('**/auth/users/pos1/settings', (route) => route.fulfill(json(settings)));
  await page.route('**/auth/users/pos1/contact', (route) => {
    contact.push(route.request().postDataJSON());
    settings = { ...settings, ...(route.request().postDataJSON() as object) };
    return route.fulfill(json(settings));
  });
  await page.route('**/auth/users/pos1/two-factor', (route) => {
    const body = route.request().postDataJSON() as { mode: string };
    modes.push(body);
    settings = { ...settings, twoFactorMode: body.mode, twoFactorExempt: body.mode === 'optional', effective: { required: body.mode === 'required', method: body.mode === 'required' ? 'app' : null } };
    return route.fulfill(json({ settings, endedAccounts: 0 }));
  });
  await page.route('**/auth/users/pos1/session-rules', (route) => {
    if (route.request().method() === 'PATCH') {
      saved.push(route.request().postDataJSON());
      return route.fulfill(json({ own: { maxSessions: 2, sessionMinutes: null }, layer: { maxSessions: 3, sessionMinutes: 360 }, effective: { maxSessions: 2, sessionMinutes: 360 } }));
    }
    return route.fulfill(json({ own: none, layer: { maxSessions: 3, sessionMinutes: 360 }, effective: { maxSessions: 3, sessionMinutes: 360 } }));
  });
  await page.goto('http://admin.localhost:3910/users/pos1');
  // No dialog behind a menu (spec 2026-11-11-ui-consistency-pass, D3): the settings are the open top of the last tab.
  await page.getByRole('tab', { name: 'الإعدادات والصلاحيات' }).click();
  const pane = page.getByRole('region', { name: 'إعدادات الحساب' });
  await expect(pane.getByLabel('البريد')).toHaveValue('shop@example.com');
  await expect(pane.getByText('غير مفعّل')).toBeVisible();

  // Two-step: a three-way choice; the method list shows only while «إلزامي» is chosen.
  await expect(pane.getByText('المطبّق الآن: اختياري')).toBeVisible();
  await expect(pane.getByLabel('الطريقة')).toHaveCount(0);
  await pane.getByRole('radio', { name: 'إلزامي' }).click();
  await expect(pane.getByLabel('الطريقة')).toBeVisible();

  await expect(pane.getByLabel('الجلسات المسموحة')).toHaveAttribute('placeholder', 'حسب الطبقة (3)');
  await expect(pane.getByText('المطبّق الآن: الجلسات المسموحة 3 · 6 ساعات')).toBeVisible();
  await pane.getByLabel('الهاتف').fill('0501234567');
  await pane.getByLabel('الجلسات المسموحة').fill('2');
  await pane.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('حُفظت إعدادات الحساب')).toBeVisible();
  // The permissions sit folded under the settings.
  await expect(page.locator('details.access-fold')).not.toHaveAttribute('open', '');
  expect(contact).toEqual([{ phone: '0501234567' }]);
  expect(modes).toEqual([{ mode: 'required', method: null }]);
  expect(saved).toEqual([{ maxSessions: 2, sessionMinutes: null }]);
});
