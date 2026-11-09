import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// Graphite topbar: the menu button, search, wallet, then the language menu, the theme and the notices (spec
// 2026-11-09-admin-review, 2b and 7), at every width; the drawer holds no preference. Nothing in the topbar leaves the
// screen from 320px up, for the branch (no wallet) and for a point of sale (with its wallet).
for (const locale of ['ar', 'en']) {
  for (const layer of ['branch', 'pos'] as const) {
    test(`the topbar fits from 320px up with the language in it (${locale}, ${layer})`, async ({ page }) => {
      const origin = layer === 'branch' ? 'http://admin.localhost:3910' : 'http://pos.localhost:3910';
      await page.context().addCookies([{ name: 'smilesim-locale', value: locale, url: origin }]);
      await serveOffice(page, layer);
      for (const width of [320, 360, 390]) {
        await page.setViewportSize({ width, height: 760 });
        await page.goto(`${origin}/`);
        await expect(page.locator('.topbar .menu-btn')).toBeVisible();
        const outside = await page.locator('.topbar').evaluate((header) =>
          [...header.querySelectorAll('button, a, input')]
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.width > 0 && (r.left < -0.5 || r.right > window.innerWidth + 0.5)).length,
        );
        expect(outside, `controls outside the screen at ${width}px`).toBe(0);
        await expect(page.locator('.topbar .shell-lang')).toBeVisible();
      }
      await page.setViewportSize({ width: 320, height: 760 });
      await page.locator('.topbar .menu-btn').click();
      await expect(page.locator('.drawer .drawer-prefs, .drawer .shell-lang')).toHaveCount(0);
    });
  }
}

test('the topbar language is the login page\'s menu: the current language, a menu of the others', async ({ page }) => {
  await serveOffice(page, 'branch');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://admin.localhost:3910/');
  await expect(page.locator('.sidebar .shell-lang')).toHaveCount(0);
  const trigger = page.locator('.topbar').getByRole('button', { name: 'اللغة' });
  await expect(trigger).toHaveText('ع');
  await trigger.click();
  const menu = page.locator('.topbar').getByRole('menu', { name: 'اللغة' });
  await expect(menu.getByRole('menuitem')).toHaveText(['English', 'עברית']);
  await menu.getByRole('menuitem', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.topbar').getByRole('button', { name: 'Language' })).toHaveText('EN');
});

// Wide screens too (spec 2026-11-09-admin-review, 6.5 and 7): at 1280px nothing in the topbar leaves the screen and
// the page does not scroll sideways; the message lists every topbar control's box if it does.
test('the topbar fits a 1280px screen without a sideways scroll', async ({ page }) => {
  await serveOffice(page, 'branch', { 'GET /companies': () => ({ body: { companies: [] } }) });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://admin.localhost:3910/companies');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const report = await page.evaluate(() => {
    const de = document.documentElement;
    const boxes = [...document.querySelectorAll('.topbar-tools > *, .topbar-tools kbd, .topbar-start, .topbar')]
      .map((el) => { const r = el.getBoundingClientRect(); return `${el.tagName}.${String(el.className).slice(0, 30)} ${Math.round(r.left)}→${Math.round(r.right)}`; });
    return { scroll: de.scrollWidth, client: de.clientWidth, boxes: boxes.join(' ; '), fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).join(',') };
  });
  expect(report.scroll, JSON.stringify(report)).toBeLessThanOrEqual(report.client);
});
