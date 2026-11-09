import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// The home overview (spec 2026-11-08-overview-and-reports-nav, F): a period switch, then one card per part of the
// picture, each shown only to the layers its data belongs to.
const home = { pendingTasks: 0, activeLines: 0, inactiveLines: 0, expiringLines: 0, operations: [] };
const ranked = (label: string, count: number, profit: number, nickname?: string) => ({ key: label, label, count, amount: count * 4500, profit, ...(nickname ? { nickname } : {}) });
const overview = (period: string, withProviders: boolean) => ({
  period,
  from: null,
  lines: { active: 6, expiring: 2, frozen: 1, disconnected: 3, suspended: 1 },
  sales: {
    count: 12, amount: 54000, profit: 3600, refunds: 1, refundAmount: 2250, net: 51750, capped: false,
    trend: [{ day: '2026-11-07', amount: 18000, profit: 1200, count: 4 }, { day: '2026-11-08', amount: 36000, profit: 2400, count: 8 }],
  },
  // The period cards (owner 2026-11-09): this period, the same span before (null over all time), the trend.
  pulse: {
    current: { count: 12, amount: 54000, activations: 5, profit: 3600 },
    previous: period === 'all' ? null : { count: 8, amount: 36000, activations: 5, profit: 4000 },
    trend: [{ at: '2026-11-07', count: 4, amount: 18000, activations: 2, profit: 1200 }, { at: '2026-11-08', count: 8, amount: 36000, activations: 3, profit: 2400 }],
  },
  top: {
    packages: [ranked('400 جيجا', 8, 2400), ranked('100 جيجا', 4, 1200)],
    companies: [ranked('سلكوم', 9, 2700)],
    providers: withProviders ? [ranked('سكاي', 12, 3600)] : [],
  },
  active: { main_agent: withProviders ? [ranked('main', 12, 3600, 'الرئيسي')] : [], agent: [ranked('agent', 12, 3600, 'الوكيل')], pos: [ranked('pos', 8, 2400, 'المحل')] },
  users: { counts: { main_agent: 1, agent: 2, pos: 5 }, frozen: 1, debtors: 2, debt: 7000, ceilings: 50000, used: 7000 },
  tasks: { pending: 3, working: 1, done: 20, rejected: 2, cancelled: 1, oldestOpenMinutes: 130 },
  providers: withProviders
    ? [
        { code: 'sky', name: 'سكاي', operations: 12, cost: 30000, profit: 3600, balance: -40000, creditLimit: 100000, available: 60000, status: 'working', problem: null },
        { code: 'lian', name: 'ليان', operations: 0, cost: 0, profit: 0, balance: -120000, creditLimit: 100000, available: -20000, status: 'problem', problem: 'balance', failures: 0, alertFloor: 0 },
      ]
    : null,
});

