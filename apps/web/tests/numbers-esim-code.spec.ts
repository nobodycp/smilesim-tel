import { expect, test, type Page, type Route } from '@playwright/test';

// Plan 2026-11-10-activation-settlement, S.5c (web step): the numbers list does not read the eSIM code from its
// rows. It is asked for from the line's detail when the user opens it, shown only after that answer, and dropped
// when the dialog closes. These specs serve list rows WITHOUT `esimQr`, as the API will once its step is done.

const QR_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const QR_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const row = (id: string, msisdn: string, esim: boolean) => ({
  id, msisdn, iccid: `89972020000000${id.replace(/\D/g, '').padStart(5, '0')}`, esim, status: 'active', suspended: false,
  packageCode: 'cell-400', packageName: '400 جيجا', companyName: 'سلكوم', posLoginName: 'pos', posPrice: 30,
  createdAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-12-12T00:00:00.000Z',
});
const rows = [row('ln1', '0550000001', true), row('ln2', '0550000002', true), row('ln3', '0550000003', false)];
const detail = (id: string, esimQr: string | null) => ({ line: { ...rows.find((line) => line.id === id), esimQr }, history: [] });

/** Serves the list and the packages; `onDetail` answers each `GET /office/lines/:id`. Returns the detail calls made. */
async function serve(page: Page, onDetail: (id: string, route: Route) => Promise<unknown> | unknown) {
  const asked: string[] = [];
  await page.route(/\/office\/lines(\?[^/]*)?$/, (route) => route.fulfill(json({ items: rows, total: rows.length, nextCursor: null, poses: [] })));
  await page.route(/\/office\/lines\/[^/?]+$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    asked.push(id);
    await onDetail(id, route);
  });
  await page.route('**/office/packages', (route) => route.fulfill(json({ packages: [], companies: [] })));
  await page.goto('/numbers');
  await expect(page.locator('table.data tbody tr')).toHaveCount(3);
  return asked;
}
const openButton = (page: Page, msisdn: string) => page.getByRole('button', { name: `عرض رمز QR ${msisdn}` });
const dialog = (page: Page) => page.locator('.dialog-qr');
const picture = (page: Page) => page.locator('.dialog-qr .qr-tile img');

test('the list works without the code: SIM and eSIM by name, and the detail is asked for only when the QR is opened', async ({ page }) => {
  const asked = await serve(page, (id, route) => route.fulfill(json(detail(id, id === 'ln1' ? QR_A : QR_B))));
  const cells = page.locator('table.data tbody tr .line-cell');
  await expect(cells.nth(0)).toContainText('eSIM');
  await expect(cells.nth(2)).toContainText('SIM');
  await expect(openButton(page, '0550000001')).toBeVisible();
  await expect(openButton(page, '0550000003')).toHaveCount(0);
  // Nothing is asked for, and no code is on the page, until the user opens one.
  await page.waitForTimeout(600);
  expect(asked).toEqual([]);
  await expect(page.locator(`img[src^="data:image/png;base64,iVBOR"]`)).toHaveCount(0);

  await openButton(page, '0550000001').click();
  await expect(picture(page)).toHaveAttribute('src', QR_A);
  await expect(dialog(page)).toContainText('0550000001');
  await expect(dialog(page)).toContainText(rows[0].iccid);
  expect(asked).toEqual(['ln1']);
});

test('nothing is shown before the answer, and pressing again while it is on its way asks once', async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const asked = await serve(page, async (id, route) => {
    await held;
    await route.fulfill(json(detail(id, QR_A)));
  });
  const button = openButton(page, '0550000001');
  await button.click();
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await button.click({ force: true }).catch(() => undefined);
  await expect(dialog(page)).toHaveCount(0);
  await expect(picture(page)).toHaveCount(0);
  release();
  await expect(picture(page)).toHaveAttribute('src', QR_A);
  expect(asked).toEqual(['ln1']);
  await expect(button).toBeEnabled();
});

for (const [status, code, message] of [
  [403, 'FORBIDDEN', 'غير مسموح'],
  [404, 'NOT_FOUND', 'غير موجود'],
  [500, 'SERVER_ERROR', 'حدث خطأ في الخادم. أعد المحاولة'],
  [500, 'ESIM_CODE_UNREADABLE', 'تعذّرت قراءة رمز eSIM المحفوظ. تواصل مع الدعم'],
] as const) {
  test(`a refusal of the detail (${status} ${code}) shows its message and no dialog`, async ({ page }) => {
    await serve(page, (_id, route) => route.fulfill(json({ code, message }, status)));
    await openButton(page, '0550000001').click();
    await expect(page.getByText(message)).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await expect(picture(page)).toHaveCount(0);
    await expect(openButton(page, '0550000001')).toBeEnabled();
  });
}

test('a line the caller may not read gives no code: the server\'s refusal is what the screen shows, whatever the list held', async ({ page }) => {
  // The row is on screen (as if the list were stale); the detail is the server's to refuse.
  const asked = await serve(page, (id, route) => route.fulfill(id === 'ln2' ? json({ code: 'NOT_FOUND', message: 'غير موجود' }, 404) : json(detail(id, QR_A))));
  await openButton(page, '0550000002').click();
  await expect(page.getByText('غير موجود')).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  expect(asked).toEqual(['ln2']);
  expect(await page.content()).not.toContain(QR_A.slice(30));
});

