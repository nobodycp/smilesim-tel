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

  // Graphite: a task is one card row (task, amount, actions); the head stays for screen readers.
  test('the tasks table writes num and row-actions on header and cells, shows a skeleton while loading, and a RowMenu on every row', async ({ page }) => {
    await serveOffice(page, 'branch', { 'GET /tasks': () => ({ body: { items: [task('1', { canTake: true }), task('2')], nextCursor: null }, delay: 700 }) });
    await page.goto(`${admin}/tasks`);
    await expect(page.locator('.sheet .table-skeleton')).toBeVisible();
    await expect(page.locator('table.data tbody tr')).toHaveCount(2);
    await expect(page.locator('.table-skeleton')).toHaveCount(0);
    await expect(page.locator('table.data thead th')).toHaveCount(3);
    await expect(page.locator('table.data th.num')).toHaveCount(1);
    await expect(page.locator('table.data td.num')).toHaveCount(2);
    await expect(page.locator('table.data th.row-actions')).toHaveCount(1);
    await expect(page.locator('table.data td.row-actions')).toHaveCount(2);
    await expect(page.locator('table.data td.msisdn')).toHaveCount(2);
    // Every task row opens from its menu; take and cancel are added where the row allows them.
    await expect(page.locator('table.data td.row-actions .row-menu')).toHaveCount(2);
    await expect(page.getByRole('button', { name: /إجراءات 0550000001/ })).toBeVisible();
  });

  test('an empty list shows .empty inside the pane with no inline style; the ledger lists keep their head', async ({ page }) => {
    await serveOffice(page, 'branch', {
      'GET /lines': () => ({ body: { items: [], poses: [], nextCursor: null } }),
      'GET /packages': () => ({ body: { packages: [], companies: [] } }),
      'GET /finance': () => ({ body: { items: [], nextCursor: null } }),
    });
    await page.goto(`${admin}/numbers`);
    const empty = page.locator('.pane > .empty');
    await expect(empty).toHaveText('لا أرقام بعد.');
    await expect(empty).not.toHaveAttribute('style', /./);
    await expect(page.locator('.pane table.data')).toHaveCount(0);

    await page.goto(`${admin}/finance`);
    await expect(page.locator('.sheet > .empty')).toHaveText('لا حركات بعد.');
    // The design's ledger (Graphite): time, reason, details, amount, my margin, balance after; three are amounts.
    await expect(page.locator('.sheet > table.data thead th')).toHaveCount(6);
    await expect(page.locator('.sheet > table.data thead th.num')).toHaveCount(3);
  });
});

