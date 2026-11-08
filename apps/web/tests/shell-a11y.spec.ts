import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const admin = 'http://admin.localhost:3910';
const home = { body: { pendingTasks: 0, activeLines: 0, inactiveLines: 0, canPost: false, operations: [], announcements: [] } };

test('Escape closes the account menu and gives the focus back to its button', async ({ page }) => {
  await serveOffice(page, 'branch', { 'GET /home': () => home });
  await page.goto(`${admin}/`);
  const trigger = page.getByRole('button', { name: 'قائمة الحساب' });
  await trigger.click();
  await expect(page.getByRole('menuitem', { name: 'تسجيل الخروج' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'تسجيل الخروج' })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

// Closed, the mobile drawer stays in the page off screen; it must not take the keyboard or screen readers.
test('the closed drawer is inert, and the open one is not', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serveOffice(page, 'branch', { 'GET /home': () => home });
  await page.goto(`${admin}/`);
  const drawer = page.locator('aside.drawer');
  await expect(drawer).toHaveAttribute('inert', '');
  await page.getByRole('button', { name: 'فتح القائمة' }).click();
  await expect(drawer).toHaveClass(/open/);
  await expect(drawer).not.toHaveAttribute('inert');
});
