import { expect, test } from '@playwright/test';
import { asBranch, expectFullTable } from './desk';

const empty = (body: string) => (route: import('@playwright/test').Route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body });

test('finance, audit, and providers fill the desk', async ({ page }) => {
  await asBranch(page);
  await page.route('**/v1/finance**', empty(JSON.stringify({ items: [] })));
  await page.route('**/v1/provider-operations**', empty(JSON.stringify({
    items: [], nextCursor: null, stats: { count: 0, cost: 0, monthCost: 0 }, providers: [],
  })));
  await page.route('**/v1/audit**', empty(JSON.stringify({ items: [] })));
  await page.route('**/v1/providers/cell/settings', empty(JSON.stringify({ code: 'cell', name: 'سلكوم', modes: {}, esimPrice: null })));
  await page.route('**/v1/providers', empty(JSON.stringify({
    providers: [{ code: 'cell', name: 'سلكوم', companies: [] }],
  })));
  await page.route('**/v1/postpaid/companies', empty(JSON.stringify({ companies: [] })));
  await page.goto('http://admin.localhost:3910/finance');
  await expectFullTable(page, 'المالية');
  await page.goto('http://admin.localhost:3910/postpaid/provider-operations');
  await expectFullTable(page, 'عمليات المزودين');
  await page.goto('http://admin.localhost:3910/audit');
  await expectFullTable(page, 'سجل النشاط');
  await page.goto('http://admin.localhost:3910/postpaid/providers');
  await expectFullTable(page, 'المزودون');
  await page.goto('http://admin.localhost:3910/postpaid/providers/cell');
  await expectFullTable(page, 'سلكوم');
  await expect(page.getByRole('heading', { level: 2, name: 'الرزم' })).toHaveCount(0);
});
