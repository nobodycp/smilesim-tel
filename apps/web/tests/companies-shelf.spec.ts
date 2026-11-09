import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const admin = 'http://admin.localhost:3910';
const shelf = {
  companies: [
    {
      code: 'wecom',
      name: 'ويكوم',
      providers: [{
        code: 'lian',
        name: 'ليان',
        packages: [
          { code: 'lian-wecom-500', name: '500 جيجا', months: 1, forSale: false, lines: 2, activeLines: 1 },
          { code: 'lian-wecom-500-3m', name: '500 جيجا · 3 أشهر', months: 3, forSale: false, lines: 0, activeLines: 0 },
        ],
      }],
    },
    { code: 'kalam', name: 'كلام', providers: [] },
    { code: 'symphony', name: 'سيمفوني', providers: [] },
  ],
};

test('the branch opens the company shelf', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    'GET /companies': () => ({ body: shelf }),
  });

  await page.goto(`${admin}/companies`);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('الشركات');
  await expect(page.getByRole('link', { name: 'كلام' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  // Dark is the default (spec 2026-11-09-graphite-identity).
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'تفعيل الوضع الفاتح' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.getByRole('button', { name: 'تفعيل الوضع الداكن' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'تفعيل الوضع الفاتح' }).click();
  await page.getByRole('button', { name: /EN/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Companies');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.getByRole('button', { name: 'Switch to dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('link', { name: 'ويكوم' }).click();
  await page.getByRole('tab', { name: 'Providers' }).click();
  await expect(page.getByRole('link', { name: 'ليان' })).toBeVisible();
  await page.getByRole('link', { name: 'ليان' }).click();
  await expect(page.getByRole('link', { name: '500 جيجا', exact: true })).toHaveAttribute('href', '/providers/lian/lian-wecom-500');
  await expect(page.getByText('Hidden from sale')).toHaveCount(2);
  expect(calls).toContain('GET /companies');
});

test('an agent is sent away without loading the company shelf', async ({ page }) => {
  const calls = await serveOffice(page, 'agent', {
    'GET /home': () => ({
      body: { pendingTasks: 0, activeLines: 0, inactiveLines: 0, canPost: false, operations: [], announcements: [] },
    }),
  });

  await page.goto(`${admin}/companies`);

  await expect(page).toHaveURL(`${admin}/`);
  expect(calls).not.toContain('GET /companies');
});

test('the package sheet shows both ladders, targets, and selectable numbers', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    'GET /packages/lian-wecom-500/sheet': () => ({
      body: {
        code: 'lian-wecom-500',
        name: '500 جيجا',
        providerCode: 'lian',
        providerName: 'ليان',
        companyCode: 'wecom',
        companyName: 'ويكوم',
        enabled: true,
        forSale: false,
        branchCost: 25,
        mainPrice: 25,
        agentPrice: 25,
        posPrice: 25,
        subscriberPrice: 25,
        renewalBranchCost: 30,
        renewalMainPrice: 30,
        renewalAgentPrice: 30,
        renewalPosPrice: 30,
        renewalSubscriberPrice: 30,
        lines: 2,
        activeLines: 1,
        renewals: [],
        switches: [],
        modes: {
          activate: 'auto', charge: 'auto', extend: 'auto', disconnect: 'auto',
          freeze: 'auto', switch: 'auto', rename: 'auto', sim: 'auto',
        },
        offers: [],
      },
    }),
    'GET /users': () => ({ body: { users: [] } }),
    'GET /companies': () => ({ body: shelf }),
    'GET /lines': () => ({
      body: {
        lines: [{
          id: 'line-1',
          msisdn: '0550000001',
          iccid: null,
          esim: false,
          status: 'active',
          packageCode: 'lian-wecom-500',
          packageName: '500 جيجا',
          companyName: 'ويكوم',
          posLogin: 'pos',
          posPrice: 25,
          createdAt: '2026-10-01T00:00:00.000Z',
          endsAt: '2026-11-01T00:00:00.000Z',
        }],
        poses: [],
        nextCursor: null,
      },
    }),
    'PUT /packages/lian-wecom-500/renewals': () => ({ body: { ok: true } }),
    'GET /packages/lian-wecom-500/line-prices': () => ({ body: { current: null, groups: [{ price: 3000, count: 1 }] } }),
    'PUT /packages/lian-wecom-500/line-prices': () => ({ body: { ok: true, lines: 1 } }),
  });

  await page.goto(`${admin}/providers/lian/lian-wecom-500`);
  await page.getByRole('tab', { name: 'نظرة عامة' }).click();
  await expect(page.getByText('عدد الأرقام', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'الأسعار' }).click();
  await expect(page.locator('.account-fund').nth(0).locator('input')).toHaveCount(5);
  await expect(page.locator('.account-fund').nth(1).locator('input')).toHaveCount(5);
  const reprice = page.locator('.account-fund').filter({ hasText: 'سعر التجديد على الأرقام الفعالة' });
  await reprice.getByRole('button', { name: 'عرض الأرقام' }).click();
  const dialog = page.getByRole('dialog', { name: 'أسعار الأرقام القائمة — 500 جيجا' });
  await dialog.getByRole('textbox').fill('40');
  await dialog.getByRole('textbox').press('Enter');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => calls).toContain('GET /packages/lian-wecom-500/line-prices?scope=all');
  await expect.poll(() => calls).toContain('PUT /packages/lian-wecom-500/line-prices');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('tab', { name: 'التجديد' }).click();
  await page.getByLabel(/500 جيجا · 3 أشهر/).check();
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect.poll(() => calls).toContain('PUT /packages/lian-wecom-500/renewals');
  await page.getByRole('tab', { name: 'الأرقام' }).click();
  const checks = page.getByRole('checkbox');
  await expect(checks).toHaveCount(2);
  await checks.first().check();
  await expect(checks.nth(1)).toBeChecked();
});
