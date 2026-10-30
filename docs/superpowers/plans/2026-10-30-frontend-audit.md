# خطة معالجة الفحص — 2026-10-30

المصدر: `docs/superpowers/specs/2026-10-30-frontend-audit.md`. مهمة واحدة في كل مرة، بهذا الترتيب. لا تُفتح مهمة قبل أن تُغلق السابقة بتحقق (typecheck + lint + بناء، وللواجهة المتصفح).

## قرارات حُسمت أثناء غياب المالك (2026-10-30)

المالك كان بعيداً سبع ساعات وطلب التنفيذ الكامل بلا توقف، فحُسمت القرارات بأقل المخاطر. للمالك أن يعكس أي منها.

1. **الخطوط:** يبقى Tajawal وIBM Plex Sans Hebrew كما في الكود. تُصحَّح `DESIGN.md` و`pearl-ui.mdc` لتطابق الكود. السبب: `DESIGN.md` نفسه ينص أن اختيار Tajawal «يبقى»، والانتقال لخطوط جديدة تغيير بصري شامل بلا مراجعة بصرية من المالك.
2. **الأنواع المشتركة:** لا حزمة `packages/contract` الآن. لا يمكن التحقق من بناء صور Docker في هذه البيئة (لا وصول إلى Docker)، وكسر النشر أسوأ من نسخ الأنواع. تبقى النسخة اليدوية ويُضاف حارس: اختبار في `apps/api` يثبّت شكل ردود النقاط الأساسية. مؤجَّل إلى أن يتوفر بناء صور.
3. **الأخطاء:** الباك إند يعيد `code` ثابتاً مع `message` العربية (للتوافق). الواجهة تقرر وتترجم من `code` وترجع إلى `message`.
4. **الفرع الافتراضي:** يُسمّى `main` بعد انتهاء كل المهام وتحقق CI، عبر `gh`.
5. **قاعدة البيانات:** المنفذ 5432 نفق ssh لقاعدة غير مملوكة للوكلاء. ممنوع على كل وكيل أي هجرة أو بذر أو كتابة عليها. الاختبارات على مخازن الذاكرة فقط.

## سجل التنفيذ

| موجة | المهام | الوكلاء | الحالة |
|---|---|---|---|
| 1 | T1 T2(إعداد) T3 T4 ‖ T12 ‖ T6 | بنية وأمن، ترقيم، نظام التصميم | T1–T4 وT12 مغلقة. T6 ما زال عند وكيل التصميم |
| 2 | T10 + حذف النصوص والدوال الميتة ‖ T5 + T7 + T8 | عقد الأخطاء، إعادة هيكلة الصفحات | ينتظر |
| 3 | T9 ‖ T11 (اختبارات الباك إند) | تفكيك الصفحات، اختبارات | ينتظر |
| 4 | T11 (سلوكية Playwright) + مراجعة أمنية + Bugbot | | ينتظر |
| 5 | إعادة فحص وتحسين: الرئيسية، التقارير، القوائم، الإدارة | 4 وكلاء | ينتظر |

## جدول المتابعة

يُحدَّث بعد كل مهمة: الحالة، التاريخ، الدليل (أمر أو لقطة)، وما انكشف أثناءها.

