// The shared page tools (useLoad, usePaged, useAction, useRequireLayer, DataTable, EmptyState, lineActions)
// have no React harness of their own, so they are exercised through the real pages that use them.
import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const admin = 'http://admin.localhost:3910';

const line = (id: string, status = 'active', extra = {}) => ({
  id, msisdn: `055${id.replace(/\D/g, '').padStart(7, '0')}`, iccid: null, esim: false, status,
  packageCode: 'cell-400', packageName: '400 جيجا', companyName: 'سلكوم', posLogin: 'pos', posPrice: 26,
  createdAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-12T00:00:00.000Z', ...extra,
});

const account = (id: string, msisdn: string) => ({
  id, at: '2026-10-02T10:30:00.000Z', msisdn, companyName: 'سلكوم', packageName: '400 جيجا',
  packagePrice: 26, balanceBefore: 100, balanceAfter: 74,
});

test.describe('layer guard', () => {
  test('a point of sale is sent away from /users through the router, not by a page load', async ({ page }) => {
    // Counts document loads in this tab: a router redirect leaves it at 1, window.location makes it 2.
    await page.addInitScript(() => sessionStorage.setItem('loads', String(Number(sessionStorage.getItem('loads') ?? 0) + 1)));
    const calls = await serveOffice(page, 'pos');
    await page.goto('/users');
    await page.waitForURL((url) => url.pathname === '/');
    expect(await page.evaluate(() => sessionStorage.getItem('loads'))).toBe('1');
    expect(calls.filter((call) => call.startsWith('GET /users'))).toEqual([]);
  });

  test('a branch page closes for another layer on the branch door, and opens for the branch', async ({ page }) => {
    const calls = await serveOffice(page, 'agent', { 'GET /providers': () => ({ body: { providers: [] } }) });
    await page.goto(`${admin}/providers`);
    await page.waitForURL((url) => url.pathname === '/');
    expect(calls.filter((call) => call.startsWith('GET /providers'))).toEqual([]);

    const open = await page.context().newPage();
    const branchCalls = await serveOffice(open, 'branch', { 'GET /providers': () => ({ body: { providers: [] } }) });
    await open.goto(`${admin}/providers`);
    await expect(open.getByRole('heading', { level: 1, name: 'المزودون' })).toBeVisible();
    expect(new URL(open.url()).pathname).toBe('/providers');
    expect(branchCalls.filter((call) => call.startsWith('GET /providers'))).toHaveLength(1);
  });
});

test.describe('DataTable and EmptyState', () => {
  const task = (id: string, extra = {}) => ({
    id, action: 'activate', status: 'pending', posLogin: 'pos', submitterLogin: 'pos', assigneeLogin: null, posDelta: -26,
    msisdn: `055000000${id}`, packageName: '400 جيجا', log: '', note: '', resultNote: '', canTake: false, canWork: false, canCancel: false, ...extra,
  });

  test('the tasks table writes num and row-actions on header and cells, shows a skeleton while loading, and RowMenu only where there are actions', async ({ page }) => {
    await serveOffice(page, 'branch', { 'GET /tasks': () => ({ body: { tasks: [task('1', { canTake: true }), task('2')], nextCursor: null }, delay: 700 }) });
    await page.goto(`${admin}/tasks`);
    await expect(page.locator('.sheet .table-skeleton')).toBeVisible();
    await expect(page.locator('table.data tbody tr')).toHaveCount(2);
    await expect(page.locator('.table-skeleton')).toHaveCount(0);
    await expect(page.locator('table.data thead th')).toHaveCount(7);
    await expect(page.locator('table.data th.num')).toHaveCount(1);
    await expect(page.locator('table.data td.num')).toHaveCount(2);
    await expect(page.locator('table.data th.row-actions')).toHaveCount(1);
    await expect(page.locator('table.data td.row-actions')).toHaveCount(2);
    await expect(page.locator('table.data td.msisdn')).toHaveCount(2);
    await expect(page.locator('table.data td.row-actions .row-menu')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /إجراءات 0550000001/ })).toBeVisible();
  });

  test('an empty list shows .empty inside the pane with no inline style; the ledger lists keep their head', async ({ page }) => {
    await serveOffice(page, 'branch', {
      'GET /lines': () => ({ body: { lines: [], poses: [], nextCursor: null } }),
      'GET /packages': () => ({ body: { packages: [], companies: [] } }),
      'GET /accounting': () => ({ body: { entries: [], nextCursor: null } }),
    });
    await page.goto(`${admin}/numbers`);
    const empty = page.locator('.pane > .empty');
    await expect(empty).toHaveText('لا أرقام بعد.');
    await expect(empty).not.toHaveAttribute('style', /./);
    await expect(page.locator('.pane table.data')).toHaveCount(0);

    await page.goto(`${admin}/accounting`);
    await expect(page.locator('.sheet > .empty')).toHaveText('لا حركات بعد.');
    await expect(page.locator('.sheet > table.data thead th')).toHaveCount(7);
    await expect(page.locator('.sheet > table.data thead th.num')).toHaveCount(3);
  });
});

