import { expect, test, type Locator, type Page } from '@playwright/test';
import { serveOffice, type Routes } from './desk';

const admin = 'http://admin.localhost:3910';
const main = 'http://main.localhost:3910';
const agent = 'http://agent.localhost:3910';

const KEEP = 'تبقى كما هي';
const FOLLOW = 'تتبع السلسلة الجديدة';
const RECAPTURE = 'تُحسب من جديد';

// A `GET /users` row as the API answers it.
const user = (loginName: string, nickname: string, layer: string, parentLogin: string | null, patch: Record<string, unknown> = {}) => ({
  loginName, nickname, layer, roleName: '', parentLogin, balance: 0, ceiling: 0, frozen: false, self: false, directChild: false,
  canEnter: false, canFreeze: false, canDelete: false, ...patch,
});

// What `GET /me` answers. `serveOffice` has a profile per door, but its grants are those of a plain account;
// a transfer needs its own grants, and a stop or an impersonation changes what the page offers.
const me = (layer: string, loginName: string, grants: string[], patch: Record<string, unknown> = {}) => ({
  loginName, nickname: loginName, layer, isBranchOwner: layer === 'branch', grants, stops: [], impersonating: false, balance: 1000, ceiling: 0, ...patch,
});
const branchMe = (patch: Record<string, unknown> = {}) => me('branch', 'admin', ['edit', 'reports', 'staff', 'transferLines', 'transferPos', 'transferAgents'], patch);

// The whole tree as the branch sees it: four main agents (one frozen), two agents, and a point of sale under ag1.
const tree = [
  user('admin', 'الإدارة', 'branch', null, { self: true }),
  user('ma1', 'رئيسي ١', 'main_agent', 'admin', { directChild: true }),
  user('ma2', 'رئيسي ٢', 'main_agent', 'admin', { directChild: true }),
  user('ma3', 'رئيسي ٣', 'main_agent', 'admin', { directChild: true, frozen: true }),
  user('ma4', 'رئيسي ٤', 'main_agent', 'admin', { directChild: true }),
  user('ag1', 'وكيل ١', 'agent', 'ma1'),
  user('ag2', 'وكيل ٢', 'agent', 'ma2'),
  user('pos1', 'نقطة ١', 'pos', 'ag1'),
];

// What a main agent sees: its own chain only, one agent of it frozen.
const chain = [
  user('main1', 'رئيسي', 'main_agent', 'admin', { self: true }),
  user('ag1', 'وكيل ١', 'agent', 'main1', { directChild: true }),
  user('ag2', 'وكيل ٢', 'agent', 'main1', { directChild: true }),
  user('ag3', 'وكيل ٣', 'agent', 'main1', { directChild: true, frozen: true }),
  user('pos1', 'نقطة ١', 'pos', 'ag1'),
];

// `GET /users/:login/transfer-preview`. Balances are agorot.
const agentPreview = {
  balance: 1200,
  subtreeBalance: 5000,
  own: { customPrices: 2, hidden: 1, stops: 0, belowNewFloor: 1 },
  child: { customPrices: 3, hidden: 0, stops: 1, sellPrices: 2 },
  lines: 37,
};
const posPreview = {
  balance: 300,
  subtreeBalance: 0,
  own: { customPrices: 0, hidden: 0, stops: 0, belowNewFloor: 0 },
  child: null,
  lines: 4,
};

