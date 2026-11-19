import { expect, test } from '@playwright/test';
import { serveApi } from './desk';

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

// The company is the catalog's root for the branch (spec 2026-11-09-admin-review, 4): /postpaid/packages sends it to the
// companies, and a company lists its packages in one table — provider, the main agent's price and renewal, the margin,
// on or off as a badge (the switch lives on the package's own head) — with a provider filter.
const twoProviders = {
  companies: [{
    ...shelf.companies[0],
    providers: [...shelf.companies[0].providers, { code: 'sky', name: 'سكاي', packages: [pkg({ code: 'sky-wecom-200', name: '200 جيجا', dataGb: 200 })] }],
  }, shelf.companies[1]],
};

test('the branch reaches packages through their company: one table, provider, prices, margin, status', async ({ page }) => {
  await serveApi(page, 'branch', { 'GET /postpaid/companies': () => ({ body: twoProviders }) });
  await page.goto(`${admin}/postpaid/packages`);
  await expect(page).toHaveURL(`${admin}/postpaid/companies`);
  await expect(page.getByTestId('sidebar').getByRole('link', { name: 'الرزم', exact: true })).toHaveCount(0);
  await page.getByTestId('sidebar').getByRole('link', { name: 'الشركات والرزم' }).click();
  await page.getByRole('link', { name: 'ويكوم' }).first().click();
  await expect(page.getByRole('tab', { name: /الرزم/ })).toHaveAttribute('aria-selected', 'true');
  const row = page.locator('tr', { hasText: '500 جيجا' });
  await expect(row).toContainText('500 جيجا · دقائق غير محدودة · 100 رسالة');
  await expect(row).toContainText('ليان');
  await expect(row).toContainText('23.00');
  await expect(row).toContainText('28.00');
  await expect(row).toContainText('+3.00');
  await expect(page.locator('tr', { hasText: '300 جيجا' })).toContainText('متوقف');
  // On/off is switched from the list (spec 2026-11-11-ui-consistency-pass, D2); the row has no ⋯ menu.
  await expect(page.locator('tr', { hasText: '300 جيجا' }).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('button', { name: 'إجراءات 500 جيجا' })).toHaveCount(0);
  await expect(page.locator('tr', { hasText: '200 جيجا' })).toContainText('سكاي');

  await page.getByRole('link', { name: '500 جيجا', exact: true }).click();
  await expect(page).toHaveURL(`${admin}/postpaid/companies/wecom/packages/lian-wecom-500`);
});