| # | المهمة | الحالة | تاريخ الإغلاق | الدليل | ملاحظات مكتشفة |
|---|---|---|---|---|---|
| T1 | بذرة الحسابات التجريبية لا تعمل في الإنتاج | مغلق | 2026-10-30 | 21 suite / 136 اختبار api. البذرة مغلقة إلا بعلمين | لا أداة لإنشاء أول صاحب فرع في الإنتاج |
| T2 | إصلاح `lint` ومنع الضجيج المولَّد | مغلق جزئياً | 2026-10-30 | `.next-*` في ignores. api eslint نظيف | 3 تحذيرات صفحات لوكيل الصفحات، و`check-copy.mjs` لوكيل النصوص |
| T3 | CI وسكربتات الجذر وREADME | مغلق | 2026-10-30 | YAML صالح. الدفع يشغّل Actions | e2e غير حاجز عمداً |
| T4 | headers أمنية وfavicon | مغلق | 2026-10-30 | curl: CSP وnonce على كل السكربتات. icon.svg | فحص console بعد الدخول مؤجّل |
| T12 | ترقيم قائمة الأرقام والقوائم المقطوعة (ينفَّذ بعد T4 وقبل T5) | مفتوح | | | |
| T5 | حذف الكود الميت | مفتوح | | | |
| T6 | حسم الخطوط وتوحيد التوكنز | مفتوح، ينتظر قرار 1 | | | |
| T7 | أدوات مشتركة للصفحات (حارس، تحميل، فعل) | مفتوح | | | |
| T8 | توحيد صفحات السجلات والعمليات | مفتوح | | | |
| T9 | تفكيك الصفحات الكبيرة ونقل الـ shell إلى layout | مفتوح | | | |
| T10 | عقد الأخطاء والأنواع المشتركة وتقسيم النصوص | مفتوح، ينتظر قرارين 2 و3 | | | |
| T11 | اختبارات سلوكية وسير الفروع | مفتوح | | | |

الحالات: مفتوح، جارٍ، مغلق، مؤجل. لا مهمة تُغلق بلا عمود «الدليل».

## قواعد تسري على كل البرومتات

- اقرأ `.cursor/rules/work-plan.mdc` و`pearl-ui.mdc` و`content-ui.mdc` و`DESIGN.md` أولاً.
- استعمل `superpowers:writing-plans` لخطة صغيرة قبل التنفيذ، و`superpowers:verification-before-completion` قبل إعلان الإنجاز.
- شريحة واحدة. ما تكتشفه خارجها يُكتب في عمود «ملاحظات مكتشفة» ولا يُنفَّذ.
- لا تغيّر `.topbar` أو `.sidebar` أو `.drawer` أو `.shell-*` بصرياً.
- لا hex في TSX. لا خط جديد. لا `style={{}}` جديدة.
- عند الانتهاء: أعد لي جدولاً من أربعة أعمدة: ما غُيّر، الملفات، أوامر التحقق ونتائجها، ما بقي.

---

## T1 — بذرة الحسابات التجريبية (P0، أمن)

**البرومت:**

```text
المهمة: امنع زرع الحسابات التجريبية (branch/main/agent/pos بكلمة 123456) في بيئة الإنتاج.

الوضع الحالي: apps/api/src/modules/auth/prisma-auth.store.ts تستدعي seedTrialAccountsIfEmpty() كلما كان جدول المستخدمين فارغاً، بلا شرط بيئة. المستودع عام وكلمة السر مكتوبة فيه.

المطلوب:
1. البذرة تعمل فقط حين TRIAL_SEED=true صراحةً، ولا تعمل أبداً إذا NODE_ENV=production حتى لو TRIAL_SEED=true إلا مع TRIAL_SEED_ALLOW_PRODUCTION=true (علم ثانٍ مقصود).
2. إن كان الجدول فارغاً في الإنتاج والبذرة مغلقة: الـ API يقلع ويسجّل سطراً واضحاً أن لا حسابات ولا طريق دخول، ولا ينشئ شيئاً.
3. ضع TRIAL_SEED=true في docker-compose.yml لبيئة التطوير المحلية فقط، وفي ملف مثال .env.example مع شرح سطر واحد.
4. حدّث التوثيق في docs/project-plan.md (قسم التجربة) بما يطابق السلوك الجديد.
5. اختبارات jest: بذرة مفعلة ثم تعمل، مغلقة ثم لا تعمل، production بلا العلم الثاني ثم لا تعمل. تحقق أن trial-boot.http.spec.ts وبقية specs المصادقة ما زالت تمر.

التحقق: npm test --workspace api، ثم أثبت بأمر أن الإقلاع على قاعدة فارغة مع NODE_ENV=production لا ينشئ مستخدمين.
لا تغيّر قواعد الدخول ولا الـ 2FA ولا أي شيء آخر في auth.
```

