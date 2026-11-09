import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// Graphite topbar: the menu button, search, wallet, notices and theme; the account and the language live in the
// sidebar (the drawer's foot on a phone). Nothing in the topbar leaves the screen from 320px up.
for (const locale of ['ar', 'en']) {
  test(`the topbar fits from 320px up, and the language sits in the drawer (${locale})`, async ({ page }) => {
    await page.context().addCookies([{ name: 'smilesim-locale', value: locale, url: 'http://admin.localhost:3910' }]);
    await serveOffice(page, 'branch');
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 760 });
      await page.goto('http://admin.localhost:3910/');
      await expect(page.locator('.topbar .menu-btn')).toBeVisible();
      const outside = await page.locator('.topbar').evaluate((header) =>
        [...header.querySelectorAll('button, a, input')]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && (r.left < -0.5 || r.right > window.innerWidth + 0.5)).length,
      );
      expect(outside, `controls outside the screen at ${width}px`).toBe(0);
      await expect(page.locator('.topbar .shell-lang')).toHaveCount(0);
    }

    await page.setViewportSize({ width: 320, height: 760 });
    await page.locator('.topbar .menu-btn').click();
    const prefs = page.locator('.drawer .drawer-prefs');
    await expect(prefs.locator('.shell-lang')).toBeVisible();
    // One icon on the theme button, not the sun and the moon together.
    await expect(prefs.locator('.shell-icon svg:visible')).toHaveCount(1);
    await prefs.locator('.shell-lang').click();
    await expect(page.locator('html')).toHaveAttribute('lang', locale === 'ar' ? 'en' : 'he');
  });
}
