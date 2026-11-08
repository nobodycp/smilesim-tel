import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const sessions = { sessions: [{ id: 's1', current: true, userAgent: '', ip: '', createdAt: '2026-11-08T00:00:00.000Z', lastSeenAt: '2026-11-08T00:00:00.000Z' }] };

async function serveAuth(page: import('@playwright/test').Page, revoke: { status: number; body: unknown }) {
  const revoked: string[] = [];
  await page.route('**/api/auth/sessions**', async (route) => {
    const request = route.request();
    if (request.method() === 'DELETE') {
      revoked.push(new URL(request.url()).pathname);
      await route.fulfill({ status: revoke.status, contentType: 'application/json', body: JSON.stringify(revoke.body) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessions) });
  });
  return revoked;
}

test('signing out revokes this session and lands on the sign-in page', async ({ page }) => {
  await serveOffice(page, 'branch', { 'GET /users': () => ({ body: { users: [] } }) });
  const revoked = await serveAuth(page, { status: 200, body: { ok: true } });
  await page.goto('http://admin.localhost:3910/users');
  await page.getByRole('button', { name: 'قائمة الحساب' }).click();
  await page.getByRole('menuitem', { name: 'تسجيل الخروج' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(revoked).toEqual(['/api/auth/sessions/s1']);
});

test('a failed sign-out keeps the account signed in where it was', async ({ page }) => {
  await serveOffice(page, 'branch', { 'GET /users': () => ({ body: { users: [] } }) });
  await serveAuth(page, { status: 500, body: { message: 'boom' } });
  await page.goto('http://admin.localhost:3910/users');
  await page.getByRole('button', { name: 'قائمة الحساب' }).click();
  await page.getByRole('menuitem', { name: 'تسجيل الخروج' }).click();
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/users$/);
});
