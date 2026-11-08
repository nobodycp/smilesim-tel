import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// A detail page shows the trail to it instead of a back button (spec 2026-11-08-inner-pages-refresh, §1).
test('a detail page shows its trail: the section links back, the page names itself', async ({ page }) => {
  const account = {
    loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos', parentLogin: 'ag1', frozen: false, isBranchOwner: false, staff: false,
    roleId: '', roleName: '', roleGrants: [], extraGrants: [], deniedGrants: [], extraRoleIds: [], grants: [], roles: [], canEdit: true,
  };
  await serveOffice(page, 'branch', {
    'GET /users/pos1': () => ({ body: account }),
    'GET /users': () => ({ body: { users: [] } }),
  });
  await page.goto('http://admin.localhost:3910/users/pos1');
  const trail = page.getByRole('navigation', { name: 'مسار الصفحة' });
  await expect(trail.getByRole('link', { name: 'المستخدمون' })).toHaveAttribute('href', '/users');
  await expect(trail.locator('[aria-current="page"]')).toHaveText('pos1 (نقطة بيع)');
  await expect(page.locator('.back-link')).toHaveCount(0);
  await trail.getByRole('link', { name: 'المستخدمون' }).click();
  await expect(page).toHaveURL(/\/users$/);
  // A section page has no trail.
  await expect(trail).toHaveCount(0);
});
