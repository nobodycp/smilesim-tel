# الصفحات الداخلية — طاولة ممتلئة

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** إعادة ترتيب الصفحات الداخلية على نمط طاولة ممتلئة بنظام مكوّنات واحد، بلا تغيير في البيانات أو الطلبات.

**Architecture:** أصناف النظام تُحصر داخل `.desk` حتى لا يتغيّر الدخول ولا الهيدر ولا السايدبار. `Desk` يضع الزر الأساسي في سطر العنوان ويُسقط المقدّمة الفارغة. كل صفحة قائمة تنقل زرها إلى هذا السطر، تحذف العنوان المكرّر، وتُبقي الفلاتر ظاهرة والجدول مالئاً للباقي.

**Tech Stack:** Next.js 15، React 19، Playwright، التوكنز `--rd-*` في `apps/web/app/globals.css`. لا مكتبة جديدة.

**Spec:** `docs/superpowers/specs/2026-10-30-inner-desk-design.md`

## Global Constraints

- الهيدر والسايدبار والدرج و`.shell-*` والصفحة الرئيسية والدخول وكلمة السر والتحقق لا تُمس.
- الصفحة تستعمل التوكن لا القيمة. `--rd-accent` لا يلوّن زراً ولا شارة داخل الصفحة.
- المسافات 4 و8 و12 و14 فقط. ارتفاع الزر والحقل 34 على سطح المكتب، و44 عند عرض 720 فأقل.
- الزاوية `--rd-radius-lg`. ظل البطاقة `--rd-shadow-card` فقط. `--rd-shadow-pop` للنوافذ والقوائم الموجودة.
- الخط تاجوال، والعبري IBM Plex Sans Hebrew. لا خط جديد.
- زر أساسي واحد في سطر العنوان: `--rd-primary-bg` / `--rd-primary-fg`. زر ثانوي: حد `--rd-line` وخلفية شفافة.
- الشارة بنص ونقطة: يعمل `--rd-success`، مجمّد وقيد المعالجة `--rd-warning`، مفصول وملغى `--rd-danger`، الحياد `--rd-surface-2`.
- الإجراء التدميري يبقى بند `danger` في `RowMenu`، وليس زراً ثالثاً.
- لا تتغيّر الأفعال ولا النصوص ولا الطلبات. الترتيب فقط.
- `/wallets` و`/staff` و`/plans` و`/reports` و`/ledger/[scope]` تحويلات. لا تُعدَّل.

---

### Task 1: أصناف النظام داخل المكتب

**Files:**
- Modify: `apps/web/app/globals.css` (كتلة `.desk` عند السطر 707)
- Test: `apps/web/tests/desk-system.spec.ts`

**Interfaces:**
- Consumes: توكنز `--rd-*` الموجودة.
- Produces: داخل `.desk`، `button.primary` حبر بارتفاع 34 (44 تحت 720)، و`button.secondary` بحد وشفاف وبنفس الارتفاع. `.desk > .pane` يتمدّد ليملأ الباقي، و`.desk .sheet` يتمرر.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from '@playwright/test';

async function probe(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const root = document.createElement('div');
    root.className = 'desk';
    const primary = document.createElement('button');
    primary.className = 'primary';
    const secondary = document.createElement('button');
    secondary.className = 'secondary';
    const field = document.createElement('input');
    root.append(primary, secondary, field);
    document.body.append(root);
    const primaryStyle = getComputedStyle(primary);
    const secondaryStyle = getComputedStyle(secondary);
    return {
      primaryHeight: primaryStyle.height,
      primaryBg: primaryStyle.backgroundColor,
      secondaryHeight: secondaryStyle.height,
      secondaryBg: secondaryStyle.backgroundColor,
      secondaryBorder: secondaryStyle.borderTopWidth,
      fieldHeight: getComputedStyle(field).height,
    };
  });
}

test('desk buttons are ink and 34px on a desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/login');
  const style = await probe(page);
  expect(style.primaryHeight).toBe('34px');
  expect(style.primaryBg).toBe('rgb(10, 10, 10)');
  expect(style.secondaryHeight).toBe('34px');
  expect(style.secondaryBg).toBe('rgba(0, 0, 0, 0)');
  expect(style.secondaryBorder).toBe('1px');
  expect(style.fieldHeight).toBe('34px');
});

