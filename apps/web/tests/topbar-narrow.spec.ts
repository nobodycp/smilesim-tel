import { expect, test, type Page } from '@playwright/test';
import { serveApi } from './desk';

/** The shell search's sheet while it is open: the search form of the shell search whose toggle is expanded. */
const openSearch = (page: Page) => page.getByTestId('shell-search').filter({ has: page.getByRole('button', { expanded: true }) }).getByRole('search');

// Graphite topbar: the menu button, search, wallet, then the notices, the theme and the language menu (spec
// 2026-11-09-admin-review, 2b, 7 and 8.6), at every width; the drawer holds no preference. Nothing in the topbar leaves the
// screen from 320px up, for the branch (no wallet) and for a point of sale (with its wallet).
for (const locale of ['ar', 'en']) {
  for (const layer of ['branch', 'pos'] as const) {
    test(`the topbar fits from 320px up with the language in it (${locale}, ${layer})`, async ({ page }) => {
      const origin = layer === 'branch' ? 'http://admin.localhost:3910' : 'http://pos.localhost:3910';
      await page.context().addCookies([{ name: 'smilesim-locale', value: locale, url: origin }]);
      await serveApi(page, layer);
      for (const width of [320, 360, 390]) {
        await page.setViewportSize({ width, height: 760 });
        await page.goto(`${origin}/`);
        await expect(page.getByTestId('topbar').getByTestId('menu-btn')).toBeVisible();
        const outside = await page.getByTestId('topbar').evaluate((header) =>
          [...header.querySelectorAll('button, a, input')]
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.width > 0 && (r.left < -0.5 || r.right > window.innerWidth + 0.5)).length,
        );
        expect(outside, `controls outside the screen at ${width}px`).toBe(0);
        await expect(page.getByTestId('topbar').getByTestId('shell-lang')).toBeVisible();
      }
      await page.setViewportSize({ width: 320, height: 760 });
      await page.getByTestId('topbar').getByTestId('menu-btn').click();
      await expect(page.getByTestId('drawer').getByTestId('shell-lang')).toHaveCount(0);
    });
  }
}

// On phones (under 768px) the search and the notices open as one sheet under the topbar, 8px from each screen edge
// (UI maintenance P0.6, 3.2-01): anchored to their button, they ran off the screen.
for (const locale of ['ar', 'en']) {
  test(`the search and notice menus stay on the screen on phones (${locale})`, async ({ page }) => {
    const origin = 'http://pos.localhost:3910';
    await page.context().addCookies([{ name: 'smilesim-locale', value: locale, url: origin }]);
    await serveApi(page, 'pos');
    for (const width of [320, 375, 767]) {
      await page.setViewportSize({ width, height: 760 });
      await page.goto(`${origin}/`);
      await page.getByTestId('topbar').getByTestId('search-toggle').click();
      const search = openSearch(page);
      await expect(search).toBeVisible();
      const searchBox = await search.boundingBox();
      await page.getByTestId('topbar').getByTestId('notice-btn').click();
      const notices = page.getByTestId('notice-panel');
      await expect(notices).toBeVisible();
      const noticeBox = await notices.boundingBox();
      for (const [name, box] of [['search', searchBox], ['notices', noticeBox]] as const) {
        expect(box, `${name} at ${width}px`).not.toBeNull();
        expect(Math.abs(box!.x - 8), `${name} start edge at ${width}px`).toBeLessThanOrEqual(1);
        expect(Math.abs(width - (box!.x + box!.width) - 8), `${name} end edge at ${width}px`).toBeLessThanOrEqual(1);
      }
    }
  });
}

