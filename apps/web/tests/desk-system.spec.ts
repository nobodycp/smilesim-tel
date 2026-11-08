import { expect, test } from '@playwright/test';

async function probe(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    // The markup <Button> and <Button variant="secondary"> render, inside a desk on the canvas as on every page.
    const canvas = document.createElement('main');
    canvas.className = 'canvas';
    const root = document.createElement('div');
    root.className = 'desk';
    const primary = document.createElement('button');
    primary.className = 'ui-btn ui-btn-primary ui-btn-md';
    const secondary = document.createElement('button');
    secondary.className = 'ui-btn ui-btn-secondary ui-btn-md';
    const field = document.createElement('input');
    root.append(primary, secondary, field);
    canvas.append(root);
    document.body.append(canvas);
    const primaryStyle = getComputedStyle(primary);
    const secondaryStyle = getComputedStyle(secondary);
    return {
      primaryHeight: primaryStyle.height,
      primaryBg: primaryStyle.backgroundColor,
      secondaryHeight: secondaryStyle.height,
      secondaryBg: secondaryStyle.backgroundColor,
      secondaryBorder: secondaryStyle.borderTopWidth,
      primaryRadius: primaryStyle.borderTopLeftRadius,
      fieldHeight: getComputedStyle(field).height,
    };
  });
}

test('desk buttons are ink and 34px on a desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/login');
  const style = await probe(page);
  expect(style.primaryHeight).toBe('34px');
  expect(style.primaryBg).toBe('rgb(10, 10, 10)');
  expect(style.secondaryHeight).toBe('34px');
  expect(style.secondaryBg).toBe('rgb(255, 255, 255)');
  expect(style.secondaryBorder).toBe('1px');
  expect(style.primaryRadius).toBe('8px');
  expect(style.fieldHeight).toBe('34px');
});

test('desk buttons grow to 44px under 720px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/login');
  const style = await probe(page);
  expect(style.primaryHeight).toBe('44px');
  expect(style.secondaryHeight).toBe('44px');
  expect(style.fieldHeight).toBe('44px');
});
