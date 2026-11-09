import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// Offers (spec 2026-11-09-offers-tasks-addons-wallet-esim, 1): a hero carousel on the home, moving on after each
// offer's seconds, and the «الإعلانات» page that manages them.
const home = { pendingTasks: 0, activeLines: 0, inactiveLines: 0, expiringLines: 0, canPost: false, operations: [], announcements: [] };
const picture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const offer = (id: string, title: string, seconds = 3) => ({
  id, title, body: `${title} — تفاصيل`, image: picture, actionLabel: 'اطلب الآن', actionHref: '/packages', seconds, active: true,
  position: 0, layers: ['pos', 'agent', 'main_agent', 'branch'], startsAt: null, endsAt: null,
});

test('the home hero shows the live offers, moves by dot and key, and moves on by itself after the offer\'s seconds', async ({ page }) => {
  await serveOffice(page, 'agent', {
    'GET /home': () => ({ body: home }),
    'GET /offers/live': () => ({ body: { offers: [offer('o1', 'عرض الشتاء', 3), offer('o2', 'عرض الربيع', 3)] } }),
  });
  await page.goto('http://agent.localhost:3910/');
  const hero = page.locator('.offer-hero');
  await expect(hero.getByRole('heading', { name: 'عرض الشتاء' })).toBeVisible();
  await expect(hero.getByRole('link', { name: 'اطلب الآن' })).toHaveAttribute('href', '/packages');
  const dots = hero.getByRole('tab');
  await expect(dots).toHaveCount(2);
  await expect(dots.first()).toHaveAttribute('aria-selected', 'true');

  // Nothing is over the hero now: after its 3 seconds the next offer comes by itself.
  await page.mouse.move(0, 0);
  await expect(hero.getByRole('heading', { name: 'عرض الربيع' })).toBeVisible({ timeout: 6000 });

  // A dot moves at once; in a right-to-left page ArrowLeft is the next offer.
  await dots.first().click();
  await expect(hero.getByRole('heading', { name: 'عرض الشتاء' })).toBeVisible();
  await hero.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(hero.getByRole('heading', { name: 'عرض الربيع' })).toBeVisible();
});

test('a home without live offers has no hero', async ({ page }) => {
  await serveOffice(page, 'agent', { 'GET /home': () => ({ body: home }), 'GET /offers/live': () => ({ body: { offers: [] } }) });
  await page.goto('http://agent.localhost:3910/');
  await expect(page.locator('.page-head h1')).toBeVisible();
  await expect(page.locator('.offer-hero')).toHaveCount(0);
});

test('the owner adds an offer with its seconds and audience, and switches one off', async ({ page }) => {
  const posted: unknown[] = [];
  const patched: unknown[] = [];
  let offers = [offer('o1', 'عرض الشتاء', 7)];
  await serveOffice(page, 'branch', {
    'GET /offers': () => ({ body: { offers } }),
    'POST /offers': () => ({ body: { offers } }),
    'PATCH /offers/o1': () => { offers = [{ ...offers[0], active: false }]; return { body: { offers } }; },
  });
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/office/offers')) posted.push(request.postDataJSON());
    if (request.method() === 'PATCH' && request.url().endsWith('/office/offers/o1')) patched.push(request.postDataJSON());
  });
  await page.goto('http://admin.localhost:3910/offers');
  await expect(page.locator('.offer-hero')).toBeVisible();
  await expect(page.locator('table.data tbody tr')).toHaveCount(1);

  await page.getByRole('button', { name: 'إعلان جديد' }).click();
  const dialog = page.getByRole('dialog', { name: 'إعلان جديد' });
  await dialog.getByLabel('العنوان').fill('عرض العيد');
  await dialog.getByLabel('النص').fill('خصم على كل الرزم');
  await dialog.getByLabel('مدة العرض (ثوانٍ)').fill('10');
  await dialog.getByLabel('وكيل رئيسي').uncheck();
  await dialog.getByLabel('فرع').uncheck();
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({ title: 'عرض العيد', body: 'خصم على كل الرزم', seconds: 10, layers: ['agent', 'pos'], active: true });

  await page.getByRole('switch', { name: 'عرض الشتاء' }).click();
  await expect.poll(() => patched).toEqual([{ active: false }]);
});
