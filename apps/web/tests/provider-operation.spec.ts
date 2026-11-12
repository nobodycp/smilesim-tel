import { expect, test, type Page } from '@playwright/test';
import { serveOffice } from './desk';

// A task's provider operation on its ticket, the decisions people take on it and the queue of the second
// approval (spec 2026-11-12-provider-operation-screens; ADR 0019 D6, D15, D16, D17; plan slice S.10). The answers
// are scripted as the API gives them: what is offered on screen is what those answers allow, and what is sent is
// what the two decision routes take.

const admin = 'http://admin.localhost:3910';
const CODE = 'LPA:1$smdp.s10-screens.example$S10-SECRET-ACTIVATION-CODE-9Q2W7E4R';
const QR_A = `data:image/png;base64,${Buffer.from('S10-TASK-A-QR-PICTURE').toString('base64')}`;
const NOTE = 'Checked on the provider portal: the line is active.';

type Phase = 'requested' | 'pending' | 'unknown' | 'unapplied' | 'exception' | 'applied' | 'failed';

const baseTask = {
  id: 't1', action: 'activate', status: 'working', posLoginName: 'pos', submitterLoginName: 'pos', assigneeLoginName: null, posDelta: -3500,
  msisdn: '0550000001', packageName: '400 جيجا', note: null, resultNote: null, lastNote: null, log: '',
  canTake: false, canWork: false, canCancel: false, createdAt: '2026-11-12T08:00:00.000Z', updatedAt: '2026-11-12T08:00:00.000Z',
  iccid: '8997201234567890123', esim: false, esimQr: null, sim: { length: null, prefix: '', esim: true }, lineStatus: null, companyName: 'سلكوم',
  providerName: 'سكاي', canNote: true, canNoteInternal: true, operation: null as null | { phase: Phase; reason: string | null; decisions: boolean }, hold: 'held',
};
const taskIn = (phase: Phase, over: Record<string, unknown> = {}) => ({
  ...baseTask,
  operation: { phase, reason: phase === 'exception' ? 'number-taken' : null, decisions: true },
  ...(phase === 'failed' ? { canWork: true, canTake: true } : {}),
  ...(phase === 'applied' ? { status: 'done', hold: 'captured' } : {}),
  ...over,
});
const record = (over: Record<string, unknown> = {}) => ({
  sequence: 1, type: 'proposed', decision: 'declare-failure', accountLoginName: 'acc1', evidenceKind: 'provider-portal', providerRef: null,
  note: NOTE, suppliedEsimCode: false, at: '2026-11-12T09:00:00.000Z', ...over,
});
const viewOf = (over: Record<string, unknown> = {}) => ({
  phase: 'unknown', reason: null, held: 3500, proposal: null, decisions: ['confirm-success', 'declare-failure'], canApprove: false, canRefuse: false, blocked: null,
  needs: { number: false, esimCode: false }, history: [], ...over,
});
const accountant = { loginName: 'acc2', nickname: 'محاسب', layer: 'branch', isBranchOwner: false, grants: ['read', 'accounting'], stops: [], impersonating: false, balance: 0, ceiling: 0 };

/** Every request body sent to a decision route, in order. */
function sentTo(page: Page, suffix: string) {
  const sent: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith(suffix)) sent.push(request.postDataJSON());
  });
  return sent;
}
const panel = (page: Page) => page.getByRole('region', { name: 'عملية المزوّد' });
const dialog = (page: Page) => page.getByRole('dialog');
async function fillEvidence(page: Page, { reference = '', note = NOTE }: { reference?: string; note?: string } = {}) {
  await dialog(page).getByLabel('نوع الدليل').selectOption('provider-portal');
  if (reference) await dialog(page).getByLabel(/مرجع العملية عند المزوّد/).fill(reference);
  await dialog(page).getByLabel('ملاحظة القرار').fill(note);
}

// ── The state of the operation ────────────────────────────────────────────────────────────────────────────

const phases: [Phase, string, string, string][] = [
  ['requested', 'بانتظار إرسال الطلب', 'لم يُرسل الطلب إلى المزوّد بعد', 'محجوز'],
  ['pending', 'جارٍ التنفيذ لدى المزوّد', 'الطلب عند المزوّد الآن', 'محجوز'],
  ['unknown', 'النتيجة غير مؤكدة', 'لم يصل جواب مؤكد من المزوّد', 'محجوز'],
  ['unapplied', 'نجح عند المزوّد، قيد التطبيق', 'أكّد المزوّد التفعيل. يُنشأ الخط', 'محجوز'],
  ['exception', 'نجح عند المزوّد وتعذّرت التسوية', 'تعذّر إنشاء الخط', 'محجوز'],
  ['applied', 'تم التفعيل', 'وأُنشئ الخط وسُوّي المبلغ', 'سُوّي'],
  ['failed', 'فشل عند المزوّد', 'المهمة الآن لدى الفرع', 'محجوز'],
];
for (const [phase, label, hint, money] of phases) {
  test(`an operation that is ${phase} says so, says what became of the amount, and shows only the buttons the API allows`, async ({ page }) => {
    await serveOffice(page, 'branch', {
      'GET /tasks/t1': () => ({ body: { task: taskIn(phase), events: [] } }),
      'GET /tasks/t1/provider-decision': () => ({ body: viewOf({ phase, decisions: [] }) }),
    });
    await page.goto(`${admin}/tasks/t1`);
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toHaveAttribute('data-phase', phase);
    await expect(panel(page).locator('.po-head .ui-badge')).toHaveText(label);
    await expect(panel(page).locator('.po-hint')).toContainText(hint);
    await expect(panel(page).locator('.po-money')).toContainText('35.00');
    await expect(panel(page).locator('.po-money .ui-badge')).toHaveText(money);
    if (phase === 'exception') await expect(panel(page)).toContainText('الرقم مأخوذ');
    // D6: complete and reject only for a failed operation; nothing by hand for the others.
    const byHand = phase === 'failed' ? 1 : 0;
    await expect(page.locator('.task-toolbar').getByRole('button', { name: 'إتمام', exact: true })).toHaveCount(byHand);
    await expect(page.locator('.task-toolbar').getByRole('button', { name: 'رفض', exact: true })).toHaveCount(byHand);
    await expect(page.locator('.task-toolbar').getByRole('button', { name: 'إلغاء', exact: true })).toHaveCount(0);
  });
}