test('an eSIM with no code says so and opens no empty dialog; an answer for another line is not shown either', async ({ page }) => {
  await serve(page, (id, route) => route.fulfill(json(id === 'ln1' ? detail('ln1', null) : { ...detail('ln1', QR_A) })));
  await openButton(page, '0550000001').click();
  await expect(page.getByText('الرقم 0550000001 eSIM بلا رمز QR محفوظ')).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  // The answer names line 1 while line 2 was asked for: not shown.
  await openButton(page, '0550000002').click();
  await expect(page.getByText('الرقم 0550000002 eSIM بلا رمز QR محفوظ')).toBeVisible();
  await expect(picture(page)).toHaveCount(0);
});

test('choosing another line while the first is on its way shows only the second, and the late answer is dropped', async ({ page }) => {
  let releaseFirst: () => void = () => undefined;
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const asked = await serve(page, async (id, route) => {
    if (id === 'ln1') await first;
    await route.fulfill(json(detail(id, id === 'ln1' ? QR_A : QR_B)));
  });
  await openButton(page, '0550000001').click();
  await expect(openButton(page, '0550000001')).toBeDisabled();
  await openButton(page, '0550000002').click();
  await expect(picture(page)).toHaveAttribute('src', QR_B);
  await expect(dialog(page)).toContainText('0550000002');
  await expect(dialog(page)).not.toContainText('0550000001');
  // The first line's answer arrives now: the dialog still shows the second line, and only it.
  releaseFirst();
  await page.waitForTimeout(500);
  await expect(picture(page)).toHaveAttribute('src', QR_B);
  await expect(dialog(page)).not.toContainText('0550000001');
  expect(await page.content()).not.toContain(QR_A.slice(30));
  expect(asked).toEqual(['ln1', 'ln2']);
});

test('closing drops the code: nothing of it stays on the page, in the address or in storage, and opening again asks again', async ({ page }) => {
  let releaseSecond: () => void = () => undefined;
  const second = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const asked = await serve(page, async (id, route) => {
    if (id === 'ln2') await second;
    await route.fulfill(json(detail(id, id === 'ln1' ? QR_A : QR_B)));
  });
  await openButton(page, '0550000001').click();
  await expect(picture(page)).toHaveAttribute('src', QR_A);
  await dialog(page).getByRole('button', { name: 'إغلاق' }).last().click();
  await expect(dialog(page)).toHaveCount(0);
  const kept = await page.evaluate(() => ({
    html: document.documentElement.outerHTML,
    local: JSON.stringify(Object.entries(localStorage)),
    session: JSON.stringify(Object.entries(sessionStorage)),
    address: location.href,
  }));
  for (const text of Object.values(kept)) expect(text).not.toContain(QR_A.slice(30));
  expect(kept.address).not.toContain('ln1');

  // Another line, slow to answer: the first line's code does not come back while it loads.
  await openButton(page, '0550000002').click();
  await page.waitForTimeout(300);
  await expect(dialog(page)).toHaveCount(0);
  expect(await page.content()).not.toContain(QR_A.slice(30));
  releaseSecond();
  await expect(picture(page)).toHaveAttribute('src', QR_B);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);

  // Opening the first again is a new request: the code was not kept anywhere to show it from.
  await openButton(page, '0550000001').click();
  await expect(picture(page)).toHaveAttribute('src', QR_A);
  expect(asked).toEqual(['ln1', 'ln2', 'ln1']);
});

// The pages that already read the code from a detail go on as before, and do not keep it once they close.
test('the line page shows the code from its own detail, and asks again after it was left', async ({ page }) => {
  let asked = 0;
  await page.route('**/office/lines/ln1**', (route) => {
    asked += 1;
    return route.fulfill(json({ line: { ...row('ln1', '0550000001', true), esimQr: QR_A }, history: [] }));
  });
  await page.goto('/numbers/ln1');
  await page.getByRole('tab', { name: 'التفاصيل' }).click();
  await page.getByRole('button', { name: /رمز QR/ }).first().click();
  await expect(picture(page)).toHaveAttribute('src', QR_A);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  const first = asked;
  // Left and opened again: the answer was not kept in the shared cache, so the page waits for a new one.
  await page.goto('/settings');
  await expect(page.locator('.settings-grid')).toBeVisible();
  await page.goto('/numbers/ln1');
  await page.getByRole('tab', { name: 'التفاصيل' }).click();
  await expect(page.getByRole('button', { name: /رمز QR/ }).first()).toBeVisible();
  expect(asked).toBeGreaterThan(first);
});

test('a task page shows the code its detail carries, large when opened', async ({ page }) => {
  const task = {
    id: 't1', action: 'sim', status: 'working', posLoginName: 'pos', submitterLoginName: 'pos', assigneeLoginName: null, posDelta: 0,
    msisdn: '0550000001', packageName: '400 جيجا', note: 'تغيير شريحة', resultNote: null, lastNote: null, log: '',
    canTake: false, canWork: false, canCancel: false, createdAt: '2026-11-09T08:00:00.000Z', updatedAt: '2026-11-09T08:00:00.000Z',
    iccid: '8997202000000000009', esim: true, esimQr: QR_B, sim: { length: null, prefix: '', esim: true }, lineStatus: 'active',
    companyName: 'سلكوم', providerName: '', canNote: false, canNoteInternal: false,
  };
  await page.route('**/office/tasks/t1', (route) => route.fulfill(json({ task, events: [] })));
  await page.goto('/tasks/t1');
  await page.locator('.esim-mark').click();
  await expect(picture(page)).toHaveAttribute('src', QR_B);
  await expect(dialog(page)).toContainText('8997202000000000009');
});