test('the branch reads the full overview, switches the period, and sees its providers', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    'GET /home': () => ({ body: home }),
    'GET /overview': (url) => ({ body: overview(new URL(url, 'http://x').searchParams.get('period') ?? 'month', true) }),
  });
  await page.goto('http://admin.localhost:3910/');
  await expect(page.getByRole('tab', { name: 'هذا الشهر' })).toHaveAttribute('aria-selected', 'true');
  // The period cards: sales with their volume, new subscriptions and profit, each with its change and its trend.
  const band = page.locator('.account-band');
  const cards = band.locator('.pulse-tile');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('12');
  await expect(cards.nth(0)).toContainText('540.00');
  await expect(cards.nth(0).locator('.change')).toHaveText('50%');
  await expect(cards.nth(0).locator('.change')).toHaveClass(/up/);
  await expect(cards.nth(1).locator('.change')).toHaveText('0%');
  await expect(cards.nth(2)).toContainText('+36.00 ₪');
  await expect(cards.nth(2).locator('.change')).toHaveClass(/down/);
  await expect(cards.nth(2).locator('.change')).toHaveText('10%');
  await expect(band.locator('.trend-line')).toHaveCount(3);
  // The branch's home, trimmed (spec 2026-11-09-admin-review, 6.3): the three period cards alone in the band, no
  // «آخر العمليات» or «مهام بانتظارك», no «تمويل حساب» or «تفعيل رقم» in the head.
  await expect(band.locator('.figure-tile')).toHaveCount(3);
  await expect(page.locator('.home-top-row')).toHaveCount(0);
  await expect(page.locator('.home-head').getByRole('link', { name: 'تمويل حساب' })).toHaveCount(0);
  await expect(page.locator('.home-head').getByRole('link', { name: 'تفعيل رقم' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'لوحة الإعلانات' })).toHaveCount(0);

  const legend = page.locator('.donut-legend li');
  await expect(legend).toHaveCount(5);
  await expect(page.locator('.donut-total')).toHaveText('13');
  await expect(page.locator('.donut-legend a[href="/numbers?status=suspended"]')).toContainText('معلق');

  const providers = page.locator('.overview-card', { hasText: 'المزودون' }).first();
  await expect(providers.locator('tbody tr')).toHaveCount(2);
  await expect(providers.locator('tbody tr').nth(1)).toContainText('فيه مشكلة');
  // Provider alerts (spec G): a banner names the providers with a problem while it holds.
  await expect(page.locator('.banner', { hasText: 'مزوّدون فيهم مشكلة الآن' })).toContainText('ليان');

  const top = page.locator('.overview-card', { hasText: 'الأكثر' }).filter({ has: page.getByRole('tab', { name: 'أكثر الرزم مبيعاً' }) });
  await expect(top.getByRole('tab')).toHaveText(['أكثر الرزم مبيعاً', 'أعلى الشركات ربحاً', 'أعلى المزودين ربحاً']);
  await top.getByRole('tab', { name: 'أعلى المزودين ربحاً' }).click();
  await expect(top.locator('.overview-rank li').first()).toContainText('سكاي');

  const active = page.locator('.overview-card', { hasText: 'الأنشط' });
  await expect(active.getByRole('tab')).toHaveText(['وكلاء رئيسيون', 'وكلاء', 'نقاط بيع']);

  await page.getByRole('tab', { name: 'اليوم' }).click();
  await expect.poll(() => calls.some((call) => call.startsWith('GET /overview?') && call.includes('period=day'))).toBe(true);
  // Over all time there is nothing to compare with: no arrow.
  await page.getByRole('tab', { name: 'كل الوقت' }).click();
  await expect(cards.nth(0).locator('.change')).toHaveCount(0);
});

test('an agent sees no providers card and no main-agent tab', async ({ page }) => {
  await serveOffice(page, 'agent', {
    'GET /home': () => ({ body: home }),
    'GET /overview': () => ({ body: overview('month', false) }),
  });
  await page.goto('http://agent.localhost:3910/');
  await expect(page.locator('.account-band .pulse-tile')).toHaveCount(3);
  // The other layers keep their home: the balance, the active numbers, the two panes and the head buttons.
  await expect(page.locator('.account-band .figure-tile')).toHaveCount(5);
  await expect(page.locator('.home-top-row')).toHaveCount(1);
  await expect(page.locator('.home-head').getByRole('link', { name: 'تفعيل رقم' })).toHaveCount(1);
  await expect(page.locator('.overview-card table.data')).toHaveCount(0);
  await expect(page.locator('.banner', { hasText: 'مزوّدون فيهم مشكلة الآن' })).toHaveCount(0);
  const top = page.locator('.overview-card').filter({ has: page.getByRole('tab', { name: 'أكثر الرزم مبيعاً' }) });
  await expect(top.getByRole('tab')).toHaveCount(2);
  const active = page.locator('.overview-card', { hasText: 'الأنشط' });
  await expect(active.locator('.overview-rank li').first()).toContainText('pos');
  await expect(active.getByRole('tab')).toHaveCount(0);
});
