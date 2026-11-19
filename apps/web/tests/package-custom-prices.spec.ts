import { expect, test } from '@playwright/test';
import { serveApi } from './desk';

const sheet = {
  code: 'lian-wecom-500', name: '500 جيجا', providerCode: 'lian', providerName: 'ليان', companyCode: 'wecom', companyName: 'ويكوم',
  enabled: true, forSale: true,
  branchCost: 2500, mainPrice: 2800, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3500,
  renewalBranchCost: 2000, renewalMainPrice: 2300, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3200,
  durations: [{ id: 'd1', unit: 'month', count: 1, days: 30, branchCost: 2000, mainPrice: 2300, agentPrice: 2700, posPrice: 3200, subscriberPrice: 3200, noDisconnect: false, forSale: true, enabled: true }],
  esimPrice: null, esimPriceEffective: 0, esimPriceSource: 'company',
  lines: 0, activeLines: 0, renewals: [], switches: [],
  modes: { activate: 'auto', charge: 'auto', extend: 'auto', disconnect: 'auto', freeze: 'auto', switch: 'auto', rename: 'auto', sim: 'auto' },
};

const customRow = {
  loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos', parentLoginName: 'ag1',
  defaultPrice: 3500, defaultRenewalPrice: 3200, price: 2900, renewalPrice: null,
};

test('the custom prices tab lists priced accounts and edits them inline', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const calls = await serveApi(page, 'branch', {
    'GET /postpaid/packages/lian-wecom-500/sheet': () => ({ body: sheet }),
    'GET /postpaid/packages/lian-wecom-500/custom-prices': () => ({ body: [customRow] }),
    'PUT /postpaid/packages/lian-wecom-500/custom-prices/pos1': () => ({ body: { ...customRow, price: 3100 } }),
    'DELETE /postpaid/packages/lian-wecom-500/custom-prices/pos1': () => ({ body: { ok: true } }),
    'GET /users': () => ({ body: { users: [{ loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos' }] } }),
    'GET /postpaid/companies': () => ({ body: { companies: [] } }),
    'GET /postpaid/lines': () => ({ body: { items: [], poses: [], nextCursor: null } }),
  });
  await page.goto('http://admin.localhost:3910/postpaid/companies/wecom/packages/lian-wecom-500');
  await page.getByRole('tab', { name: 'تخصيص سعر' }).click();

  const row = page.getByTestId('data-table').locator('tbody tr', { hasText: 'pos1' });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('price-pair').first().getByTestId('money')).toHaveText('35.00 ₪');
  const field = row.getByRole('textbox', { name: /اشتراك/ });
  await expect(field).toHaveValue('29');

  const put = page.waitForRequest((request) => request.method() === 'PUT' && request.url().endsWith('/custom-prices/pos1'));
  await field.fill('31');
  await field.press('Enter');
  expect((await put).postDataJSON()).toEqual({ price: 3100 });

  await row.getByRole('button', { name: /إجراءات/ }).click();
  await page.getByRole('menuitem', { name: 'إرجاع للافتراضي' }).click();
  await expect.poll(() => calls).toContain('DELETE /postpaid/packages/lian-wecom-500/custom-prices/pos1');
});

test('the custom prices table sorts by each account own price and by a signed difference', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Same default price, so the old text sort (by the muted default) could not order them; one difference is -6.00.
  const rows = [
    { ...customRow, loginName: 'pos1', nickname: 'أ', price: 2900 },
    { ...customRow, loginName: 'pos2', nickname: 'ب', price: 3400 },
    { ...customRow, loginName: 'pos3', nickname: 'ج', price: 3700 },
  ];
  await serveApi(page, 'branch', {
    'GET /postpaid/packages/lian-wecom-500/sheet': () => ({ body: sheet }),
    'GET /postpaid/packages/lian-wecom-500/custom-prices': () => ({ body: rows }),
    'GET /users': () => ({ body: { users: [] } }),
    'GET /postpaid/companies': () => ({ body: { companies: [] } }),
    'GET /postpaid/lines': () => ({ body: { items: [], poses: [], nextCursor: null } }),
  });
  await page.goto('http://admin.localhost:3910/postpaid/companies/wecom/packages/lian-wecom-500');
  await page.getByRole('tab', { name: 'تخصيص سعر' }).click();

  const table = page.getByTestId('data-table');
  const order = () => table.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => /pos\d/.exec(tr.textContent ?? '')?.[0]));
  await expect.poll(order).toEqual(['pos1', 'pos2', 'pos3']);

  const diff = table.locator('thead th', { hasText: 'الفرق' }).getByRole('button');
  await diff.click();
  await expect.poll(order).toEqual(['pos1', 'pos2', 'pos3']);
  await diff.click();
  await expect.poll(order).toEqual(['pos3', 'pos2', 'pos1']);

  const price = table.locator('thead th', { hasText: 'سعر الاشتراك' }).getByRole('button');
  await price.click();
  await price.click();
  await expect.poll(order).toEqual(['pos3', 'pos2', 'pos1']);
});

// UI maintenance P0.7 (3.2-02): under 640px a table row is a card, two values a row; a cell that holds a price pair
// (the default beside its own price field, and the difference pair) takes the card's whole row instead, so the field
// stays inside its cell.
test('on a phone the custom price cells take the card row and keep their fields inside', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await serveApi(page, 'branch', {
    'GET /postpaid/packages/lian-wecom-500/sheet': () => ({ body: sheet }),
    'GET /postpaid/packages/lian-wecom-500/custom-prices': () => ({ body: [{ ...customRow, renewalPrice: 123456 }] }),
    'GET /users': () => ({ body: { users: [] } }),
    'GET /postpaid/companies': () => ({ body: { companies: [] } }),
    'GET /postpaid/lines': () => ({ body: { items: [], poses: [], nextCursor: null } }),
  });
  await page.goto('http://admin.localhost:3910/postpaid/companies/wecom/packages/lian-wecom-500');
  await page.getByRole('tab', { name: 'تخصيص سعر' }).click();

  const row = page.getByTestId('data-table').locator('tbody tr', { hasText: 'pos1' });
  await expect(row.getByRole('textbox', { name: /اشتراك/ })).toBeVisible();
  const cells = await row.locator('td').filter({ has: page.getByTestId('price-pair') }).evaluateAll((tds) => tds.map((td) => {
    const cell = td.getBoundingClientRect();
    const card = td.parentElement!.getBoundingClientRect();
    const inside = [...td.querySelectorAll('*')].every((child) => {
      const box = child.getBoundingClientRect();
      return !box.width || (box.left >= cell.left - 1 && box.right <= cell.right + 1);
    });
    return { spare: card.width - cell.width, inside };
  }));
  expect(cells).toHaveLength(3);
  for (const cell of cells) {
    // The card's padding (16px a side) is all that is left beside a cell that spans the row.
    expect(cell.spare).toBeLessThanOrEqual(34);
    expect(cell.inside).toBe(true);
  }
});
