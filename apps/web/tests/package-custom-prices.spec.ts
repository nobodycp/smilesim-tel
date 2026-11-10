import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const sheet = {
  code: 'lian-wecom-500', name: '500 جيجا', providerCode: 'lian', providerName: 'ليان', companyCode: 'wecom', companyName: 'ويكوم',
  enabled: true, forSale: true,
  branchCost: 2500, mainPrice: 2800, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3500,
  renewalBranchCost: 2000, renewalMainPrice: 2300, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3200,
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
  const calls = await serveOffice(page, 'branch', {
    'GET /packages/lian-wecom-500/sheet': () => ({ body: sheet }),
    'GET /packages/lian-wecom-500/custom-prices': () => ({ body: [customRow] }),
    'PUT /packages/lian-wecom-500/custom-prices/pos1': () => ({ body: { ...customRow, price: 3100 } }),
    'DELETE /packages/lian-wecom-500/custom-prices/pos1': () => ({ body: { ok: true } }),
    'GET /users': () => ({ body: { users: [{ loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos' }] } }),
    'GET /companies': () => ({ body: { companies: [] } }),
    'GET /lines': () => ({ body: { items: [], poses: [], nextCursor: null } }),
  });
  await page.goto('http://admin.localhost:3910/providers/lian/lian-wecom-500');
  await page.getByRole('tab', { name: 'تخصيص سعر' }).click();

  const row = page.locator('.data tbody tr', { hasText: 'pos1' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.money.muted').first()).toHaveText('35.00 ₪');
  const field = row.getByRole('textbox', { name: /اشتراك/ });
  await expect(field).toHaveValue('29');

  const put = page.waitForRequest((request) => request.method() === 'PUT' && request.url().endsWith('/custom-prices/pos1'));
  await field.fill('31');
  await field.press('Enter');
  expect((await put).postDataJSON()).toEqual({ price: 3100 });

  await row.getByRole('button', { name: /إجراءات/ }).click();
  await page.getByRole('menuitem', { name: 'إرجاع للافتراضي' }).click();
  await expect.poll(() => calls).toContain('DELETE /packages/lian-wecom-500/custom-prices/pos1');
});