## T2 — إصلاح `lint` (P0)

```text
المهمة: اجعل npm run lint في apps/web بوابة نظيفة قابلة للربط بـ CI.

الوضع: eslint . يعطي 3825 مشكلة (676 خطأ) كلها من .next-e2e المولَّد. الكود الفعلي يعطي 0 أخطاء و3 تحذيرات.

المطلوب:
1. أضف '.next-e2e/**' و'.next-audit/**' إلى ignores في apps/web/eslint.config.mjs.
2. أصلح التحذيرات الثلاثة: متغير modeName غير المستعمل في app/providers/[code]/[packageCode]/page.tsx، وتحذيرا <img> في app/packages/page.tsx وapp/providers/[code]/page.tsx (الصور data URL مضغوطة محلياً، فاختر: next/image مع unoptimized، أو تعطيل القاعدة سطراً بسطر مع سبب مكتوب. اشرح اختيارك).
3. أزل eslint-disable في app/page.tsx:37 بإصلاح التبعية فعلاً (load داخل useCallback).
4. أضف تحقق lint للـ api أيضاً (apps/api يملك السكربت) وتأكد أنه يمر، وأبلغ بالنتيجة إن فشل دون إصلاح خارج النطاق.

التحقق: npm run lint --workspace web بصفر أخطاء وصفر تحذيرات، npx tsc --noEmit في apps/web.
```

## T3 — CI وسكربتات الجذر وREADME (P0)

```text
المهمة: أنشئ بوابة جودة آلية وسكربتات الجذر.

المطلوب:
1. package.json في الجذر: scripts لـ lint وtypecheck وtest وbuild تشغّل الحزمتين عبر workspaces. أضف engines (node >=22) وملف .nvmrc.
2. .github/workflows/ci.yml: عند push وpull_request، خطوات: npm ci، lint، typecheck (web: tsc --noEmit)، اختبارات api (jest)، build للحزمتين. اختبارات Playwright في job منفصل يمكن تعطيله مؤقتاً إن احتاج متصفحاً غير متاح، واذكر ذلك صراحة.
3. README.md في الجذر بالعربية، قصير: ما هو المشروع، كيف يعمل محلياً (docker compose، الأبواب admin/main/agent/pos على localhost)، السكربتات، بنية المجلدات، وإشارة إلى DESIGN.md وdocs/superpowers.
4. .env.example في الجذر بكل المتغيرات التي يقرؤها docker-compose.yml وapps، بلا قيم سرية حقيقية.
5. لا تغيّر أي كود تطبيق.

التحقق: شغّل سكربتات الجذر محلياً وأرفق نتائجها. تحقق من صحة YAML. بعد الدفع افتح تبويب Actions على GitHub وأبلغ بنتيجة أول تشغيل.
```

## T4 — headers أمنية وfavicon (P0)

```text
المهمة: أضف headers أمنية أساسية وأيقونة موقع إلى apps/web.

المطلوب:
1. في next.config.mjs أضف headers() لكل المسارات: X-Content-Type-Options: nosniff، Referrer-Policy: strict-origin-when-cross-origin، X-Frame-Options: DENY، Permissions-Policy مقيّدة، وContent-Security-Policy تعمل مع: next/font، السكربت المضمّن في components/bootstrap.tsx (استعمل nonce أو hash، لا unsafe-inline إلا إن تعذّر وبسبب مكتوب)، صور data: في صور الشركات، واتصال fetch إلى /api فقط.
2. أضف app/icon.svg (أو favicon.ico) من الهوية الموجودة (البصمة الحمراء/الحبر) بدون ألوان hex جديدة خارج الشعار.
3. جرّب CSP في المتصفح على: /login، /، /packages (الصور)، حوار، ومبدّل الثيم. لا يجوز أن يظهر خطأ CSP واحد في الـ console.
4. وثّق في README سطراً عن CSP وكيف تضيف مصدراً.

التحقق: npx tsc، npm run lint، next build، ثم المتصفح: لقطة لكل شاشة مذكورة وقائمة أخطاء console فارغة.
```

