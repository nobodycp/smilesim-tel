import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DOORS, closeDb, login, sql, type Door } from './kit';
import { inspect, problems, watchErrors } from './page-checks';

const OUT = path.join(__dirname, '..', 'audit-output', 'screens');
const POS_NAV = ['الصفحة الرئيسية', 'الأرقام', 'الرزم', 'المهام', 'المالية', 'سجل النشاط'];

/** `dialog` is an operation on the number card whose dialog is checked, then closed without confirming. */
type Visit = { name: string; path: string; tabs?: string[]; dialog?: string };
type Finding = { name: string; url: string; problems: string[] };

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.skeleton, [aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

async function sample() {
  const line = await sql<{ id: string }>(
    `SELECT l.id FROM "Line" l JOIN "User" u ON u.id = l."posId" WHERE u."loginName" = 'pos' ORDER BY l."createdAt" LIMIT 1`,
  );
  const active = await sql<{ id: string }>(
    `SELECT l.id FROM "Line" l JOIN "User" u ON u.id = l."posId" WHERE u."loginName" = 'pos' AND l.status = 'active' ORDER BY l."createdAt" LIMIT 1`,
  );
  const task = await sql<{ id: string }>(`SELECT id FROM "OfficeTask" ORDER BY "createdAt" DESC LIMIT 1`);
  const pack = await sql<{ code: string; provider: string; company: string }>(
    `SELECT p.code, pr.code AS provider, c.code AS company FROM "Package" p JOIN "Provider" pr ON pr.id = p."providerId" JOIN "Company" c ON c.id = p."companyId" WHERE pr.code = 'lian' ORDER BY p.code LIMIT 1`,
  );
  return { lineId: line[0]?.id, activeId: active[0]?.id, taskId: task[0]?.id, pack: pack[0] };
}

async function audit(page: Page, door: Door, visits: Visit[], nav: string[] | undefined, reports: Finding[]) {
  const errors = watchErrors(page);
  for (const visit of visits) {
    await test.step(`${door} ${visit.name}`, async () => {
      errors.length = 0;
      await page.goto(`${DOORS[door]}${visit.path}`);
      await settle(page);
      const shots = [
        { label: visit.name, tab: '', dialog: '' },
        ...(visit.dialog ? [{ label: `${visit.name}-dialog`, tab: '', dialog: visit.dialog }] : []),
        ...(visit.tabs ?? []).map((tab) => ({ label: `${visit.name}-${tab}`, tab, dialog: '' })),
      ];
      for (const shot of shots) {
        if (shot.tab) {
          await page.getByRole('tab', { name: shot.tab, exact: true }).click();
          await settle(page);
        }
        if (shot.dialog) {
          await page.locator('.line-ops').getByRole('button', { name: shot.dialog, exact: true }).click();
          await expect(page.getByRole('dialog').locator('.money')).toBeVisible();
        }
        const file = `${door}-${shot.label}`.replace(/[^\w-]+/g, '_');
        await page.screenshot({ path: path.join(OUT, `${file}.png`), fullPage: true });
        const report = await inspect(page, `${door} ${shot.label}`, errors);
        const list = problems(report, nav);
        reports.push({ name: report.name, url: report.url, problems: list });
        expect.soft(list, `${door} ${shot.label} (${visit.path})`).toEqual([]);
        if (shot.dialog) {
          await page.getByRole('dialog').getByRole('button', { name: 'إلغاء', exact: true }).click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
        }
      }
    });
  }
}

test('every branch and point of sale screen renders clean in Arabic at 1440px', async ({ browser }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({ locale: 'ar', viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const admin = await context.newPage();
  const pos = await context.newPage();
  await login(admin, 'admin', 'branch');
  await login(pos, 'pos', 'pos');
  const { lineId, activeId, taskId, pack } = await sample();
  const reports: Finding[] = [];

  const branch: Visit[] = [
    { name: 'home', path: '/' },
    { name: 'tasks', path: '/tasks' },
    ...(taskId ? [{ name: 'task', path: `/tasks/${taskId}` }] : []),
    { name: 'numbers', path: '/numbers' },
    ...(lineId ? [{ name: 'number', path: `/numbers/${lineId}`, tabs: ['التفاصيل', 'السجل'] }] : []),
    ...(activeId ? [{ name: 'disconnect', path: `/numbers/${activeId}`, dialog: 'فصل' }] : []),
    { name: 'users', path: '/users' },
    { name: 'user', path: '/users/pos' },
    { name: 'finance', path: '/finance' },
    { name: 'packages', path: '/packages' },
    { name: 'companies', path: '/companies' },
    ...(pack ? [
      { name: 'company', path: `/companies/${pack.company}`, tabs: ['المزودون'] },
      { name: 'company-provider', path: `/companies/${pack.company}/${pack.provider}` },
    ] : []),
    { name: 'providers', path: '/providers' },
    ...(pack ? [
      { name: 'provider', path: `/providers/${pack.provider}` },
      { name: 'package-sheet', path: `/providers/${pack.provider}/${pack.code}` },
    ] : []),
    { name: 'report-providers', path: '/reports/providers' },
    { name: 'provider-operations', path: '/provider-operations' },
    { name: 'activity', path: '/audit' },
    { name: 'roles', path: '/roles' },
    { name: 'settings', path: '/settings' },
    { name: 'report-tasks', path: '/reports/tasks' },
    { name: 'report-numbers', path: '/reports/numbers' },
    { name: 'report-operations', path: '/reports/operations' },
  ];
  const point: Visit[] = [
    { name: 'home', path: '/' },
    { name: 'numbers', path: '/numbers' },
    ...(lineId ? [{ name: 'number', path: `/numbers/${lineId}`, tabs: ['التفاصيل', 'السجل'] }] : []),
    ...(activeId ? [{ name: 'disconnect', path: `/numbers/${activeId}`, dialog: 'فصل' }] : []),
    { name: 'packages', path: '/packages' },
    { name: 'tasks', path: '/tasks' },
    { name: 'finance', path: '/finance' },
    { name: 'activity', path: '/audit' },
    { name: 'settings', path: '/settings' },
  ];

  await audit(admin, 'admin', branch, undefined, reports);
  await audit(pos, 'pos', point, POS_NAV, reports);

  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(reports, null, 2));
  await context.close();
  await closeDb();
});