test('desk buttons grow to 44px under 720px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/login');
  const style = await probe(page);
  expect(style.primaryHeight).toBe('44px');
  expect(style.secondaryHeight).toBe('44px');
  expect(style.fieldHeight).toBe('44px');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `apps/web`: `npx playwright test tests/desk-system.spec.ts`
Expected: FAIL because `button.primary` inside `.desk` is not 34px.

- [ ] **Step 3: Write minimal implementation**

أضف بعد كتلة `.desk` الحالية في `apps/web/app/globals.css`. لا تغيّر `.btn` العام ولا أزرار الدخول.

```css
.desk > .page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.desk > .page-head h1 { margin: 0; }
.desk > .page-head .lede { flex-basis: 100%; margin: 4px 0 0; }
.desk > .pane,
.desk > .stack > .pane:last-child { flex: 1; }
.desk .sheet { flex: 1; min-height: 0; overflow: auto; }
.desk button.primary {
  height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: var(--rd-primary-bg);
  color: var(--rd-primary-fg);
  font-weight: 700;
}
.desk button.secondary {
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--rd-line);
  border-radius: 8px;
  background: transparent;
  color: var(--rd-ink);
  font-weight: 700;
}
.desk input:not([type='checkbox']):not([type='file']),
.desk select { height: 34px; }
@media (max-width: 720px) {
  .desk button.primary,
  .desk button.secondary,
  .desk input:not([type='checkbox']):not([type='file']),
  .desk select { height: 44px; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/desk-system.spec.ts`
Expected: PASS. الوضع الليلي يبدّل `--rd-primary-bg` إلى `rgb(245, 245, 242)` لأن `.dark` معرّف في الملف نفسه. لا تختبره على صفحة الدخول لأنها لا تضع `.dark` على هذا الزر المزروع.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/globals.css apps/web/tests/desk-system.spec.ts
git commit -m "قفل أزرار المكتب على نظام الصفحات الداخلية"
```

### Task 2: سطر العنوان في Desk

**Files:**
- Modify: `apps/web/components/desk.tsx`
- Create: `apps/web/tests/desk.ts`
- Test: `apps/web/tests/desk-head.spec.ts`

**Interfaces:**
- Consumes: `OfficeShell` كما هو.
- Produces: `Desk` يقبل `action?: ReactNode`. إذا كانت `lede` فارغة لا يُرسم `p.lede`. المساعد `asBranch(page)` يحقن `GET /office/me` لحساب فرع، و`expectFullTable(page, title)` يثبت عنواناً واحداً بلا تكرار وبلا زر فلاتر.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from '@playwright/test';

test('settings keeps its lede and does not gain a second copy of the title', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.lede')).toBeVisible();
});
```

هذا الاختبار يمر اليوم. الاختبار الذي يفشل هو نوع `action`:

```ts
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('Desk accepts an action slot and skips an empty lede', () => {
  const source = readFileSync('components/desk.tsx', 'utf8');
  expect(source).toContain('action?:');
  expect(source).toContain('{lede ?');
});
```

اجمع الاختبارين في `apps/web/tests/desk-head.spec.ts`. شغّل Playwright من `apps/web` حتى يُحَل `components/desk.tsx`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/desk-head.spec.ts`
Expected: FAIL because `action?:` is absent.

- [ ] **Step 3: Write minimal implementation**

في `Desk` أضف `action` إلى الخصائص. استبدل رأس الصفحة:

```tsx
<header className="page-head">
  <h1>{title}</h1>
  {action}
  {lede ? <p className="lede">{lede}</p> : null}
</header>
```

ونوع الخاصية `action?: ReactNode`. المستدعون الحاليون يمرّرون `lede` كما هي، فالإعدادات تبقى بمقدّمتها.

أنشئ `apps/web/tests/desk.ts`:

```ts
import { expect, type Page } from '@playwright/test';

