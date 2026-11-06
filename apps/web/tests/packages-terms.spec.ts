import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const sim = { length: 19, prefix: '8997', esim: true };
const base = {
  providerCode: 'lian', providerName: '', activateMode: 'auto', sim, esimPrice: 0, dataGb: 150, months: 1,
  branchCost: 2500, mainPrice: 2800, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3800,
  autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true,
};

test('an agent sees its own buy price and writes a sell price', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const calls = await serveOffice(page, 'agent', {
    'GET /packages': () => ({
      body: {
        companies: [],
        packages: [
          { ...base, code: 'lian-wecom-150', name: '150 جيجا', companyName: 'ويكوم', editableField: 'pos', price: 3100, renewalPrice: 2700, canActivate: true, sellPrice: 3700, sellRenewalPrice: null, sellDefault: 3500, sellRenewalDefault: 3200 },
          { ...base, code: 'lian-wecom-400', name: '400 جيجا', companyName: 'ويكوم', editableField: 'pos', price: 3000, renewalPrice: 2700, canActivate: true, sellPrice: null, sellRenewalPrice: null, sellDefault: 3500, sellRenewalDefault: 3200 },
        ],
      },
    }),
    'PUT /sell-prices/lian-wecom-400': () => ({ body: { price: 3900, renewalPrice: null } }),
    'DELETE /sell-prices/lian-wecom-150': () => ({ body: { ok: true } }),
  });
  await page.goto('http://agent.localhost:3910/packages');

  const table = page.locator('table.data');
  await expect(table.locator('thead th').first()).toHaveText('الرزمة');
  await expect(table.locator('thead th').nth(1)).toHaveText('سعرك');
  await expect(table.locator('thead')).not.toContainText('تكلفة الفرع');
  const row150 = table.locator('tbody tr', { hasText: '150 جيجا' });
  await expect(row150.locator('td').nth(1)).toHaveText('31.00 ₪');
  await expect(row150.getByRole('textbox', { name: /اشتراك/ })).toHaveValue('37');

  const row400 = table.locator('tbody tr', { hasText: '400 جيجا' });
  const field = row400.getByRole('textbox', { name: /اشتراك/ });
  await expect(field).toHaveValue('');
  await expect(field).toHaveAttribute('placeholder', '35');
  const put = page.waitForRequest((request) => request.method() === 'PUT' && request.url().endsWith('/sell-prices/lian-wecom-400'));
  await field.fill('39');
  await row400.getByRole('button', { name: 'حفظ' }).click();
  expect((await put).postDataJSON()).toEqual({ price: 3900, renewalPrice: null });
  await expect.poll(() => calls.filter((call) => call.startsWith('GET /packages')).length).toBeGreaterThan(1);

  // Only a row with its own sell price offers the reset; it sends the DELETE and empties the field.
  await expect(row400.getByRole('button', { name: 'إجراءات 400 جيجا' })).toHaveCount(0);
  const del = page.waitForRequest((request) => request.method() === 'DELETE' && request.url().endsWith('/sell-prices/lian-wecom-150'));
  await row150.getByRole('button', { name: 'إجراءات 150 جيجا' }).click();
  await page.getByRole('menuitem', { name: 'إرجاع للافتراضي' }).click();
  await del;
  await expect(row150.getByRole('textbox', { name: /اشتراك/ })).toHaveValue('');
});

test('the point of sale sees its effective price and a stopped activation', async ({ page }) => {
  await serveOffice(page, 'pos', {
    'GET /packages': () => ({
      body: {
        companies: [],
        packages: [
          { ...base, code: 'lian-wecom-150', name: '150 جيجا', companyName: 'ويكوم', editableField: null, price: 3700, renewalPrice: 3200, canActivate: false, sellPrice: null, sellRenewalPrice: null, sellDefault: null, sellRenewalDefault: null },
        ],
      },
    }),
  });
  await page.goto('http://pos.localhost:3910/packages');
  await page.getByRole('button', { name: 'ويكوم' }).click();
  await expect(page.locator('.pack-card .money')).toHaveText('37.00 ₪');
  await page.locator('.pack-card').click();
  await expect(page.locator('form .pack-price .money')).toHaveText('37.00 ₪');
  await expect(page.getByText('التفعيل موقوف على هذا الحساب.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'تفعيل', exact: true })).toHaveCount(0);
});
