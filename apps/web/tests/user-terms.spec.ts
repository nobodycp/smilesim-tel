import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const account = {
  loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos', parentLogin: 'ag1', frozen: false, isBranchOwner: false, staff: false,
  roleId: '', roleName: '', roleGrants: [], extraGrants: [], deniedGrants: [], extraRoleIds: [], grants: [], roles: [], canEdit: true,
};

const row = (code: string, name: string, companyCode: string, patch: Record<string, unknown> = {}) => ({
  code, name, dataGb: 150, months: 1, companyCode, hidden: false, hiddenAbove: null,
  parentBuy: 3000, parentRenewalBuy: 2700, price: null, renewalPrice: null, effective: 3500, renewalEffective: 3200, source: 'layer',
  ...patch,
});

const sheet = {
  summary: { total: 3, visible: 2, custom: 1 },
  companies: [
    { code: 'alloha', name: 'الوها', packages: [
      row('alloha-150', '150 جيجا', 'alloha'),
      row('alloha-400', '400 جيجا', 'alloha', { hiddenAbove: 'ma1' }),
    ] },
    { code: 'cell', name: 'سلكوم', packages: [
      row('cell-100', '100 جيجا', 'cell', { price: 3300, effective: 3300, source: 'custom' }),
    ] },
  ],
};

test('the user page has three tabs and the packages tab shows inherited state per row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await serveOffice(page, 'branch', {
    'GET /users/pos1': () => ({ body: account }),
    'GET /users/pos1/packages': () => ({ body: sheet }),
    'PUT /users/pos1/packages/alloha-150': () => ({ body: { ...row('alloha-150', '150 جيجا', 'alloha'), hidden: true } }),
  });
  await page.goto('http://admin.localhost:3910/users/pos1#packages');
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(page.getByRole('tab', { name: 'الرزم والأسعار' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('3 رزمة · 2 ظاهرة · 1 بسعر خاص')).toBeVisible();

  const locked = page.locator('.terms-row', { hasText: '400 جيجا' });
  await expect(locked.getByRole('switch')).toBeDisabled();
  await expect(locked.getByText('موقوف من فوق')).toBeVisible();
  const custom = page.locator('.terms-row', { hasText: '100 جيجا' });
  await expect(custom.getByText('سعر خاص')).toBeVisible();

  const open = page.locator('.terms-row', { hasText: '150 جيجا' });
  const put = page.waitForRequest((request) => request.method() === 'PUT' && request.url().endsWith('/office/users/pos1/packages/alloha-150'));
  await open.getByRole('switch').click();
  expect((await put).postDataJSON()).toEqual({ hidden: true });
});

test('the operations tab shows nine cards and marks an inherited stop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await serveOffice(page, 'branch', {
    'GET /users/pos1': () => ({ body: account }),
    'GET /users/pos1/ops': () => ({ body: { denied: ['sim'], deniedAbove: [{ op: 'charge', login: 'ma1' }] } }),
  });
  await page.goto('http://admin.localhost:3910/users/pos1#ops');
  const cards = page.locator('.op-card');
  await expect(cards).toHaveCount(9);
  const charge = cards.filter({ hasText: 'شحن' }).first();
  await expect(charge.getByRole('switch')).toBeDisabled();
  await expect(charge.getByText('موقوف من ma1')).toBeVisible();
  const sim = cards.filter({ hasText: 'تبديل الشريحة' });
  await expect(sim.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});