test.describe('usePaged', () => {
  for (const [path, route, key, name] of [
    ['finance', 'GET /finance', 'items', 'المالية'],
    ['provider-operations', 'GET /provider-operations', 'items', 'عمليات المزودين'],
    ['audit', 'GET /audit', 'items', 'سجل النشاط'],
  ] as const) {
    // The first answer fills one page of the saved size (10) and names a cursor; page 2 reads it.
    test(`${path} counts its pages from the total and reads the next cursor for page 2`, async ({ page }) => {
      const row = (n: number) => ({
        ...account(`r${n}`, `05500000${String(n).padStart(2, '0')}`), action: 'extend', status: 'done', kind: 'extend', amount: -26,
        providerName: 'مزود', actorName: 'الكاشير', note: null, actorLogin: 'pos',
      });
      const first = Array.from({ length: 10 }, (_, index) => row(index + 1));
      const calls = await serveOffice(page, 'branch', {
        [route]: (url) => (url.searchParams.get('cursor') === 'c2'
          ? { body: { [key]: [row(11)], nextCursor: null, total: 11 } }
          : { body: { [key]: first, nextCursor: 'c2', total: 11 } }),
      });
      await page.goto(`${admin}/${path}`);
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      const rows = page.locator('table.data tbody tr');
      await expect(rows).toHaveCount(10);
      await expect(page.locator('.table-pager')).toContainText('11');
      expect(calls.filter((call) => call.includes('cursor=c2'))).toHaveLength(0);
      await page.getByRole('button', { name: '2', exact: true }).click();
      await expect(rows).toHaveCount(1);
      await expect(page.getByRole('button', { name: '3', exact: true })).toHaveCount(0);
      expect(calls.filter((call) => call.includes('cursor=c2'))).toHaveLength(1);
    });
  }

  test('an answer for an older filter set is dropped', async ({ page }) => {
    await serveOffice(page, 'branch', {
      'GET /finance': (url) => {
        const q = url.searchParams.get('q');
        if (q === '111') return { body: { items: [account('slow', '0551110000')], nextCursor: null }, delay: 1500 };
        if (q === '222') return { body: { items: [account('fast', '0552220000')], nextCursor: null } };
        return { body: { items: [], nextCursor: null } };
      },
    });
    await page.goto(`${admin}/finance`);
    const search = page.getByLabel('الحساب أو الرقم');
    await search.fill('111');
    await page.waitForTimeout(450);
    await search.fill('222');
    await expect(page.locator('table.data tbody tr')).toHaveCount(1);
    await expect(page.locator('table.data tbody')).toContainText('0552220000');
    await page.waitForTimeout(1800);
    await expect(page.locator('table.data tbody')).toContainText('0552220000');
    await expect(page.locator('table.data tbody')).not.toContainText('0551110000');
  });

  test('a failed load shows the failed state with its error and a retry inside the pane, then recovers on the next filter', async ({ page }) => {
    await serveOffice(page, 'branch', {
      'GET /audit': (url) => (url.searchParams.get('action') === 'extend'
        ? { body: { items: [], nextCursor: null } }
        : { status: 400, body: { message: 'بيانات غير صالحة' } }),
    });
    await page.goto(`${admin}/audit`);
    // The failure lives in the pane, not in a page banner, and offers one retry.
    const failed = page.locator('.pane .load-failed');
    await expect(failed).toContainText('بيانات غير صالحة');
    await expect(failed.getByRole('button', { name: 'إعادة المحاولة' })).toBeVisible();
    await expect(page.locator('p.error')).toHaveCount(0);
    await expect(page.locator('.table-skeleton')).toHaveCount(0);
    await page.getByLabel('الحدث').selectOption('extend');
    await expect(page.locator('.load-failed')).toHaveCount(0);
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
      'POST /lines/ln1/extend': () => ({ body: { applied: true, debited: true }, delay: 400 }),
    });
    await page.goto(`${admin}/numbers/ln1`);
    const extend = page.locator('.line-op-grid').getByRole('button', { name: 'تمديد', exact: true });
    await expect(extend).toBeVisible();
    // The card reads once per load (the session answer can re-run the load once); the action adds exactly one reload.
    const before = reads;
    await extend.dblclick();
    await expect(page.getByRole('status')).toHaveText('تم التنفيذ وخصم الرصيد.');
    await expect.poll(() => reads).toBe(before + 1);
    expect(calls.filter((call) => call.startsWith('POST /lines/ln1/extend'))).toHaveLength(1);
  });

  // The card's three reads are cached apart: an action on the number asks for the number again, not the catalog
  // or the accounts (they used to be read again, one after the other, on every action).
  test('an action on the line card reads the number again and leaves the catalog and the accounts alone', async ({ page }) => {
    const calls = await serveOffice(page, 'branch', {
      'GET /lines/ln1': () => ({ body: card('active') }),
      'GET /packages': () => ({ body: { packages: [], companies: [] } }),
      'GET /users': () => ({ body: { users: [] } }),
      'POST /lines/ln1/extend': () => ({ body: { applied: true, debited: true } }),
    });
    await page.goto(`${admin}/numbers/ln1`);
    await expect(page.locator('.line-op-grid').getByRole('button', { name: 'تمديد', exact: true })).toBeVisible();
    const count = (prefix: string) => calls.filter((call) => call === prefix).length;
    const before = { line: count('GET /lines/ln1'), packages: count('GET /packages'), users: count('GET /users') };
    await page.locator('.line-op-grid').getByRole('button', { name: 'تمديد', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('تم التنفيذ وخصم الرصيد.');
    await expect.poll(() => count('GET /lines/ln1')).toBe(before.line + 1);
    await page.waitForTimeout(300);
    expect(count('GET /packages')).toBe(before.packages);
    expect(count('GET /users')).toBe(before.users);
  });

  test('a refused action shows the error, leaves the card as it was, and can be tried again', async ({ page }) => {
    let tries = 0;
    await serveOffice(page, 'branch', {
      'GET /lines/ln1': () => ({ body: card('active') }),
      'GET /packages': () => ({ body: { packages: [], companies: [] } }),
      'GET /users': () => ({ body: { users: [] } }),
      'GET /lines/ln1/disconnect-quote': () => ({ body: { amount: 2850, runsNow: true } }),
      'POST /lines/ln1/disconnect': () => { tries += 1; return { status: 400, body: { message: 'بيانات غير صالحة' } }; },
    });
    await page.goto(`${admin}/numbers/ln1`);
    const disconnect = async () => {
      await page.locator('.line-op-grid').getByRole('button', { name: 'فصل', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'فصل الرقم' });
      await expect(dialog.locator('.money')).toHaveText('28.50 ₪');
      await dialog.getByRole('button', { name: 'فصل', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    };
    await disconnect();
    await expect(page.locator('p.error')).toHaveText('بيانات غير صالحة');
    await disconnect();
    await expect.poll(() => tries).toBe(2);
  });

  test('the list menu and the line card come from the same rules; only the card offers freeze', async ({ page }) => {
    await serveOffice(page, 'branch', {
      'GET /lines': () => ({ body: { items: [line('ln1', 'active'), line('ln2', 'frozen'), line('ln3', 'disconnected'), line('ln4', 'active', { opsLocked: true })], poses: [], nextCursor: null } }),
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
      return page.locator('.line-op[data-now] b').allTextContents();
    };
    expect((await listItems(0)).map((text) => text.trim())).toEqual(['تمديد', 'تحديث الرقم', 'فصل']);
    expect((await cardItems('ln1')).map((text) => text.trim())).toEqual(['تمديد', 'تحديث الرقم', 'تجميد', 'فصل']);
    // A refresh is for an active number only: frozen and disconnected numbers do not offer it.
    expect((await listItems(1)).map((text) => text.trim())).toEqual(['فك تجميد', 'فصل']);
    expect((await cardItems('ln2')).map((text) => text.trim())).toEqual(['فك تجميد', 'فصل']);
    expect((await listItems(2)).map((text) => text.trim())).toEqual(['شحن']);
    expect((await cardItems('ln3')).map((text) => text.trim())).toEqual(['شحن']);
    // A number locked for a package switch has no immediate action on either screen.
    await page.goto(`${admin}/numbers`);
    await expect(page.locator('table.data tbody tr').nth(3).getByRole('button', { name: /إجراءات/ })).toHaveCount(0);
    expect(await cardItems('ln4')).toEqual([]);
    await expect(page.locator('.line-op[data-now]')).toHaveCount(0);
  });
});

test.describe('reports', () => {
  const kinds = {
    providers: { rows: [{ providerName: 'مزود', companyName: 'سلكوم', packageName: '400 جيجا', price: 20, lines: 4 }] },
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
    await page.goto(`${admin}/reports/tasks`);
    await expect(head('thead th')).toHaveCount(5);
    await expect(head('thead th.num')).toHaveCount(0);
    await page.goto(`${admin}/reports/numbers`);
    await expect(head('thead th')).toHaveCount(4);
    await expect(head('tbody td.msisdn')).toHaveCount(1);
  });

  test('a report pages by cursor and keeps the table while it loads more', async ({ page }) => {
    const entry = (id: string) => ({ id, at: '2026-10-02T10:30:00.000Z', loginName: 'pos', actorLogin: 'admin', kind: 'extend', amount: -26, balanceAfter: 74, note: null });
    const first = Array.from({ length: 10 }, (_, index) => entry(`e${index + 1}`));
    await serveOffice(page, 'branch', {
      'GET /reports/operations': (url) => (url.searchParams.get('cursor') === 'c2'
        ? { body: { items: [entry('e11')], nextCursor: null, total: 11 } }
        : { body: { items: first, nextCursor: 'c2', total: 11 } }),
    });
    await page.goto(`${admin}/reports/operations`);
    await expect(page.locator('table.data tbody tr')).toHaveCount(10);
    await page.getByRole('button', { name: '2', exact: true }).click();
    await expect(page.locator('table.data tbody tr')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '3', exact: true })).toHaveCount(0);
  });
});

