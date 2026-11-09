import { expect, test } from '@playwright/test';
import { pickName, serveOffice } from './desk';

// Adding from the provider (spec 2026-11-09-admin-review, 3): query the provider, pick what it offers, set it up, save.
const admin = 'http://admin.localhost:3910';
const shelf = {
  companies: [{ code: 'cellcom', name: 'سلكوم', image: '', sim: { length: null, prefix: '', esim: true }, esimPrice: 500, providers: [] }],
};
const providers = { providers: [{ code: 'sky', name: 'سكاي', companies: [] }, { code: 'lian', name: 'ليان', companies: [] }] };
const product = (code: string, name: string, added: boolean) => ({
  code, name, dataGb: 250, smsCount: -1, minutes: -1, months: 1, details: '', cost: 3200, renewalCost: 3000, added,
  addons: [{ name: '10 جيجا إضافية', price: 1500 }],
});
const providerModes = { activate: 'auto', charge: 'manual', extend: 'manual', disconnect: 'manual', freeze: 'manual', switch: 'manual', rename: 'manual', sim: 'manual', companySwitch: 'manual' };

test('a package is added from a provider product: details, add-ons, inherited modes, prices', async ({ page }) => {
  const sent: unknown[] = [];
  await serveOffice(page, 'branch', {
    'GET /companies': () => ({ body: shelf }),
    'GET /providers': () => ({ body: providers }),
    'GET /providers/sky/settings': () => ({ body: { code: 'sky', name: 'سكاي', modes: providerModes, esimPrice: null } }),
    'GET /providers/sky/catalog/products': () => ({ body: { simulated: true, products: [product('sky-cellcom-300', '300 جيجا', true), product('sky-cellcom-250', '250 جيجا', false)] } }),
    'POST /packages': () => ({ body: { ok: true, code: 'sky-cellcom-250', companyCode: 'cellcom' } }),
    'GET /packages/sky-cellcom-250/sheet': () => ({ status: 404, body: { message: 'غير موجود', code: 'NOT_FOUND' } }),
  });
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/office/packages')) sent.push(request.postDataJSON());
  });
  await page.goto(`${admin}/companies/cellcom`);
  await page.getByRole('link', { name: 'إضافة رزمة' }).click();
  await expect(page).toHaveURL(`${admin}/companies/cellcom/packages/new`);

  await pickName(page.getByRole('combobox', { name: 'المزود' }), 'سكاي');
  await page.getByRole('button', { name: 'استعلام' }).click();
  await expect(page.getByText('المزود وهمي حالياً')).toBeVisible();
  const offer = page.getByRole('radiogroup', { name: 'رزم المزود' });
  await expect(offer.getByRole('radio', { name: /^300 جيجا/ })).toBeDisabled();
  await offer.getByRole('radio', { name: /^250 جيجا/ }).click();

  // The provider's facts and add-ons fill in; every layer starts at the provider's cost.
  await expect(page.getByLabel('الرزمة', { exact: true })).toHaveValue('250 جيجا');
  await expect(page.getByLabel('الإنترنت (جيجا)')).toHaveValue('250');
  await expect(page.getByLabel('اسم العملية')).toHaveValue('10 جيجا إضافية');
  const fold = page.locator('.inherit-fold');
  await expect(fold.locator('summary')).toContainText('9 موروثة من المزود · 0 مخصصة');
  await fold.locator('summary').click();
  await page.getByRole('radiogroup', { name: 'التشغيل شحن' }).getByRole('radio', { name: 'مباشر' }).click();
  await expect(fold.locator('summary')).toContainText('8 موروثة من المزود · 1 مخصصة');

  const board = page.getByLabel('السلسلة');
  await expect(board.getByLabel('تكلفة الفرع').first()).toHaveValue('32');
  await board.getByLabel('وكيل رئيسي').first().fill('34');
  await board.getByLabel('وكيل', { exact: true }).first().fill('36');
  await board.getByLabel('نقطة بيع').first().fill('38');
  await board.getByLabel('سعر المشترك').first().fill('45');
  await page.getByRole('button', { name: 'إضافة الرزمة' }).click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({
    providerCode: 'sky', companyCode: 'cellcom', productCode: 'sky-cellcom-250', name: '250 جيجا', months: 1,
    dataGb: 250, smsCount: -1, minutes: -1, suspendAfterDays: 90, esimAvailable: true,
    subscription: { branchCost: 3200, mainPrice: 3400, agentPrice: 3600, posPrice: 3800, subscriberPrice: 4500 },
    renewal: { branchCost: 3000, mainPrice: 3000 },
    addons: [{ name: '10 جيجا إضافية', price: 1500 }],
  });
  expect((sent[0] as { modes: Record<string, string> }).modes).toMatchObject({ charge: 'auto', activate: 'inherit', extend: 'inherit' });
  await expect(page).toHaveURL(`${admin}/companies/cellcom/packages/sky-cellcom-250`);
});

test('a company is added from the provider with its SIM rules', async ({ page }) => {
  const sent: unknown[] = [];
  await serveOffice(page, 'branch', {
    'GET /companies': () => ({ body: shelf }),
    'GET /providers': () => ({ body: providers }),
    'GET /providers/lian/catalog/companies': () => ({ body: { simulated: true, companies: [
      { code: 'cellcom', name: 'سلكوم', sim: { length: null, prefix: '', esim: true }, esimPrice: 500, added: true },
      { code: 'golan', name: 'جولان تليكوم', sim: { length: 19, prefix: '89972', esim: true }, esimPrice: 500, added: false },
    ] } }),
    'POST /companies': () => ({ body: { ok: true, code: 'golan' } }),
  });
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/office/companies')) sent.push(request.postDataJSON());
  });
  await page.goto(`${admin}/companies`);
  await page.getByRole('link', { name: 'إضافة شركة' }).click();
  await pickName(page.getByRole('combobox', { name: 'المزود' }), 'ليان');
  await page.getByRole('button', { name: 'استعلام' }).click();
  const offer = page.getByRole('radiogroup', { name: 'شركات المزود' });
  await expect(offer.getByRole('radio', { name: /سلكوم/ })).toBeDisabled();
  await offer.getByRole('radio', { name: /جولان/ }).click();
  await expect(page.getByLabel('عدد خانات الشريحة')).toHaveValue('19');
  await page.getByLabel('مقدّمة الشريحة').fill('8997');
  await page.getByRole('button', { name: 'إضافة الشركة' }).click();
  await expect.poll(() => sent).toEqual([{ providerCode: 'lian', companyCode: 'golan', name: 'جولان تليكوم', simLength: 19, simPrefix: '8997', esim: true, esimPrice: 500 }]);
  await expect(page).toHaveURL(`${admin}/companies/golan`);
});

test('an agent cannot open the add pages', async ({ page }) => {
  await serveOffice(page, 'agent');
  await page.goto('http://agent.localhost:3910/companies/new');
  await expect(page).not.toHaveURL(/\/companies\/new$/);
});
