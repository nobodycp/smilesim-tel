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

// Every popup shares usePopover: a menu takes the focus on its first item and the arrows walk it.
test('the account menu opens on its first item and the arrow keys move between its items', async ({ page }) => {
  await serveOffice(page, 'branch', { 'GET /home': () => home });
  await page.goto(`${admin}/`);
  await page.getByRole('button', { name: 'قائمة الحساب' }).click();
  const settings = page.getByRole('menuitem', { name: 'الملف الشخصي' });
  const logout = page.getByRole('menuitem', { name: 'تسجيل الخروج' });
  await expect(settings).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(logout).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(settings).toBeFocused();
  await page.keyboard.press('End');
  await expect(logout).toBeFocused();
});

test('a press outside the wallet pop closes it, and Escape on the notices gives the focus back', async ({ page }) => {
  await serveOffice(page, 'branch', { 'GET /home': () => home });
  const session = page.waitForResponse((response) => response.url().endsWith('/office/me'));
  await page.goto(`${admin}/`);
  await session;
  await page.getByRole('button', { name: 'تفاصيل المحفظة' }).click();
  await expect(page.getByRole('dialog', { name: 'تفاصيل المحفظة' })).toBeVisible();
  await page.locator('.canvas').click({ position: { x: 5, y: 5 } });
  await expect(page.getByRole('dialog', { name: 'تفاصيل المحفظة' })).toHaveCount(0);
  const bell = page.getByRole('button', { name: 'الإشعارات' });
  await bell.click();
  await expect(page.locator('.notice-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.notice-panel')).toHaveCount(0);
  await expect(bell).toBeFocused();
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
