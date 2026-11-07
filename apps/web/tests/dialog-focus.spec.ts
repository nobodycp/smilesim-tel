import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// Typing re-renders the page that owns the dialog. The dialog must keep the focus on the field being typed in,
// not move it back to the first field on every keystroke.
test('typing in a later dialog field keeps the focus there', async ({ page }) => {
  await serveOffice(page, 'branch', { 'GET /users': () => ({ body: { users: [] } }) });
  await page.goto('http://admin.localhost:3910/users');
  await page.getByRole('button', { name: 'حساب جديد' }).click();
  const dialog = page.getByRole('dialog', { name: 'حساب جديد' });
  await expect(dialog.getByLabel('اسم الدخول')).toBeFocused();
  const fullName = dialog.getByLabel('الاسم الكامل');
  await fullName.click();
  await page.keyboard.type('سمير');
  await expect(fullName).toBeFocused();
  await expect(fullName).toHaveValue('سمير');
  await expect(dialog.getByLabel('اسم الدخول')).toHaveValue('');
});
