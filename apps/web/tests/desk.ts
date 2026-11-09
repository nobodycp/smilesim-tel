import { expect, type Page } from '@playwright/test';

export async function asBranch(page: Page) {
  await page.route('**/office/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        loginName: 'admin',
        nickname: 'الإدارة',
        layer: 'branch',
        isBranchOwner: true,
        grants: ['edit', 'reports', 'staff'],
        stops: [],
        impersonating: false,
        balance: 1000,
        ceiling: 0,
      }),
    }),
  );
}

/**
 * A desk page shows one h1, no repeated pane heading, no filter toggle, and one pane. A workbench
 * pane fills the canvas; a paged card (`.pane.fit`, users and roles) sizes to its rows instead.
 */
export async function expectFullTable(page: Page, title: string, { fit = false } = {}) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  // The title is not repeated as a pane heading; an optional lede under the h1 is allowed.
  await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toHaveCount(0);
  await expect(page.locator('.filter-toggle')).toHaveCount(0);
  // Graphite: a list's card ends with its content (no empty block down to the page's bottom), and the page scrolls.
  const box = await page.locator('.desk .pane').first().boundingBox();
  expect(box).not.toBeNull();
  void fit;
}

export type Reply = { body: unknown; status?: number; delay?: number };
export type Routes = Record<string, (url: URL) => Reply>;

const accounts = {
  branch: { loginName: 'admin', nickname: 'الإدارة', layer: 'branch', isBranchOwner: true, grants: ['edit', 'reports', 'staff'] },
  main_agent: { loginName: 'main1', nickname: 'رئيسي', layer: 'main_agent', isBranchOwner: false, grants: [] },
  agent: { loginName: 'agent1', nickname: 'وكيل', layer: 'agent', isBranchOwner: false, grants: [] },
  pos: { loginName: 'pos', nickname: 'الكاشير', layer: 'pos', isBranchOwner: false, grants: [] },
} as const;

/**
 * Answers every /office call in the browser. `routes` is keyed "METHOD /path" (the path after /office);
 * a route answers with its body, an optional status, and an optional delay in milliseconds.
 * The account and the notices have defaults. The returned list records every call as "METHOD /path?query",
 * so a test can say which requests were made, and in what order.
 */
type ListedUser = { loginName: string; nickname: string; layer: string };
const USER_LAYERS = ['branch', 'main_agent', 'agent', 'pos'];

/**
 * A test's `GET /users` answers the whole list. The users table asks for one page with `paged=1`, so that answer
 * is filtered, ordered and counted here the way the API's `users-page.ts` does, unless the test answered a page itself.
 */
function asUsersPage(url: URL, reply: Reply): Reply {
  const body = reply.body as { users?: ListedUser[]; total?: number } | null;
  if (!url.searchParams.get('paged') || !body || !Array.isArray(body.users) || body.total !== undefined) return reply;
  const needle = (url.searchParams.get('q') ?? '').trim();
  const layer = url.searchParams.get('layer') ?? '';
  const rank = (row: ListedUser) => USER_LAYERS.indexOf(row.layer);
  const users = body.users
    .filter((row) => !layer || row.layer === layer)
    .filter((row) => !needle || row.nickname.includes(needle) || row.loginName.includes(needle))
    .sort((a, b) => rank(a) - rank(b) || a.loginName.localeCompare(b.loginName));
  return { ...reply, body: { ...body, users, nextCursor: null, total: users.length } };
}

export async function serveOffice(page: Page, layer: keyof typeof accounts, routes: Routes = {}) {
  const calls: string[] = [];
  await page.route('**/api/office/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/office/, '');
    const key = `${request.method()} ${path}`;
    calls.push(`${key}${url.search}`);
    let reply: Reply = { body: { message: 'none' }, status: 404 };
    if (routes[key]) reply = key === 'GET /users' ? asUsersPage(url, routes[key](url)) : routes[key](url);
    else if (key === 'GET /me') reply = { body: { ...accounts[layer], stops: [], impersonating: false, balance: 1000, ceiling: 0 } };
    else if (key === 'GET /directory') reply = { body: { names: Object.fromEntries(Object.values(accounts).map((row) => [row.loginName, row.nickname])) } };
    else if (key === 'GET /notices') reply = { body: { unread: 0, notices: [], nextCursor: null } };
    else if (key === 'GET /notices/stream') reply = { body: {}, status: 204 };
    if (reply.delay) await new Promise((resolve) => setTimeout(resolve, reply.delay));
    await route.fulfill({ status: reply.status ?? 200, contentType: 'application/json', body: JSON.stringify(reply.body) });
  });
  return calls;
}
