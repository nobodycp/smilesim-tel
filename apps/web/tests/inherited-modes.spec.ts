import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// A package's run modes follow its provider unless set on the package (spec 2026-11-09-admin-review, 3; ADR 0009):
// folded with a count, each card says where its mode comes from, and «رجوع للموروث» follows the provider again.
const sheet = {
  code: 'lian-wecom-500', name: '500 جيجا', providerCode: 'lian', providerName: 'ليان', companyCode: 'wecom', companyName: 'ويكوم',
  enabled: true, forSale: true, dataGb: 500, smsCount: null, minutes: -1, details: '', months: 1, suspendAfterDays: 90, esimAvailable: true,
  branchCost: 2000, mainPrice: 2300, agentPrice: 2500, posPrice: 2700, subscriberPrice: 3000,
  renewalBranchCost: 2000, renewalMainPrice: 2300, renewalAgentPrice: 2500, renewalPosPrice: 2700, renewalSubscriberPrice: 3000,
  esimPrice: null, esimPriceEffective: 0, esimPriceSource: 'company', lines: 0, activeLines: 0, renewals: [], switches: [],
  modes: { activate: 'auto', charge: 'off', extend: 'manual', disconnect: 'manual', freeze: 'manual', switch: 'manual', rename: 'manual', sim: 'manual', companySwitch: 'manual' },
  inheritedModes: ['activate', 'extend', 'disconnect', 'freeze', 'switch', 'rename', 'sim', 'companySwitch'],
  providerModes: { activate: 'auto', charge: 'manual', extend: 'manual', disconnect: 'manual', freeze: 'manual', switch: 'manual', rename: 'manual', sim: 'manual', companySwitch: 'manual' },
};

test('the run tab shows which modes follow the provider and sends «inherit» to follow it again', async ({ page }) => {
  const sent: unknown[] = [];
  await serveOffice(page, 'branch', {
    'GET /packages/lian-wecom-500/sheet': () => ({ body: sheet }),
    'GET /packages/lian-wecom-500/custom-prices': () => ({ body: [] }),
    'GET /users': () => ({ body: { users: [] } }),
    'GET /companies': () => ({ body: { companies: [] } }),
    'GET /lines': () => ({ body: { lines: [], poses: [], nextCursor: null, total: 0 } }),
    'PATCH /packages/lian-wecom-500/mode': () => ({ body: { ok: true } }),
  });
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().endsWith('/office/packages/lian-wecom-500/mode')) sent.push(request.postDataJSON());
  });
  await page.goto('http://admin.localhost:3910/companies/wecom/packages/lian-wecom-500');
  await page.getByRole('tab', { name: 'إجراءات الحزمة' }).click();
  const fold = page.locator('.inherit-fold');
  await expect(fold.locator('summary')).toContainText('8 موروثة من المزود · 1 مخصصة');
  // One mode of its own: the fold opens by itself.
  await expect(fold).toHaveAttribute('open', '');
  const activate = page.locator('.mode-card', { has: page.getByRole('radiogroup', { name: 'التشغيل تفعيل' }) });
  await expect(activate.locator('.mode-source')).toHaveText('موروث من المزود');
  const charge = page.locator('.mode-card', { has: page.getByRole('radiogroup', { name: 'التشغيل شحن' }) });
  await expect(charge.locator('.mode-source')).toContainText('مخصص');
  await charge.getByRole('button', { name: 'رجوع للموروث' }).click();
  await expect.poll(() => sent).toEqual([{ action: 'charge', mode: 'inherit' }]);
});
