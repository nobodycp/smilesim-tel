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
