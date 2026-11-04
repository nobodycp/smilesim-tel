# الشركات ثم المزودون ثم الرزم — خطة التنفيذ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** قلب الرف من «مزود ثم شركة» إلى «شركة ثابتة ثم مزود ثم رزمة»، مع سعر اشتراك وسعر تجديد، وقائمتين للتجديد والتبديل، وخط يحفظ أسعاره.

**Architecture:** قواعد المال دوال صافية في `office-rules.ts` بلا قاعدة. الحقول الجديدة على `Package` و`Line` تحفظ الاشتراك والتجديد. التفعيل يحصّل الاشتراك، والشحن والتجديد والتبديل تحصّل التجديد. الواجهة تبدأ من `/companies`.

**Tech Stack:** Prisma 7، Nest 12، Jest، Next 16، النصوص في `apps/web/lib/copy/{ar,en,he}.ts`.

## Global Constraints

- الشركات المغلقة: سلكوم، ويكوم، الوها، بليفون، بارتنر، هوت موبايل، رامي ليفي، 019، كلام، سيمفوني، سكاي. لا زر إضافة ولا حذف.
- سكاي الشركة غير مزود اسمه سكاي.
- العرض تعديل `subscription` فقط. لا رزمة باسم «عرض».
- الشحن والتجديد والتبديل تحصّل سعر التجديد كاملًا، لا سعر الاشتراك ولا فرق سعرين.
- رقم موجود لا يأخذ سعر عرض لاحق. الانتقال بالتجديد يحصّل السعر والمدة المحفوظين على الخط. تعديل الكتالوج لا يغيّر خطًا موجودًا.
- من الرزمة يمكن رفع أو خفض سعر التجديد المحفوظ على الأرقام الفعالة: بقاء شهر، أو هدف محفوظ مثل 3 أشهر. الرقم الجديد يتبع الكتالوج.
- التبديل: نفس `companyId` ونفس `providerId` فقط، ومن القائمة المختارة. إيقاف التبديل لا يمس التجديد.
- الرزمة المخفية عن الطلب الجديد تبقى صالحة للشحن والتجديد والتبديل.
- سعر المستخدم المخصص (`PackageOffer`) لا يتغير: `buyPrice` يبقى يغلّف المبلغ بعد اختيار سعر الاشتراك أو التجديد.
- `chainHolds` يسري على مجموعة الاشتراك وعلى مجموعة التجديد كلًا على حدة.
- ممنوع تشغيل أي هجرة أو بذر على المنفذ 5432. ملف الهجرة يُكتب ولا يُطبَّق.
- لا إجراءات على تحديد الأرقام في هذه الخطة. التحديد وتحديد الكل فقط.
- النصوص تُضاف في `ar.ts` و`en.ts` و`he.ts` معًا، ثم `npm run check:copy`.

---

### Task 1: قواعد المال الصافية

**Files:**
- Modify: `apps/api/src/modules/office/office-rules.ts`
- Test: `apps/api/src/modules/office/office-rules.spec.ts`

**Interfaces:**
- Consumes: `Prices` الحالي في `office-rules.ts`
- Produces:

```ts
export type PackageTerms = {
  code: string;
  companyCode: string;
  providerCode: string;
  months: number;
  forSale: boolean;
  subscription: Prices;
  renewal: Prices;
};

export type RenewalTarget = { code: string; months: number; renewal: Prices };

export type LineTerms = {
  packageCode: string;
  months: number;
  subscription: Prices;
  renewal: Prices;
  renewalTargets: RenewalTarget[];
};

export function captureTerms(pkg: PackageTerms, targets: PackageTerms[]): LineTerms;
export function subscriptionDebit(pkg: PackageTerms): number;
export function chargeDebit(line: LineTerms): number;
export function renewStay(line: LineTerms, from: Date): { endsAt: Date; debit: number; terms: LineTerms };
export function renewOnto(line: LineTerms, target: PackageTerms, from: Date):
  | { endsAt: Date; debit: number; terms: LineTerms }
  | { error: 'NOT_A_RENEWAL_TARGET' };
export function switchOnto(
  line: LineTerms,
  current: PackageTerms,
  target: PackageTerms,
  allowedCodes: string[],
  from: Date,
):
  | { endsAt: Date; debit: number; terms: LineTerms }
  | { error: 'SAME_PACKAGE' | 'OTHER_SHELF' | 'NOT_ALLOWED' };
```

