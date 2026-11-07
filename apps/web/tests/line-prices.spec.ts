import { expect, test } from '@playwright/test';
import { serveOffice, type Routes } from './desk';

const admin = 'http://admin.localhost:3910';

// The user page, opened by the agent that owns the point of sale: the packages tab is its to edit.
const account = {
  loginName: 'pos', nickname: 'نقطة بيع', layer: 'pos', parentLogin: 'agent1', frozen: false, isBranchOwner: false, staff: false,
  roleId: '', roleName: '', roleGrants: [], extraGrants: [], deniedGrants: [], extraRoleIds: [], grants: [], roles: [], canEdit: true,
};

const row = (code: string, name: string, patch: Record<string, unknown> = {}) => ({
  code, name, dataGb: 150, months: 1, companyCode: 'wecom', hidden: false, hiddenAbove: null,
  parentBuy: 3000, parentRenewalBuy: 2700, price: null, renewalPrice: null, effective: 3500, renewalEffective: 3200, source: 'layer', lines: 150,
  ...patch,
});

const userSheet = (...packages: ReturnType<typeof row>[]) => ({
  summary: { total: packages.length, visible: packages.length, custom: 0 },
  companies: [{ code: 'wecom', name: 'ويكوم', packages }],
});

const grouped = { current: 3500, groups: [{ price: 3500, count: 20 }, { price: 4100, count: 30 }, { price: 4500, count: 100 }] };

function userRoutes(): Routes {
  return {
    'GET /users/pos': () => ({ body: account }),
    'GET /users/pos/packages': () => ({ body: userSheet(row('lian-wecom-150', '150 جيجا')) }),
    'GET /packages/lian-wecom-150/line-prices': () => ({ body: grouped }),
    'PUT /packages/lian-wecom-150/line-prices': () => ({ body: { ok: true, lines: 50 } }),
  };
}

async function openFromUserPage(page: import('@playwright/test').Page) {
  await page.goto('http://agent.localhost:3910/users/pos');
  await page.getByRole('tab', { name: 'الرزم والأسعار' }).click();
  await page.getByRole('button', { name: 'إجراءات 150 جيجا' }).click();
  await page.getByRole('menuitem', { name: 'أسعار الأرقام القائمة' }).click();
  return page.getByRole('dialog');
}

test('the user page groups existing numbers and saves two new prices', async ({ page }) => {
  const calls = await serveOffice(page, 'agent', userRoutes());
  const dialog = await openFromUserPage(page);

  await expect(dialog.locator('table.data tbody tr')).toHaveCount(3);
  await expect(dialog.locator('tbody tr').nth(2).locator('td').nth(1)).toHaveText('100');
  await expect(dialog.getByRole('button', { name: 'حفظ' })).toBeDisabled();
  // The table fills the dialog body: nothing is pinned to a strip.
  const table = await dialog.locator('table.data').boundingBox();
  const body = await dialog.locator('.dialog-body').boundingBox();
  expect(table?.width ?? 0).toBeGreaterThan((body?.width ?? 0) - 40);

  const put = page.waitForRequest((r) => r.method() === 'PUT' && r.url().endsWith('/line-prices'));
  await dialog.locator('tbody tr').nth(1).getByRole('textbox').fill('39');
  await dialog.locator('tbody tr').nth(1).getByRole('textbox').press('Enter');
  await dialog.locator('tbody tr').nth(0).getByRole('textbox').fill('37');
  await dialog.locator('tbody tr').nth(0).getByRole('textbox').press('Enter');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  expect((await put).postDataJSON()).toEqual({ scope: 'pos', groups: [{ from: 3500, to: 3700 }, { from: 4100, to: 3900 }] });
  await expect(page.getByText('تم تحديث 50 رقماً')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => calls.filter((call) => call === 'GET /users/pos/packages').length).toBeGreaterThan(1);
});

test('follow the current price fills every row', async ({ page }) => {
  await serveOffice(page, 'agent', userRoutes());
  const dialog = await openFromUserPage(page);

  await expect(dialog.locator('table.data tbody tr')).toHaveCount(3);
  await expect(dialog.getByText('الحالي', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'اتباع السعر الحالي (35.00 ₪)' }).click();
  await expect(dialog.getByText('الحالي', { exact: true })).toHaveCount(3);
  await expect(dialog.locator('tbody tr').nth(1).getByRole('textbox')).toHaveAttribute('placeholder', '35');

  const put = page.waitForRequest((r) => r.method() === 'PUT' && r.url().endsWith('/line-prices'));
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  expect((await put).postDataJSON()).toEqual({
    scope: 'pos',
    groups: [{ from: 3500, to: 'current' }, { from: 4100, to: 'current' }, { from: 4500, to: 'current' }],
  });
});

test('a bad price is refused in the dialog and a cleared one leaves the group alone', async ({ page }) => {
  await serveOffice(page, 'agent', userRoutes());
  const dialog = await openFromUserPage(page);
  await expect(dialog.locator('table.data tbody tr')).toHaveCount(3);

  const field = dialog.locator('tbody tr').nth(1).getByRole('textbox');
  await field.fill('abc');
  await field.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText('بيانات غير صالحة');
  await expect(dialog.getByRole('button', { name: 'حفظ' })).toBeDisabled();

  await field.fill('39');
  await field.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'حفظ' })).toBeEnabled();

  await field.fill('');
  await field.press('Enter');
  await expect(dialog.getByRole('button', { name: 'حفظ' })).toBeDisabled();
});

