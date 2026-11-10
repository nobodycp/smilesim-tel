import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// Task notes and statuses (spec 2026-11-09-offers-tasks-addons-wallet-esim, 2): the branch writes internal notes,
// which carry a badge; an open task reads «قيد المعالجة» and has no «بانتظار الاستلام».
const task = {
  id: 't1', action: 'switch', status: 'working', posLoginName: 'pos', submitterLoginName: 'pos', assigneeLoginName: null, posDelta: -500,
  msisdn: '0550000001', packageName: '400 جيجا', note: 'مهمة فرع', resultNote: null, lastNote: null, log: '',
  canTake: true, canWork: true, canCancel: false, createdAt: '2026-11-09T08:00:00.000Z', updatedAt: '2026-11-09T08:00:00.000Z',
  iccid: null, esim: false, esimQr: null, sim: { length: null, prefix: '', esim: true }, lineStatus: 'active', companyName: 'سلكوم',
  providerName: 'سكاي', canNote: true, canNoteInternal: true,
};
const events = [
  { id: 'n1', kind: 'note', internal: true, body: 'اتصلت بالمزود، ننتظر رده', authorName: 'المالك', at: '2026-11-09T09:00:00.000Z' },
  { id: 'n2', kind: 'note', body: 'متى يجهز؟', authorName: 'نقطة', at: '2026-11-09T08:30:00.000Z' },
];

test('the branch writes an internal note, sees it marked, and the task reads in progress', async ({ page }) => {
  const sent: unknown[] = [];
  await serveOffice(page, 'branch', {
    'GET /tasks/t1': () => ({ body: { task, events } }),
    'POST /tasks/t1/notes': () => ({ body: { ok: true } }),
  });
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/office/tasks/t1/notes')) sent.push(request.postDataJSON());
  });
  await page.goto('http://admin.localhost:3910/tasks/t1');
  await expect(page.getByText('قيد المعالجة').first()).toBeVisible();
  await expect(page.getByText('بانتظار الاستلام')).toHaveCount(0);
  const internal = page.locator('.task-tree-card.internal');
  await expect(internal).toHaveCount(1);
  await expect(internal).toContainText('داخلية');
  // The toggle starts on for the branch: a note it writes is internal unless it says otherwise.
  const toggle = page.getByLabel('ملاحظة داخلية (للفرع فقط)');
  await expect(toggle).toBeChecked();
  await page.getByRole('textbox', { name: 'ملاحظة' }).fill('تم التحقق من الشريحة');
  await page.locator('.task-tree-compose').getByRole('button', { name: 'إضافة ملاحظة' }).click();
  await expect.poll(() => sent).toEqual([{ text: 'تم التحقق من الشريحة', internal: true }]);
});
