import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// NameField (spec 2026-11-09-admin-review, 2a): names are picked by typing, closest first, with the keyboard or the
// pointer; a picked name has a «×»; leaving the field puts the picked name back.
const pack = (code: string, name: string, companyName: string, providerName: string) => ({ code, name, companyName, providerName });
const packages = [
  pack('cell-400', '400 جيجا', 'سلكوم', 'سكاي'),
  pack('wecom-150', '150 جيجا', 'ويكوم', 'ليان'),
  pack('partner-50', '50 جيجا', 'بارتنر', 'سكاي'),
  pack('hot-1', 'هوت موبايل', 'هوت', 'نيود'),
];

test('a filter is typed: closest names first, keys move, Enter picks, × clears', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    'GET /packages': () => ({ body: { packages, companies: [] } }),
    'GET /tasks': () => ({ body: { items: [], nextCursor: null, total: 0 } }),
  });
  await page.goto('http://admin.localhost:3910/tasks');
  const company = page.locator('.filter-panel').getByRole('combobox', { name: 'الشركة' });
  await expect(company).toHaveAttribute('placeholder', 'الكل');

  // Focused and empty, it lists the names so a short list can be browsed.
  await company.click();
  const list = page.getByRole('listbox', { name: 'الشركة' });
  await expect(list.getByRole('option')).toHaveCount(4);

  // «ك» is in سلكوم and ويكوم; a typo still finds بارتنر; nothing matches → the empty line.
  await company.fill('كوم');
  await expect(list.getByRole('option')).toHaveText(['سلكوم', 'ويكوم']);
  await expect(list.locator('b').first()).toHaveText('كوم');
  await company.fill('برتنر');
  await expect(list.getByRole('option')).toHaveText(['بارتنر']);
  await company.fill('زين');
  await expect(list).toContainText('لا يوجد اسم مطابق');

  // ↓ then Enter picks the second; the filter reaches the server and the chip shows the name.
  await company.fill('كوم');
  await company.press('ArrowDown');
  await expect(list.getByRole('option', { name: 'ويكوم' })).toHaveAttribute('aria-selected', 'true');
  await company.press('Enter');
  await expect(list).toHaveCount(0);
  await expect(company).toHaveValue('ويكوم');
  await expect.poll(() => calls.some((call) => call.startsWith('GET /tasks?') && call.includes(encodeURIComponent('ويكوم')))).toBe(true);

  // Typing then leaving without a pick keeps the picked name: the field takes no free text.
  await company.fill('سل');
  await page.getByRole('heading', { level: 1 }).click();
  await expect(company).toHaveValue('ويكوم');

  // The «×» clears it back to «الكل».
  await page.locator('.filter-panel').getByRole('button', { name: /امسح الاختيار/ }).click();
  await expect(company).toHaveValue('');
  await expect(company).toHaveAttribute('placeholder', 'الكل');
});

test('Esc closes the list and leaves a dialog around the field open', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /lines': () => ({ body: { items: [], nextCursor: null, total: 0, poses: [{ loginName: 'pos1', nickname: 'محل الأمل' }, { loginName: 'pos2', nickname: 'نقطة النور' }] } }),
    'GET /packages': () => ({ body: { packages: packages.map((row) => ({ ...row, forSale: true, enabled: true })), companies: [] } }),
  });
  await page.goto('http://admin.localhost:3910/numbers');
  await page.getByRole('button', { name: 'تفعيل رقم' }).first().click();
  const dialog = page.getByRole('dialog');
  const pos = dialog.getByRole('combobox', { name: 'نقطة البيع' });
  // «امل» finds «محل الأمل» through the article «ال».
  await pos.fill('امل');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
  await pos.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(dialog).toBeVisible();
});