## T12 — ترقيم قائمة الأرقام والقوائم المقطوعة (P0 وظيفي)

```text
المهمة: اجعل قائمة الأرقام ترى كل أرقام الحساب، وأخبر المستخدم حين تكون أي قائمة مقطوعة.

الوضع المقيس: GET /office/lines يعيد 30 سطراً و nextCursor (office.service.ts:331-375). api.officeLines() في apps/web/lib/api.ts لا يرسل cursor ولا q. app/numbers/page.tsx لا يقرأ nextCursor، ويفلتر الحالة والرزمة والبحث على الـ 30 المحمّلة فقط. audit/accounting/ledger مقطوعة عند 80، tasks عند 40، تقارير 30-80، بلا أي إشارة في الواجهة.

المطلوب (ابدأ بكتابة plan قصير ثم نفّذ):
1. api.officeLines({ q, status, packageCode, cursor }) يرسل المعاملات. نوع الرد يضم nextCursor: string | null.
2. الباك إند: أضف status وpackageCode كمعاملين لـ lines (فلترة في الاستعلام وليس في العميل)، واجعل q يطابق المسافات كما تفعل الواجهة. حافظ على take 31 والترتيب. اكتب اختبار jest: 70 سطراً تُرجَع على 3 صفحات بلا تكرار ولا فقد، والفلتر يعمل عبر الصفحات.
3. numbers/page.tsx: البحث والفلاتر ترسل للخادم (debounce 300ms للبحث)، وزر «تحميل المزيد» (نص في Copy بالثلاث لغات) أسفل الجدول يظهر فقط حين nextCursor غير null، ويبقى الفلتر نشطاً. فلاتر الحالة والرزمة تعدّ من الخادم لا من الصفوف المحمّلة (قائمة خيارات الرزم من officePackages).
4. القوائم المقطوعة (audit، accounting، operations/ledger، tasks): إما nextCursor وتحميل المزيد بالنمط نفسه، أو سطر «يُعرض آخر N» بنص مترجم داخل .pane. اختر الأول لـ audit وaccounting وledger، والثاني لـ tasks إن لم يكن له cursor. اشرح اختيارك.
5. إن لم تكن T7 وT8 قد نُفّذتا فلا تبنِ مكوناً جديداً مشتركاً، اجعل التعديل موضعياً، وسجّل في ملاحظات المتابعة أن المكوّن سيُستخرج في T7.

التحقق: jest للباك، tsc، lint، Playwright (أضف اختباراً بـ mock يعيد 31 سطراً ثم 5: يظهر زر المزيد، يضغطه، يصير 36). ثم المتصفح على بيانات حقيقية: أنشئ 35 رقماً (سكربت بذرة محلي في docker فقط) وأثبت بلقطة أن الرقم 35 قابل للوصول والبحث.
لا تغيّر ترتيب الأعمدة ولا مظهر الجدول. الزر يستعمل نمط .secondary الموجود.
```

## T5 — حذف الكود الميت