`periodEnd` تُنقل إلى `office-rules.ts` وتُحذف نسختها الخاصة في `office.service.ts`. تمديد الأشهر كما هي اليوم: `setUTCMonth`.

- [ ] **Step 1: Write the failing test**

أضف في `office-rules.spec.ts`:

```ts
const sub30 = { branchCost: 30, mainPrice: 30, agentPrice: 30, posPrice: 30, subscriberPrice: 30 };
const renew30 = { ...sub30 };
const sub25 = { ...sub30, branchCost: 25, mainPrice: 25, agentPrice: 25, posPrice: 25, subscriberPrice: 25 };
const renew80 = { branchCost: 80, mainPrice: 80, agentPrice: 80, posPrice: 80, subscriberPrice: 80 };
const sub70 = { ...renew80, branchCost: 70, mainPrice: 70, agentPrice: 70, posPrice: 70, subscriberPrice: 70 };

const month: PackageTerms = {
  code: 'lian-wecom-500', companyCode: 'wecom', providerCode: 'lian',
  months: 1, forSale: true, subscription: sub25, renewal: renew30,
};
const three: PackageTerms = {
  code: 'lian-wecom-500-3m', companyCode: 'wecom', providerCode: 'lian',
  months: 3, forSale: true, subscription: sub70, renewal: renew80,
};
const fiveG: PackageTerms = {
  code: 'lian-wecom-500-5g', companyCode: 'wecom', providerCode: 'lian',
  months: 1, forSale: true, subscription: { ...sub30, posPrice: 39, branchCost: 39, mainPrice: 39, agentPrice: 39, subscriberPrice: 39 },
  renewal: { ...sub30, posPrice: 39, branchCost: 39, mainPrice: 39, agentPrice: 39, subscriberPrice: 39 },
};

it('charges a new number the subscription price and an existing line the saved renewal', () => {
  const line = captureTerms(month, [three]);
  expect(subscriptionDebit(month)).toBe(25);
  expect(chargeDebit(line)).toBe(30);
  expect(line.subscription.posPrice).toBe(25);
  expect(line.renewal.posPrice).toBe(30);
});

it('renews in place at the saved renewal price', () => {
  const line = captureTerms(month, [three]);
  const stayed = renewStay(line, new Date('2026-01-15T00:00:00Z'));
  expect(stayed.debit).toBe(30);
  expect(stayed.terms.packageCode).toBe('lian-wecom-500');
  expect(stayed.endsAt.toISOString()).toBe('2026-02-15T00:00:00.000Z');
});

it('moves onto an allowed package at that package renewal price, never its offer', () => {
  const line = captureTerms(month, [three]);
  const moved = renewOnto(line, three, new Date('2026-01-15T00:00:00Z'));
  expect('debit' in moved && moved.debit).toBe(80);
  expect('terms' in moved && moved.terms.packageCode).toBe('lian-wecom-500-3m');
  expect('terms' in moved && moved.terms.subscription.posPrice).toBe(80);
});

it('refuses a renewal target that was not saved on the line', () => {
  const line = captureTerms(fiveG, []);
  expect(renewOnto(line, three, new Date('2026-01-15T00:00:00Z'))).toEqual({ error: 'NOT_A_RENEWAL_TARGET' });
});

it('switches only inside the same shelf and charges the full renewal price', () => {
  const line = captureTerms(month, []);
  const from = new Date('2026-01-15T00:00:00Z');
  const ok = switchOnto(line, month, three, ['lian-wecom-500-3m'], from);
  expect('debit' in ok && ok.debit).toBe(80);
  expect(switchOnto(line, month, three, [], from)).toEqual({ error: 'NOT_ALLOWED' });
  expect(switchOnto(line, month, month, ['lian-wecom-500'], from)).toEqual({ error: 'SAME_PACKAGE' });
  const other = { ...three, providerCode: 'aren', code: 'aren-wecom-500' };
  expect(switchOnto(line, month, other, ['aren-wecom-500'], from)).toEqual({ error: 'OTHER_SHELF' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace api -- office-rules.spec.ts`
Expected: FAIL, `captureTerms` is not defined.