test.describe('shell', () => {
  test('the shell search reads the first page of numbers and ignores nextCursor', async ({ page }) => {
    const calls = await serveOffice(page, 'branch', {
      'GET /home': () => ({ body: { pendingTasks: 0, activeLines: 0, inactiveLines: 0, operations: [] } }),
      'GET /users': () => ({ body: { users: [] } }),
      'GET /lines': () => ({ body: { items: [line('ln1'), line('ln2')], poses: [], nextCursor: 'c9' } }),
    });
    await page.goto(`${admin}/`);
    await page.locator('.shell-search-field input').fill('055');
    await expect(page.locator('.shell-search-item')).toHaveCount(2);
    expect(calls.filter((call) => call.startsWith('GET /lines')).every((call) => !call.includes('cursor'))).toBe(true);
  });

  // The accounts are read once when the box opens and filtered as the reader types; numbers go to the server.
  test('the shell search reads the accounts once, however much is typed', async ({ page }) => {
    const user = (loginName: string, nickname: string) => ({ loginName, nickname, layer: 'pos', roleName: '', parentLogin: null, balance: 0, ceiling: 0, frozen: false, self: false, directChild: true, canEnter: false, canFreeze: false, canDelete: false });
    const calls = await serveOffice(page, 'branch', {
      'GET /home': () => ({ body: { pendingTasks: 0, activeLines: 0, inactiveLines: 0, operations: [] } }),
      'GET /users': () => ({ body: { users: [user('samir1', 'سمير'), user('sara2', 'سارة')] } }),
      'GET /lines': () => ({ body: { items: [], poses: [], nextCursor: null } }),
    });
    await page.goto(`${admin}/`);
    const field = page.locator('.shell-search-field input');
    await field.pressSequentially('sam', { delay: 250 });
    await expect(page.locator('.shell-search-item')).toHaveCount(1);
    await field.pressSequentially('ir', { delay: 250 });
    await expect(page.locator('.shell-search-item')).toHaveText(/samir1/);
    expect(calls.filter((call) => call === 'GET /users')).toHaveLength(1);
  });

  test('a notice names its action with the same words as the desk', async ({ page }) => {
    await serveOffice(page, 'branch', {
      'GET /home': () => ({ body: { pendingTasks: 0, activeLines: 0, inactiveLines: 0, operations: [] } }),
      'GET /notices': () => ({
        body: {
          unread: 2,
          nextCursor: null,
          items: [
            { id: 'n1', kind: 'task.done', payload: { taskId: 't1', action: 'sim', msisdn: '0550000001', handlerName: 'الفرع' }, actorName: 'الفرع', href: '/tasks/t1', read: false, createdAt: '2026-10-02T10:30:00.000Z' },
            { id: 'n2', kind: 'task.opened', payload: { taskId: 't2', action: 'reactivate', msisdn: null }, actorName: 'نقطة', href: '/tasks/t2', read: false, createdAt: '2026-10-02T10:30:00.000Z' },
          ],
        },
      }),
    });
    await page.goto(`${admin}/`);
    await page.getByRole('button', { name: 'الإشعارات' }).click();
    await expect(page.locator('.shell-item strong').first()).toHaveText('تمّت المهمة');
    await expect(page.locator('.shell-item .notice-detail').first()).toHaveText('تبديل الشريحة · 0550000001 · بواسطة الفرع');
    await expect(page.locator('.shell-item .notice-detail').nth(1)).toHaveText('شحن · بواسطة نقطة');
  });
});