```text
المهمة: احذف الكود الميت المؤكد في apps/web (والملفات الجذرية)، بلا أي إعادة هيكلة.

القائمة المؤكدة (تحقق من كل بند بالبحث قبل حذفه، وإن وجدت استعمالاً فاتركه واكتبه في ملاحظاتك):
1. مسارات إعادة التوجيه: app/plans، app/staff، app/wallets، app/ledger/[scope]. واترك app/reports/page.tsx إن أبقيته احتياطاً وأخبرني.
2. دوال api.ts بلا مستهلك: disableTwoFactor، officeWallets، chargeLine. لا تحذف مسارات الباك إند، فقط سجّل في الملاحظات أن GET wallets وPOST lines/:id/charge صارت بلا واجهة لأقرر.
3. 34 مفتاح نص يتيم من نوع Copy ومن اللغات الثلاث: loginKicker settingsKicker navAccount navBranch navWallets navStaff rolesLede usersLede reportProvidersLede reportConsumptionLede reportFundingLede reportTasksLede reportNumbersLede reportOperationsLede lockedHint walletsTitle walletsLede plansLede numbersLede numbersPosLede providersLede tasksLede staffTitle staffLede reportsTitle reportsLede morning evening accountingLede backCompanies operationsLede auditLede auditProviderLede filters.
4. 22 كلاس CSS بلا استعمال: account-ops filter-count filter-toggle hero hero-greet hero-role locked mini muted neutral notice-dot notice-pop op-block op-blocks op-fields ops-row ops-toggle sr-only tabular topbar-brand user-btn user-copy. استثناء: لا تحذف sr-only قبل أن تتأكد أنه لا يُحقن ديناميكياً. ولا تحذف op-blocks قبل أن تحدّث content-ui.mdc ليذكر ذلك.
5. components/toast.tsx ومزود Toasts في layout.tsx (لا أحد يستدعي useToasts).
6. exports بلا مستورد: RowIcon، THEME_KEY/LOCALE_KEY/Theme (اجعلها غير مصدّرة)، وأنواع api.ts: Next, ApiResult, AccountProfile, WalletRow, ActivateBody, ReportRow (إن كانت مستعملة داخل الملف فقط فاجعلها غير مصدّرة).
7. من جذر المستودع: four-layers.html وملفات test-results وtsconfig.tsbuildinfo من التتبع إن كانت متتبَّعة، وأضفها إلى .gitignore. dump.rdb مستثنى سلفاً.
8. أعد التحقق بالسكربت: لا مفتاح نص ولا كلاس ولا export يتيم بعد الحذف.

التحقق: tsc، lint، next build، npm test في web (Playwright)، والمتصفح على 4 صفحات رئيسية. أرفق عدد الأسطر قبل/بعد.
لا تدمج دوال أو تنقل ملفات في هذه المهمة. حذف فقط.
```

## T6 — حسم الخطوط وتوحيد التوكنز (ينتظر قرار 1)

```text
المهمة: أنهِ التعارض بين DESIGN.md وpearl-ui.mdc وcontent-ui.mdc وlayout.tsx، ثم انقل CSS إلى توكنز --rd-* فقط.

القرار المعتمد للخطوط: [اكتب هنا: "Tajawal يبقى" أو "انتقال إلى IBM Plex Sans Arabic + Noto Kufi Arabic + Inter Tight"].

المطلوب:
1. اجعل الوثائق الثلاث والكود يقولون الشيء نفسه. إن كان القرار الانتقال: حمّل الخطوط عبر next/font فقط، خط الأرقام للأرقام والمبالغ والتواريخ والهواتف مع font-variant-numeric: tabular-nums، ولا رابط Google جديد.
2. أكمل جدول التوكنز في DESIGN.md بما هو في CSS: --rd-surface-3، --rd-line-soft، --rd-ink-2، --rd-faint، --rd-radius-lg، --rd-shadow-pop، وصحّح --rd-field مقابل --rd-field-border (اختر اسماً واحداً في الاثنين).
3. استبدل كل استعمال legacy (--surface, --line, --ink, --ink-2, --ink-3, --ink-4, --accent, --accent-soft, --accent-fg, --bad, --bad-bg, --good, --good-bg, --shadow-card, --shadow-pop, --focus-ring) بمقابله --rd-* وهو 240 موضعاً، ثم احذف كتلة الأسماء المستعارة. --accent-2 ولون focus-ring المضمّن يصيران توكنز --rd-* في الثيمين.
4. أزل 3 !important ما أمكن، وحوّل الخصائص الفيزيائية الثلاث (left/right) إلى منطقية، وأي hex/rgba خارج كتلة التوكنز إلى توكن.
5. قسّم globals.css إلى ملفات مستوردة في ترتيب ثابت: tokens، base، shell، desk (page/pane/table/badge/filter)، dialog، auth، doors. بلا تغيير بصري.
6. أزل style={{ padding: 14 }} من .empty (7 مواضع) بكلاس .empty في CSS.

التحقق: لقطات قبل/بعد لـ 6 شاشات (دخول، الرئيسية، المستخدمون، الأرقام، حوار، الرزم) في الثيمين وفي ar وen وعرضي 1280 و390. الفرق البكسلي المقبول: صفر إلا حيث غيّر الخط عمداً. واكتب قائمة الاختلافات.
لا تغيّر .topbar/.sidebar/.drawer/.shell-* بصرياً، يجوز لك تغيير أسماء المتغيرات داخلها فقط.
```

