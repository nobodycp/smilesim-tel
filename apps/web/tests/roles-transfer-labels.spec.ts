import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const admin = 'http://admin.localhost:3910';

// `GET /roles` as the API answers it: `grants` is the list of codes the role holds, `layer` is '' on a job role.
const role = (id: string, name: string, kind: 'layer' | 'job', layer: string, grants: string[]) => ({
  id, name, kind, layer, grants,
  read: grants.includes('read'), edit: false, accounting: false, tasks: false, reports: false, staff: false, enter: false,
});

// The grant says what an account may move and the layer of the role says how far, so each layer names the
// grant in its own words and a layer that can never use a grant does not show it. `cell` is the whole
// permissions cell in Arabic, English, and Hebrew; `boxes` are the transfer checkboxes of the role form.
const cases = [
  {
    row: role('r-branch', 'branch', 'layer', 'branch', ['read', 'transferLines', 'transferPos', 'transferAgents']),
    who: 'فرع',
    cell: {
      ar: 'قراءة · نقل الأرقام بين السلاسل · نقل نقاط البيع خارج السلسلة · نقل الوكلاء',
      en: 'Read · Transfer numbers between chains · Transfer points of sale outside the chain · Transfer agents',
      he: 'קריאה · העברת מספרים בין שרשראות · העברת נקודות מכירה מחוץ לשרשרת · העברת סוכנים',
    },
    boxes: ['نقل الأرقام بين السلاسل', 'نقل نقاط البيع خارج السلسلة', 'نقل الوكلاء'],
  },
  {
    row: role('r-main', 'main_agent', 'layer', 'main_agent', ['read', 'transferLines', 'transferPos']),
    who: 'وكيل رئيسي',
    cell: {
      ar: 'قراءة · نقل الأرقام خارج السلسلة · نقل نقاط البيع داخل السلسلة',
      en: 'Read · Transfer numbers outside the chain · Transfer points of sale inside the chain',
      he: 'קריאה · העברת מספרים מחוץ לשרשרת · העברת נקודות מכירה בתוך השרשרת',
    },
    boxes: ['نقل الأرقام خارج السلسلة', 'نقل نقاط البيع داخل السلسلة'],
  },
  {
    row: role('r-agent', 'agent', 'layer', 'agent', ['read', 'transferLines']),
    who: 'وكيل',
    cell: {
      ar: 'قراءة · نقل الأرقام داخل السلسلة',
      en: 'Read · Transfer numbers inside the chain',
      he: 'קריאה · העברת מספרים בתוך השרשרת',
    },
    boxes: ['نقل الأرقام داخل السلسلة'],
  },
  {
    row: role('r-pos', 'pos', 'layer', 'pos', ['read']),
    who: 'نقطة بيع',
    cell: { ar: 'قراءة', en: 'Read', he: 'קריאה' },
    boxes: [],
  },
  {
    // A job role belongs to the branch, so it is worded as the branch is.
    row: role('r-job', 'مشرف النقل', 'job', '', ['transferLines', 'transferPos', 'transferAgents']),
    who: 'مشرف النقل',
    cell: {
      ar: 'نقل الأرقام بين السلاسل · نقل نقاط البيع خارج السلسلة · نقل الوكلاء',
      en: 'Transfer numbers between chains · Transfer points of sale outside the chain · Transfer agents',
      he: 'העברת מספרים בין שרשראות · העברת נקודות מכירה מחוץ לשרשרת · העברת סוכנים',
    },
    boxes: ['نقل الأرقام بين السلاسل', 'نقل نقاط البيع خارج السلسلة', 'نقل الوكلاء'],
  },
];

const everyTransferLabel = [
  'نقل الأرقام داخل السلسلة', 'نقل الأرقام خارج السلسلة', 'نقل الأرقام بين السلاسل',
  'نقل نقاط البيع داخل السلسلة', 'نقل نقاط البيع خارج السلسلة', 'نقل الوكلاء',
];

for (const locale of ['ar', 'en', 'he'] as const) {
  test(`the roles table names each transfer grant for the layer of the role in ${locale}`, async ({ page }) => {
    await page.context().addCookies([{ name: 'smilesim-locale', value: locale, url: admin }]);
    await serveOffice(page, 'branch', { 'GET /roles': () => ({ body: { roles: cases.map((item) => item.row) } }) });
    await page.goto(`${admin}/roles`);
    const rows = page.locator('.data tbody tr');
    await expect(rows).toHaveCount(cases.length);
    for (const [index, item] of cases.entries()) {
      await expect(rows.nth(index).locator('td').nth(2)).toHaveText(item.cell[locale]);
    }
  });
}

for (const item of cases) {
  test(`the ${item.who} role form lists only the transfer grants its layer can use`, async ({ page }) => {
    await serveOffice(page, 'branch', { 'GET /roles': () => ({ body: { roles: [item.row] } }) });
    await page.goto(`${admin}/roles`);
    await page.getByRole('button', { name: `إجراءات ${item.who}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'تعديل' }).click();
    const form = page.getByRole('dialog');
    await expect(form.getByRole('checkbox', { name: 'قراءة', exact: true })).toBeVisible();
    // No transfer checkbox besides the ones this layer can use, whatever the wording.
    await expect(form.getByRole('checkbox', { name: /^نقل/ })).toHaveCount(item.boxes.length);
    for (const label of everyTransferLabel) {
      const box = form.getByRole('checkbox', { name: label, exact: true });
      if (item.boxes.includes(label)) await expect(box).toBeChecked();
      else await expect(box).toHaveCount(0);
    }
  });
}

test('an agent role form has no checkbox for points of sale or agents and still saves the grants it holds', async ({ page }) => {
  const agent = cases[2];
  await serveOffice(page, 'branch', {
    'GET /roles': () => ({ body: { roles: [agent.row] } }),
    'POST /roles': () => ({ body: { ok: true } }),
  });
  await page.goto(`${admin}/roles`);
  await page.getByRole('button', { name: 'إجراءات وكيل', exact: true }).click();
  await page.getByRole('menuitem', { name: 'تعديل' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByRole('checkbox', { name: /نقل نقاط البيع/ })).toHaveCount(0);
  await expect(form.getByRole('checkbox', { name: /نقل الوكلاء/ })).toHaveCount(0);
  const saved = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/office/roles'));
  await form.getByRole('button', { name: 'حفظ' }).click();
  expect((await saved).postDataJSON()).toMatchObject({ id: 'r-agent', grants: ['read', 'transferLines'] });
});
