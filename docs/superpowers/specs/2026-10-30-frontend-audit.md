# فحص شامل للواجهة والبنية — 2026-10-30

فحص قراءة فقط. لم يُغيَّر أي كود. كل رقم هنا قيس من الشيفرة يوم الفحص. المهام والبرومبتات وجدول المتابعة في `docs/superpowers/plans/2026-10-30-frontend-audit.md`.

## الحالة العامة

| فحص | النتيجة |
|---|---|
| `tsc --noEmit` (web) | يمر، صفر أخطاء |
| `eslint` على `app components lib tests` | صفر أخطاء، 3 تحذيرات |
| `npm run lint` (كما هو في السكربت) | 3825 مشكلة، لأن `.next-e2e` غير مستثنى. الضجيج من ملفات مولّدة |
| `next build` | ينجح. 21 مسار. كلها `ƒ` ديناميكية (الـ layout يقرأ `headers()`) |
| First Load JS | 103 kB مشترك، والصفحات بين 117 و131 kB. الـ middleware 34 kB |
| حجم الواجهة | 8192 سطراً: `globals.css` 1710، `copy.ts` 1130، `office-shell.tsx` 434، `users/page.tsx` 417 |

الأساس سليم: types صارمة، الواجهة لا تحمل منطق صلاحيات، و`Dialog` و`RowMenu` و`Desk` موحدة. المشاكل في ثلاثة أماكن: ما يخص الإطلاق، التكرار بين الصفحات، وتعارض وثائق التصميم مع الكود.

## 1. ما يمنع الإطلاق (P0)

1. **حسابات تجريبية بكلمة سر 123456 تُزرع في الإنتاج.** `PrismaAuthStore.seedTrialAccountsIfEmpty()` تعمل كلما كان جدول المستخدمين فارغاً، بلا شرط على البيئة. أول إقلاع على قاعدة إنتاج فارغة ينشئ `branch` صاحب الفرع، بكلمة `123456`، ومستثنى من التحقق الثنائي. والمستودع عام الآن وكلمة السر مكتوبة فيه.
2. **`npm run lint` غير صالح كبوابة.** يفشل بـ 676 خطأ من `.next-e2e` المولَّد. لا يمكن ربطه بـ CI قبل إصلاحه.
3. **لا CI ولا README ولا سكربتات في الجذر.** لا شيء يمنع دمج كود يكسر البناء. `package.json` في الجذر بلا `scripts`، ولا `engines` ولا `.nvmrc`.
4. **الأخطاء تُترجم بمطابقة نص عربي حرفي.** `api.ts` يقارن `message === 'يلزم تسجيل الدخول'` ليقرر تحويل الدخول، و`translateApi` يطابق 20 رسالة فقط. من 14 رسالة في `office.service.ts` خمس غير مترجمة للإنجليزية والعبرية. تغيير كلمة في الباك إند يكسر إعادة التوجيه بصمت.
5. **لا headers أمنية** في `next.config.mjs` (CSP، `X-Frame-Options`، `Referrer-Policy`)، ولا `public/` فيه favicon.
6. **قائمة الأرقام تعرض أول 30 رقماً فقط.** `GET /office/lines` يعيد 30 سطراً مع `nextCursor`، و`api.officeLines()` لا يرسل `cursor` ولا `q`، والصفحة لا تقرأ `nextCursor` إطلاقاً. فمن يملك 31 رقماً أو أكثر لا يرى الباقي، وفلاتر الحالة والرزمة والبحث بالرقم تعمل على الـ 30 المحمّلة فقط. وهذا يناقض مطلب `project-plan.md` (حساب واحد قد يملك مئة ألف رقم). سقوف الباك إند الأخرى ثابتة بلا ترقيم: `audit` و`accounting` و`ledger` 80، `tasks` 40، التقارير 30 إلى 80. فالمستخدم لا يعلم أن القائمة مقطوعة.
7. **حماية الصفحات في العميل فقط.** خمس صفحات تكرر `window.location.replace('/')` داخل `useEffect`. الباك إند يرفض فعلاً، فالخطر ليس تسريب بيانات، لكن الصفحة تُرسم ثم تُطرد، وكل صفحة جديدة قد تنسى الحارس.