## T7 — أدوات مشتركة للصفحات

```text
المهمة: استخرج الأنماط المنسوخة بين الصفحات إلى أدوات مشتركة، وطبّقها على ثلاث صفحات فقط كبداية (accounting، audit، providers) كي نتحقق من الشكل قبل التعميم.

الأنماط (قياس الفحص): load/setError/setLoaded منسوخ في 14 صفحة، setError(apiText(...)) 44 موضعاً، حارس الطبقة window.location.replace('/') في 5 صفحات، الفراغ والجدول المنسوخان.

المطلوب:
1. lib/use-load.ts: hook يأخذ دالة جلب ويعيد { data, error, loaded, reload } ويترجم الخطأ عبر apiText ويلغي الاستجابة المتأخرة بعد التفكيك.
2. lib/use-action.ts: hook للأفعال: يعيد { run, busy } ويضبط setError('')/setNote('')/busy، ويستدعي onDone (reload) عند النجاح، ويعرض الخطأ مترجماً. يغني عن سلسلة setBusy اليدوية.
3. components/require-layer.tsx (أو hook useRequireLayer(['branch'])): حارس واحد يحوّل إلى '/' عبر router.replace وليس window.location، ويعيد allowed. لا رسم للمحتوى قبل أن يُحسم.
4. components/data-table.tsx: غلاف رقيق فوق .sheet و.data يأخذ أعمدة { key, header, num?, render } وصفوفاً وحالة تحميل وفراغ، ويضيف class="num" ورأس row-actions تلقائياً. لا نمط جدول جديد: يخرج الـ markup نفسه المعتمد في content-ui.mdc.
5. components/empty.tsx: .empty داخل .pane بلا style مضمّنة.
6. اكتب اختبار وحدة أو Playwright لكل أداة.
7. طبّق على accounting وaudit وproviders فقط، وتأكد أن الـ DOM الناتج مطابق للقديم (قارن innerHTML المطبَّع).

التحقق: tsc، lint، اختبارات Playwright الحالية (lists-desk وdesk-system)، ولقطات لثلاث الصفحات قبل/بعد. أبلغ بعدد الأسطر المحذوفة من كل صفحة.
لا تطبّق على بقية الصفحات الآن. هذا في T8 وT9.
```

## T8 — توحيد صفحات السجلات والعمليات

