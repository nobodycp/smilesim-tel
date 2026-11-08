import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const admin = 'http://admin.localhost:3910';

// The filters live in the address: a link opens a filtered list, a filter change is written back, and the browser's
// back button returns to the filter before it.
test('numbers read their filters from the address, write them back, and follow back/forward', async ({ page }) => {
  const asked: string[] = [];
  await serveOffice(page, 'branch', {
    'GET /lines': (url) => {
      asked.push(url.searchParams.get('status') ?? '');
      return { body: { lines: [], poses: [], nextCursor: null, total: 0 } };
    },
    'GET /packages': () => ({ body: { packages: [], companies: [] } }),
  });
  await page.goto(`${admin}/numbers?status=frozen`);
  const status = page.getByLabel('الحالة');
  await expect(status).toHaveValue('frozen');
  await expect.poll(() => asked.at(-1)).toBe('frozen');
  await status.selectOption('active');
  await expect(page).toHaveURL(/status=active/);
  await expect.poll(() => asked.at(-1)).toBe('active');
  // A status the list does not know is ignored, not sent.
  await page.goto(`${admin}/numbers?status=bogus`);
  await expect(status).toHaveValue('');
  await page.goBack();
  await expect(status).toHaveValue('active');
});

// The shell search sends `/users?q=` even from /users; the page follows the address it is on.
test('users follow a new ?q= while already on the page, and the typed search goes to the address', async ({ page }) => {
  const user = (loginName: string) => ({
    loginName, nickname: loginName, layer: 'pos', roleName: '', parentLogin: 'agent1', balance: 0, ceiling: 0, frozen: false, self: false, directChild: false,
    canEnter: false, canFreeze: false, canDelete: false,
  });
  await serveOffice(page, 'branch', { 'GET /users': () => ({ body: { users: [user('alpha'), user('beta'), user('gamma')] } }) });
  await page.goto(`${admin}/users`);
  const rows = page.locator('.data tbody tr');
  await expect(rows).toHaveCount(3);
  await page.evaluate(() => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push('/users?q=beta'));
  await expect(rows).toHaveCount(1);
  const search = page.locator('.filter-panel input').first();
  await expect(search).toHaveValue('beta');
  await search.fill('gam');
  await expect(rows).toHaveCount(1);
  await expect(page).toHaveURL(/q=gam/);
});
