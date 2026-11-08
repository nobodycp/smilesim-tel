import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// A refusal is translated by its code. The Arabic sentence can change on the server; the code is the contract.
test('a page error in English follows the code, not the Arabic message', async ({ page }) => {
  const admin = 'http://admin.localhost:3910';
  await page.context().addCookies([{ name: 'smilesim-locale', value: 'en', url: admin }]);
  await serveOffice(page, 'branch', {
    'GET /users': () => ({ body: { message: 'نص عربي لم يُترجم بعد', code: 'FORBIDDEN' }, status: 403 }),
  });
  await page.goto(`${admin}/users`);
  await expect(page.locator('.load-failed .empty-text')).toHaveText('Not allowed');
});