- [ ] **Step 3: Write minimal implementation**

في `office-rules.ts`:

```ts
export function periodEnd(from: Date, months: number): Date {
  const next = new Date(from.getTime());
  next.setUTCMonth(next.getUTCMonth() + Math.max(1, months));
  return next;
}

export function captureTerms(pkg: PackageTerms, targets: PackageTerms[]): LineTerms {
  return {
    packageCode: pkg.code,
    months: pkg.months,
    subscription: { ...pkg.subscription },
    renewal: { ...pkg.renewal },
    renewalTargets: targets.map((target) => ({ code: target.code, months: target.months, renewal: { ...target.renewal } })),
  };
}

export function subscriptionDebit(pkg: PackageTerms): number {
  return pkg.subscription.posPrice;
}

export function chargeDebit(line: LineTerms): number {
  return line.renewal.posPrice;
}

export function renewStay(line: LineTerms, from: Date) {
  return { endsAt: periodEnd(from, line.months), debit: line.renewal.posPrice, terms: line };
}

export function renewOnto(line: LineTerms, target: PackageTerms, from: Date) {
  const saved = line.renewalTargets.find((item) => item.code === target.code);
  if (!saved) return { error: 'NOT_A_RENEWAL_TARGET' as const };
  const renewal = { ...target.renewal };
  return {
    endsAt: periodEnd(from, target.months),
    debit: renewal.posPrice,
    terms: captureTerms({ ...target, subscription: renewal, renewal }, []),
  };
}

export function switchOnto(line: LineTerms, current: PackageTerms, target: PackageTerms, allowedCodes: string[], from: Date) {
  if (target.code === line.packageCode) return { error: 'SAME_PACKAGE' as const };
  if (target.companyCode !== current.companyCode || target.providerCode !== current.providerCode) return { error: 'OTHER_SHELF' as const };
  if (!allowedCodes.includes(target.code)) return { error: 'NOT_ALLOWED' as const };
  const renewal = { ...target.renewal };
  return {
    endsAt: periodEnd(from, target.months),
    debit: renewal.posPrice,
    terms: captureTerms({ ...target, subscription: renewal, renewal }, []),
  };
}
```

`renewOnto` بعد الانتقال يبدأ الخط على الرزمة الجديدة وتجديده هو سعر تجديدها الحالي. أهداف التجديد التالية تُملأ في Task 5 من روابط تلك الرزمة، لا من هذا الاختبار.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace api -- office-rules.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/office/office-rules.ts apps/api/src/modules/office/office-rules.spec.ts
git commit -m "Add subscription and renewal price rules."
```

---

### Task 2: حقول الرزمة والخط

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261101120000_company_shelf/migration.sql`
- Modify: `apps/api/src/modules/office/office.service.ts` (استيراد `periodEnd` من `office-rules` وحذف النسخة المحلية)

**Interfaces:**
- Consumes: `Prices`
- Produces: أعمدة Prisma

على `Package`:

- `forSale Boolean @default(true)`
- `renewalBranchCost Int`
- `renewalMainPrice Int`
- `renewalAgentPrice Int`
- `renewalPosPrice Int`
- `renewalSubscriberPrice Int`

أعمدة الأسعار الحالية تبقى سعر الاشتراك الأول. `Company.providerId` يُحذف. الشركة لا تتبع مزودًا.

نماذج جديدة:

```prisma
model PackageRenewal {
  id              String  @id @default(uuid())
  packageId       String
  package         Package @relation(fields: [packageId], references: [id])
  targetPackageId String
  target          Package @relation("RenewalTarget", fields: [targetPackageId], references: [id])

  @@unique([packageId, targetPackageId])
}

model PackageSwitch {
  id              String  @id @default(uuid())
  packageId       String
  package         Package @relation(fields: [packageId], references: [id])
  targetPackageId String
  target          Package @relation("SwitchTarget", fields: [targetPackageId], references: [id])

  @@unique([packageId, targetPackageId])
}
```

على `Line`:

- `terms Json` — شكل `LineTerms`. الخطوط القديمة تُملأ في SQL من أسعار الرزمة الحالية بحيث التجديد يساوي الاشتراك إلى أن يُعدَّل أحدهما.

- [ ] **Step 1: Write the migration SQL**