test.describe('usePaged', () => {
  for (const [path, route, key, name] of [
    ['accounting', 'GET /accounting', 'entries', 'المحاسبة'],
    ['audit', 'GET /audit', 'entries', 'سجل التدقيق'],
    ['operations', 'GET /ledger/operations', 'entries', 'العمليات'],
  ] as const) {
    test(`${path} loads the next page by cursor and appends it`, async ({ page }) => {
      const row = (n: number) => ({
        ...account(`r${n}`, `055000000${n}`), action: 'extend', status: 'done', kind: 'extend', amount: -26,
        providerName: 'مزود', actorName: 'الكاشير', note: null, actorLogin: 'pos',
      });
      const calls = await serveOffice(page, 'branch', {
        [route]: (url) => (url.searchParams.get('cursor') === 'c2'
          ? { body: { [key]: [row(3)], nextCursor: null } }
          : { body: { [key]: [row(1), row(2)], nextCursor: 'c2' } }),
      });
      await page.goto(`${admin}/${path}`);
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      const rows = page.locator('table.data tbody tr');
      await expect(rows).toHaveCount(2);
      await expect(page.locator('.pane .hint')).toContainText('2');
      await page.getByRole('button', { name: '2', exact: true }).click();
      await expect(rows).toHaveCount(1);
      await expect(page.getByRole('button', { name: '3', exact: true })).toHaveCount(0);
      expect(calls.filter((call) => call.includes('cursor=c2'))).toHaveLength(1);
    });
  }

  test('an answer for an older filter set is dropped', async ({ page }) => {
    await serveOffice(page, 'branch', {
      'GET /accounting': (url) => {
        const q = url.searchParams.get('q');
        if (q === '111') return { body: { entries: [account('slow', '0551110000')], nextCursor: null }, delay: 1500 };
        if (q === '222') return { body: { entries: [account('fast', '0552220000')], nextCursor: null } };
        return { body: { entries: [], nextCursor: null } };
      },
    });
    await page.goto(`${admin}/accounting`);
    const search = page.getByLabel('الرقم');
    await search.fill('111');
    await page.waitForTimeout(450);
    await search.fill('222');
    await expect(page.locator('table.data tbody tr')).toHaveCount(1);
    await expect(page.locator('table.data tbody')).toContainText('0552220000');
    await page.waitForTimeout(1800);
    await expect(page.locator('table.data tbody')).toContainText('0552220000');
    await expect(page.locator('table.data tbody')).not.toContainText('0551110000');
  });

  test('a failed load shows the translated error and an empty table, then recovers on the next filter', async ({ page }) => {
    await serveOffice(page, 'branch', {
      'GET /audit': (url) => (url.searchParams.get('kind') === 'extend'
        ? { body: { entries: [], nextCursor: null } }
        : { status: 400, body: { message: 'بيانات غير صالحة' } }),
    });
    await page.goto(`${admin}/audit`);
    await expect(page.locator('p.error')).toHaveText('بيانات غير صالحة');
    await page.getByLabel('النوع').selectOption('extend');
    await expect(page.locator('p.error')).toHaveCount(0);
    await expect(page.locator('.empty')).toHaveText('لا حركات بعد.');
  });
});

