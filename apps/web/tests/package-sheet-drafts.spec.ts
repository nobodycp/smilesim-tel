import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const base = {
  code: 'lian-wecom-500', name: '500 جيجا', providerCode: 'lian', providerName: 'ليان', companyCode: 'wecom', companyName: 'ويكوم',
  enabled: true, forSale: true,
  branchCost: 2500, mainPrice: 2800, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3500,
  renewalBranchCost: 2000, renewalMainPrice: 2300, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3200,
  esimPrice: null, esimPriceEffective: 0, esimPriceSource: 'company',
  lines: 0, activeLines: 0, renewals: [], switches: [],
  modes: { activate: 'auto', charge: 'auto', extend: 'auto', disconnect: 'auto', freeze: 'auto', switch: 'auto', rename: 'auto', sim: 'auto' },
};

// Saving in one tab reloads the sheet. A chain price the user typed and has not saved stays; one they left alone
// follows the server.
test('a reload keeps typed chain prices and refreshes untouched ones', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let sheet = base;
  await serveOffice(page, 'branch', {
    'GET /packages/lian-wecom-500/sheet': () => ({ body: sheet }),
    'GET /packages/lian-wecom-500/custom-prices': () => ({ body: [] }),
    'PATCH /packages/lian-wecom-500/mode': () => {
      sheet = { ...base, agentPrice: 3100, modes: { ...base.modes, charge: 'manual' } };
      return { body: { ok: true } };
    },
    'GET /users': () => ({ body: { users: [] } }),
    'GET /companies': () => ({ body: { companies: [] } }),
    'GET /lines': () => ({ body: { lines: [], poses: [], nextCursor: null, total: 0 } }),
  });
  await page.goto('http://admin.localhost:3910/providers/lian/lian-wecom-500');
  await page.getByRole('tab', { name: 'الأسعار' }).click();
  const board = page.getByLabel('السلسلة');
  await board.getByLabel('وكيل رئيسي').first().fill('30');

  await page.getByRole('tab', { name: 'إجراءات الحزمة' }).click();
  const reloaded = page.waitForResponse((response) => response.url().endsWith('/sheet') && response.request().method() === 'GET');
  await page.getByLabel('التشغيل شحن').selectOption('manual');
  await reloaded;
  await expect(page.getByLabel('التشغيل شحن')).toHaveValue('manual');

  await page.getByRole('tab', { name: 'الأسعار' }).click();
  await expect(board.getByLabel('وكيل رئيسي').first()).toHaveValue('30');
  await expect(board.getByLabel('وكيل', { exact: true }).first()).toHaveValue('31');
});

// The numbers tab lists every line on the package, not only the first page the API sends.
test('the numbers tab reads every page of lines', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const line = (id: string) => ({
    id, msisdn: `05500000${id}`, iccid: '', esim: false, status: 'active', packageCode: 'lian-wecom-500', packageName: '500 جيجا',
    companyCode: 'wecom', companyName: 'ويكوم', providerCode: 'lian', posLogin: 'pos1', posNickname: 'نقطة', endsAt: '2026-12-01T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z', operations: null,
  });
  await serveOffice(page, 'branch', {
    'GET /packages/lian-wecom-500/sheet': () => ({ body: { ...base, lines: 3, activeLines: 3 } }),
    'GET /packages/lian-wecom-500/custom-prices': () => ({ body: [] }),
    'GET /users': () => ({ body: { users: [] } }),
    'GET /companies': () => ({ body: { companies: [] } }),
    'GET /lines': (url) => ({
      body: url.searchParams.get('cursor') === 'p2'
        ? { lines: [line('03')], poses: [], nextCursor: null, total: 3 }
        : { lines: [line('01'), line('02')], poses: [], nextCursor: 'p2', total: 3 },
    }),
  });
  await page.goto('http://admin.localhost:3910/providers/lian/lian-wecom-500');
  await page.getByRole('tab', { name: 'الأرقام' }).click();
  await expect(page.locator('.data tbody tr')).toHaveCount(3);
});