النسخ يملأ التجديد من الأسعار الحالية، و`terms` من تلك الأسعار، و`forSale` من `enabled`. لا يغيّر `PackageOffer`.

- [ ] **Step 2: Generate the client only**

Run: `npm run prisma:generate --workspace api`
Expected: client يتولد. لا `prisma migrate deploy` ولا أي اتصال بـ 5432.

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261101120000_company_shelf/migration.sql apps/api/src/modules/office/office.service.ts
git commit -m "Store subscription and renewal prices on the package and the line."
```

---

### Task 3: الكتالوج على شكل الرف

**Files:**
- Modify: `apps/api/src/modules/office/office-catalog.ts`
- Test: `apps/api/src/modules/office/office-catalog.spec.ts`

**Interfaces:**
- Produces: `export const companies` بالأسماء الإحدى عشرة، و`catalog` يبقى مزودًا ثم شركات ثم رزمًا كبذرة، مع ربط الشركة بالرمز الثابت لا بنسخة لكل مزود.

```ts
export const companies = [
  { code: 'cellcom', name: 'سلكوم' },
  { code: 'wecom', name: 'ويكوم' },
  { code: 'alloha', name: 'الوها' },
  { code: 'pelephone', name: 'بليفون' },
  { code: 'partner', name: 'بارتنر' },
  { code: 'hot', name: 'هوت موبايل' },
  { code: 'rami', name: 'رامي ليفي' },
  { code: '019', name: '019' },
  { code: 'kalam', name: 'كلام' },
  { code: 'symphony', name: 'سيمفوني' },
  { code: 'sky', name: 'سكاي' },
] as const;
```

تصحيح الأسماء داخل البذرة: `سليكوم` تصبح `سلكوم`، و`رمي ليفي` تصبح `رامي ليفي`. كلام وسيمفوني بلا رزم. سعر البذرة الحالي يُنسخ إلى الاشتراك والتجديد معًا. `forSale` يبدأ `true`.

- [ ] **Step 1: Write the failing test**

```ts
expect(companies.map((company) => company.name)).toEqual([
  'سلكوم', 'ويكوم', 'الوها', 'بليفون', 'بارتنر', 'هوت موبايل', 'رامي ليفي', '019', 'كلام', 'سيمفوني', 'سكاي',
]);
expect(catalog.find((provider) => provider.code === 'lian')?.companies.find((company) => company.code === 'wecom')?.packages).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ gb: 500, months: 1, price: 30 }),
    expect.objectContaining({ gb: 500, months: 3, price: 80 }),
  ]),
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace api -- office-catalog.spec.ts`
Expected: FAIL on the company list.

- [ ] **Step 3: Write minimal implementation**

حدّث النوع والكتالوج والاختبار القديم الذي يتوقع `سليكوم` أو عدد 22 إن تغيّر العدد. `packageCode` و`packageName` يبقيان.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace api -- office-catalog.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/office/office-catalog.ts apps/api/src/modules/office/office-catalog.spec.ts
git commit -m "Fix the company shelf names in the wholesale catalog."
```

---