/** The «نقل» item of the row menu, then the dialog it opens. */
async function openMove(page: Page, login: string) {
  await page.getByRole('button', { name: `إجراءات ${login}` }).click();
  await page.getByRole('menuitem', { name: 'نقل', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'نقل', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** One radio: the row it sits in when the group has several rows, then the radio itself. */
const radio = (group: Locator, choice: string, row?: string) =>
  (row ? group.getByRole('radiogroup', { name: row }) : group).getByRole('radio', { name: choice });

const accountGroups = (dialog: Locator) => ({
  own: dialog.getByRole('group', { name: 'شروط الحساب' }),
  below: dialog.getByRole('group', { name: 'شروط ما تحته' }),
  lines: dialog.getByRole('group', { name: 'أسعار الأرقام المنقولة' }),
});

test('branch moves an agent: destination, preview, five choices, request body', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const calls = await serveOffice(page, 'branch', {
    'GET /me': () => ({ body: branchMe() }),
    'GET /users': () => ({ body: { users: tree } }),
    'GET /users/ag1/transfer-preview': () => ({ body: agentPreview }),
    'POST /users/ag1/transfer': () => ({ body: { ok: true, lines: 37 } }),
  });
  await page.goto(`${admin}/users`);
  const dialog = await openMove(page, 'ag1');
  const submit = dialog.getByRole('button', { name: 'نقل', exact: true });
  const { own, below, lines } = accountGroups(dialog);

  // The destinations are the open main agents that are not its parent; until one is picked there is nothing to decide.
  const destination = dialog.getByLabel('الوكيل الرئيسي الجديد');
  await expect(destination.locator('option')).toHaveText(['—', 'ma2 (رئيسي ٢)', 'ma4 (رئيسي ٤)']);
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await expect(submit).toBeDisabled();

  await destination.selectOption('ma2');
  await expect(dialog.getByText('37 رقماً')).toBeVisible();
  expect(calls).toContain('GET /users/ag1/transfer-preview?parentLogin=ma2');
  await expect(dialog.locator('.ui-badge-warning')).toHaveText('1 سعراً خاصاً أقل من تكلفة الأب الجديد');
  await expect(dialog.locator('.detail-rows > div', { hasText: 'الرصيد المنقول' })).toContainText('12.00 ₪');
  await expect(dialog.locator('.detail-rows > div', { hasText: 'رصيد ما تحته' })).toContainText('50.00 ₪');

  // Five rows of two radios, and none of them chosen for the person: the button waits for every one.
  await expect(dialog.getByRole('radio')).toHaveCount(10);
  await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(submit).toBeDisabled();
  await radio(own, KEEP, 'الأسعار والإخفاء').check();
  // A choice leaves the focus on the radio it was made on, so the arrow keys carry on from there.
  await expect(radio(own, KEEP, 'الأسعار والإخفاء')).toBeFocused();
  await radio(own, FOLLOW, 'الإيقافات').check();
  await radio(below, FOLLOW, 'الأسعار والإخفاء').check();
  await radio(below, KEEP, 'الإيقافات').check();
  await expect(submit).toBeDisabled();
  await radio(lines, RECAPTURE).check();
  await expect(submit).toBeEnabled();

  const sent = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/office/users/ag1/transfer'));
  await submit.click();
  expect((await sent).postDataJSON()).toEqual({
    parentLogin: 'ma2', ownPrices: 'keep', ownStops: 'reset', childPrices: 'reset', childStops: 'keep', linePrices: 'recapture',
  });
  // A move closes the dialog and the list is read again.
  await expect(dialog).toBeHidden();
  await expect.poll(() => calls.filter((call) => call === 'GET /users').length).toBe(2);
});

test('a point of sale asks three choices, shows no terms for what is below it, and sends no child choice', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /me': () => ({ body: branchMe() }),
    'GET /users': () => ({ body: { users: tree } }),
    'GET /users/pos1/transfer-preview': () => ({ body: posPreview }),
    'POST /users/pos1/transfer': () => ({ body: { ok: true, lines: 4 } }),
  });
  await page.goto(`${admin}/users`);
  const dialog = await openMove(page, 'pos1');
  const { own, below, lines } = accountGroups(dialog);

  // Agents that are open and are not its parent.
  const destination = dialog.getByLabel('الوكيل الجديد');
  await expect(destination.locator('option')).toHaveText(['—', 'ag2 (وكيل ٢)']);
  await destination.selectOption('ag2');
  await expect(dialog.getByText('4 رقماً')).toBeVisible();
  await expect(dialog.locator('.detail-rows > div', { hasText: 'الرصيد المنقول' })).toContainText('3.00 ₪');
  await expect(dialog.getByText('رصيد ما تحته')).toHaveCount(0);
  await expect(dialog.locator('.ui-badge-warning')).toHaveCount(0);
  await expect(below).toHaveCount(0);
  await expect(dialog.getByRole('radio')).toHaveCount(6);

  const submit = dialog.getByRole('button', { name: 'نقل', exact: true });
  await radio(own, FOLLOW, 'الأسعار والإخفاء').check();
  await radio(own, KEEP, 'الإيقافات').check();
  await expect(submit).toBeDisabled();
  await radio(lines, KEEP).check();
  const sent = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/office/users/pos1/transfer'));
  await submit.click();
  expect((await sent).postDataJSON()).toEqual({ parentLogin: 'ag2', ownPrices: 'reset', ownStops: 'keep', linePrices: 'keep' });
});

test('a refused preview shows its message in the dialog and opens no choices', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /me': () => ({ body: branchMe() }),
    'GET /users': () => ({ body: { users: tree } }),
    'GET /users/ag1/transfer-preview': () => ({ status: 403, body: { code: 'FORBIDDEN', message: 'غير مسموح' } }),
  });
  await page.goto(`${admin}/users`);
  const dialog = await openMove(page, 'ag1');
  await dialog.getByLabel('الوكيل الرئيسي الجديد').selectOption('ma2');
  await expect(dialog.getByRole('alert')).toHaveText('غير مسموح');
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'نقل', exact: true })).toBeDisabled();
});