## 2. التكرار بين الصفحات

الأرقام عبر 14 صفحة تعرض بيانات:

| النمط | العدد |
|---|---|
| `const load = useCallback(async () => { ... setError(apiText(...)) ... setLoaded(true) })` منسوخ يدوياً | 14 |
| `setError(apiText(result.message))` | 44 موضعاً في 15 ملفاً |
| `const result = await api.x(); if (!result.ok) ...` | 33 |
| حارس الطبقة `window.location.replace('/')` | 5 صفحات |
| `<table className="data">` مكتوب باليد | 20 جدولاً في 14 ملفاً |
| `style={{ padding: 14 }}` على `.empty` | 7 مواضع (الفراغ يجب أن يكون في CSS) |
| سلسلة `setError('') ; setNote('') ; setBusy(true) ... setBusy(false)` | `users` و`packages` و`settings` و`providers/*` |
| `layerName` و`actionName` و`noticeAction` | `noticeAction` في `office-shell.tsx` نسخة ناقصة من `actionName` في `desk.tsx` |

صفحات متشابهة في العملية والعرض:

- **`accounting` و`audit` و`operations`**: ثلاث قوائم سجل بالبنية نفسها (filter-bar، جدول، empty). الفرق في الأعمدة والفلتر فقط. `operations` تستعمل `api.officeLedger` والاثنتان الأخريان endpoint خاص لكل منهما. وفي الباك إند ثلاثة مسارات: `audit` و`accounting` و`ledger/:scope`.
- **`packages` و`providers` و`providers/[code]` و`providers/[code]/[packageCode]`**: أربع شاشات لسلسلة واحدة (شركة، رزمة، تسعير). `packages/page.tsx` فيه مكونان غير مرتبطين: `PosCatalog` (معالج بيع لنقطة البيع) وجدول الفرع.
- **`numbers` و`numbers/[id]`**: قائمة عمليات الرقم (`extend`, `unfreeze`, `reactivate`, `disconnect`) مبنية في الصفحتين كل واحدة على حدة.
- **`users/page.tsx`**: مكون واحد يحمل سبع عمليات (`fund`, `ceiling`, `transfer`, `password`, `freeze`, `enter`, `delete`) و17 `useState`. و`packages` 17، و`numbers` 16، و`numbers/[id]` 14.
- **`settings/page.tsx`**: 12 `useState` وست استدعاءات `api` في مكون واحد: بروفايل، كلمة سر، جلسات، تحقق ثنائي.
- **`compactImage`** (ضغط صورة الشركة) معرّفة داخل `providers/[code]/page.tsx`. و`markOf` و`hueOf` داخل `packages/page.tsx`. ثلاثتها أدوات عامة.

## 3. الكود الميت

مؤكد بالبحث:

- **مسارات إعادة توجيه فقط، لا أحد يربط بها:** `app/plans`, `app/staff`, `app/wallets`, `app/ledger/[scope]`. أربعة ملفات. و`app/reports/page.tsx` تعيد توجيه إلى `/reports/consumption` والشريط الجانبي يربط بالأنواع مباشرة، فهي احتياط فقط.
- **دوال `api` بلا مستهلك:** `disableTwoFactor`, `officeWallets`, `chargeLine`. ومساراتها في الباك إند (`GET wallets`, `POST lines/:id/charge`) تبقى حية بلا واجهة.
- **34 مفتاح نص يتيم** × 3 لغات: `loginKicker settingsKicker navAccount navBranch navWallets navStaff rolesLede usersLede reportProvidersLede reportConsumptionLede reportFundingLede reportTasksLede reportNumbersLede reportOperationsLede lockedHint walletsTitle walletsLede plansLede numbersLede numbersPosLede providersLede tasksLede staffTitle staffLede reportsTitle reportsLede morning evening accountingLede backCompanies operationsLede auditLede auditProviderLede filters`.
- **22 كلاس CSS بلا استعمال:** `account-ops filter-count filter-toggle hero hero-greet hero-role locked mini muted neutral notice-dot notice-pop op-block op-blocks op-fields ops-row ops-toggle sr-only tabular topbar-brand user-btn user-copy`. منها `op-blocks` التي تذكرها `content-ui.mdc` كنمط معتمد ولا صفحة تستعمله.
- **`components/toast.tsx`**: مزود `Toasts` مركّب في `layout.tsx` ولا أحد يستدعي `useToasts()`. و`DESIGN.md` يقول التغذية الراجعة عبر `PageAlert`.
- **exports بلا مستورد:** `RowIcon`, `THEME_KEY`, `LOCALE_KEY`, `Theme`, و types في `api.ts`: `Next`, `ApiResult`, `AccountProfile`, `WalletRow`, `ActivateBody`, `ReportRow`.
- **متغير غير مستعمل:** `modeName` في `providers/[code]/[packageCode]/page.tsx:42`.
- **`eslint-disable` واحد** في `app/page.tsx:37` يخفي تبعية ناقصة.
- **ملفات في جذر المستودع:** `four-layers.html`, `dump.rdb` (مستثنى الآن من git لكنه على القرص), `test-results/`, `tsconfig.tsbuildinfo`, و22 صورة في `docs/visual-review` مرفوعة على مستودع عام.