test.describe('useAction and lineActions', () => {
  const card = (status: string, extra = {}) => ({ line: line('ln1', status, extra), history: [] });

  test('the line card runs an action once, even on a double click, then says so and reloads', async ({ page }) => {
    let reads = 0;
    const calls = await serveOffice(page, 'branch', {
      'GET /lines/ln1': () => { reads += 1; return { body: card('active') }; },
      'GET /packages': () => ({ body: { packages: [], companies: [] } }),
      'GET /users': () => ({ body: { users: [] } }),
      'POST /lines/ln1/extend': () => ({ body: { applied: true }, delay: 400 }),
    });
    await page.goto(`${admin}/numbers/ln1`);
    const extend = page.getByRole('button', { name: 'تمديد', exact: true });
    await expect(extend).toBeVisible();
    await extend.dblclick();
    await expect(page.getByRole('status')).toHaveText('تم التنفيذ وخصم الرصيد.');
    await expect.poll(() => reads).toBe(2);
    expect(calls.filter((call) => call.startsWith('POST /lines/ln1/extend'))).toHaveLength(1);
  });

  test('a refused action shows the error, leaves the card as it was, and can be tried again', async ({ page }) => {
    let tries = 0;
    await serveOffice(page, 'branch', {
      'GET /lines/ln1': () => ({ body: card('active') }),
      'GET /packages': () => ({ body: { packages: [], companies: [] } }),
      'GET /users': () => ({ body: { users: [] } }),
      'POST /lines/ln1/disconnect': () => { tries += 1; return { status: 400, body: { message: 'بيانات غير صالحة' } }; },
    });
    await page.goto(`${admin}/numbers/ln1`);
    await page.getByRole('button', { name: 'فصل', exact: true }).click();
    await expect(page.locator('p.error')).toHaveText('بيانات غير صالحة');
    await page.getByRole('button', { name: 'فصل', exact: true }).click();
    await expect.poll(() => tries).toBe(2);
  });

  test('the list menu and the line card come from the same rules; only the card offers freeze', async ({ page }) => {
    await serveOffice(page, 'branch', {
      'GET /lines': () => ({ body: { lines: [line('ln1', 'active'), line('ln2', 'frozen'), line('ln3', 'disconnected'), line('ln4', 'active', { opsLocked: true })], poses: [], nextCursor: null } }),
      'GET /lines/ln1': () => ({ body: card('active') }),
      'GET /lines/ln2': () => ({ body: card('frozen') }),
      'GET /lines/ln3': () => ({ body: card('disconnected') }),
      'GET /lines/ln4': () => ({ body: card('active', { opsLocked: true }) }),
      'GET /packages': () => ({ body: { packages: [], companies: [] } }),
      'GET /users': () => ({ body: { users: [] } }),
    });
    const listItems = async (n: number) => {
      await page.goto(`${admin}/numbers`);
      await expect(page.locator('table.data tbody tr')).toHaveCount(4);
      await page.locator('table.data tbody tr').nth(n).getByRole('button', { name: /إجراءات/ }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      return page.getByRole('menuitem').allTextContents();
    };
    const cardItems = async (id: string) => {
      await page.goto(`${admin}/numbers/${id}`);
      await expect(page.locator('.line-number')).toBeVisible();
      return page.locator('.command-list .op-card').allTextContents();
    };
    expect((await listItems(0)).map((text) => text.trim())).toEqual(['تمديد', 'فصل']);
    expect((await cardItems('ln1')).map((text) => text.trim())).toEqual(['تمديد', 'تجميد', 'فصل']);
    expect((await listItems(1)).map((text) => text.trim())).toEqual(['فك تجميد', 'فصل']);
    expect((await cardItems('ln2')).map((text) => text.trim())).toEqual(['فك تجميد', 'فصل']);
    expect((await listItems(2)).map((text) => text.trim())).toEqual(['تفعيل']);
    expect((await cardItems('ln3')).map((text) => text.trim())).toEqual(['تفعيل']);
    // A number locked for a package switch has no immediate action on either screen.
    await page.goto(`${admin}/numbers`);
    await expect(page.locator('table.data tbody tr').nth(3).getByRole('button', { name: /إجراءات/ })).toHaveCount(0);
    expect(await cardItems('ln4')).toEqual([]);
    await expect(page.locator('.command-list')).toHaveCount(0);
  });
});

test.describe('reports', () => {
  const kinds = {
    providers: { rows: [{ providerName: 'مزود', companyName: 'سلكوم', packageName: '400 جيجا', price: 20, lines: 4 }] },
    consumption: { entries: [{ id: 'e1', at: '2026-10-02T10:30:00.000Z', loginName: 'pos', actorLogin: 'admin', kind: 'extend', amount: -26, balanceAfter: 74, note: null }] },
    funding: { entries: [] },
    tasks: { tasks: [{ id: 't1', action: 'activate', status: 'done', posLogin: 'pos', submitterLogin: 'pos', assigneeLogin: null, posDelta: -26, msisdn: '0550000001', packageName: '400 جيجا', log: '', note: '', resultNote: '', canTake: false, canWork: false, canCancel: false }] },
    numbers: { lines: [line('ln1')] },
    operations: { entries: [] },
  } as const;

  test('each report draws the table its answer calls for', async ({ page }) => {
    await serveOffice(page, 'branch', Object.fromEntries(
      Object.entries(kinds).map(([kind, body]) => [`GET /reports/${kind}`, () => ({ body })]),
    ));
    const head = (selector: string) => page.locator(`table.data ${selector}`);
    await page.goto(`${admin}/reports/providers`);
    await expect(head('thead th')).toHaveCount(5);
    await expect(head('thead th.num')).toHaveCount(2);
    await expect(head('tbody td.num')).toHaveCount(2);
    await page.goto(`${admin}/reports/consumption`);
    await expect(head('thead th')).toHaveCount(6);
    await expect(head('thead th.num')).toHaveCount(2);
    await expect(head('tbody td.when')).toHaveCount(1);
    await page.goto(`${admin}/reports/tasks`);
    await expect(head('thead th')).toHaveCount(5);
    await expect(head('thead th.num')).toHaveCount(0);
    await page.goto(`${admin}/reports/numbers`);
    await expect(head('thead th')).toHaveCount(4);
    await expect(head('tbody td.msisdn')).toHaveCount(1);
    await page.goto(`${admin}/reports/funding`);
    await expect(page.locator('.pane > .empty')).toHaveText('لا حركات بعد.');
    await expect(page.locator('table.data')).toHaveCount(0);
  });

  test('a report pages by cursor and keeps the table while it loads more', async ({ page }) => {
    const entry = (id: string) => ({ id, at: '2026-10-02T10:30:00.000Z', loginName: 'pos', actorLogin: 'admin', kind: 'extend', amount: -26, balanceAfter: 74, note: null });
    await serveOffice(page, 'branch', {
      'GET /reports/consumption': (url) => (url.searchParams.get('cursor') === 'c2'
        ? { body: { entries: [entry('e3')], nextCursor: null } }
        : { body: { entries: [entry('e1'), entry('e2')], nextCursor: 'c2' } }),
    });
    await page.goto(`${admin}/reports/consumption`);
    await expect(page.locator('table.data tbody tr')).toHaveCount(2);
    await page.getByRole('button', { name: '2', exact: true }).click();
    await expect(page.locator('table.data tbody tr')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '3', exact: true })).toHaveCount(0);
  });
});