test('changing the destination reads its own preview and keeps the choices already made', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    'GET /me': () => ({ body: branchMe() }),
    'GET /users': () => ({ body: { users: tree } }),
    'GET /users/ag1/transfer-preview': (url) => ({
      body: url.searchParams.get('parentLogin') === 'ma2' ? agentPreview : { ...agentPreview, lines: 5, own: { ...agentPreview.own, belowNewFloor: 0 } },
    }),
  });
  await page.goto(`${admin}/users`);
  const dialog = await openMove(page, 'ag1');
  const destination = dialog.getByLabel('الوكيل الرئيسي الجديد');
  await destination.selectOption('ma2');
  await expect(dialog.getByText('37 رقماً')).toBeVisible();
  await expect(dialog.locator('.ui-badge-warning')).toHaveCount(1);
  await radio(accountGroups(dialog).own, KEEP, 'الأسعار والإخفاء').check();

  await destination.selectOption('ma4');
  await expect(dialog.getByText('5 رقماً')).toBeVisible();
  await expect(dialog.locator('.ui-badge-warning')).toHaveCount(0);
  expect(calls).toContain('GET /users/ag1/transfer-preview?parentLogin=ma4');
  await expect(radio(accountGroups(dialog).own, KEEP, 'الأسعار والإخفاء')).toBeChecked();
  await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(1);
});

test('a late preview of an earlier destination never replaces the one now chosen', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /me': () => ({ body: branchMe() }),
    'GET /users': () => ({ body: { users: tree } }),
    'GET /users/ag1/transfer-preview': (url) => (
      url.searchParams.get('parentLogin') === 'ma2'
        ? { body: agentPreview, delay: 500 }
        : { body: { ...agentPreview, lines: 5 } }
    ),
  });
  await page.goto(`${admin}/users`);
  const dialog = await openMove(page, 'ag1');
  const destination = dialog.getByLabel('الوكيل الرئيسي الجديد');
  const late = page.waitForResponse((response) => response.url().includes('parentLogin=ma2'));
  await destination.selectOption('ma2');
  await destination.selectOption('ma4');
  await expect(dialog.getByText('5 رقماً')).toBeVisible();
  await late;
  // Two frames after the late answer, so a stale write would have landed by now.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await expect(dialog.getByText('5 رقماً')).toBeVisible();
  await expect(dialog.getByText('37 رقماً')).toHaveCount(0);
});

test('a main agent sees only its own agents as destinations and no «نقل» on agent rows', async ({ page }) => {
  await serveOffice(page, 'main_agent', {
    'GET /me': () => ({ body: me('main_agent', 'main1', ['transferLines', 'transferPos']) }),
    'GET /users': () => ({ body: { users: chain } }),
  });
  await page.goto(`${main}/users`);

  // An agent row has a menu, and the menu holds no «نقل» (funding sits in the row's «المحفظة» menu).
  await page.getByRole('button', { name: 'إجراءات ag1' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'نقل' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // A point of sale moves to the agents of the chain, minus the one it sits under and the frozen one.
  const dialog = await openMove(page, 'pos1');
  await expect(dialog.getByLabel('الوكيل الجديد').locator('option')).toHaveText(['—', 'ag2 (وكيل ٢)']);
});

// The grant says what may move: transferPos a point of sale, transferAgents an agent. A number's grant gives nothing here.
for (const ask of [
  { grants: ['transferPos'], pos: 1, agent: 0 },
  { grants: ['transferAgents'], pos: 0, agent: 1 },
  { grants: ['transferLines'], pos: 0, agent: 0 },
]) {
  test(`the «نقل» item follows the grant of the kind it moves: ${ask.grants.join()}`, async ({ page }) => {
    await serveOffice(page, 'branch', {
      'GET /me': () => ({ body: branchMe({ grants: ask.grants }) }),
      'GET /users': () => ({ body: { users: tree } }),
    });
    await page.goto(`${admin}/users`);
    for (const [login, count] of [['pos1', ask.pos], ['ag1', ask.agent]] as const) {
      await page.getByRole('button', { name: `إجراءات ${login}` }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'نقل', exact: true })).toHaveCount(count);
      await page.keyboard.press('Escape');
    }
  });
}

