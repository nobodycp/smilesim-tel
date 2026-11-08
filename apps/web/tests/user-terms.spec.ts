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

test('the packages tab folds each company, keeps one line per package, and edits a price from the row menu', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await serveOffice(page, 'branch', {
    'GET /users/pos1': () => ({ body: account }),
    'GET /users/pos1/packages': () => ({ body: sheet }),
    'PUT /users/pos1/packages/alloha-150': () => ({ body: { ...row('alloha-150', '150 جيجا', 'alloha'), hidden: true } }),
  });
  await page.goto('http://admin.localhost:3910/users/pos1#packages');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: 'الرزم والأسعار' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('3 رزمة · 2 ظاهرة · 1 بسعر خاص')).toBeVisible();
  // No bulk actions, no company switch, and every company starts folded.
  await expect(page.getByRole('button', { name: 'تشغيل الكل' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'إيقاف الكل' })).toHaveCount(0);
  const alloha = page.getByRole('button', { name: /^الوها/ });
  await expect(alloha).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('switch')).toHaveCount(0);

  await alloha.click();
  await expect(alloha).toHaveAttribute('aria-expanded', 'true');
  const rows = page.locator('.terms-rows tbody tr');
  await expect(rows).toHaveCount(2);
  // One line: buy and sell pairs, the margin, and a state only when there is one ("inherited" is gone).
  const open = rows.filter({ hasText: '150 جيجا' });
  await expect(open).toContainText('30.00 ₪/27.00 ₪');
  await expect(open).toContainText('35.00 ₪/32.00 ₪');
  await expect(open).toContainText('+5.00 ₪');
  await expect(page.getByText('موروث')).toHaveCount(0);
  const locked = rows.filter({ hasText: '400 جيجا' });
  await expect(locked.getByRole('switch')).toBeDisabled();
  await expect(locked.getByText('موقوف من فوق')).toBeVisible();

  const toggle = page.waitForRequest((request) => request.method() === 'PUT' && request.url().endsWith('/office/users/pos1/packages/alloha-150'));
  await open.getByRole('switch').click();
  expect((await toggle).postDataJSON()).toEqual({ hidden: true });

  await page.getByRole('button', { name: /^سلكوم/ }).click();
  await expect(page.locator('.terms-rows tbody tr').filter({ hasText: '100 جيجا' }).getByText('سعر خاص')).toBeVisible();

  // The price is edited from the menu: an empty renewal field goes back to the default.
  await open.getByRole('button', { name: 'إجراءات 150 جيجا' }).click();
  await page.getByRole('menuitem', { name: 'تعديل السعر' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('اشتراك').fill('36.5');
  const price = page.waitForRequest((request) => request.method() === 'PUT' && request.url().endsWith('/office/users/pos1/packages/alloha-150'));
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  expect((await price).postDataJSON()).toEqual({ price: 3650, renewalPrice: null });
  await expect(dialog).toHaveCount(0);
});

test('a search opens the companies it finds', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /users/pos1': () => ({ body: account }),
    'GET /users/pos1/packages': () => ({ body: sheet }),
  });
  await page.goto('http://admin.localhost:3910/users/pos1#packages');
  await page.getByLabel('الرزمة').fill('100');
  await expect(page.getByRole('button', { name: /^سلكوم/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.terms-rows tbody tr')).toHaveCount(1);
});

test('a main agent opening a grandchild sees only the access tab, and a hash to a hidden tab falls back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await serveOffice(page, 'main_agent', {
    'GET /users/pos1': () => ({ body: { ...account, canEdit: false } }),
  });
  await page.goto('http://main.localhost:3910/users/pos1#packages');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: 'الحساب' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('لا رزم معروضة للبيع.')).toHaveCount(0);
});

// Since spec 2026-11-08-overview-and-reports-nav (H) the number operations are a closed section of «الحساب»;
// an old `#ops` link opens that tab.
test('the number operations section shows ten cards and marks an inherited stop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await serveOffice(page, 'branch', {
    'GET /users/pos1': () => ({ body: account }),
    'GET /users/pos1/ops': () => ({ body: { denied: ['sim'], deniedAbove: [{ op: 'charge', login: 'ma1' }] } }),
  });
  await page.goto('http://admin.localhost:3910/users/pos1#ops');
  await expect(page.getByRole('tab', { name: 'الحساب' })).toHaveAttribute('aria-selected', 'true');
  await page.locator('details.fold', { hasText: 'عمليات الأرقام' }).locator('summary').click();
  const cards = page.locator('.op-card');
  await expect(cards).toHaveCount(10);
  const charge = cards.filter({ hasText: 'شحن' }).first();
  await expect(charge.getByRole('switch')).toBeDisabled();
  await expect(charge.getByText('موقوف من ma1')).toBeVisible();
  const sim = cards.filter({ hasText: 'تبديل الشريحة' });
  await expect(sim.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});