```text
المهمة: ادمج المتشابه بعد أن أثبتت T7 أدواتها.

1. accounting وaudit وoperations: ثلاث قوائم سجل بالبنية نفسها. اصنع مكوناً LedgerList (أو ثلاث تعريفات أعمدة فوق DataTable) بحيث تبقى الصفحات الثلاث والمسارات كما هي، لكن الجلب والفلاتر والفراغ والسكيلتون في مكان واحد. لا تغيّر الأعمدة ولا الفلاتر ولا عناوين الصفحات.
   اقتراح اختياري للباك إند: وثّق في الملاحظات أن /office/audit و/office/accounting و/office/ledger/:scope يمكن أن تصير مورداً واحداً لاحقاً، ولا تغيّر الباك إند الآن.
2. numbers وnumbers/[id]: قائمة عمليات الرقم (extend، unfreeze، reactivate، disconnect، freeze، sim، rename، switch) تُبنى مرتين. استخرج lineActions(line, verdict, run, t) واحدة تعيد عناصر RowMenu، واستعملها في الصفحتين. صفحة التفصيل تعرض المزيد منها عبر الأبواب نفسها.
3. noticeAction في office-shell.tsx نسخة ناقصة من actionName في desk.tsx. احذفها واستعمل actionName.
4. نقل markOf وhueOf (packages) وcompactImage (providers/[code]) إلى lib/company-mark.ts مع اختبار وحدة.
5. تقرير reports/[kind]: أربعة جداول في ملف واحد. حوّلها لتعريفات أعمدة على DataTable.

التحقق: Playwright الحالي كله، ولقطات قبل/بعد لكل صفحة تغيّرت، وقارن صفاً بصف أن الأعمدة والعناوين والترتيب والصلاحيات ظاهرة كما كانت لكل طبقة (branch/main/agent/pos).
```

## T9 — تفكيك الصفحات الكبيرة ونقل الـ shell

```text
المهمة: فكّك الصفحات الضخمة، وانقل OfficeShell من داخل كل صفحة إلى layout واحد.

1. أنشئ مجموعة المسارات app/(office)/layout.tsx تحمل OfficeShell مرة واحدة، وانقل كل مسارات المكتب إلى داخلها (login وpassword وtwo-factor تبقى خارجها). Desk يتخلى عن لفّ OfficeShell ويبقى رأس الصفحة وPageAlert فقط. المطلوب أن لا يُعاد تركيب الشريط الجانبي ومؤقت الإشعارات (20 ثانية) عند التنقل، وأن تبقى حالة الطي.
2. users/page.tsx (417 سطراً و17 useState): قسّمه إلى UsersTable، وحوار لكل عملية (FundDialog، CeilingDialog، TransferDialog، PasswordDialog، ConfirmDialog لـ freeze/enter/delete)، وCreateUserDialog. كل حوار يملك حالته. الصفحة تنسّق فقط.
3. settings/page.tsx (12 useState): قسّمه إلى ProfileSection وPasswordSection وSessionsSection وTwoFactorSection.
4. packages/page.tsx: افصل PosCatalog (معالج البيع) في components/pos-catalog.tsx عن جدول الفرع.
5. numbers/page.tsx: حوار التفعيل في مكون.
6. الأيقونات: اجمع مجموعتي office-shell وrow-menu في components/icons.tsx.

التحقق: لا فرق بصري ولا سلوكي. لقطات قبل/بعد، وPlaywright، وإثبات في المتصفح أن التنقل بين /users و/numbers لا يعيد إنشاء مؤقت الإشعارات (تتبع طلبات /office/notices في Network). أبلغ بحجم كل ملف قبل/بعد.
```

## T10 — عقد الأخطاء والأنواع المشتركة وتقسيم النصوص (ينتظر قرارين 2 و3)