for (const [why, patch] of [['transfer is stopped on the actor path', { stops: ['transfer'] }], ['the session is an impersonation', { impersonating: true }]] as const) {
  test(`«نقل» is absent when ${why}`, async ({ page }) => {
    await serveOffice(page, 'branch', {
      'GET /me': () => ({ body: branchMe(patch) }),
      'GET /users': () => ({ body: { users: tree } }),
    });
    await page.goto(`${admin}/users`);
    for (const login of ['pos1', 'ag1']) {
      await page.getByRole('button', { name: `إجراءات ${login}` }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'نقل' })).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
  });
}

test('the term groups sit side by side on a wide screen and stack on a narrow one; every choice is a 44px target', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /me': () => ({ body: branchMe() }),
    'GET /users': () => ({ body: { users: tree } }),
    'GET /users/ag1/transfer-preview': () => ({ body: agentPreview }),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${admin}/users`);
  const dialog = await openMove(page, 'ag1');
  await dialog.getByLabel('الوكيل الرئيسي الجديد').selectOption('ma2');
  const { own, below, lines } = accountGroups(dialog);
  await expect(lines).toBeVisible();

  const place = async () => {
    const [a, b, c, panel] = await Promise.all([own.boundingBox(), below.boundingBox(), lines.boundingBox(), dialog.boundingBox()]);
    if (!a || !b || !c || !panel) throw new Error('a group has no box');
    return { a, b, c, panel };
  };
  const sharesRow = async () => {
    const { a, b } = await place();
    return Math.abs(a.y - b.y) < 2 && a.x !== b.x;
  };
  const stacked = async () => {
    const { a, b, c } = await place();
    return Math.abs(a.x - b.x) < 2 && b.y >= a.y + a.height - 1 && c.y >= b.y + b.height - 1;
  };

  // Wide: the account's terms and the terms below it share a row, the first at the reading start (right in Arabic);
  // the lines group is its own row under both.
  await expect.poll(sharesRow).toBe(true);
  const wide = await place();
  expect(wide.a.x).toBeGreaterThan(wide.b.x);
  expect(wide.c.y).toBeGreaterThanOrEqual(wide.a.y + wide.a.height - 1);
  await page.setViewportSize({ width: 900, height: 900 });
  await expect.poll(stacked).toBe(true);

  // At both widths nothing leaves the panel, and a radio is a 44px row.
  for (const width of [900, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const { panel } = await place();
    for (const group of [own, below, lines]) {
      const box = await group.boundingBox();
      expect(box?.x ?? 0).toBeGreaterThanOrEqual(panel.x);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
    }
    for (const label of await dialog.locator('label.check').all()) {
      expect((await label.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  }
});

// The same dialog in each language: the fourteen words the dialog owns, and the direction of the two groups.
const words = {
  ar: {
    menu: 'نقل', destination: 'الوكيل الرئيسي الجديد', own: 'شروط الحساب', below: 'شروط ما تحته', prices: 'الأسعار والإخفاء', stops: 'الإيقافات',
    lines: 'أسعار الأرقام المنقولة', keep: 'تبقى كما هي', follow: 'تتبع السلسلة الجديدة', recapture: 'تُحسب من جديد', balance: 'الرصيد المنقول',
    subtree: 'رصيد ما تحته', count: '37 رقماً', floor: '1 سعراً خاصاً أقل من تكلفة الأب الجديد',
  },
  en: {
    menu: 'Transfer', destination: 'New main agent', own: 'Account terms', below: 'Terms below it', prices: 'Prices and hidden packages', stops: 'Stops',
    lines: 'Prices of the moved numbers', keep: 'Stay as they are', follow: 'Follow the new chain', recapture: 'Recalculated', balance: 'Balance moving',
    subtree: 'Balance below it', count: '37 numbers', floor: "1 custom prices below the new parent's cost",
  },
  he: {
    menu: 'העברה', destination: 'סוכן ראשי חדש', own: 'תנאי החשבון', below: 'תנאים מתחתיו', prices: 'מחירים והסתרות', stops: 'עצירות',
    lines: 'מחירי המספרים המועברים', keep: 'נשארים כפי שהם', follow: 'לפי השרשרת החדשה', recapture: 'מחושבים מחדש', balance: 'יתרה מועברת',
    subtree: 'יתרה מתחתיו', count: '37 מספרים', floor: '1 מחירים מותאמים מתחת לעלות ההורה החדש',
  },
} as const;

for (const locale of ['ar', 'en', 'he'] as const) {
  test(`the transfer dialog speaks ${locale} and puts the first group at the reading start`, async ({ page }) => {
    const w = words[locale];
    await page.context().addCookies([{ name: 'smilesim-locale', value: locale, url: admin }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await serveOffice(page, 'branch', {
      'GET /me': () => ({ body: branchMe() }),
      'GET /users': () => ({ body: { users: tree } }),
      'GET /users/ag1/transfer-preview': () => ({ body: agentPreview }),
    });
    await page.goto(`${admin}/users`);
    // A row has «المحفظة» then ⋯; the move is in ⋯, the last of the two.
    await page.getByRole('button', { name: /ag1/ }).last().click();
    await page.getByRole('menuitem', { name: w.menu, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: w.menu, exact: true });
    await dialog.getByLabel(w.destination).selectOption('ma2');

    const own = dialog.getByRole('group', { name: w.own });
    const below = dialog.getByRole('group', { name: w.below });
    const lines = dialog.getByRole('group', { name: w.lines });
    for (const group of [own, below]) {
      await expect(group.getByRole('radiogroup', { name: w.prices })).toBeVisible();
      await expect(group.getByRole('radiogroup', { name: w.stops })).toBeVisible();
      await expect(group.getByRole('radio', { name: w.keep })).toHaveCount(2);
      await expect(group.getByRole('radio', { name: w.follow })).toHaveCount(2);
    }
    await expect(lines.getByRole('radio', { name: w.keep })).toHaveCount(1);
    await expect(lines.getByRole('radio', { name: w.recapture })).toHaveCount(1);
    await expect(lines).toContainText(w.count);
    await expect(dialog.locator('.ui-badge-warning')).toHaveText(w.floor);
    await expect(dialog.locator('.detail-rows > div', { hasText: w.balance })).toContainText('12.00 ₪');
    await expect(dialog.locator('.detail-rows > div', { hasText: w.subtree })).toContainText('50.00 ₪');

    const [a, b] = await Promise.all([own.boundingBox(), below.boundingBox()]);
    if (!a || !b) throw new Error('a group has no box');
    // Right to left in Arabic and Hebrew, left to right in English.
    if (locale === 'en') expect(a.x).toBeLessThan(b.x);
    else expect(a.x).toBeGreaterThan(b.x);
  });
}

// The number card: one number moves to another point of sale, and the dialog asks the same price question.
const line = {
  id: 'ln1', msisdn: '0550246962', iccid: null, esim: false, status: 'active',
  packageCode: 'cell-400', packageName: '400 جيجا', companyName: 'سلكوم',
  posLogin: 'pos1', posPrice: 30, createdAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-12T00:00:00.000Z',
};

function serveNumber(page: Page, patch: Record<string, unknown> = {}, extra: Routes = {}) {
  return serveOffice(page, 'agent', {
    'GET /me': () => ({ body: me('agent', 'agent1', ['transferLines'], patch) }),
    'GET /lines/ln1': () => ({ body: { line, history: [] } }),
    'GET /packages': () => ({ body: { packages: [], companies: [] } }),
    'GET /users': () => ({ body: { users: [user('pos1', 'نقطة ١', 'pos', 'agent1'), user('pos2', 'نقطة ٢', 'pos', 'agent1')] } }),
    ...extra,
  });
}

for (const [label, wire] of [[KEEP, 'keep'], [RECAPTURE, 'recapture']] as const) {
  test(`number detail sends linePrices ${wire} with the transfer`, async ({ page }) => {
    await serveNumber(page, {}, { 'POST /lines/ln1/transfer': () => ({ body: { ok: true } }) });
    await page.goto(`${agent}/numbers/ln1`);
    await page.getByRole('button', { name: 'نقل', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'نقل', exact: true });
    const submit = dialog.getByRole('button', { name: 'نقل', exact: true });

    // The price question has no default, and the button waits for both the point of sale and the answer.
    await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(dialog.getByRole('radio')).toHaveCount(2);
    await dialog.getByLabel('نقل').selectOption('pos2');
    await expect(submit).toBeDisabled();
    const choice = radio(dialog.getByRole('group', { name: 'أسعار الأرقام المنقولة' }), label);
    await choice.check();
    await expect(choice).toBeFocused();
    await expect(submit).toBeEnabled();

    const sent = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/office/lines/ln1/transfer'));
    await submit.click();
    expect((await sent).postDataJSON()).toEqual({ posLogin: 'pos2', linePrices: wire });
  });
}

test('the number card has no «نقل» tile when transfer is stopped on the actor path', async ({ page }) => {
  await serveNumber(page, { stops: ['transfer'] });
  await page.goto(`${agent}/numbers/ln1`);
  await expect(page.locator('.line-number')).toHaveText('0550246962');
  await expect(page.locator('.line-ops')).toBeVisible();
  await expect(page.getByRole('button', { name: 'نقل', exact: true })).toHaveCount(0);
});