## 4. نظام التصميم

وثائق التصميم تناقض بعضها:

- `DESIGN.md` يعرّف الخطوط: IBM Plex Sans Arabic للنص، Noto Kufi Arabic للعناوين، Inter Tight للأرقام. ثم في آخر قسم «Inner pages» يقول: «Body type is Tajawal ... That choice stays».
- `pearl-ui.mdc` يقول IBM Plex Sans Arabic، و`content-ui.mdc` يقول Tajawal.
- الكود (`layout.tsx`) يحمّل **Tajawal** و**IBM Plex Sans Hebrew** فقط. لا Noto Kufi ولا Inter Tight. فخط الأرقام «tabular Inter Tight» غير موجود فعلياً.

التوكنز:

- 240 استعمال لتوكنز «legacy» (`--surface`, `--line`, `--ink-3`, `--accent`, `--bad`, ...) مقابل 105 لـ `--rd-*`. الـ legacy أصبحت أسماء مستعارة (`--ink-3: var(--rd-muted)`) فلا ضرر بصري، لكن القاعدة «اللمس يعني الانتقال إلى `--rd-*`» لم تُنفَّذ، والاسمان يعيشان معاً.
- توكنز موجودة في CSS وغائبة عن جدول `DESIGN.md`: `--rd-surface-3`, `--rd-line-soft`, `--rd-ink-2`, `--rd-faint`, `--rd-radius-lg`, `--rd-shadow-pop`. و`DESIGN.md` يسمّي `--rd-field` والكود `--rd-field-border`.
- `--accent-2: #242422` و`#ffffff` معرّفان مباشرة (hex) خارج `--rd-*`. و7 أسطر `rgba/hex` إضافية بعد كتلة التوكنز.
- 3 `!important`، و3 خصائص فيزيائية (`left/right`) في CSS بينما القاعدة منطقية فقط.
- ملف CSS واحد 1710 سطراً بلا تقسيم (shell، desk، dialog، auth، doors).
- 5 `style={{...}}` مضمّنة في TSX (واحدة مبررة: موضع `RowMenu`).

ما هو سليم: لا hex في TSX إطلاقاً، `Dialog` موحد مع فخ تركيز، RTL منطقي، وضع داكن كامل، `prefers-reduced-motion`.

## 5. البنية والعمارة