### Task 4: التفعيل والشحن يقرآن الشروط المحفوظة

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts` عند `activate` و`operate` لـ `charge` و`extend`
- Test: `apps/api/src/modules/office/office-terms.spec.ts` (جديد، يستدعي الدوال الصافية عبر غلاف صغير يُستخرج من الخدمة إن لزم)

**Interfaces:**
- Consumes: `captureTerms`, `subscriptionDebit`, `chargeDebit`, `renewStay`, `buyPrice`
- Produces: خط جديد يُخزَّن `terms` من `captureTerms`. الشحن يمرر `line.terms.renewal.posPrice` إلى `buyPrice` لا `package.posPrice`. التمديد يستدعي `renewStay` ويمد `endsAt` ويخصم `debit`.

التفعيل يرفض الرزمة إذا `forSale === false` برمز `PACKAGE_HIDDEN`. الرزمة `enabled === false` تبقى `PACKAGE_DISABLED` كما هي اليوم.

خصم المحفظة يبقى على نقطة البيع كما هو اليوم. المبلغ هو خلية نقطة البيع: اشتراك عند التفعيل، وتجديد عند الشحن والتمديد والتبديل. خلايا الرئيسي والوكيل تُحفظ وتُفحص بـ `chainHolds` ولا يُضاف لها خصم ثانٍ.

في `activate` المبلغ هو سعر الاشتراك `subscriptionDebit`، ثم يُحفظ `captureTerms` على الخط. في `operate` عند `charge` استبدل `line.package.posPrice` بـ `chargeDebit(line.terms)`. في `extend` استدع `renewStay` واستخدم `debit` و`endsAt`. `buyPrice(packageId, posId, fallback)` يبقى بعد اختيار `fallback`.

- [ ] **Step 1: Write the failing test** على غلاف خالص:

```ts
function priced(kind: 'subscription' | 'renewal', terms: LineTerms, offer: number | null) {
  const base = kind === 'subscription' ? terms.subscription.posPrice : terms.renewal.posPrice;
  return offer ?? base;
}
expect(priced('subscription', captureTerms(month, []), null)).toBe(25);
expect(priced('renewal', captureTerms(month, []), null)).toBe(30);
expect(priced('renewal', captureTerms(month, []), 22)).toBe(22);
```

هذا يثبت أن العرض المخصص ما زال يغلّف المبلغ، وأن مصدر الشحن هو التجديد.

- [ ] **Step 2: Run test to verify it fails** ثم **Step 3** اربط `activate` و`charge` و`extend` في `office.service.ts` بهذه المصادر. **Step 4** `npm test --workspace api -- office-terms.spec.ts office-rules.spec.ts` يمر. **Step 5** commit: `Charge and activate from saved line terms.`

---

### Task 5: قائمتا التجديد والتبديل

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts` (`switchPackage`, وإضافة `renewOnto` على مسار `extend` حين يصل `targetCode`)
- Modify: `apps/api/src/modules/office/office.controller.ts`
- Test: `apps/api/src/modules/office/office-rules.spec.ts` (القواعد موجودة من Task 1؛ أضف اختبار خدمة فقط إذا وُجد مستودع وهمي. وإلا يبقى الاختبار الصافي ويُستدعى من الخدمة كما هو)

**Interfaces:**
- Consumes: `renewOnto`, `switchOnto`
- Produces:
  - `PUT /office/packages/:code/renewals` بجسم `{ targets: string[] }` رموز رزم. تُرفض الرزمة نفسها ورمز من مزود أو شركة أخرى بـ `400 INVALID`.
  - `PUT /office/packages/:code/switches` بالجسم نفسه والرفض نفسه.
  - `extend` مع `targetCode`: إن وُجد في `line.terms.renewalTargets` تُستدعى `renewOnto` بالرزمة الهدف الحالية (سعر تجديدها الآن)، ويُستبدل `line.terms` و`packageId`.
  - `switchPackage`: الخصم `switchOnto(...).debit` كاملًا عبر `buyPrice`، لا فرق السعرين. الهدف خارج `PackageSwitch` يعيد `400 INVALID`. الرزمة المخفية (`forSale === false`) تبقى هدفًا مسموحًا إذا كانت في القائمة. وضع التبديل `off` يبقى `OPERATION_DISABLED`. الوضع اليدوي يفتح مهمة كما اليوم، والمبلغ المحفوظ في المهمة هو سعر التجديد.

- [ ] **Step 1: Write the failing test** في `office-rules.spec.ts` يؤكد أن `switchOnto` الناجح يعيد `debit === target.renewal.posPrice` وأن `target.subscription.posPrice` المختلف (70) لا يظهر في `debit`.

- [ ] **Step 2–4: Implement and pass** `npm test --workspace api -- office-rules.spec.ts`

- [ ] **Step 5: Commit** `Renew and switch at the renewal price.`

---

