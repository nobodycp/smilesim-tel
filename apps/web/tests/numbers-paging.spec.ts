import { expect, test } from '@playwright/test';
import { pickName } from './desk';

const mock = 'http://localhost:3911';
const desk = 'http://admin.localhost:3910';

// The mock answers 31 lines and a cursor, then 5 more; it says 36 in total. The table pages by the
// saved page size (10), counts its pages from the total, and reads the next cursor only when a page
// asks for rows it does not hold yet.
test('numbers list pages by the total, reads the next cursor on demand, and filters go to the server', async ({ page, request }) => {
  await page.context().addCookies([{ name: 'mock-branch', value: '1', url: desk }]);
  await request.post(`${mock}/__lines/reset`);
  const log = async () => (await (await request.get(`${mock}/__lines/log`)).json()) as Record<string, string>[];

  await page.goto(`${desk}/numbers`);
  const rows = page.locator('table.data tbody tr');
  const pager = page.locator('.table-pager');
  await expect(rows).toHaveCount(10);
  await expect(pager).toContainText('36');
  await expect(page.getByRole('button', { name: '4', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '5', exact: true })).toHaveCount(0);
  expect((await log()).filter((query) => query.cursor)).toHaveLength(0);

  // Page 2 and 3 are already in hand; page 4 needs the second cursor.
  await page.getByRole('button', { name: '3', exact: true }).click();
  await expect(rows).toHaveCount(10);
  expect((await log()).filter((query) => query.cursor)).toHaveLength(0);
  await page.getByRole('button', { name: '4', exact: true }).click();
  await expect(rows).toHaveCount(6);
  const served = await log();
  expect(served.at(-1)).toEqual({ cursor: 'c31' });
  expect(served.filter((query) => query.cursor)).toHaveLength(1);

  // A status filter resets the list and is sent to the server, with no cursor.
  await page.getByLabel('الحالة').selectOption('frozen');
  await expect(rows).toHaveCount(3);
  await expect(page.getByRole('button', { name: '2', exact: true })).toHaveCount(0);
  expect((await log()).at(-1)).toEqual({ status: 'frozen' });

  // The package options come from the catalog, not from the loaded rows.
  // The package filter is a NameField (spec 2026-11-09-admin-review, 2a): typed, then picked.
  await pickName(page.locator('.filter-panel').getByLabel('الرزمة'), 'cell-400', /./);
  await expect(async () => expect((await log()).at(-1)).toEqual({ status: 'frozen', packageCode: 'cell-400' })).toPass();

  // Search sits in the filter and waits for a pause, then sends the text as typed.
  await expect(page.locator('.table-search')).toHaveCount(0);
  await page.locator('.filter-panel').getByLabel('الرقم أو السيريال').fill('055 0000');
  await expect(async () => expect((await log()).at(-1)).toEqual({ q: '055 0000', status: 'frozen', packageCode: 'cell-400' })).toPass();
  const beforeClear = (await log()).length;
  await page.getByRole('button', { name: 'مسح', exact: true }).click();
  await expect(rows).toHaveCount(10);
  await expect(page.getByRole('button', { name: '1', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: '4', exact: true })).toBeVisible();
  // The cleared list shows from the cache at once and is asked again in the background: every chunk read before for
  // it, starting from the first, with no filter sent.
  await expect(async () => expect((await log()).slice(beforeClear)[0]).toEqual({})).toPass();
  expect((await log()).slice(beforeClear).every((query) => !query.status && !query.packageCode && !query.q)).toBe(true);
});
