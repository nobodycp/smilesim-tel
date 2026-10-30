import { expect, test } from '@playwright/test';

const mock = 'http://localhost:3911';
const desk = 'http://admin.localhost:3910';

test('numbers list loads more, and filters go to the server', async ({ page, request }) => {
  await page.context().addCookies([{ name: 'mock-branch', value: '1', url: desk }]);
  await request.post(`${mock}/__lines/reset`);
  const log = async () => (await (await request.get(`${mock}/__lines/log`)).json()) as Record<string, string>[];

  await page.goto(`${desk}/numbers`);
  const rows = page.locator('table.data tbody tr');
  const more = page.getByRole('button', { name: 'تحميل المزيد' });
  await expect(rows).toHaveCount(31);
  await expect(more).toBeVisible();
  await expect(page.locator('.pane .hint')).toContainText('31');

  await more.click();
  await expect(rows).toHaveCount(36);
  await expect(more).toHaveCount(0);
  const served = await log();
  expect(served.at(-1)).toEqual({ cursor: 'c31' });
  expect(served.filter((query) => query.cursor)).toHaveLength(1);

  // A status filter resets the list and is sent to the server, with no cursor.
  await page.getByLabel('الحالة').selectOption('frozen');
  await expect(rows).toHaveCount(3);
  await expect(more).toHaveCount(0);
  expect((await log()).at(-1)).toEqual({ status: 'frozen' });

  // The package options come from the catalog, not from the loaded rows.
  await page.getByLabel('الرزمة').selectOption('cell-400');
  await expect(async () => expect((await log()).at(-1)).toEqual({ status: 'frozen', packageCode: 'cell-400' })).toPass();

  // Search waits for a pause, then sends the text as typed; clearing restores the first page.
  await page.getByLabel('الرقم').fill('055 0000');
  await expect(async () => expect((await log()).at(-1)).toEqual({ q: '055 0000', status: 'frozen', packageCode: 'cell-400' })).toPass();
  await page.getByRole('button', { name: 'مسح' }).click();
  await expect(rows).toHaveCount(31);
  await expect(more).toBeVisible();
  expect((await log()).at(-1)).toEqual({});
});
