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

// The company is the catalog's root for the branch (spec 2026-11-09-admin-review, 4): /packages sends it to the
// companies, and a company lists its packages in one table — provider, the main agent's price and renewal, the margin,
// on or off as a badge (the switch lives on the package's own head) — with a provider filter.
const twoProviders = {
  companies: [{
    ...shelf.companies[0],
    providers: [...shelf.companies[0].providers, { code: 'sky', name: 'سكاي', packages: [pkg({ code: 'sky-wecom-200', name: '200 جيجا', dataGb: 200 })] }],
  }, shelf.companies[1]],
};

test('the branch reaches packages through their company: one table, provider, prices, margin, status', async ({ page }) => {
  await serveOffice(page, 'branch', { 'GET /companies': () => ({ body: twoProviders }) });
  await page.goto(`${admin}/packages`);
  await expect(page).toHaveURL(`${admin}/companies`);
  await expect(page.locator('.sidebar').getByRole('link', { name: 'الرزم', exact: true })).toHaveCount(0);
  await page.locator('.sidebar').getByRole('link', { name: 'الشركات والرزم' }).click();
  await page.getByRole('link', { name: 'ويكوم' }).first().click();
  await expect(page.getByRole('tab', { name: /الرزم/ })).toHaveAttribute('aria-selected', 'true');
  const row = page.locator('tr', { hasText: '500 جيجا' });
  await expect(row).toContainText('500 جيجا · دقائق غير محدودة · 100 رسالة');
  await expect(row).toContainText('ليان');
  await expect(row).toContainText('23.00');
  await expect(row).toContainText('28.00');
  await expect(row).toContainText('+3.00');
  await expect(page.locator('tr', { hasText: '300 جيجا' })).toContainText('متوقف');
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.locator('tr', { hasText: '200 جيجا' })).toContainText('سكاي');

  await page.getByRole('button', { name: 'إجراءات 500 جيجا' }).click();
  await page.getByRole('menuitem', { name: 'فتح الرزمة' }).click();
  await expect(page).toHaveURL(`${admin}/companies/wecom/packages/lian-wecom-500`);
});

test('the provider filter narrows a company\'s packages, and the old company-provider page lands on it', async ({ page }) => {
  await serveOffice(page, 'branch', { 'GET /companies': () => ({ body: twoProviders }) });
  await page.goto(`${admin}/companies/wecom/sky`);
  await expect(page).toHaveURL(`${admin}/companies/wecom?provider=sky`);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('200 جيجا');
  await page.getByRole('button', { name: /امسح الاختيار/ }).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  // From the providers tab, a provider's package count opens its packages here.
  await page.getByRole('tab', { name: /المزودون/ }).click();
  await page.locator('tr', { hasText: 'ليان' }).getByRole('button', { name: '2' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
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
    'GET /lines': () => ({ body: { items: [], poses: [], nextCursor: null, total: 0 } }),
    'PATCH /packages/lian-wecom-500/details': () => ({ body: { ok: true } }),
  });
  // The package page's old address moves to its company's (spec 2026-11-09-admin-review, 4).
  await page.goto(`${admin}/providers/lian/lian-wecom-500`);
  await expect(page).toHaveURL(`${admin}/companies/wecom/packages/lian-wecom-500`);
  // The page opens on the price chain (as in the design); the facts are on the overview.
  await page.getByRole('tab', { name: 'نظرة عامة' }).click();
  await expect(page.getByText('500 جيجا · دقائق غير محدودة')).toBeVisible();
  await page.getByRole('tab', { name: 'التفاصيل' }).click();
  await expect(page.getByLabel('الإنترنت (جيجا)')).toHaveValue('500');
  await expect(page.getByLabel('دقائق الاتصال')).toBeDisabled();
  await page.getByLabel('الرسائل').fill('200');
  await page.getByLabel('تفاصيل إضافية').fill('تجوال في الأردن');
  // Suspension period (spec 2026-11-08-overview-and-reports-nav, I): 90 days when the sheet carries none.
  await expect(page.getByLabel('مدة تعليق الرقم (بالأيام)')).toHaveValue('90');
  await page.getByLabel('مدة تعليق الرقم (بالأيام)').fill('60');
  // eSIM per package (spec 2026-11-09, 5): on by default; turned off here.
  await page.getByLabel('الرزمة متاحة كـ eSIM').uncheck();
  const sent = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith('/office/packages/lian-wecom-500/details'));
  await page.locator('.package-details-form').getByRole('button', { name: 'حفظ' }).click();
  expect((await sent).postDataJSON()).toEqual({ dataGb: 500, smsCount: 200, minutes: -1, details: 'تجوال في الأردن', suspendAfterDays: 60, esimAvailable: false });
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