// On a short or landscape phone screen both sheets end at least 8px above the bottom edge and scroll inside: the
// topbar is sticky, so a sheet that ran past the edge could not be scrolled into view (UI maintenance P0.6, fix round 1).
for (const locale of ['ar', 'en']) {
  test(`the search and notice menus end above the bottom edge on a short screen (${locale})`, async ({ page }) => {
    const origin = 'http://pos.localhost:3910';
    const at = '2026-10-02T10:30:00.000Z';
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`, kind: 'transfer.in', payload: { kind: 'line', subject: `05210000${10 + i}`, fromLoginName: 'pos1', actorName: 'الإدارة' },
      actorName: 'الإدارة', href: '/numbers', read: false, createdAt: at,
    }));
    const lines = Array.from({ length: 8 }, (_, i) => ({
      id: `ln${i}`, msisdn: `05500000${10 + i}`, status: 'active', companyName: 'Cellcom', packageName: '400 جيجا', posLoginName: 'pos1', endsAt: '2026-12-01T00:00:00.000Z',
    }));
    await page.context().addCookies([{ name: 'smilesim-locale', value: locale, url: origin }]);
    await serveApi(page, 'pos', {
      'GET /notices': () => ({ body: { unread: items.length, nextCursor: null, items } }),
      'GET /postpaid/lines': () => ({ body: { items: lines, poses: [], nextCursor: null, total: lines.length } }),
    });
    for (const [width, height] of [[667, 320], [320, 480]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${origin}/`);
      await page.getByTestId('topbar').getByTestId('search-toggle').click();
      await page.getByRole('search').getByRole('searchbox').fill('05');
      await expect(page.getByTestId('search-item')).toHaveCount(8);
      const searchBox = await openSearch(page).boundingBox();
      await expect(page.getByTestId('search-field')).toBeInViewport({ ratio: 1 });
      await page.getByTestId('topbar').getByTestId('notice-btn').click();
      await expect(page.getByTestId('notice-panel').getByTestId('notice-item')).toHaveCount(items.length);
      const noticeBox = await page.getByTestId('notice-panel').boundingBox();
      for (const [name, box] of [['search', searchBox], ['notices', noticeBox]] as const) {
        expect(box, `${name} at ${width}x${height}`).not.toBeNull();
        // At least --rd-space-2 above the bottom edge. At 667x320 neither sheet fits uncapped (they start under a
        // two-row bar), so this fails if either cap is removed.
        expect(box!.y + box!.height, `${name} bottom edge at ${width}x${height}`).toBeLessThanOrEqual(height - 8 + 1);
      }
    }
  });
}

// On phones (under 768px) the topbar uses the page's gutter, 16px (ADR 0021 D9), so its content edges line up with
// the canvas content edges on both sides (UI maintenance P0.8, 3.4-01 and 3.2-05): a 28px rule meant for 768px and
// up used to reach phones and set the topbar 12px deeper than the page.
for (const locale of ['ar', 'en']) {
  test(`the topbar edge matches the page edge on phones (${locale})`, async ({ page }) => {
    const origin = 'http://pos.localhost:3910';
    await page.context().addCookies([{ name: 'smilesim-locale', value: locale, url: origin }]);
    await serveApi(page, 'pos');
    for (const width of [320, 360, 375, 390, 767]) {
      await page.setViewportSize({ width, height: 760 });
      await page.goto(`${origin}/`);
      await expect(page.getByTestId('topbar').getByTestId('menu-btn')).toBeVisible();
      const edges = await page.evaluate(() => {
        const content = (el: Element) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return { left: r.left + parseFloat(s.paddingLeft), right: r.right - parseFloat(s.paddingRight) };
        };
        return { bar: content(document.querySelector('[data-testid="topbar"]')!), page: content(document.querySelector('[data-testid="canvas-inner"]')!) };
      });
      expect(Math.abs(edges.bar.left - edges.page.left), `left edge at ${width}px`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(edges.bar.right - edges.page.right), `right edge at ${width}px`).toBeLessThanOrEqual(0.5);
    }
  });
}

test('the topbar language is the login page\'s menu: the current language, a menu of the others', async ({ page }) => {
  await serveApi(page, 'branch');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://admin.localhost:3910/');
  await expect(page.getByTestId('sidebar').getByTestId('shell-lang')).toHaveCount(0);
  const trigger = page.getByTestId('topbar').getByRole('button', { name: 'اللغة' });
  await expect(trigger).toHaveText('ع');
  await trigger.click();
  const menu = page.getByTestId('topbar').getByRole('menu', { name: 'اللغة' });
  await expect(menu.getByRole('menuitem')).toHaveText(['English', 'עברית']);
  await menu.getByRole('menuitem', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByTestId('topbar').getByRole('button', { name: 'Language' })).toHaveText('EN');
});

// Wide screens too (spec 2026-11-09-admin-review, 6.5 and 7): at 1280px nothing in the topbar leaves the screen and
// the page does not scroll sideways; the message lists every topbar control's box if it does.
test('the topbar fits a 1280px screen without a sideways scroll', async ({ page }) => {
  await serveApi(page, 'branch', { 'GET /postpaid/companies': () => ({ body: { companies: [] } }) });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://admin.localhost:3910/companies');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const report = await page.evaluate(() => {
    const de = document.documentElement;
    const boxes = [...document.querySelectorAll('[data-testid="topbar-tools"] > *, [data-testid="topbar-tools"] kbd, [data-testid="topbar-start"], [data-testid="topbar"]')]
      .map((el) => { const r = el.getBoundingClientRect(); return `${el.tagName}.${String(el.className).slice(0, 30)} ${Math.round(r.left)}→${Math.round(r.right)}`; });
    return { scroll: de.scrollWidth, client: de.clientWidth, boxes: boxes.join(' ; '), fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).join(',') };
  });
  expect(report.scroll, JSON.stringify(report)).toBeLessThanOrEqual(report.client);
});