test('a requested operation leaves its submitter the cancel button, and nothing else', async ({ page }) => {
  const calls = await serveOffice(page, 'pos', {
    'GET /tasks/t1': () => ({ body: { task: taskIn('requested', { canCancel: true, canNoteInternal: false, providerName: '', operation: { phase: 'requested', reason: null, decisions: false } }), events: [] } }),
  });
  await page.goto(`${admin.replace('admin', 'pos')}/tasks/t1`);
  await expect(panel(page).locator('.po-head .ui-badge')).toHaveText('بانتظار إرسال الطلب');
  await expect(page.locator('.task-toolbar').getByRole('button', { name: 'إلغاء', exact: true })).toBeVisible();
  // Not an account that decides: no decision section, and the decision view is never asked for.
  await expect(panel(page).locator('.po-decisions')).toHaveCount(0);
  expect(calls.filter((call) => call.includes('provider-decision'))).toEqual([]);
});

test('a manual task has no provider panel and keeps its buttons', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    'GET /tasks/t1': () => ({ body: { task: { ...baseTask, canWork: true, canTake: true, note: 'مهمة فرع' }, events: [] } }),
  });
  await page.goto(`${admin}/tasks/t1`);
  await expect(page.locator('.task-rail')).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator('.task-toolbar').getByRole('button', { name: 'إتمام', exact: true })).toBeVisible();
  await expect(page.locator('.task-toolbar').getByRole('button', { name: 'رفض', exact: true })).toBeVisible();
  expect(calls.filter((call) => call.includes('provider-decision'))).toEqual([]);
});

test('an older API answer with no operation field reads as a manual task', async ({ page }) => {
  const { operation: _operation, hold: _hold, ...old } = baseTask;
  void _operation; void _hold;
  await serveOffice(page, 'branch', { 'GET /tasks/t1': () => ({ body: { task: { ...old, canWork: true }, events: [] } }) });
  await page.goto(`${admin}/tasks/t1`);
  await expect(page.locator('.task-rail')).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
});

// ── Who sees what ─────────────────────────────────────────────────────────────────────────────────────────

test('a point of sale reads where its activation stands and the amount, not the reason, and is offered no decision', async ({ page }) => {
  await serveOffice(page, 'pos', {
    'GET /tasks/t1': () => ({ body: { task: taskIn('exception', { providerName: '', canNoteInternal: false, operation: { phase: 'exception', reason: null, decisions: false } }), events: [] } }),
  });
  await page.goto(`${admin.replace('admin', 'pos')}/tasks/t1`);
  await expect(panel(page).locator('.po-head .ui-badge')).toHaveText('نجح عند المزوّد وتعذّرت التسوية');
  await expect(panel(page).locator('.po-money .ui-badge')).toHaveText('محجوز');
  await expect(panel(page)).not.toContainText('السبب');
  await expect(panel(page).getByRole('button')).toHaveCount(0);
});

test('an account the API refuses the decision view sees the refusal, and no decision', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /tasks/t1': () => ({ body: { task: taskIn('unknown'), events: [] } }),
    'GET /tasks/t1/provider-decision': () => ({ status: 403, body: { message: 'غير مسموح', code: 'FORBIDDEN' } }),
  });
  await page.goto(`${admin}/tasks/t1`);
  await expect(panel(page).getByRole('alert')).toHaveText('غير مسموح');
  await expect(panel(page).getByRole('button')).toHaveCount(0);
});

test('the task\'s submitter is told it decides nothing here', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /tasks/t1': () => ({ body: { task: taskIn('unknown'), events: [] } }),
    'GET /tasks/t1/provider-decision': () => ({ body: viewOf({ decisions: [], blocked: 'own-task' }) }),
  });
  await page.goto(`${admin}/tasks/t1`);
  await expect(panel(page)).toContainText('أنت مُرسِل هذه المهمة، فلا تتخذ قراراً عليها.');
  await expect(panel(page).getByRole('button')).toHaveCount(0);
});

// ── The four decisions ────────────────────────────────────────────────────────────────────────────────────

test('confirm success: the form checks what the API will, sends it once, and the ticket is read again', async ({ page }) => {
  let applied = false;
  const calls = await serveOffice(page, 'branch', {
    'GET /tasks/t1': () => ({ body: { task: applied ? taskIn('applied') : taskIn('unknown'), events: [] } }),
    'GET /tasks/t1/provider-decision': () => ({ body: applied ? viewOf({ phase: 'applied', decisions: [], history: [record({ type: 'applied', decision: 'confirm-success', providerRef: 'REF-77', accountLoginName: 'admin' })] }) : viewOf() }),
    'POST /tasks/t1/provider-decision': () => { applied = true; return { body: { ok: true, outcome: 'applied' }, delay: 300 }; },
  });
  const sent = sentTo(page, '/office/tasks/t1/provider-decision');
  await page.goto(`${admin}/tasks/t1`);
  await expect(panel(page).getByRole('button', { name: 'تأكيد النجاح' })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'إعلان الفشل' })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'تطبيق ببيانات مصحَّحة' })).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'تأكيد النجاح' }).click();
  // The dialog says what the decision does to the line and the money, and opens on its first field.
  await expect(dialog(page)).toContainText('يُنشأ الخط ويُخصم المبلغ المحجوز من نقطة البيع. يسري فوراً.');
  await expect(dialog(page).getByLabel('نوع الدليل')).toBeFocused();
  // No eSIM field for a plain SIM.
  await expect(dialog(page).getByLabel('رمز تفعيل eSIM')).toHaveCount(0);
  const submit = dialog(page).getByRole('button', { name: 'تنفيذ القرار' });
  await expect(submit).toBeDisabled();
  await fillEvidence(page, { note: 'too short' });
  await expect(submit).toBeDisabled();
  await expect(dialog(page).locator('.decision-count')).toContainText('9/20');
  await dialog(page).getByLabel('ملاحظة القرار').fill(`   ${NOTE}   `);
  // The reference is required to confirm a success.
  await expect(submit).toBeDisabled();
  await dialog(page).getByLabel(/مرجع العملية عند المزوّد/).fill('REF-77');
  await dialog(page).getByLabel(/الرقم الذي فعّله المزوّد/).fill('12345');
  await expect(submit).toBeDisabled();
  await dialog(page).getByLabel(/الرقم الذي فعّله المزوّد/).fill('0550000009');
  await expect(submit).toBeEnabled();
  // Pressed twice while the request runs: sent once.
  await submit.click();
  await expect(submit).toBeDisabled();
  await submit.click({ force: true });
  await expect(dialog(page)).toHaveCount(0);
  expect(sent).toEqual([{ decision: 'confirm-success', evidenceKind: 'provider-portal', note: NOTE, providerRef: 'REF-77', msisdn: '0550000009' }]);
  await expect(page.getByText('نُفّذ القرار')).toBeVisible();
  // The ticket and its decisions were asked again: no decision is offered any more, and the record shows the step.
  await expect(panel(page).locator('.po-head .ui-badge')).toHaveText('تم التفعيل');
  await expect(panel(page).locator('.po-money .ui-badge')).toHaveText('سُوّي');
  await expect(panel(page).getByRole('button')).toHaveCount(0);
  await expect(panel(page).locator('.po-history')).toContainText('تأكيد النجاح');
  await expect(panel(page).locator('.po-history')).toContainText('REF-77');
  expect(calls.filter((call) => call === 'GET /tasks/t1').length).toBeGreaterThanOrEqual(2);
  expect(calls.filter((call) => call === 'POST /tasks/t1/provider-decision')).toHaveLength(1);
});