```text
المهمة: أزل الاعتماد على نصوص عربية حرفية بين الباك إند والواجهة، وشارك الأنواع، وقسّم النصوص.

القرارات المعتمدة: [اكتب: الأخطاء = code ثابت + message / الأنواع = حزمة packages/contract أو غيرها].

1. الباك إند: OfficeFailure وبقية الاستثناءات تعيد { code, message } حيث code ثابت (مثل LOGIN_REQUIRED، DOOR_MISMATCH، INVALID، BALANCE_CEILING...). أبقِ message كما هي للتوافق.
2. الواجهة: api.ts يقرر إعادة التوجيه إلى /login من code وليس من النص. apiText يترجم من code إلى مفتاح في Copy، ويرجع إلى message إن لم يعرف الكود. غطِّ كل رسائل office.service.ts (14) وأبلغ أي رسالة بلا ترجمة en/he (الفحص وجد 5: اسم الدخول مستخدم، الرزمة متوقفة، بدّل الرزمة أولاً، صفّر المحفظة قبل النقل، متوقف على هذه الرزمة).
3. الأنواع المشتركة: أنشئ الآلية المعتمدة بحيث يستورد web الأنواع التي يرجعها api (HomePayload، LineRow، TaskRow...) من مصدر واحد، وأضف خطوة بناء تفشل إذا اختلفا.
4. النصوص: قسّم lib/copy.ts إلى ملف لكل لغة (copy/ar.ts، en.ts، he.ts) مع نوع Copy مشتق من ar، وحمّل اللغة الفعّالة فقط (import ديناميكي)، وأبقِ ar افتراضياً لتجنب وميض. قِس حجم First Load JS قبل/بعد على /login و/users.
5. أضف سكربت يفشل إذا بقي مفتاح بلا استعمال أو مفتاح ناقص في لغة.

التحقق: npm test --workspace api، tsc، lint، build، Playwright. أثبت في المتصفح أن خطأ مثل «الرصيد لا يكفي ضمن السقف» يظهر بالإنجليزية والعبرية، وأن انتهاء الجلسة يعيد إلى /login. أرفق قياس الحزمة.
```

## T11 — اختبارات سلوكية وسير الفروع

```text
المهمة: غطِّ المسارات الحرجة بسلوك حقيقي، وثبّت سير الفروع.

1. اختبارات Playwright سلوكية على mock api موسَّع (أو api حقيقي على docker compose للاختبار): تفعيل رقم بنجاح وبفشل (يصير مهمة)، شحن رقم، مهمة تؤخذ وتُغلق، إلغاء مهمة، تمويل محفظة، تغيير سقف، دخول كمستخدم ثم العودة، تبديل رزمة، تجميد حساب. كل واحد يتحقق من النص الظاهر ومن الطلب المرسل.
2. أضف جلسات لكل طبقة (branch/main/agent/pos): ما يظهر في الشريط الجانبي، وما تعيده الصفحات المحجوبة (تحويل إلى /).
3. اختبار وحدات للباك إند على office.service.ts: قواعد السعر والسقف والنقل (مرجعها docs/project-plan.md). اتبع superpowers:test-driven-development: اكتب الاختبار الذي يفشل أولاً لكل قاعدة.
4. سير الفروع: سمِّ الفرع الافتراضي main، وادمج feature/login عبر PR، وفعّل حماية main (CI أخضر مطلوب) من إعدادات GitHub أو بأمر gh.
5. أضف docs/superpowers/gates/progress.md سطراً لكل مهمة هنا.

التحقق: كل الاختبارات خضراء في CI. أرفق رابط تشغيل Actions وتقرير التغطية للقواعد المالية.
```

---

## مراجعة الإطلاق (بعد T1 إلى T11)

قبل أي إعلان إطلاق:

1. `review-security` على كل التغييرات.
2. `review-bugbot` على كل التغييرات.
3. جولة متصفح كاملة لكل بوابة وكل طبقة، في ar وen وhe، فاتح وداكن، 1280 و390.
4. قياس: First Load JS، وزمن فتح `/` و`/numbers` مع 10 آلاف سطر (مطلب docs/project-plan.md: 100 ألف رقم لحساب واحد). الترقيم نفسه في T12، وهذا القياس يتحقق من أنه يصمد.
5. تأكيد أن `docker compose up` على جهاز نظيف يقلع بلا بذرة تجريبية إلا بعلم صريح.

## بنود مفتوحة لم تدخل مهمة

- تفكيك `office.service.ts` (1688 سطراً).
- إدارة الصور المرفوعة: `Company.image` نص في قاعدة البيانات يحمل data URL مضغوط (حد 200 KB من الواجهة)، ويُرسل مع كل رد `providers` و`packages`. يلزم تخزين ملفات أو حد أصغر.
- `rewrites()` في `next.config.mjs` يجمّد وجهة الـ API وقت البناء.
