import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const admin = 'http://admin.localhost:3910';
const event = (id: string, result: string) => ({
  id, at: '2026-11-08T10:00:00.000Z', action: 'fund', result, reason: '', ip: '', actorLoginName: 'admin', actorLayer: 'branch', subjectKind: 'account', subjectRef: 'pos1',
});

// A filter change asks the server for the new list and keeps the rows on screen until it lands: no blank table.
test('a filter change keeps the previous rows until the new list arrives', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /audit': (url) =>
      url.searchParams.get('result') === 'fail'
        ? { body: { total: 1, items: [event('f1', 'fail')], nextCursor: null }, delay: 1500 }
        : { body: { total: 2, items: [event('o1', 'ok'), event('o2', 'ok')], nextCursor: null } },
  });
  await page.goto(`${admin}/audit`);
  const rows = page.locator('table.data tbody tr');
  await expect(rows).toHaveCount(2);
  await page.getByLabel('النتيجة').selectOption('fail');
  // While the answer is on its way, the old rows stay and no skeleton replaces them.
  await page.waitForTimeout(400);
  expect(await rows.count()).toBe(2);
  expect(await page.locator('.table-skeleton').count()).toBe(0);
  await expect(rows).toHaveCount(1);
});

// After a write the list is asked again in the background, every chunk already read, and the reader stays on the page.
test('taking a task on page 3 keeps the reader on page 3, with rows on screen while the list is asked again', async ({ page }) => {
  const task = (n: number) => ({
    id: `t${n}`, action: 'activate', status: 'pending', posLoginName: 'pos', submitterLoginName: 'pos', assigneeLoginName: null, posDelta: -26,
    msisdn: `05500000${String(n).padStart(2, '0')}`, packageName: '400 جيجا', log: '', note: '', resultNote: '', canTake: true, canWork: false, canCancel: false,
  });
  const all = Array.from({ length: 25 }, (_, i) => task(i));
  let taken = 0;
  await serveOffice(page, 'branch', {
    'GET /tasks': (url) => {
      const start = Number(url.searchParams.get('cursor') ?? 0);
      return {
        body: { items: all.slice(start, start + 10), total: all.length, nextCursor: start + 10 < all.length ? String(start + 10) : null },
        delay: taken ? 800 : 0,
      };
    },
    'POST /tasks/t21/take': () => {
      taken += 1;
      return { body: { ok: true } };
    },
  });
  await page.goto('http://admin.localhost:3910/tasks');
  await page.getByRole('button', { name: '3', exact: true }).click();
  const rows = page.locator('table.data tbody tr');
  await expect(rows).toHaveCount(5);
  await rows.nth(1).getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'استلام' }).click();
  await expect.poll(() => taken).toBe(1);
  // Each chunk answers slowly on purpose. After the first chunk of the refetch has landed (~800 ms) the same page and
  // rows are still there with no skeleton: the list did not drop back to its first chunk.
  // A snapshot, not a retrying assertion: the question is what is on screen at this moment.
  await page.waitForTimeout(1300);
  expect(await page.locator('.table-skeleton').count()).toBe(0);
  expect(await rows.count()).toBe(5);
  await expect(page.getByRole('button', { name: '3', exact: true })).toHaveAttribute('aria-current', 'page');
});