test('a confirmation whose line could not be made says so, and the ticket shows the exception', async ({ page }) => {
  let decided = false;
  await serveOffice(page, 'branch', {
    'GET /tasks/t1': () => ({ body: { task: decided ? taskIn('exception') : taskIn('unknown'), events: [] } }),
    'GET /tasks/t1/provider-decision': () => ({ body: decided ? viewOf({ phase: 'exception', reason: 'number-taken', decisions: ['apply-corrected', 'release-after-success'] }) : viewOf() }),
    'POST /tasks/t1/provider-decision': () => { decided = true; return { body: { ok: true, outcome: 'exception', reason: 'number-taken' } }; },
  });
  await page.goto(`${admin}/tasks/t1`);
  await panel(page).getByRole('button', { name: 'تأكيد النجاح' }).click();
  await fillEvidence(page, { reference: 'REF-1' });
  await dialog(page).getByRole('button', { name: 'تنفيذ القرار' }).click();
  await expect(page.getByText('سُجّل نجاح المزوّد وتعذّر إنشاء الخط. المهمة بانتظار قرار.')).toBeVisible();
  await expect(panel(page).locator('.po-head .ui-badge')).toHaveText('نجح عند المزوّد وتعذّرت التسوية');
  await expect(panel(page).getByRole('button', { name: 'تطبيق ببيانات مصحَّحة' })).toBeVisible();
});

test('declare failure is sent as a proposal; its proposer is then told another account answers it', async ({ page }) => {
  let proposed = false;
  await serveOffice(page, 'branch', {
    'GET /tasks/t1': () => ({ body: { task: taskIn('unknown'), events: [] } }),
    'GET /tasks/t1/provider-decision': () => ({ body: proposed ? viewOf({ decisions: [], blocked: 'own-proposal', proposal: record({ accountLoginName: 'admin' }), history: [record({ accountLoginName: 'admin' })] }) : viewOf() }),
    'POST /tasks/t1/provider-decision': () => { proposed = true; return { body: { ok: true, outcome: 'proposed' } }; },
  });
  const sent = sentTo(page, '/office/tasks/t1/provider-decision');
  await page.goto(`${admin}/tasks/t1`);
  await panel(page).getByRole('button', { name: 'إعلان الفشل' }).click();
  await expect(dialog(page)).toContainText('اقتراح يحتاج موافقة حساب مخوَّل ثانٍ');
  await expect(dialog(page)).toContainText('يبقى المبلغ محجوزاً');
  // A failure takes no number, serial or code; its reference is optional.
  await expect(dialog(page).getByLabel(/الرقم الذي فعّله المزوّد/)).toHaveCount(0);
  await expect(dialog(page).getByLabel('رمز تفعيل eSIM')).toHaveCount(0);
  await fillEvidence(page);
  await dialog(page).getByRole('button', { name: 'إرسال الاقتراح' }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(sent).toEqual([{ decision: 'declare-failure', evidenceKind: 'provider-portal', note: NOTE }]);
  await expect(page.getByText('أُرسل الاقتراح، بانتظار حساب ثانٍ')).toBeVisible();
  // The amount is still held, the proposal is shown, and its proposer gets no approve or refuse.
  await expect(panel(page).locator('.po-money .ui-badge')).toHaveText('محجوز');
  await expect(panel(page).locator('.po-proposal')).toContainText('إعلان الفشل');
  await expect(panel(page).locator('.po-proposal')).toContainText('هذا اقتراحك. يجيب عليه حساب مخوَّل آخر.');
  await expect(panel(page).getByRole('button', { name: 'موافقة' })).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'رفض الاقتراح' })).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'تأكيد النجاح' })).toHaveCount(0);
});

