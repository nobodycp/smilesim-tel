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
        impersonating: false,
        balance: 1000,
        ceiling: 0,
      }),
    }),
  );
}

export async function expectFullTable(page: Page, title: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: title })).toHaveCount(0);
  await expect(page.locator('.page-head .lede')).toHaveCount(0);
  await expect(page.locator('.filter-toggle')).toHaveCount(0);
  const box = await page.locator('.desk .pane').first().boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(720);
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
export async function serveOffice(page: Page, layer: keyof typeof accounts, routes: Routes = {}) {
  const calls: string[] = [];
  await page.route('**/api/office/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/office/, '');
    const key = `${request.method()} ${path}`;
    calls.push(`${key}${url.search}`);
    let reply: Reply = { body: { message: 'none' }, status: 404 };
    if (routes[key]) reply = routes[key](url);
    else if (key === 'GET /me') reply = { body: { ...accounts[layer], impersonating: false, balance: 1000, ceiling: 0 } };
    else if (key === 'GET /directory') reply = { body: { names: Object.fromEntries(Object.values(accounts).map((row) => [row.loginName, row.nickname])) } };
    else if (key === 'GET /notices') reply = { body: { unread: 0, notices: [], nextCursor: null } };
    else if (key === 'GET /notices/stream') reply = { body: {}, status: 204 };
    if (reply.delay) await new Promise((resolve) => setTimeout(resolve, reply.delay));
    await route.fulfill({ status: reply.status ?? 200, contentType: 'application/json', body: JSON.stringify(reply.body) });
  });
  return calls;
}