export async function asBranch(page: Page) {
  await page.route('**/office/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        loginName: 'admin',
        nickname: 'الإدارة',
        layer: 'branch',
        isBranchOwner: true,
        grants: ['edit', 'reports', 'staff'],
        impersonating: false,
        balance: 1000,
        ceiling: 0,
      }),
    }),
  );
}

export async function expectFullTable(page: Page, title: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: title })).toHaveCount(0);
  await expect(page.locator('.page-head .lede')).toHaveCount(0);
  await expect(page.locator('.filter-toggle')).toHaveCount(0);
  const box = await page.locator('.desk .pane').first().boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(720);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/desk-head.spec.ts`
Expected: PASS. صفحة الإعدادات ما زالت تعرض المقدّمة.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/desk.tsx apps/web/tests/desk.ts apps/web/tests/desk-head.spec.ts
git commit -m "اجعل عنوان المكتب يحمل الزر الأساسي ويسقط المقدمة الفارغة"
```

### Task 3: صفحة الأرقام

**Files:**
- Modify: `apps/web/app/numbers/page.tsx`
- Test: `apps/web/tests/numbers-desk.spec.ts`

**Interfaces:**
- Consumes: `Desk` مع `action`، و`expectFullTable` من `apps/web/tests/desk.ts`.
- Produces: صفحة الأرقام بلا مقدّمة، بلا `h2`، بلا `.filter-toggle`. زر التفعيل `button.primary` في سطر العنوان. أول إجراء غير تدميري في الصف `button.secondary`، والباقي في `RowMenu`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from '@playwright/test';
import { expectFullTable } from './desk';

const line = {
  id: 'ln1',
  msisdn: '0550246962',
  iccid: null,
  esim: false,
  status: 'active',
  packageCode: 'cell-400',
  packageName: '400 جيجا',
  companyName: 'سلكوم',
  posLogin: 'pos',
  posPrice: 30,
  createdAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2026-11-12T00:00:00.000Z',
};