test('apply corrected on a plain exception asks for no eSIM code, and release is a proposal that says where the money goes', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /tasks/t1': () => ({ body: { task: taskIn('exception'), events: [] } }),
    'GET /tasks/t1/provider-decision': () => ({ body: viewOf({ phase: 'exception', reason: 'number-taken', decisions: ['apply-corrected', 'release-after-success'] }) }),
    'POST /tasks/t1/provider-decision': () => ({ body: { ok: true, outcome: 'applied' } }),
  });
  const sent = sentTo(page, '/office/tasks/t1/provider-decision');
  await page.goto(`${admin}/tasks/t1`);
  await panel(page).getByRole('button', { name: 'تحرير بعد نجاح المزوّد' }).click();
  await expect(dialog(page)).toContainText('تُرفض المهمة ويُعاد المبلغ المحجوز إلى نقطة البيع، ولا يُنشأ خط');
  await expect(dialog(page).getByRole('button', { name: 'إرسال الاقتراح' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'تطبيق ببيانات مصحَّحة' }).click();
  await expect(dialog(page).getByLabel('رمز تفعيل eSIM')).toHaveCount(0);
  await fillEvidence(page);
  await dialog(page).getByLabel(/الرقم الذي فعّله المزوّد/).fill('0550000042');
  await dialog(page).getByLabel(/رقم الشريحة الذي فعّله المزوّد/).fill('8997209999999999999');
  await dialog(page).getByRole('button', { name: 'تنفيذ القرار' }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(sent).toEqual([{ decision: 'apply-corrected', evidenceKind: 'provider-portal', note: NOTE, msisdn: '0550000042', iccid: '8997209999999999999' }]);
});

// ── esim-code-missing, and the code's privacy ─────────────────────────────────────────────────────────────

test('esim-code-missing: the form asks for the code, sends it in the request only, and keeps it nowhere', async ({ page }) => {
  const logged: string[] = [];
  page.on('console', (message) => logged.push(message.text()));
  let applied = false;
  const calls = await serveOffice(page, 'branch', {
    'GET /tasks/t1': () => ({ body: { task: applied ? taskIn('applied', { esim: true }) : taskIn('exception', { esim: true, operation: { phase: 'exception', reason: 'esim-code-missing', decisions: true } }), events: [] } }),
    'GET /tasks/t1/provider-decision': () => ({ body: applied
      ? viewOf({ phase: 'applied', decisions: [], history: [record({ type: 'applied', decision: 'apply-corrected', suppliedEsimCode: true, accountLoginName: 'admin' })] })
      : viewOf({ phase: 'exception', reason: 'esim-code-missing', decisions: ['apply-corrected', 'release-after-success'], needs: { number: false, esimCode: true } }) }),
    'POST /tasks/t1/provider-decision': () => { applied = true; return { body: { ok: true, outcome: 'applied' } }; },
  });
  const sent = sentTo(page, '/office/tasks/t1/provider-decision');
  await page.goto(`${admin}/tasks/t1`);
  await expect(panel(page)).toContainText('لم يصل رمز تفعيل eSIM');
  await panel(page).getByRole('button', { name: 'تطبيق ببيانات مصحَّحة' }).click();
  const code = dialog(page).getByLabel('رمز تفعيل eSIM');
  await expect(code).toBeVisible();
  await expect(code).toHaveAttribute('autocomplete', 'off');
  await fillEvidence(page);
  const submit = dialog(page).getByRole('button', { name: 'تنفيذ القرار' });
  // Without a code, and with something that is not one, nothing can be sent.
  await expect(submit).toBeDisabled();
  await code.fill('0521234567');
  await expect(submit).toBeDisabled();
  // Closing the dialog drops what was typed: the next opening is empty.
  await code.fill(CODE);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'تطبيق ببيانات مصحَّحة' }).click();
  await expect(dialog(page).getByLabel('رمز تفعيل eSIM')).toHaveValue('');
  await expect(dialog(page).getByLabel('ملاحظة القرار')).toHaveValue('');
  await fillEvidence(page);
  await dialog(page).getByLabel('رمز تفعيل eSIM').fill(CODE);
  await dialog(page).getByRole('button', { name: 'تنفيذ القرار' }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(sent).toEqual([{ decision: 'apply-corrected', evidenceKind: 'provider-portal', note: NOTE, esimCode: CODE }]);
  await expect(panel(page).locator('.po-history')).toContainText('أُرفق رمز eSIM');
  // After the decision the code is in no part of the page, the address, the storage, the cache or the console.
  const kept = await page.evaluate(() => JSON.stringify({ html: document.documentElement.outerHTML, url: location.href, local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }));
  expect(kept).not.toContain('S10-SECRET');
  expect(logged.join('\n')).not.toContain('S10-SECRET');
  expect(calls.join('\n')).not.toContain('S10-SECRET');
});

test('the queue and the decision view are given no eSIM code, and moving from one task to another shows nothing of the first', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    'GET /provider-decisions': () => ({ body: { capped: false, items: [
      { taskId: 'ta', action: 'activate', msisdn: '0550000001', packageName: 'باقة', posLoginName: 'pos', submitterLoginName: 'pos', waitingSince: '2026-11-12T09:00:00.000Z', ...viewOf({ phase: 'exception', reason: 'esim-code-missing', decisions: ['apply-corrected', 'release-after-success'] }), needs: undefined, history: undefined },
      { taskId: 'tb', action: 'activate', msisdn: '0550000002', packageName: 'باقة', posLoginName: 'pos', submitterLoginName: 'pos', waitingSince: '2026-11-12T09:05:00.000Z', ...viewOf(), needs: undefined, history: undefined },
    ] } }),
    // Task A is done and carries its line's code; task B is slow to answer and has none.
    'GET /tasks/ta': () => ({ body: { task: taskIn('applied', { id: 'ta', esim: true, esimQr: QR_A, msisdn: '0550000001' }), events: [] } }),
    'GET /tasks/ta/provider-decision': () => ({ body: viewOf({ phase: 'applied', decisions: [] }) }),
    'GET /tasks/tb': () => ({ body: { task: taskIn('unknown', { id: 'tb', msisdn: '0550000002' }), events: [] }, delay: 900 }),
    'GET /tasks/tb/provider-decision': () => ({ body: viewOf() }),
  });
  await page.goto(`${admin}/tasks/decisions`);
  await expect(page.locator('.po-row')).toHaveCount(2);
  expect(await page.content()).not.toContain('data:image');
  // Task A: its code is on its ticket, for the account the API gave it to.
  await page.locator('.po-row').filter({ hasText: '0550000001' }).getByRole('link', { name: 'فتح التذكرة' }).click();
  await expect(page.locator(`img[src="${QR_A}"]`)).toHaveCount(1);
  // Back to the queue, then task B while its answer is still on the way: nothing of A is on screen at any moment.
  await page.goBack();
  await expect(page.locator('.po-row')).toHaveCount(2);
  expect(await page.content()).not.toContain(QR_A);
  await page.locator('.po-row').filter({ hasText: '0550000002' }).getByRole('link', { name: 'فتح التذكرة' }).click();
  await expect(page).toHaveURL(/\/tasks\/tb$/);
  expect(await page.content()).not.toContain(QR_A);
  await expect(panel(page).locator('.po-head .ui-badge')).toHaveText('النتيجة غير مؤكدة');
  expect(await page.content()).not.toContain(QR_A);
  await expect(page.locator('img[src^="data:image"]')).toHaveCount(0);
  // And going back to A asks for it again: it was not kept in the cache.
  await page.goBack();
  await expect(page.locator('.po-row')).toHaveCount(2);
  const before = calls.filter((call) => call === 'GET /tasks/ta').length;
  await page.locator('.po-row').filter({ hasText: '0550000001' }).getByRole('link', { name: 'فتح التذكرة' }).click();
  await expect(page.locator(`img[src="${QR_A}"]`)).toHaveCount(1);
  expect(calls.filter((call) => call === 'GET /tasks/ta').length).toBe(before + 1);
});