test.describe('shell', () => {
  test('the shell search reads the first page of numbers and ignores nextCursor', async ({ page }) => {
    const calls = await serveOffice(page, 'branch', {
      'GET /home': () => ({ body: { pendingTasks: 0, activeLines: 0, inactiveLines: 0, canPost: false, operations: [], announcements: [] } }),
      'GET /users': () => ({ body: { users: [] } }),
      'GET /lines': () => ({ body: { lines: [line('ln1'), line('ln2')], poses: [], nextCursor: 'c9' } }),
    });
    await page.goto(`${admin}/`);
    await page.locator('.shell-search-field input').fill('055');
    await expect(page.locator('.shell-search-item')).toHaveCount(2);
    expect(calls.filter((call) => call.startsWith('GET /lines')).every((call) => !call.includes('cursor'))).toBe(true);
  });

  test('a notice names its action with the same words as the desk', async ({ page }) => {
    await serveOffice(page, 'branch', {
      'GET /home': () => ({ body: { pendingTasks: 0, activeLines: 0, inactiveLines: 0, canPost: false, operations: [], announcements: [] } }),
      'GET /notices': () => ({
        body: {
          unread: 2,
          notices: [
            { id: 'n1', kind: 'task_reply', action: 'sim', msisdn: '0550000001', href: '/tasks', read: false, createdAt: '2026-10-02T10:30:00.000Z' },
            { id: 'n2', kind: 'task_reply', action: 'reactivate', msisdn: null, href: '/tasks', read: false, createdAt: '2026-10-02T10:30:00.000Z' },
          ],
        },
      }),
    });
    await page.goto(`${admin}/`);
    await page.getByRole('button', { name: 'الإشعارات' }).click();
    await expect(page.locator('.shell-item small').first()).toHaveText('تبديل الشريحة · 0550000001');
    await expect(page.locator('.shell-item small').nth(1)).toHaveText('تفعيل');
  });
});
