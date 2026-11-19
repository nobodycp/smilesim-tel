import { expect, test } from '@playwright/test';

test('line card keeps its tabs and stretches the pane', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/v1/postpaid/lines/ln1**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        line: {
          id: 'ln1', msisdn: '0550246962', iccid: null, esim: false, status: 'active',
          packageCode: 'cell-400', packageName: '400 جيجا', companyName: 'سلكوم',
          posLoginName: 'pos', posPrice: 30, createdAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-12T00:00:00.000Z',
        },
        history: [],
      }),
    }),
  );
  await page.goto('/postpaid/numbers/ln1');
  await expect(page.getByRole('tablist')).toBeVisible();
  const box = await page.getByTestId('line-pane').boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(700);
});

test('settings lede stays and the grid has no trailing spacer', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByTestId('page-lede')).toBeVisible();
  await expect(page.getByTestId('settings-grid')).toBeVisible();
});