// ── The second approval ───────────────────────────────────────────────────────────────────────────────────

test('a second account approves a proposed release after reading what it does to the money', async ({ page }) => {
  let approved = false;
  await serveOffice(page, 'branch', {
    'GET /me': () => ({ body: accountant }),
    'GET /tasks/t1': () => ({ body: { task: approved ? taskIn('exception', { status: 'cancelled', hold: 'released' }) : taskIn('exception'), events: [] } }),
    'GET /tasks/t1/provider-decision': () => ({ body: approved
      ? viewOf({ phase: 'exception', reason: 'number-taken', decisions: [], history: [record({ decision: 'release-after-success' }), record({ sequence: 2, type: 'approved', decision: 'release-after-success', accountLoginName: 'acc2', evidenceKind: null, note: '' })] })
      : viewOf({ phase: 'exception', reason: 'number-taken', decisions: [], canApprove: true, canRefuse: true, proposal: record({ decision: 'release-after-success', providerRef: 'REF-9' }), history: [record({ decision: 'release-after-success', providerRef: 'REF-9' })] }) }),
    'POST /tasks/t1/provider-decision/approval': () => { approved = true; return { body: { ok: true, outcome: 'approved' }, delay: 250 }; },
  });
  const sent = sentTo(page, '/office/tasks/t1/provider-decision/approval');
  await page.goto(`${admin}/tasks/t1`);
  const proposal = panel(page).locator('.po-proposal');
  await expect(proposal).toContainText('تحرير بعد نجاح المزوّد');
  await expect(proposal).toContainText('acc1');
  await expect(proposal).toContainText('بوابة المزوّد');
  await expect(proposal).toContainText('REF-9');
  await expect(proposal).toContainText(NOTE);
  await expect(proposal).toContainText('بالموافقة تُرفض المهمة ويُعاد المبلغ المحجوز إلى نقطة البيع. لا يمكن التراجع.');
  await proposal.getByRole('button', { name: 'موافقة' }).click();
  // Asked once more, with the effect repeated.
  await expect(dialog(page)).toContainText('بالموافقة تُرفض المهمة ويُعاد المبلغ المحجوز إلى نقطة البيع');
  const confirm = dialog(page).getByRole('button', { name: 'تأكيد الموافقة' });
  await confirm.click();
  await expect(confirm).toBeDisabled();
  await confirm.click({ force: true });
  await expect(dialog(page)).toHaveCount(0);
  expect(sent).toEqual([{ approve: true }]);
  await expect(page.getByText('تمت الموافقة على الاقتراح')).toBeVisible();
  await expect(panel(page).locator('.po-money .ui-badge')).toHaveText('أُعيد إلى الرصيد');
  await expect(panel(page).locator('.po-proposal')).toHaveCount(0);
  await expect(panel(page).getByRole('button')).toHaveCount(0);
});

test('a second account refuses a proposal: nothing changes, and a decision can be stated again', async ({ page }) => {
  let refused = false;
  await serveOffice(page, 'branch', {
    'GET /me': () => ({ body: accountant }),
    'GET /tasks/t1': () => ({ body: { task: taskIn('unknown'), events: [] } }),
    'GET /tasks/t1/provider-decision': () => ({ body: refused ? viewOf() : viewOf({ decisions: [], canApprove: true, canRefuse: true, proposal: record() }) }),
    'POST /tasks/t1/provider-decision/approval': () => { refused = true; return { body: { ok: true, outcome: 'refused' } }; },
  });
  const sent = sentTo(page, '/office/tasks/t1/provider-decision/approval');
  await page.goto(`${admin}/tasks/t1`);
  await expect(panel(page).locator('.po-proposal')).toContainText('بالموافقة تصبح العملية فاشلة وتنتقل المهمة إلى الفرع. المبلغ يبقى محجوزاً.');
  await panel(page).getByRole('button', { name: 'رفض الاقتراح' }).click();
  await expect(dialog(page)).toContainText('يُغلق الاقتراح ولا يتغيّر شيء في العملية أو المبلغ');
  await dialog(page).getByRole('button', { name: 'تأكيد الرفض' }).click();
  expect(sent).toEqual([{ approve: false }]);
  await expect(page.getByText('رُفض الاقتراح', { exact: true })).toBeVisible();
  await expect(panel(page).locator('.po-proposal')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'إعلان الفشل' })).toBeVisible();
});

test('a proposal that went stale is offered for refusal only, and says why', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /me': () => ({ body: accountant }),
    'GET /tasks/t1': () => ({ body: { task: taskIn('applied'), events: [] } }),
    'GET /tasks/t1/provider-decision': () => ({ body: viewOf({ phase: 'applied', decisions: [], canApprove: false, canRefuse: true, proposal: record() }) }),
  });
  await page.goto(`${admin}/tasks/t1`);
  await expect(panel(page).locator('.po-proposal')).toContainText('تغيّرت حالة العملية بعد هذا الاقتراح. يمكن رفضه فقط.');
  await expect(panel(page).getByRole('button', { name: 'موافقة' })).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'رفض الاقتراح' })).toBeVisible();
});