test('numbers is a full table with extend outside the menu', async ({ page }) => {
  await page.route('**/office/lines**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ lines: [line], poses: [] }),
    }),
  );
  await page.route('**/office/packages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ packages: [], companies: [] }),
    }),
  );
  await page.goto('/numbers');
  await expectFullTable(page, 'الأرقام');
  await expect(page.getByLabel('الرقم')).toBeVisible();
  await expect(page.getByRole('button', { name: 'تمديد' })).toBeVisible();
  await expect(page.locator('.lede')).toHaveCount(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/numbers-desk.spec.ts`
Expected: FAIL. المقدّمة موجودة أو زر التمديد داخل القائمة أو زر الفلاتر ظاهر.

- [ ] **Step 3: Write minimal implementation**

في استدعاء `Desk`: `lede=""` وانقل زر التفعيل إلى `action`:

```tsx
<Desk
  title={t.numbersTitle}
  lede=""
  action={ready && me && me.layer !== 'pos' ? (
    <button type="button" className="primary" onClick={() => setActivateOpen(true)}>{t.activateLine}</button>
  ) : undefined}
  error={error}
  note={note}
>
```

احذف `filter-toggle` و`filtersOpen`. لوحة الفلاتر تُرسم دائماً. احذف `header.pane-head` وعنوان `h2`. أبقِ `Dialog` كما هو.

في صف الخط، ابنِ عناصر القائمة كما هي اليوم، ثم أخرج أول عنصر `danger` غير مضبوط إلى زر:

```tsx
const items = [ /* نفس المصفوفة الحالية بلا تغيير في الشروط */ ];
const visible = items.find((item) => !item.danger);
const rest = items.filter((item) => item !== visible);
```

```tsx
<td>
  {visible && (
    <button type="button" className="secondary" onClick={visible.onClick}>{visible.label}</button>
  )}
  {rest.length > 0 && <RowMenu label={t.lineOps} items={rest} />}
</td>
```

الهاتف يبقى `<bdi dir="ltr">`. لا تغيّر `run` ولا `activate`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/numbers-desk.spec.ts tests/login.spec.ts`
Expected: PASS. دخول الإعدادات لا ينكسر.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/numbers/page.tsx apps/web/tests/numbers-desk.spec.ts
git commit -m "اجعل صفحة الأرقام طاولة ممتلئة"
```

### Task 4: المستخدمون

**Files:**
- Modify: `apps/web/app/users/page.tsx`
- Test: `apps/web/tests/users-desk.spec.ts`

**Interfaces:**
- Consumes: `asBranch` و`expectFullTable`.
- Produces: عنوان «المستخدمون» مرة واحدة، وزر «حساب جديد» أساسي في السطر، والفلاتر ظاهرة.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from '@playwright/test';
import { asBranch, expectFullTable } from './desk';

test('users is a full table on the branch door', async ({ page }) => {
  await asBranch(page);
  await page.route('**/office/users**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ users: [] }) }),
  );
  await page.goto('http://admin.localhost:3910/users');
  await expectFullTable(page, 'المستخدمون');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/users-desk.spec.ts`
Expected: FAIL لأن `h2` يعيد «المستخدمون» أو البطاقة لا تملأ الارتفاع.

- [ ] **Step 3: Write minimal implementation**

`lede=""`. انقل زر `t.openAccount` من `pane-head` إلى `action` بـ `className="primary"` وبنفس `onClick`. احذف `header.pane-head`. أبقِ `Dialog` الإنشاء وحقول التمويل في الصف كما هي. لا زر جديد.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/users-desk.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/users/page.tsx apps/web/tests/users-desk.spec.ts
git commit -m "اجعل صفحة المستخدمين طاولة ممتلئة"
```

### Task 5: المهام

**Files:**
- Modify: `apps/web/app/tasks/page.tsx`
- Test: `apps/web/tests/tasks-desk.spec.ts`

**Interfaces:**
- Consumes: `expectFullTable`.
- Produces: بلا `h2` مكرر. حقل السبب يبقى في الصف. أول زر غير تدميري (`take` ثم `complete` ثم `release`) يصير `secondary`. `reject` و`cancelTask` بندا `danger` في `RowMenu`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from '@playwright/test';
import { expectFullTable } from './desk';

test('tasks drops the repeated title and keeps the status filter visible', async ({ page }) => {
  await page.route('**/office/tasks**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) }),
  );
  await page.goto('/tasks');
  await expectFullTable(page, 'المهام');
  await expect(page.getByLabel('الحالة')).toBeVisible();
});
```

المسار هو `GET /office/tasks` والجسم `{ tasks: TaskRow[] }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/tasks-desk.spec.ts`
Expected: FAIL بسبب `h2` أو المقدّمة.

- [ ] **Step 3: Write minimal implementation**

`lede=""`. احذف `pane-head`. الفلتر يبقى كما هو. في عمود العمليات: الحقل `aria-label={t.reason}` يبقى. الأزرار تُجمع بالشروط الحالية `canTake` و`canWork` و`canCancel`. أول زر من استلام ثم إتمام ثم إرجاع يُرسم `secondary`. الرفض والإلغاء والإرجاع المتبقي تذهب إلى `RowMenu`، والرفض والإلغاء `danger: true`. نفس دوال `api.takeTask` و`completeTask` و`rejectTask` و`releaseTask` و`cancelTask`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/tasks-desk.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/tasks/page.tsx apps/web/tests/tasks-desk.spec.ts
git commit -m "اجعل صفحة المهام طاولة ممتلئة"
```

### Task 6: قوائم بلا زر إنشاء

**Files:**
- Modify: `apps/web/app/operations/page.tsx`
- Modify: `apps/web/app/accounting/page.tsx`
- Modify: `apps/web/app/audit/page.tsx`
- Modify: `apps/web/app/reports/[kind]/page.tsx`
- Modify: `apps/web/app/providers/page.tsx`
- Modify: `apps/web/app/providers/[code]/page.tsx`
- Test: `apps/web/tests/lists-desk.spec.ts`

**Interfaces:**
- Consumes: `asBranch` و`expectFullTable`.
- Produces: كل صفحة من هذه بلا مقدّمة وبلا `h2` يعيد عنوان الصفحة، والجدول يملأ الباقي. لا زر أساسي يُخترع.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from '@playwright/test';
import { asBranch, expectFullTable } from './desk';

const empty = (body: string) => (route: import('@playwright/test').Route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body });

test('operations, accounting, audit, providers, and consumption fill the desk', async ({ page }) => {
  await asBranch(page);
  await page.route('**/office/ledger/operations**', empty(JSON.stringify({ entries: [] })));
  await page.route('**/office/accounting**', empty(JSON.stringify({ entries: [] })));
  await page.route('**/office/audit**', empty(JSON.stringify({ entries: [] })));
  await page.route('**/office/providers**', empty(JSON.stringify({
    providers: [{ code: 'cell', name: 'سلكوم', companies: [] }],
  })));
  await page.route('**/office/reports/consumption**', empty(JSON.stringify({ rows: [] })));
  await page.goto('http://admin.localhost:3910/operations');
  await expectFullTable(page, 'العمليات');
  await page.goto('http://admin.localhost:3910/accounting');
  await expectFullTable(page, 'المحاسبة');
  await page.goto('http://admin.localhost:3910/audit');
  await expectFullTable(page, 'سجل التدقيق');
  await page.goto('http://admin.localhost:3910/providers');
  await expectFullTable(page, 'المزودون');
  await page.goto('http://admin.localhost:3910/providers/cell');
  await expectFullTable(page, 'سلكوم');
  await expect(page.getByRole('heading', { level: 2, name: 'الرزم' })).toHaveCount(0);
  await page.goto('http://admin.localhost:3910/reports/consumption');
  await expectFullTable(page, 'تقارير استهلاك الرصيد');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/lists-desk.spec.ts`
Expected: FAIL بسبب عنوان مكرر أو بطاقة قصيرة.

- [ ] **Step 3: Write minimal implementation**

في كل ملف من الستة: `lede=""`. احذف `pane-head` إذا كان `h2` يعيد عنوان الصفحة. أبقِ الفلاتر الموجودة ظاهرة. أبقِ أعمدة الجدول والنقر كما هي. في صفحة رزم المزود احذف `pane-head` الذي عنوانه `t.navPlans`. عنوان الصفحة يبقى اسم المزود. غلاف الهاتف إن وُجد يصير `<bdi dir="ltr">` بلا تغيير القيمة.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/lists-desk.spec.ts`
Expected: PASS على العمليات والمحاسبة والتدقيق.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/operations/page.tsx apps/web/app/accounting/page.tsx apps/web/app/audit/page.tsx apps/web/app/reports apps/web/app/providers apps/web/tests/lists-desk.spec.ts
git commit -m "املأ قوائم التشغيل والتقارير والمزودين"
```

### Task 7: الرزم والأدوار

**Files:**
- Modify: `apps/web/app/packages/page.tsx`
- Modify: `apps/web/app/roles/page.tsx`
- Test: `apps/web/tests/packages-roles-desk.spec.ts`

**Interfaces:**
- Consumes: `asBranch` و`expectFullTable`.
- Produces: جدول أسعار الرزم طاولة ممتلئة. بطاقات الشركات تبقى بطاقات. خطوات نقطة البيع تبقى `.steps`. الأدوار: زر «الدور» أساسي في سطر العنوان، وتعديل الصف يبقى في `RowMenu`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from '@playwright/test';
import { asBranch, expectFullTable } from './desk';

test('roles puts the create button on the title row', async ({ page }) => {
  await asBranch(page);
  await page.route('**/office/roles**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ roles: [] }) }),
  );
  await page.goto('http://admin.localhost:3910/roles');
  await expectFullTable(page, 'الأدوار');
  await expect(page.getByRole('button', { name: 'الدور' })).toBeVisible();
});

test('package steps stay on the point-of-sale door', async ({ page }) => {
  await page.route('**/office/packages**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ packages: [], companies: [] }) }),
  );
  await page.goto('/packages');
  await expect(page.locator('.steps')).toBeVisible();
});
```

`GET /office/roles` جسمه `{ roles: [] }`. `GET /office/packages` جسمه `{ packages: [], companies: [] }`. زر الدور نصه «الدور».

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/packages-roles-desk.spec.ts`
Expected: FAIL على الأدوار بسبب `h2`. اختبار الخطوات قد يمر إذا كانت `.steps` موجودة؛ لا تحذفها لتجعله يفشل.

- [ ] **Step 3: Write minimal implementation**

الأدوار: `lede=""`, انقل زر `t.role` إلى `action` بـ `className="primary"`, احذف `pane-head`. `RowMenu` التعديل يبقى.

الرزم: في فرع جدول الأسعار احذف `h2` المكرر إن كان يعيد عنوان الصفحة، و`lede=""`. لا تحوّل بطاقات الشركات إلى جدول. في نقطة البيع أبقِ `.steps` و`lede` الخاصة بخطوات البيع إن كانت شرح الخطوة، ولا تضف لوحة تفصيل.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/packages-roles-desk.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/packages/page.tsx apps/web/app/roles/page.tsx apps/web/tests/packages-roles-desk.spec.ts
git commit -m "رتب الرزم والأدوار على نظام المكتب"
```

### Task 8: التفاصيل والإعدادات

**Files:**
- Modify: `apps/web/app/numbers/[id]/page.tsx`
- Modify: `apps/web/app/providers/[code]/[packageCode]/page.tsx`
- Modify: `apps/web/app/settings/page.tsx`
- Modify: `apps/web/app/globals.css` (فقط `.settings-page` إن لزم)
- Test: `apps/web/tests/detail-desk.spec.ts`

**Interfaces:**
- Consumes: أصناف `.desk` و`.pane` و`.steps`.
- Produces: بطاقة الرقم ورزمة المزود تملآن العرض وتُبقيان `.steps`. لا لوحة جانبية جديدة. الإعدادات بطاقات بعرض المساحة بلا فراغ مصطنع تحت آخر بطاقة، ومقدّمتها تبقى.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from '@playwright/test';

test('line card keeps its tabs and stretches the pane', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/office/lines/ln1**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        line: {
          id: 'ln1', msisdn: '0550246962', iccid: null, esim: false, status: 'active',
          packageCode: 'cell-400', packageName: '400 جيجا', companyName: 'سلكوم',
          posLogin: 'pos', posPrice: 30, createdAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-12T00:00:00.000Z',
        },
        history: [],
      }),
    }),
  );
  await page.goto('/numbers/ln1');
  await expect(page.locator('.steps')).toBeVisible();
  const box = await page.locator('.desk .pane').first().boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(700);
});

test('settings lede stays and the grid has no trailing spacer', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.locator('.lede')).toBeVisible();
  await expect(page.locator('.settings-grid')).toBeVisible();
});
```

`GET /office/lines/ln1` يعيد `{ line, history }`. الجسم في الاختبار يطابق `LineRow`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/detail-desk.spec.ts`
Expected: FAIL إذا كان عرض البطاقة أقل من 700، أو PASS لاختبار الإعدادات الحالي. إذا مر اختبار البطاقة لأن العرض واسع أصلاً، لا تضف لوحة جانبية، وأكمل بضبط `.settings-page` فقط حيث الفراغ.

- [ ] **Step 3: Write minimal implementation**

لا تضف عموداً بجانب الجدول في بطاقة الرقم ولا في رزمة المزود. أبقِ `.steps`. إذا وُجد `max-width` على محتوى هاتين الصفحتين داخل `.canvas`، أزله عنهما فقط.

في `settings/page.tsx` أبقِ `h1` والمقدّمة وعناوين الأقسام (`h2` للحساب وكلمة السر والتحقق والجلسات) لأنها ليست تكراراً لعنوان الصفحة. أضف الصنف `desk` على `div.settings-page` حتى تأخذ الحقول ارتفاع النظام. في CSS:

```css
.settings-page.desk { width: 100%; }
.settings-page .pane { width: 100%; }
```

لا تمدّد البطاقة الأخيرة بفراغ داخلي.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/detail-desk.spec.ts tests/desk-system.spec.ts tests/login.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/numbers/[id]/page.tsx apps/web/app/providers/[code]/[packageCode]/page.tsx apps/web/app/settings/page.tsx apps/web/app/globals.css apps/web/tests/detail-desk.spec.ts
git commit -m "املأ صفحات التفصيل والإعدادات بعرض المكتب"
```
