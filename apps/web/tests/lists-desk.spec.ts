import { expect, test } from '@playwright/test';
import { asBranch, expectFullTable } from './desk';

const empty = (body: string) => (route: import('@playwright/test').Route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body });

test('operations, accounting, audit, providers, and consumption fill the desk', async ({ page }) => {
  await asBranch(page);
  await page.route('**/office/ledger/operations**', empty(JSON.stringify({ entries: [] })));
  await page.route('**/office/accounting**', empty(JSON.stringify({ entries: [] })));
  await page.route('**/office/audit**', empty(JSON.stringify({ entries: [] })));
  await page.route('**/office/providers**', empty(JSON.stringify({
    providers: [{ code: 'cell', name: 'سلكوم', companies: [] }],
  })));
  await page.route('**/office/reports/consumption**', empty(JSON.stringify({ rows: [] })));
  await page.goto('http://admin.localhost:3910/operations');
  await expectFullTable(page, 'العمليات');
  await page.goto('http://admin.localhost:3910/accounting');
  await expectFullTable(page, 'المحاسبة');
  await page.goto('http://admin.localhost:3910/audit');
  await expectFullTable(page, 'سجل التدقيق');
  await page.goto('http://admin.localhost:3910/providers');
  await expectFullTable(page, 'المزودون');
  await page.goto('http://admin.localhost:3910/providers/cell');
  await expectFullTable(page, 'سلكوم');
  await expect(page.getByRole('heading', { level: 2, name: 'الرزم' })).toHaveCount(0);
  await page.goto('http://admin.localhost:3910/reports/consumption');
  await expectFullTable(page, 'تقارير استهلاك الرصيد');
});
