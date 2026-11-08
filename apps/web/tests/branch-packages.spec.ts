import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// Spec 2026-11-08-branch-packages-and-details: the branch list in the users-tab shape (child price, margin, switch),
// and package details shown where a package is chosen.

const admin = 'http://admin.localhost:3910';
const pkg = (over: Record<string, unknown>) => ({
  months: 1, dataGb: 500, smsCount: null, minutes: null, branchCost: 2000, mainPrice: 2300, renewalBranchCost: 2500, renewalMainPrice: 2800,
  forSale: true, enabled: true, lines: 0, activeLines: 0, stoppedLines: 0, ...over,
});
const shelf = {
  companies: [
    {
      code: 'wecom', name: 'ويكوم', image: '', sim: { length: null, prefix: '', esim: false }, esimPrice: 0,
      providers: [{ code: 'lian', name: 'ليان', packages: [
        pkg({ code: 'lian-wecom-500', name: '500 جيجا', minutes: -1, smsCount: 100 }),
        pkg({ code: 'lian-wecom-300', name: '300 جيجا', dataGb: 300, enabled: false, mainPrice: 2100, branchCost: 2000 }),
      ] }],
    },
    { code: 'kalam', name: 'كلام', image: '', sim: { length: null, prefix: '', esim: false }, esimPrice: 0, providers: [] },
  ],
};

test('the branch list folds by company and shows the main agent price, the margin and a switch', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    'GET /companies': () => ({ body: shelf }),
    'PATCH /packages/lian-wecom-300/mode': () => ({ body: { ok: true } }),
  });
  await page.goto(`${admin}/packages`);
  const head = page.getByRole('button', { name: /ويكوم/ });
  await expect(head).toContainText('2 رزمة · 1 متوقفة');
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: /كلام/ })).toHaveCount(0);
  await head.click();
  const row = page.locator('tr', { hasText: '500 جيجا' });
  await expect(row).toContainText('500 جيجا · دقائق غير محدودة · 100 رسالة');
  await expect(row).toContainText('ليان');
  await expect(row).toContainText('23.00');
  await expect(row).toContainText('28.00');
  await expect(row).toContainText('+3.00');
  await expect(page.getByRole('columnheader', { name: 'أرقام فعالة' })).toHaveCount(0);

  const off = page.getByRole('switch', { name: '300 جيجا' });
  await expect(off).toHaveAttribute('aria-checked', 'false');
  const sent = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith('/office/packages/lian-wecom-300/mode'));
  await off.click();
  expect((await sent).postDataJSON()).toEqual({ enabled: true });
  expect(calls).toContain('PATCH /packages/lian-wecom-300/mode');

  await page.getByRole('button', { name: 'إجراءات 500 جيجا' }).click();
  await page.getByRole('menuitem', { name: 'فتح الرزمة' }).click();
  await expect(page).toHaveURL(`${admin}/providers/lian/lian-wecom-500`);
});

test('a filter opens the companies it found', async ({ page }) => {
  await serveOffice(page, 'branch', { 'GET /companies': () => ({ body: shelf }) });
  await page.goto(`${admin}/packages`);
  await page.getByLabel('الحالة').selectOption('off');
  await expect(page.getByRole('button', { name: /ويكوم/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('tr', { hasText: '300 جيجا' })).toBeVisible();
  await expect(page.locator('tr', { hasText: '500 جيجا' })).toHaveCount(0);
});

test('the package page edits its details', async ({ page }) => {
  const sheet = {
    code: 'lian-wecom-500', name: '500 جيجا', providerCode: 'lian', providerName: 'ليان', companyCode: 'wecom', companyName: 'ويكوم',
    enabled: true, forSale: true, dataGb: 500, smsCount: null, minutes: -1, details: '', months: 1,
    branchCost: 2000, mainPrice: 2300, agentPrice: 2500, posPrice: 2700, subscriberPrice: 3000,
    renewalBranchCost: 2000, renewalMainPrice: 2300, renewalAgentPrice: 2500, renewalPosPrice: 2700, renewalSubscriberPrice: 3000,
    esimPrice: null, esimPriceEffective: 0, esimPriceSource: 'company', lines: 0, activeLines: 0, renewals: [], switches: [],
    modes: { activate: 'auto', charge: 'auto', extend: 'auto', disconnect: 'auto', freeze: 'auto', switch: 'auto', rename: 'auto', sim: 'auto' },
  };
  await serveOffice(page, 'branch', {
    'GET /packages/lian-wecom-500/sheet': () => ({ body: sheet }),
    'GET /packages/lian-wecom-500/prices': () => ({ body: { offers: [] } }),
    'GET /users': () => ({ body: { users: [] } }),
    'GET /companies': () => ({ body: shelf }),
    'GET /lines': () => ({ body: { lines: [], poses: [], nextCursor: null, total: 0 } }),
    'PATCH /packages/lian-wecom-500/details': () => ({ body: { ok: true } }),
  });
  await page.goto(`${admin}/providers/lian/lian-wecom-500`);
  await expect(page.getByText('500 جيجا · دقائق غير محدودة')).toBeVisible();
  await page.getByRole('tab', { name: 'التفاصيل' }).click();
  await expect(page.getByLabel('الإنترنت (جيجا)')).toHaveValue('500');
  await expect(page.getByLabel('دقائق الاتصال')).toBeDisabled();
  await page.getByLabel('الرسائل').fill('200');
  await page.getByLabel('تفاصيل إضافية').fill('تجوال في الأردن');
  const sent = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith('/office/packages/lian-wecom-500/details'));
  await page.locator('.package-details-form').getByRole('button', { name: 'حفظ' }).click();
  expect((await sent).postDataJSON()).toEqual({ dataGb: 500, smsCount: 200, minutes: -1, details: 'تجوال في الأردن' });
});

test('the point of sale sees the details on the package card and the subscribe step', async ({ page }) => {
  const row = {
    code: 'lian-wecom-500', name: '500 جيجا', providerCode: 'lian', providerName: '', companyName: 'ويكوم',
    sim: { length: null, prefix: '', esim: false }, esimPrice: 0, dataGb: 500, smsCount: -1, minutes: 1000, details: 'تجوال في الأردن', months: 3,
    branchCost: 0, mainPrice: 0, agentPrice: 0, posPrice: 2700, subscriberPrice: 3000, editableField: null,
    autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true,
    price: 2700, renewalPrice: 2700, canActivate: true, sellPrice: null, sellRenewalPrice: null, sellDefault: null, sellRenewalDefault: null,
  };
  await serveOffice(page, 'pos', { 'GET /packages': () => ({ body: { packages: [row], companies: [{ name: 'ويكوم', image: '' }] } }) });
  await page.goto('/packages');
  await page.getByRole('button', { name: /ويكوم/ }).click();
  const card = page.locator('.pack-card');
  await expect(card).toContainText('500 جيجا · 1000 دقيقة · رسائل غير محدودة · 3 أشهر');
  await expect(card).not.toContainText('تجوال');
  await card.click();
  await expect(page.locator('.package-facts-details')).toHaveText('تجوال في الأردن');
});