test('a package without renewable numbers has no entry, and an empty table says so', async ({ page }) => {
  await serveOffice(page, 'agent', {
    ...userRoutes(),
    'GET /users/pos/packages': () => ({ body: userSheet(row('lian-wecom-150', '150 جيجا'), row('lian-wecom-400', '400 جيجا', { lines: 0 })) }),
    'GET /packages/lian-wecom-150/line-prices': () => ({ body: { current: 3500, groups: [] } }),
  });
  await page.goto('http://agent.localhost:3910/users/pos');
  await page.getByRole('tab', { name: 'الرزم والأسعار' }).click();
  await expect(page.getByRole('button', { name: 'إجراءات 150 جيجا' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'إجراءات 400 جيجا' })).toHaveCount(0);

  await page.getByRole('button', { name: 'إجراءات 150 جيجا' }).click();
  await page.getByRole('menuitem', { name: 'أسعار الأرقام القائمة' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('لا أرقام قابلة للتجديد على هذه الرزمة')).toBeVisible();
  await expect(dialog.locator('table')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'حفظ' })).toBeDisabled();
});

const sheet = {
  code: 'lian-wecom-500', name: '500 جيجا', providerCode: 'lian', providerName: 'ليان', companyCode: 'wecom', companyName: 'ويكوم',
  enabled: true, forSale: true,
  branchCost: 2500, mainPrice: 2800, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3500,
  renewalBranchCost: 2000, renewalMainPrice: 2300, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3200,
  esimPrice: null, esimPriceEffective: 0, esimPriceSource: 'company',
  lines: 2, activeLines: 1, renewals: [], switches: [],
  modes: { activate: 'auto', charge: 'auto', extend: 'auto', disconnect: 'auto', freeze: 'auto', switch: 'auto', rename: 'auto', sim: 'auto' },
};

function sheetRoutes(): Routes {
  return {
    'GET /packages/lian-wecom-500/sheet': () => ({ body: sheet }),
    'GET /packages/lian-wecom-500/custom-prices': () => ({
      body: [{ loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos', parentLogin: 'ag1', defaultPrice: 3500, defaultRenewalPrice: 3200, price: 2900, renewalPrice: null }],
    }),
    'GET /users': () => ({ body: { users: [{ loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos' }] } }),
    'GET /companies': () => ({ body: { companies: [] } }),
    'GET /lines': () => ({ body: { lines: [], poses: [], nextCursor: null } }),
  };
}

test('the package sheet opens the table for the whole system and then for one account', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    ...sheetRoutes(),
    'GET /packages/lian-wecom-500/line-prices': (url) => ({
      body: url.searchParams.get('scope') === 'all'
        ? { current: null, groups: [{ price: 3200, count: 1 }, { price: 4000, count: 1 }] }
        : { current: 3200, groups: [{ price: 2900, count: 1 }] },
    }),
  });
  await page.goto(`${admin}/providers/lian/lian-wecom-500`);
  await page.getByRole('tab', { name: 'الأسعار' }).click();

  const block = page.locator('.account-fund').filter({ hasText: 'سعر التجديد على الأرقام الفعالة' });
  await block.getByRole('combobox').selectOption({ label: 'كل النظام' });
  await block.getByRole('button', { name: 'عرض الأرقام' }).click();
  const dialog = page.getByRole('dialog', { name: 'أسعار الأرقام القائمة — 500 جيجا' });
  await expect(dialog.locator('table.data tbody tr')).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: 'اتباع تسعيرة السلسلة' })).toBeVisible();
  expect(calls).toContain('GET /packages/lian-wecom-500/line-prices?scope=all');

  // Opening it again for an account reads that account's table, not the one just closed.
  await dialog.getByRole('button', { name: 'إلغاء' }).click();
  await expect(dialog).toHaveCount(0);
  await block.getByRole('combobox').selectOption({ label: 'pos1 (نقطة بيع)' });
  await block.getByRole('button', { name: 'عرض الأرقام' }).click();
  await expect(dialog.locator('table.data tbody tr')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'اتباع السعر الحالي (32.00 ₪)' })).toBeVisible();
  expect(calls).toContain('GET /packages/lian-wecom-500/line-prices?scope=pos1');
});

test('a custom price row opens the table for its account', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    ...sheetRoutes(),
    'GET /packages/lian-wecom-500/line-prices': () => ({ body: { current: 2900, groups: [{ price: 3200, count: 2 }] } }),
    'PUT /packages/lian-wecom-500/line-prices': () => ({ body: { ok: true, lines: 2 } }),
  });
  await page.goto(`${admin}/providers/lian/lian-wecom-500`);
  await page.getByRole('tab', { name: 'تخصيص سعر' }).click();

  await page.getByRole('button', { name: /إجراءات pos1/ }).click();
  await page.getByRole('menuitem', { name: 'أسعار الأرقام القائمة' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('table.data tbody tr')).toHaveCount(1);
  expect(calls).toContain('GET /packages/lian-wecom-500/line-prices?scope=pos1');

  const put = page.waitForRequest((r) => r.method() === 'PUT' && r.url().endsWith('/line-prices'));
  await dialog.getByRole('button', { name: 'اتباع السعر الحالي (29.00 ₪)' }).click();
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  expect((await put).postDataJSON()).toEqual({ scope: 'pos1', groups: [{ from: 3200, to: 'current' }] });
  await expect(page.getByText('تم تحديث 2 رقماً')).toBeVisible();
});