### Task 6: قراءة الرف للإدارة

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts` أضف `companiesShelf`
- Modify: `apps/api/src/modules/office/office.controller.ts` `GET /office/companies`
- Modify: `apps/web/lib/api.ts`

**Interfaces:**
- Produces:

```ts
type Shelf = {
  companies: {
    code: string;
    name: string;
    providers: {
      code: string;
      name: string;
      packages: { code: string; name: string; months: number; forSale: boolean; lines: number; activeLines: number }[];
    }[];
  }[];
};
```

نقطة البيع لا تستقبل هذا المسار. `packages()` الحالي يصفّي `forSale: true` و`enabled: true`، ويخفي `providerName` لغير الفرع كما اليوم.

- [ ] **Step 1–4:** اختبار شكل الرد في `response-shape.spec.ts` لمفتاح `forSale` و`activeLines`. ثم التنفيذ. `npm test --workspace api -- response-shape.spec.ts`

- [ ] **Step 5: Commit** `Expose the company shelf to the branch.`

---

### Task 7: شاشات الإدارة

**Files:**
- Create: `apps/web/app/companies/page.tsx`
- Create: `apps/web/app/companies/[code]/page.tsx`
- Create: `apps/web/app/companies/[code]/[provider]/page.tsx`
- Modify: `apps/web/app/providers/[code]/[packageCode]/page.tsx` (الأسعار قائمتان، نظرة عامة، كشف أرقام بتحديد، قائمتا التجديد والتبديل)
- Modify: `apps/web/app/page.tsx` رابط الفرع من `/providers` إلى `/companies`
- Modify: `apps/web/lib/copy/ar.ts`, `en.ts`, `he.ts`
- Test: `apps/web/tests/tools-pages.spec.ts`

**Interfaces:**
- Consumes: `GET /office/companies` و`PUT` التجديد والتبديل من Task 5 و6

داخل الرزمة تبويب أسعار فيه حقول الاشتراك الخمسة وحقول التجديد الخمسة. نظرة عامة سطران: العدد، والفعال. جدول الأرقام من خطوط هذه الرزمة مع خانة تحديد في الرأس. لا أزرار على التحديد.

- [ ] **Step 1: Write the failing test** في `tools-pages.spec.ts`: دخول الفرع إلى `/companies` يستدعي `GET /companies`. الوكيل لا يستدعيه.

- [ ] **Step 2–4:** التنفيذ ثم `npm run check:copy` و`npx playwright test tests/tools-pages.spec.ts` من `apps/web`.

- [ ] **Step 5: Commit** `Open the branch shelf from companies.`

---

### Task 8: إعادة تسعير التجديد على الأرقام الفعالة

**Files:**
- Modify: `apps/api/src/modules/office/office-rules.ts` إن لم تُضف `repriceRenewal` في إصلاح Task 1
- Modify: `apps/api/src/modules/office/office.service.ts`
- Modify: `apps/web/app/providers/[code]/[packageCode]/page.tsx`

**Interfaces:**
- Produces: `repriceRenewal(line, which, posPrice)` حيث `which` هو `{ kind: 'stay' }` أو `{ kind: 'target', code }`. تستبدل `posPrice` في التجديد المحفوظ فقط. المدة لا تتغير. الكتالوج لا يتغير.
- `POST /office/packages/:code/reprice-renewal` بجسم `{ which: 'stay' | string, posPrice: number }` يطبّق على خطوط الرزمة ذات `status === 'active'` فقط.

- [ ] **Step 1:** اختبار: خط محفوظ تجديده 30 وهدفه 80. بعد `repriceRenewal` للهدف إلى 70، `renewOnto` يخصم 70 والكتالوج ما زال 80. بعد إعادة البقاء إلى 40، `chargeDebit` يصير 40.
- [ ] **Step 2–4:** التنفيذ والاختبار `office-rules.spec.ts`.
- [ ] **Step 5:** Commit `Reprice saved renewal on active lines.`

## تغطية المواصفة

| قسم المواصفة | المهمة |
|---|---|
| الشركات الإحدى عشرة | Task 3 |
| مزود داخل شركة، رزم متعددة | Task 2 و3 |
| ظاهرة أو مخفية | Task 2 `forSale`، Task 4 يرفض التفعيل، Task 6 يصفّي البيع |
| اشتراك وتجديد على السلسلة | Task 1 و2 |
| التجديد سعر أو رزمة | Task 1 `renewStay` / `renewOnto`، Task 5 |
| التبديل نفس الرف وسعر التجديد | Task 1 `switchOnto`، Task 5 |
| ما يحفظه الخط | Task 2 `terms`، Task 4 |
| الشاشات والنظرة والكشف | Task 6 و7 |
| سعر المستخدم المخصص بلا تغيير | Task 4 يبقي `buyPrice` |
| خارج العمل: إجراءات التحديد، إعادة التسعير، إضافة شركة | لا مهمة |
