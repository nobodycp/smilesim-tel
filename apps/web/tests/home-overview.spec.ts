import { expect, test } from '@playwright/test';
import { serveApi } from './desk';

// The home overview (spec 2026-11-08-overview-and-reports-nav, F): a period switch, then one card per part of the
// picture, each shown only to the layers its data belongs to.
const home = { pendingTasks: 0, activeLines: 0, inactiveLines: 0, expiringLines: 0, operations: [] };
const ranked = (label: string, count: number, profit: number, nickname?: string) => ({ key: label, label, count, amount: count * 4500, profit, ...(nickname ? { nickname } : {}) });
const overview = (period: string, withProviders: boolean) => ({
  period,
  from: null,
  lines: { active: 6, expiring: 2, frozen: 1, disconnected: 3, suspended: 1 },
  lineChange: { active: 3, expiring: 0, frozen: -2, disconnected: 0, suspended: 0 },
  sales: {
    count: 12, amount: 54000, profit: 3600, refunds: 1, refundAmount: 2250, net: 51750,
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
  tasks: { working: 4, done: 20, rejected: 2, cancelled: 1, oldestOpenMinutes: 130 },
  providers: withProviders
    ? [
        { code: 'sky', name: 'سكاي', operations: 12, cost: 30000, profit: 3600, balance: -40000, creditLimit: 100000, available: 60000, status: 'working', problem: null },
        { code: 'lian', name: 'ليان', operations: 0, cost: 0, profit: 0, balance: -120000, creditLimit: 100000, available: -20000, status: 'problem', problem: 'balance', failures: 0, alertFloor: 0 },
      ]
    : null,
});

test('the branch reads the full overview, switches the period, and sees its providers', async ({ page }) => {
  const calls = await serveApi(page, 'branch', {
    'GET /home': () => ({ body: home }),
    'GET /overview': (url) => ({ body: overview(new URL(url, 'http://x').searchParams.get('period') ?? 'month', true) }),
  });
  await page.goto('http://admin.localhost:3910/');
  await expect(page.getByRole('tab', { name: 'شهر', exact: true })).toHaveAttribute('aria-selected', 'true');
  // The period cards: sales with their volume, new subscriptions and profit, each with its change and its trend.
  const band = page.getByTestId('account-band');
  const cards = band.getByTestId('pulse-tile');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('12');
  await expect(cards.nth(0)).toContainText('540.00');
  await expect(cards.nth(0).getByTestId('pulse-change')).toHaveText('50%');
  await expect(cards.nth(0).getByTestId('pulse-change')).toHaveAttribute('data-trend', 'up');
  await expect(cards.nth(1).getByTestId('pulse-change')).toHaveText('0%');
  await expect(cards.nth(2)).toContainText('+36.00 ₪');
  await expect(cards.nth(2).getByTestId('pulse-change')).toHaveAttribute('data-trend', 'down');
  await expect(cards.nth(2).getByTestId('pulse-change')).toHaveText('10%');
  await expect(band.getByTestId('trend-line')).toHaveCount(3);
  // The branch's home, trimmed (spec 2026-11-09-admin-review, 6.3): the three period cards alone in the band, no
  // «آخر العمليات» or «مهام بانتظارك», no «تمويل حساب» or «تفعيل رقم» in the head.
  await expect(band.getByTestId(/^(figure|pulse)-tile$/)).toHaveCount(3);
  await expect(page.getByTestId('home-top-row')).toHaveCount(0);
  await expect(page.getByTestId('page-head').getByRole('link', { name: 'تمويل حساب' })).toHaveCount(0);
  await expect(page.getByTestId('page-head').getByRole('link', { name: 'تفعيل رقم' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'لوحة الإعلانات' })).toHaveCount(0);

  const legend = page.getByTestId('donut-legend').locator('li');
  await expect(legend).toHaveCount(5);
  await expect(page.getByTestId('donut-total')).toHaveText('13');
  await expect(page.getByTestId('donut-legend').locator('a[href="/numbers?status=suspended"]')).toContainText('معلق');
  // Each slice's change over the period (spec 2026-11-09-admin-review, 6.4): green ↑3, red ↓2, nothing for 0.
  await expect(legend.nth(0).getByTestId('donut-change-up')).toHaveText('3');
  await expect(page.getByTestId('donut-legend').locator('a[href="/numbers?status=frozen"]').getByTestId('donut-change-down')).toHaveText('2');
  await expect(legend.nth(1).getByTestId(/^donut-change-(up|down)$/)).toHaveCount(0);
  // The count closes the line, the change before it (spec 2026-11-09-admin-review, 8.2).
  await expect(legend.nth(0).locator('a > *').last()).toHaveAttribute('data-testid', 'donut-value');
  // The period switch is short (8.5); the cards keep the long name.
  await expect(page.getByTestId('page-head').getByRole('tab')).toHaveText(['يوم', 'شهر', 'الكل']);
  await expect(cards.nth(1)).toContainText('هذا الشهر');
  // «المستخدمون» (8.3): a tile per layer linking to its list, the ceilings bar, debtors and frozen.
  const users = page.getByTestId('users-card');
  await expect(users.getByTestId('users-layer')).toHaveCount(3);
  await expect(users.getByTestId('users-layer').first()).toHaveAttribute('href', '/users?layer=main_agent');
  await expect(users.getByTestId('users-layer').first()).toContainText('وكلاء رئيسيون');
  await expect(users.getByTestId('users-meter').locator('i')).toHaveAttribute('style', /14%/);
  const debtors = users.getByTestId('users-debtors');
  await expect(debtors).toHaveAttribute('data-warn', '');
  await expect(debtors).toContainText('70.00');
  // Pointing at a slice puts its share in the ring's middle; leaving brings the total back.
  await legend.nth(0).hover();
  await expect(page.getByTestId('donut-total')).toHaveText('46%');
  await expect(page.getByTestId('donut-caption')).toHaveText('فعال');
  await page.getByTestId('page-head').getByRole('heading', { level: 1 }).hover();
  await expect(page.getByTestId('donut-total')).toHaveText('13');

  const providers = page.getByTestId('overview-card').filter({ hasText: 'المزودون' }).first();
  await expect(providers.locator('tbody tr')).toHaveCount(2);
  await expect(providers.locator('tbody tr').nth(1)).toContainText('فيه مشكلة');
  // Provider alerts (spec G): a banner names the providers with a problem while it holds.
  await expect(page.getByTestId('banner').filter({ hasText: 'مزوّدون فيهم مشكلة الآن' })).toContainText('ليان');

  const top = page.getByTestId('overview-card').filter({ hasText: 'الأكثر' }).filter({ has: page.getByRole('tab', { name: 'أكثر الرزم مبيعاً' }) });
  await expect(top.getByRole('tab')).toHaveText(['أكثر الرزم مبيعاً', 'أعلى الشركات ربحاً', 'أعلى المزودين ربحاً']);
  await top.getByRole('tab', { name: 'أعلى المزودين ربحاً' }).click();
  await expect(top.getByTestId('overview-rank').locator('li').first()).toContainText('سكاي');

  const active = page.getByTestId('overview-card').filter({ hasText: 'الأنشط' });
  await expect(active.getByRole('tab')).toHaveText(['وكلاء رئيسيون', 'وكلاء', 'نقاط بيع']);

  await page.getByRole('tab', { name: 'يوم', exact: true }).click();
  await expect.poll(() => calls.some((call) => call.startsWith('GET /overview?') && call.includes('period=day'))).toBe(true);
  // Over all time there is nothing to compare with: no arrow.
  await page.getByRole('tab', { name: 'الكل', exact: true }).click();
  await expect(cards.nth(0).getByTestId('pulse-change')).toHaveCount(0);
});

test('an agent sees no providers card and no main-agent tab', async ({ page }) => {
  await serveApi(page, 'agent', {
    'GET /home': () => ({ body: home }),
    'GET /overview': () => ({ body: overview('month', false) }),
  });
  await page.goto('http://agent.localhost:3910/');
  await expect(page.getByTestId('account-band').getByTestId('pulse-tile')).toHaveCount(3);
  // The other layers keep their home: the balance, the active numbers, the two panes and the head buttons.
  await expect(page.getByTestId('account-band').getByTestId(/^(figure|pulse)-tile$/)).toHaveCount(5);
  await expect(page.getByTestId('home-top-row')).toHaveCount(1);
  await expect(page.getByTestId('page-head').getByRole('link', { name: 'تفعيل رقم' })).toHaveCount(1);
  await expect(page.getByTestId('overview-card').getByTestId('data-table')).toHaveCount(0);
  await expect(page.getByTestId('banner').filter({ hasText: 'مزوّدون فيهم مشكلة الآن' })).toHaveCount(0);
  const top = page.getByTestId('overview-card').filter({ has: page.getByRole('tab', { name: 'أكثر الرزم مبيعاً' }) });
  await expect(top.getByRole('tab')).toHaveCount(2);
  const active = page.getByTestId('overview-card').filter({ hasText: 'الأنشط' });
  await expect(active.getByTestId('overview-rank').locator('li').first()).toContainText('pos');
  await expect(active.getByRole('tab')).toHaveCount(0);
  await expect(page.getByTestId('users-card').getByTestId('users-layer')).toHaveCount(1);
});