test('the provider filter narrows a company\'s packages', async ({ page }) => {
  await serveApi(page, 'branch', { 'GET /postpaid/companies': () => ({ body: twoProviders }) });
  await page.goto(`${admin}/postpaid/companies/wecom?provider=sky`);
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
  durations: [{ id: 'd1', unit: 'month', count: 1, days: 30, branchCost: 2000, mainPrice: 2300, agentPrice: 2500, posPrice: 2700, subscriberPrice: 3000, noDisconnect: false, forSale: true, enabled: true }],
    esimPrice: null, esimPriceEffective: 0, esimPriceSource: 'company', lines: 0, activeLines: 0, renewals: [], switches: [],
    modes: { activate: 'auto', charge: 'auto', extend: 'auto', disconnect: 'auto', freeze: 'auto', switch: 'auto', rename: 'auto', sim: 'auto' },
  };
  await serveApi(page, 'branch', {
    'GET /postpaid/packages/lian-wecom-500/sheet': () => ({ body: sheet }),
    'GET /postpaid/packages/lian-wecom-500/prices': () => ({ body: { offers: [] } }),
    'GET /users': () => ({ body: { users: [] } }),
    'GET /postpaid/companies': () => ({ body: shelf }),
    'GET /postpaid/lines': () => ({ body: { items: [], poses: [], nextCursor: null, total: 0 } }),
    'PATCH /postpaid/packages/lian-wecom-500/details': () => ({ body: { ok: true } }),
    'PATCH /postpaid/packages/lian-wecom-500/mode': () => ({ body: { ok: true } }),
  });
  await page.goto(`${admin}/postpaid/companies/wecom/packages/lian-wecom-500`);
  // The page opens on the price chain (as in the design); the facts are on the overview.
  await page.getByRole('tab', { name: 'نظرة عامة' }).click();
  await expect(page.getByText('500 جيجا · دقائق غير محدودة')).toBeVisible();
  // eSIM per package (spec 2026-11-09, 5) is on the start tab (spec 2026-11-16-package-page, P.1): on by default,
  // with its price beside it; turned off here, it saves at once with the other details as they are.
  const esim = page.getByTestId('package-esim');
  await expect(esim.getByLabel('سعر eSIM')).toBeVisible();
  const switched = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith('/v1/postpaid/packages/lian-wecom-500/details'));
  await esim.getByRole('switch', { name: 'الرزمة متاحة كـ eSIM' }).click();
  expect((await switched).postDataJSON()).toMatchObject({ dataGb: 500, smsCount: null, minutes: -1, details: '', esimAvailable: false });
  // Porting and card-to-bill (spec 2026-11-16-package-page, P.5): both off, with no mode to choose; turning one on
  // saves it as a branch task.
  const kinds = page.getByTestId('package-activation-kinds');
  await expect(kinds.getByRole('switch', { name: 'نيود' })).toHaveAttribute('aria-checked', 'false');
  await expect(kinds.getByRole('switch', { name: 'تحويل من كرت لفاتورة' })).toHaveAttribute('aria-checked', 'false');
  await expect(kinds.getByRole('radiogroup')).toHaveCount(0);
  const ported = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith('/v1/postpaid/packages/lian-wecom-500/mode'));
  await kinds.getByRole('switch', { name: 'نيود' }).click();
  expect((await ported).postDataJSON()).toEqual({ portMode: 'manual' });
  // The details are edited on the same tab (spec 2026-11-16-package-page, P.2); eSIM is not one of their fields.
  await expect(page.getByRole('tab', { name: 'التفاصيل' })).toHaveCount(0);
  await expect(page.getByTestId('package-details-form').getByLabel('الرزمة متاحة كـ eSIM')).toHaveCount(0);
  await expect(page.getByLabel('الإنترنت (جيجا)')).toHaveValue('500');
  await expect(page.getByLabel('دقائق الاتصال')).toBeDisabled();
  await page.getByLabel('الرسائل').fill('200');
  await page.getByLabel('تفاصيل إضافية').fill('تجوال في الأردن');
  // Suspension period (spec 2026-11-08-overview-and-reports-nav, I): 90 days when the sheet carries none.
  await expect(page.getByLabel('مدة تعليق الرقم (بالأيام)')).toHaveValue('90');
  await page.getByLabel('مدة تعليق الرقم (بالأيام)').fill('60');
  const sent = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith('/v1/postpaid/packages/lian-wecom-500/details'));
  await page.getByTestId('package-details-form').getByRole('button', { name: 'حفظ' }).click();
  // The details leave eSIM to its switch.
  expect((await sent).postDataJSON()).toEqual({ dataGb: 500, smsCount: 200, minutes: -1, details: 'تجوال في الأردن', suspendAfterDays: 60 });
});

test('the point of sale sees the details on the package card and the subscribe step', async ({ page }) => {
  const row = {
    code: 'lian-wecom-500', name: '500 جيجا', providerCode: null, providerName: '', activateMode: null, sellable: true, activateInput: 'generated', companyName: 'ويكوم',
    sim: { length: null, prefix: '', esim: false }, esimPrice: 0, dataGb: 500, smsCount: -1, minutes: 1000, details: 'تجوال في الأردن', months: 3,
    branchCost: 0, mainPrice: 0, agentPrice: 0, posPrice: 2700, subscriberPrice: 3000, editableField: null,
    autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true,
    price: 2700, renewalPrice: 2700, canActivate: true, sellPrice: null, sellRenewalPrice: null, sellDefault: null, sellRenewalDefault: null,
  };
  await serveApi(page, 'pos', { 'GET /postpaid/packages': () => ({ body: { packages: [row], companies: [{ name: 'ويكوم', image: '' }] } }) });
  await page.goto('/postpaid/packages');
  await page.getByRole('button', { name: /ويكوم/ }).click();
  const card = page.getByTestId('pack-card');
  // The card draws the data as a ring and names the rest (spec 2026-11-16-package-page, P.6).
  await expect(card.locator('[data-slot="gb-ring"]')).toHaveText('500');
  await expect(card).toContainText('1000 دقيقة');
  await expect(card).toContainText('رسائل غير محدودة');
  await expect(card).toContainText('3 أشهر');
  await expect(card).not.toContainText('تجوال');
  await card.click();
  await expect(page.getByTestId('package-facts-details')).toHaveText('تجوال في الأردن');
});

test('the company list turns a package on and off, and the package page only shows its state', async ({ page }) => {
  await serveApi(page, 'branch', {
    'GET /postpaid/companies': () => ({ body: twoProviders }),
    'PATCH /postpaid/packages/lian-wecom-300/mode': () => ({ body: { ok: true } }),
  });
  await page.goto(`${admin}/postpaid/companies/wecom`);
  const sent = page.waitForRequest((request) => request.url().endsWith('/postpaid/packages/lian-wecom-300/mode') && request.method() === 'PATCH');
  await page.locator('tr', { hasText: '300 جيجا' }).getByRole('switch').click();
  expect((await sent).postDataJSON()).toEqual({ enabled: true });
});