// ── When the answer is not a yes ──────────────────────────────────────────────────────────────────────────

test('a 409 says the operation changed, closes the form and reads the ticket again: nothing stale is left to press', async ({ page }) => {
  let moved = false;
  const calls = await serveOffice(page, 'branch', {
    'GET /tasks/t1': () => ({ body: { task: moved ? taskIn('applied') : taskIn('unknown'), events: [] } }),
    'GET /tasks/t1/provider-decision': () => ({ body: moved ? viewOf({ phase: 'applied', decisions: [] }) : viewOf() }),
    // The provider's own answer arrived first.
    'POST /tasks/t1/provider-decision': () => { moved = true; return { status: 409, body: { message: 'القرار لا ينطبق على حالة العملية الآن', code: 'DECISION_NOT_APPLICABLE' } }; },
  });
  await page.goto(`${admin}/tasks/t1`);
  await panel(page).getByRole('button', { name: 'تأكيد النجاح' }).click();
  await fillEvidence(page, { reference: 'REF-1' });
  await dialog(page).getByRole('button', { name: 'تنفيذ القرار' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'القرار لا ينطبق على حالة العملية الآن' })).toContainText('تغيّرت حالة العملية. حُدّثت البيانات.');
  await expect(page.getByText('نُفّذ القرار')).toHaveCount(0);
  await expect(panel(page).locator('.po-head .ui-badge')).toHaveText('تم التفعيل');
  await expect(panel(page).getByRole('button')).toHaveCount(0);
  expect(calls.filter((call) => call === 'POST /tasks/t1/provider-decision')).toHaveLength(1);
});

test('a refusal of the request itself stays in the form with its message, and what was typed stays too', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /tasks/t1': () => ({ body: { task: taskIn('exception'), events: [] } }),
    'GET /tasks/t1/provider-decision': () => ({ body: viewOf({ phase: 'exception', reason: 'number-taken', decisions: ['apply-corrected', 'release-after-success'] }) }),
    'POST /tasks/t1/provider-decision': () => ({ status: 409, body: { message: 'الرقم مستخدم', code: 'NUMBER_TAKEN' } }),
  });
  await page.goto(`${admin}/tasks/t1`);
  await panel(page).getByRole('button', { name: 'تطبيق ببيانات مصحَّحة' }).click();
  await fillEvidence(page);
  await dialog(page).getByLabel(/الرقم الذي فعّله المزوّد/).fill('0550000042');
  await dialog(page).getByRole('button', { name: 'تنفيذ القرار' }).click();
  await expect(dialog(page).getByRole('alert')).toHaveText('الرقم مستخدم');
  await expect(dialog(page).getByLabel(/الرقم الذي فعّله المزوّد/)).toHaveValue('0550000042');
  await expect(dialog(page).getByRole('button', { name: 'تنفيذ القرار' })).toBeEnabled();
});

test('a lost connection is said in the form: no success is claimed and nothing is sent again by itself', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    'GET /tasks/t1': () => ({ body: { task: taskIn('unknown'), events: [] } }),
    'GET /tasks/t1/provider-decision': () => ({ body: viewOf() }),
  });
  let posts = 0;
  await page.route('**/api/office/tasks/t1/provider-decision', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts += 1;
    await route.abort('connectionfailed');
  });
  await page.goto(`${admin}/tasks/t1`);
  await panel(page).getByRole('button', { name: 'تأكيد النجاح' }).click();
  await fillEvidence(page, { reference: 'REF-1' });
  await dialog(page).getByRole('button', { name: 'تنفيذ القرار' }).click();
  await expect(dialog(page).getByRole('alert')).toHaveText('تعذّر الاتصال بالخادم');
  await expect(page.getByText('نُفّذ القرار')).toHaveCount(0);
  // The form is as it was, ready for the person to send again; nothing retried on its own.
  await expect(dialog(page).getByLabel('ملاحظة القرار')).toHaveValue(NOTE);
  await page.waitForTimeout(1200);
  expect(posts).toBe(1);
  expect(calls.filter((call) => call.startsWith('POST'))).toEqual([]);
});

// ── The queue ─────────────────────────────────────────────────────────────────────────────────────────────

const queueRow = (taskId: string, over: Record<string, unknown> = {}) => {
  const { needs: _needs, history: _history, ...standing } = viewOf(over);
  void _needs; void _history;
  return { taskId, action: 'activate', msisdn: taskId === 'q1' ? '0550000011' : '0550000022', packageName: '400 جيجا', posLoginName: 'pos', submitterLoginName: 'agent1', waitingSince: '2026-11-12T09:00:00.000Z', ...standing };
};

test('the queue groups what waits for a second approval and what waits for a decision; an approval there is asked once more and the list is read again', async ({ page }) => {
  let approved = false;
  const calls = await serveOffice(page, 'branch', {
    'GET /me': () => ({ body: accountant }),
    'GET /provider-decisions': () => ({ body: { capped: false, items: approved
      ? [queueRow('q2', { phase: 'exception', reason: 'number-taken', decisions: ['apply-corrected', 'release-after-success'] })]
      : [queueRow('q1', { decisions: [], canApprove: true, canRefuse: true, proposal: record({ providerRef: 'REF-5' }) }), queueRow('q2', { phase: 'exception', reason: 'number-taken', decisions: ['apply-corrected', 'release-after-success'] })] } }),
    'POST /tasks/q1/provider-decision/approval': () => { approved = true; return { body: { ok: true, outcome: 'approved' } }; },
  });
  const sent = sentTo(page, '/office/tasks/q1/provider-decision/approval');
  await page.goto(`${admin}/tasks/decisions`);
  await expect(page.getByRole('heading', { level: 1, name: 'قرارات عمليات المزوّد' })).toBeVisible();
  const proposals = page.getByRole('region', { name: 'بانتظار موافقة ثانية' });
  const undecided = page.getByRole('region', { name: 'بانتظار قرار' });
  await expect(proposals.locator('.po-row')).toHaveCount(1);
  await expect(undecided.locator('.po-row')).toHaveCount(1);
  const row = proposals.locator('.po-row');
  for (const text of ['تفعيل', 'النتيجة غير مؤكدة', '0550000011', '400 جيجا', 'pos', 'agent1', '35.00', 'إعلان الفشل', 'acc1', 'بوابة المزوّد', 'REF-5', NOTE, 'المبلغ يبقى محجوزاً']) await expect(row).toContainText(text);
  await expect(row.getByRole('link', { name: 'فتح التذكرة' })).toHaveAttribute('href', '/tasks/q1');
  // What nobody decided on yet names the decisions it is open to; they are stated on the task.
  await expect(undecided.locator('.po-row')).toContainText('الرقم مأخوذ');
  await expect(undecided.locator('.po-row')).toContainText('تطبيق ببيانات مصحَّحة · تحرير بعد نجاح المزوّد');
  await expect(undecided.getByRole('button')).toHaveCount(0);
  await row.getByRole('button', { name: 'موافقة' }).click();
  await dialog(page).getByRole('button', { name: 'تأكيد الموافقة' }).click();
  expect(sent).toEqual([{ approve: true }]);
  await expect(page.getByText('تمت الموافقة على الاقتراح')).toBeVisible();
  await expect(proposals).toHaveCount(0);
  await expect(undecided.locator('.po-row')).toHaveCount(1);
  expect(calls.filter((call) => call === 'GET /provider-decisions').length).toBeGreaterThanOrEqual(2);
});

