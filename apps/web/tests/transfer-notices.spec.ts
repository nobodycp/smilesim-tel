import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const admin = 'http://admin.localhost:3910';
const at = '2026-10-02T10:30:00.000Z';

const notice = (id: string, kind: string, payload: Record<string, unknown>) => ({
  id, kind, payload, actorName: 'الإدارة', href: '/users', read: false, createdAt: at,
});

// What `office.service` writes for every move: `transfer.out` tells the account that lost the thing which
// account has it now, `transfer.in` tells the account that received it where it came from.
const notices = [
  notice('n1', 'transfer.out', { kind: 'pos', subject: 'pos1', toLogin: 'ag2', actorName: 'الإدارة' }),
  notice('n2', 'transfer.in', { kind: 'line', subject: '0521000001', fromLogin: 'pos1', actorName: 'الإدارة' }),
  notice('n3', 'transfer.out', { kind: 'agent', subject: 'ag1', toLogin: 'ma2', actorName: 'الإدارة' }),
];

const words = {
  ar: {
    out: 'نُقل من حسابك', in: 'نُقل إلى حسابك',
    details: ['pos1 · إلى ag2 · بواسطة الإدارة', '0521000001 · من pos1 · بواسطة الإدارة', 'ag1 · إلى ma2 · بواسطة الإدارة'],
  },
  en: {
    out: 'Moved out of your account', in: 'Moved into your account',
    details: ['pos1 · to ag2 · by الإدارة', '0521000001 · from pos1 · by الإدارة', 'ag1 · to ma2 · by الإدارة'],
  },
  he: {
    out: 'הועבר מחשבונך', in: 'הועבר לחשבונך',
    details: ['pos1 · אל ag2 · על ידי الإدارة', '0521000001 · מאת pos1 · על ידי الإدارة', 'ag1 · אל ma2 · על ידי الإدارة'],
  },
} as const;

for (const locale of ['ar', 'en', 'he'] as const) {
  test(`the shell words a transfer notice in ${locale}: what moved, to or from which account, and who moved it`, async ({ page }) => {
    await page.context().addCookies([{ name: 'smilesim-locale', value: locale, url: admin }]);
    await serveOffice(page, 'branch', {
      'GET /home': () => ({ body: { pendingTasks: 0, activeLines: 0, inactiveLines: 0, canPost: false, operations: [], announcements: [] } }),
      'GET /notices': () => ({ body: { unread: notices.length, nextCursor: null, notices } }),
    });
    await page.goto(`${admin}/`);
    await page.getByRole('button', { name: { ar: 'الإشعارات', en: 'Notices', he: 'התראות' }[locale], exact: true }).click();
    const titles = page.locator('.shell-item strong');
    const details = page.locator('.shell-item .notice-detail');
    await expect(titles).toHaveText([words[locale].out, words[locale].in, words[locale].out]);
    await expect(details).toHaveText([...words[locale].details]);
  });
}

test('the activity log names an account transfer and offers it as a filter', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    'GET /audit': () => ({
      body: {
        entries: [{
          id: 'a1', at, action: 'user_transfer', result: 'ok', reason: '', ip: '', actorLogin: 'admin', actorLayer: 'branch',
          subjectKind: 'user', subjectRef: 'pos1',
        }],
        nextCursor: null,
        total: 1,
      },
    }),
  });
  await page.goto(`${admin}/audit`);
  await expect(page.locator('.data tbody tr')).toHaveCount(1);
  await expect(page.locator('.data tbody tr').first()).toContainText('نقل حساب');
  const filter = page.getByLabel('الحدث');
  await expect(filter.getByRole('option', { name: 'نقل حساب', exact: true })).toHaveCount(1);
  await filter.selectOption('user_transfer');
  await expect.poll(() => calls.some((call) => call.startsWith('GET /audit') && call.includes('action=user_transfer'))).toBe(true);
});
