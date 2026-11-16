import { expect, test } from '@playwright/test';
import { serveApi } from './desk';

const sim = { length: 19, prefix: '8997', esim: true };
const base = {
  providerCode: null, providerName: '', activateMode: null, sellable: true, activateInput: 'generated', sim, esimPrice: 0, dataGb: 150, months: 1,
  branchCost: 2500, mainPrice: 2800, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3800,
  autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true,
};

test('an agent sees its own buy price and writes a sell price', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const calls = await serveApi(page, 'agent', {
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

  const table = page.getByTestId('data-table');
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

// UI maintenance P0.7 (3.2-02): under 640px a table row is a card; the sell cell (two price fields, save, and the
// reset menu on a row with its own price) takes the card's whole row and wraps there, every part inside the cell.
test('on a phone the sell cell takes the card row and keeps its fields inside', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await serveApi(page, 'agent', {
    'GET /packages': () => ({
      body: {
        companies: [],
        packages: [
          { ...base, code: 'lian-wecom-150', name: '150 جيجا', companyName: 'ويكوم', editableField: 'pos', price: 3100, renewalPrice: 2700, canActivate: true, sellPrice: 123456, sellRenewalPrice: 98765, sellDefault: 3500, sellRenewalDefault: 3200 },
        ],
      },
    }),
  });
  await page.goto('http://agent.localhost:3910/packages');

  const row = page.getByTestId('data-table').locator('tbody tr', { hasText: '150 جيجا' });
  await expect(row.getByRole('textbox', { name: /اشتراك/ })).toHaveValue('1234.56');
  const cell = await row.locator('td').filter({ has: page.getByTestId('sell-cell') }).evaluate((td) => {
    const box = td.getBoundingClientRect();
    const card = td.parentElement!.getBoundingClientRect();
    const parts = [...td.querySelectorAll('input, button')].map((part) => part.getBoundingClientRect());
    return {
      spare: card.width - box.width,
      parts: parts.length,
      inside: parts.every((part) => part.left >= box.left - 1 && part.right <= box.right + 1),
    };
  });
  // The card's padding (16px a side) is all that is left beside a cell that spans the row.
  expect(cell.spare).toBeLessThanOrEqual(34);
  expect(cell.parts).toBe(4);
  expect(cell.inside).toBe(true);
  // The save button is pressable where it is drawn: nothing covers it.
  await row.getByRole('button', { name: 'حفظ' }).click({ trial: true });
});

test('the point of sale sees its effective price and a stopped activation', async ({ page }) => {
  await serveApi(page, 'pos', {
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
  await expect(page.getByTestId('pack-card').getByTestId('money')).toHaveText('37.00 ₪');
  await page.getByTestId('pack-card').click();
  // The package picked is an answer above the form; the price is on the pay bar's button, which a stopped account has not.
  await expect(page.getByTestId('pos-answer').last()).toContainText('الرزمة');
  await expect(page.getByText('التفعيل موقوف على هذا الحساب.')).toBeVisible();
  await expect(page.getByTestId('pos-pay').getByRole('button')).toHaveCount(0);
});