test('the queue shows the proposer and the submitter why they may not answer, and offers them no button', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /provider-decisions': () => ({ body: { capped: true, items: [
      queueRow('q1', { decisions: [], blocked: 'own-proposal', proposal: record({ accountLoginName: 'admin' }) }),
      queueRow('q2', { decisions: [], blocked: 'own-task' }),
    ] } }),
  });
  await page.goto(`${admin}/tasks/decisions`);
  await expect(page.locator('.po-row').first()).toContainText('هذا اقتراحك. يجيب عليه حساب مخوَّل آخر.');
  await expect(page.locator('.po-row').nth(1)).toContainText('أنت مُرسِل هذه المهمة، فلا تتخذ قراراً عليها.');
  await expect(page.locator('.po-row').getByRole('button')).toHaveCount(0);
  await expect(page.getByText('تُعرض أقدم العمليات فقط')).toBeVisible();
});

test('the queue is empty, is refused, or fails: each is said, and none shows a row', async ({ page }) => {
  let mode: 'empty' | 'refused' | 'down' = 'empty';
  await serveOffice(page, 'branch', {
    'GET /provider-decisions': () => (mode === 'empty' ? { body: { items: [], capped: false } } : mode === 'refused' ? { status: 403, body: { message: 'غير مسموح', code: 'FORBIDDEN' } } : { status: 500, body: { message: 'حدث خطأ في الخادم. أعد المحاولة', code: 'SERVER_ERROR' } }),
  });
  await page.goto(`${admin}/tasks/decisions`);
  await expect(page.getByText('لا توجد عمليات بانتظار قرار')).toBeVisible();
  mode = 'refused';
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'غير مسموح' })).toBeVisible();
  await expect(page.locator('.po-row')).toHaveCount(0);
  await expect(page.getByText('لا توجد عمليات بانتظار قرار')).toHaveCount(0);
  mode = 'down';
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'حدث خطأ في الخادم' })).toBeVisible();
  await expect(page.locator('.po-row')).toHaveCount(0);
});

test('the tasks page links to the queue for an account that may decide, with the count, and marks an open task\'s operation', async ({ page }) => {
  const rows = [
    { ...baseTask, id: 'a', operationPhase: 'unknown' }, { ...baseTask, id: 'b', msisdn: '0550000002', operationPhase: 'exception' },
    { ...baseTask, id: 'c', msisdn: '0550000003', operationPhase: null, canWork: true }, { ...baseTask, id: 'd', msisdn: '0550000004', status: 'done', operationPhase: 'applied' },
  ];
  await serveOffice(page, 'branch', {
    'GET /tasks': () => ({ body: { items: rows, nextCursor: null, total: rows.length } }),
    'GET /packages': () => ({ body: { packages: [] } }),
    'GET /provider-decisions': () => ({ body: { capped: false, items: [queueRow('q1'), queueRow('q2')] } }),
  });
  await page.goto(`${admin}/tasks`);
  const link = page.getByRole('link', { name: /قرارات المزوّد/ });
  await expect(link).toHaveAttribute('href', '/tasks/decisions');
  await expect(link.locator('.ui-badge')).toHaveText('2');
  await expect(page.locator('.task-card').nth(0)).toContainText('النتيجة غير مؤكدة');
  await expect(page.locator('.task-card').nth(1)).toContainText('نجح عند المزوّد وتعذّرت التسوية');
  // A manual task and a closed one carry no operation mark.
  await expect(page.locator('.task-card').nth(2).locator('.ui-badge')).toHaveCount(1);
  await expect(page.locator('.task-card').nth(3).locator('.ui-badge')).toHaveCount(1);
});

for (const [who, me] of [
  ['a point of sale', { loginName: 'pos', nickname: 'الكاشير', layer: 'pos', isBranchOwner: false, grants: ['read'], impersonating: false }],
  ['a branch account without the accounting grant', { loginName: 'clerk', nickname: 'موظف', layer: 'branch', isBranchOwner: false, grants: ['read', 'tasks'], impersonating: false }],
  ['an entered session', { loginName: 'acc2', nickname: 'محاسب', layer: 'branch', isBranchOwner: false, grants: ['read', 'accounting'], impersonating: true }],
] as const) {
  test(`the tasks page shows ${who} no way to the queue and never asks for it`, async ({ page }) => {
    const calls = await serveOffice(page, 'branch', {
      'GET /me': () => ({ body: { ...me, stops: [], balance: 0, ceiling: 0 } }),
      'GET /tasks': () => ({ body: { items: [], nextCursor: null, total: 0 } }),
      'GET /packages': () => ({ body: { packages: [] } }),
    });
    await page.goto(`${admin}/tasks`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /قرارات المزوّد/ })).toHaveCount(0);
    expect(calls.filter((call) => call.includes('provider-decisions'))).toEqual([]);
  });
}