- **كل الصفحات `'use client'`** وتجلب البيانات داخل `useEffect`. التسلسل: JS ثم `officeMe` ثم بيانات الصفحة. لا كاش ولا إعادة استعمال بين التنقلات، كل زيارة جلب جديد.
- **`copy.ts` 1130 سطراً (42 KB خام)** يضم اللغات الثلاث في ملف واحد، فتصل النصوص الثلاثة لكل صفحة بينما المستخدم يرى لغة واحدة. `Copy` نوع بـ 263 حقلاً مكتوب يدوياً، و34 منها يتيم. وزنه في الحزمة المضغوطة لم يُقَس بعد، وهو بند قياس في مهمة P5.
- **أنواع الـ API مكررة يدوياً.** `lib/api.ts` (367 سطراً) يعيد كتابة أنواع الباك إند باليد. لا حزمة مشتركة، فأي تغيير في الباك إند ينكسر بصمت عند التشغيل لا عند البناء.
- **`OfficeShell` يلفّ كل صفحة من الداخل** (عبر `Desk`)، فيُعاد تركيبه عند كل تنقل: مؤقت الإشعارات كل 20 ثانية يُعاد إنشاؤه، وحالة الطي تُقرأ من `localStorage` من جديد. المكان الصحيح `app/(office)/layout.tsx`.
- **الأيقونات** داخل `office-shell.tsx` (80 سطراً) و`row-menu.tsx` بمجموعتين منفصلتين.
- **الباك إند:** `office.service.ts` 1688 سطراً و51 مساراً في controller واحد. خارج نطاق هذا الفحص لكنه يحدد شكل أي حزمة أنواع مشتركة.
- **الفصل بين الأبواب (`admin/main/agent/pos`)** سليم ومنفّذ بـ `middleware` + `DoorProvider`. يبقى ثغرة: `doors.ts` منسوخ منطقه في الباك (`doors.ts`, `door.middleware.ts`).

## 6. سير العمل (workflow)

- الاختبارات: ثمانية ملفات Playwright، كلها اختبارات **تخطيط وأبعاد** (ارتفاع زر 34px، وجود عنوان). لا اختبار سلوكي لأي مسار مالي أو مهمة أو نقل. الـ mock يجيب 401 على كل شيء عدا الملف الشخصي والجلسات.
- الباك إند 10+ ملفات spec جيدة للمصادقة، ولا spec لـ `office.service.ts` (1688 سطراً) سوى `office-rules` و`office-catalog`.
- `docs/superpowers` فيه 5 specs و5 plans و`gates/progress.md`. القاعدة سليمة (spec ثم plan ثم شريحة)، لكن لا ربط بين الـ plan المنجز وحالته. `docs/qa` و`docs/visual-review` ملفات تقارير بلا ملكية.
- فرع العمل `feature/login` هو الفرع الافتراضي على GitHub، وفيه كل شيء. لا `main`، ولا حماية فرع، ولا PR.

## 7. المهارات اللازمة للإطلاق

| المجال | ما يلزم |
|---|---|
| أمن | مراجعة أمنية (سكربت البذر، headers، CORS، الكوكيز، `enter` كمستخدم آخر) عبر `security-review` |
| جودة تصميم | `frontend-design` لأي لمسة بصرية، مع حسم الخطوط أولاً |
| منهج | `brainstorming` قبل أي ميزة، `writing-plans` قبل كل شريحة، `test-driven-development` للقواعد المالية |
| تحقق | `verification-before-completion` قبل أي ادعاء إنجاز، `systematic-debugging` لأي فشل |
| مراجعة | `requesting-code-review` و`review-bugbot` قبل الدمج |
| بنية | `using-git-worktrees` لأي إعادة هيكلة كبيرة حتى لا تتشابك الشرائح |

## قرارات تنتظر المالك

1. **الخطوط:** نبقى على Tajawal (كما في الكود وفي `content-ui.mdc`) ونصحّح `DESIGN.md` و`pearl-ui.mdc`، أم ننتقل فعلاً إلى IBM Plex Sans Arabic + Noto Kufi + Inter Tight؟ **— مُغلَق:** نبقى على Tajawal (مع IBM Plex Sans Hebrew للعبري)، حسب القرار ٣ في `docs/superpowers/specs/2026-11-01-pearl-rebuild-phase1-shell-home-design.md`.
2. **أنواع الـ API:** حزمة `packages/contract` مشتركة، أم توليد من OpenAPI، أم نبقي النسخ اليدوي مع اختبار عقد؟
3. **الرسائل:** الباك إند يعيد `code` ثابتاً (مثل `E_LOGIN_REQUIRED`) والواجهة تترجم، أم تبقى الرسائل العربية؟
4. **الفرع الافتراضي:** نسمّي `main` وندمج `feature/login` عبر PR؟

## خارج النطاق

- لا تغيير في منطق الباك إند أو قواعد المال.
- لا إعادة تصميم بصري لأي شاشة. الإصلاحات هنا تنظيم وتوحيد.
- الشريط الجانبي والرأس يبقيان كما هما (`content-ui.mdc`).
