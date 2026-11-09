import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const account = {
  loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos', parentLogin: 'ag1', frozen: false, isBranchOwner: false, staff: false,
  roleId: '', roleName: '', roleGrants: [], extraGrants: [], deniedGrants: [], extraRoleIds: [], grants: [], roles: [], canEdit: true,
};

// One tab strip everywhere (components/tabs.tsx): only the selected tab is in the Tab order, and the arrows move the
// selection, mirrored right to left.
test('tabs move with the arrow keys and keep one tab in the Tab order', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /users/pos1': () => ({ body: account }),
    'GET /users/pos1/packages': () => ({ body: { summary: { total: 0, visible: 0, custom: 0 }, companies: [] } }),
    'GET /users/pos1/ops': () => ({ body: { denied: [], deniedAbove: [] } }),
  });
  await page.goto('http://admin.localhost:3910/users/pos1');
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(4);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(1)).toHaveAttribute('tabindex', '-1');
  await tabs.nth(0).focus();
  // Right to left: ArrowLeft goes to the next tab.
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(1)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
});