// ── Every width, both directions, both themes ─────────────────────────────────────────────────────────────

const widths: [string, number, number][] = [['phone', 390, 844], ['tablet', 820, 1180], ['desktop', 1280, 800]];
for (const [device, width, height] of widths) {
  for (const locale of ['ar', 'en'] as const) {
    // One page load per screen: the theme is switched with the shell's own button, so each screen is measured in
    // light and in dark without loading it twice (the suite shares one dev server).
    test(`the ticket, the form and the queue fit a ${device} in ${locale}, light and dark`, async ({ page }) => {
      const ar = locale === 'ar';
      await page.setViewportSize({ width, height });
      await page.context().addCookies([{ name: 'smilesim-locale', value: locale, url: admin }, { name: 'smilesim-theme', value: 'light', url: admin }]);
      await serveOffice(page, 'branch', {
        'GET /me': () => ({ body: accountant }),
        'GET /tasks/t1': () => ({ body: { task: taskIn('exception', { esim: true, operation: { phase: 'exception', reason: 'esim-code-missing', decisions: true } }), events: [] } }),
        'GET /tasks/t1/provider-decision': () => ({ body: viewOf({ phase: 'exception', reason: 'esim-code-missing', decisions: ['apply-corrected', 'release-after-success'], needs: { number: true, esimCode: true }, history: [record({ decision: 'release-after-success' }), record({ sequence: 2, type: 'refused', decision: 'release-after-success', accountLoginName: 'acc2', evidenceKind: null, note: '' })] }) }),
        'GET /provider-decisions': () => ({ body: { capped: false, items: [queueRow('q1', { decisions: [], canApprove: true, canRefuse: true, proposal: record({ providerRef: 'REF-5', note: `${NOTE} ${NOTE} ${NOTE}` }) }), queueRow('q2', { phase: 'exception', reason: 'number-taken', decisions: ['apply-corrected', 'release-after-success'] })] } }),
      });
      const html = page.locator('html');
      const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      const inside = async (box: { x: number; width: number } | null) => expect(box && box.x >= 0 && box.x + box.width <= width + 1).toBe(true);
      const shot = async (name: string) => {
        const theme = (await html.getAttribute('class'))?.split(' ').includes('dark') ? 'dark' : 'light';
        if (process.env.S10_SHOTS) await page.screenshot({ path: `${process.env.S10_SHOTS}/${device}-${locale}-${theme}-${name}.png`, fullPage: true });
      };
      /** Presses the shell's theme button and waits for the page to be in the other theme. */
      const toDark = async (dark: boolean) => {
        await page.getByRole('button', { name: dark ? (ar ? 'تفعيل الوضع الداكن' : /dark/i) : (ar ? 'تفعيل الوضع الفاتح' : /light/i) }).first().click();
        await expect(html).toHaveClass(dark ? /(^| )dark( |$)/ : /^((?!\bdark\b).)*$/);
      };

      await page.goto(`${admin}/tasks/t1`);
      await expect(html).toHaveAttribute('dir', ar ? 'rtl' : 'ltr');
      await expect(html).not.toHaveClass(/(^| )dark( |$)/);
      const region = page.getByRole('region', { name: ar ? 'عملية المزوّد' : 'Provider operation' });
      await expect(region.locator('.po-head .ui-badge')).toHaveText(ar ? 'نجح عند المزوّد وتعذّرت التسوية' : 'Confirmed by the provider, could not be settled');
      await expect(region.locator('.po-history li')).toHaveCount(2);
      // The panel sits inside the page's width, in both themes.
      await fits();
      await inside(await region.boundingBox());
      await shot('ticket');
      await toDark(true);
      await fits();
      await inside(await region.boundingBox());
      await shot('ticket');

      const open = region.getByRole('button', { name: ar ? 'تطبيق ببيانات مصحَّحة' : 'Apply corrected data' });
      await open.click();
      const form = page.getByRole('dialog');
      await expect(form.getByLabel(ar ? 'رمز تفعيل eSIM' : 'eSIM activation code')).toBeVisible();
      // The dialog is inside the viewport, and its submit button is on screen.
      const sheet = await form.boundingBox();
      await inside(sheet);
      expect(sheet && sheet.y >= 0 && sheet.y + sheet.height <= height + 1).toBe(true);
      await expect(form.getByRole('button', { name: ar ? 'تنفيذ القرار' : 'Apply the decision' })).toBeInViewport();
      // By keyboard: the first field has the focus, Tab moves on, Escape closes and gives the focus back.
      await expect(form.getByLabel(ar ? 'نوع الدليل' : 'Kind of evidence')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(form.getByLabel(ar ? /مرجع العملية عند المزوّد/ : /Provider reference/)).toBeFocused();
      await fits();
      await shot('form');
      await page.keyboard.press('Escape');
      await expect(form).toHaveCount(0);
      await expect(open).toBeFocused();
      // The same form in light.
      await toDark(false);
      await open.click();
      await inside(await form.boundingBox());
      await shot('form');
      await page.keyboard.press('Escape');

      await page.goto(`${admin}/tasks/decisions`);
      await expect(page.locator('.po-row')).toHaveCount(2);
      for (const dark of [false, true]) {
        if (dark) await toDark(true);
        await fits();
        for (const row of await page.locator('.po-row').all()) await inside(await row.boundingBox());
        await shot('queue');
      }
    });
  }
}

test('the Hebrew copy is complete on the ticket: no key shows through', async ({ page }) => {
  await page.context().addCookies([{ name: 'smilesim-locale', value: 'he', url: admin }]);
  await serveOffice(page, 'branch', {
    'GET /tasks/t1': () => ({ body: { task: taskIn('unknown'), events: [] } }),
    'GET /tasks/t1/provider-decision': () => ({ body: viewOf({ decisions: [], canApprove: true, canRefuse: true, proposal: record() }) }),
  });
  await page.goto(`${admin}/tasks/t1`);
  const region = page.getByRole('region', { name: 'פעולת ספק' });
  await expect(region.locator('.po-head .ui-badge')).toHaveText('התוצאה אינה ודאית');
  await expect(region.getByRole('button', { name: 'אישור', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});
