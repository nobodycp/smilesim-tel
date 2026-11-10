# Every logged action has a name in the web — plan

Spec: `docs/superpowers/specs/2026-11-10-auth-activity-and-audit-labels.md`. One slice = one commit.

- [x] **A.1 (this commit) API: two actions, three routes.** `apps/api/src/modules/office/activity/activity-log.ts`: add
  `session_rules`, `user_contact`. `apps/api/src/modules/auth/auth.controller.ts`: `recordOwner` in
  `setLayerSessionRules` (`{ action: 'session_rules', subjectKind: 'layer', subjectRef: layer }`),
  `setUserSessionRules` and `setUserContact` (`subjectKind: 'account'`, the login). Specs:
  `auth/session-rules.http.spec.ts`, `auth/user-settings.http.spec.ts` assert one recorded event on success and one
  on refusal. Check: `tsc`, ESLint, `architecture.spec`, those two specs.
- [x] **A.2 (this commit) Web: labels.** `apps/web/lib/copy/{ar,en,he}.ts`: block `auditActions` with all 65 names (owner reviews
  the Arabic wording before commit — list below). `apps/web/components/names.ts` `actionName()` reads
  `t.auditActions[action]` first, then its existing cases. Check: `npm run check:copy`, `npm run typecheck`,
  the audit page in the browser in ar and en.
- [x] **A.3 (this commit) Web: filter from the labels.** `apps/web/features/audit/screens/audit-screen.tsx`: `ACTIONS` becomes the
  keys of `auditActions` in the groups the menu shows today (sign-in, accounts, money, numbers, tasks, catalog,
  providers). e2e `tests/audit*.spec.ts` updated if it pins the list. Check in the browser at phone and desktop
  widths, light and dark.
- [x] **A.4 (this commit) The rule.** `apps/web/scripts/check-copy.mjs`: parse `ACTIVITY_ACTIONS`, fail on a missing or orphan
  label. `.cursor/rules/backend-engineering.mdc` 4.4 and `docs/architecture/{backend,frontend}.md` say so.
  Check: remove one label → `check:copy` fails; restore → passes.

## How it was done (2026-11-10)

The web already names actions with flat copy keys (`actActivate`, …) read by `actionName()`, so the labels were
added the same way (17 new keys in ar / en / he) rather than as a nested `auditActions` block; fifteen actions had
no name, plus the two new ones. The audit filter lists all 65 actions by hand, grouped; `check:copy` fails when an
action the API logs has no name in `actionName()` or no place in the filter, or when the filter lists an action
the API does not log (proved by removing one). The Arabic wording below is what shipped; change it in
`apps/web/lib/copy/ar.ts`.

## Arabic labels to confirm with the owner (A.2)

`addon` عملية إضافية · `ceiling` تعديل السقف · `company_image` صورة الشركة · `company_switch` تبديل الشركة ·
`deduct` استرداد رصيد · `esim` طلب eSIM · `offer` عرض · `package_addon` عملية إضافية للرزمة ·
`package_details` تفاصيل الرزمة · `package_renewals` رزم التجديد · `package_switches` رزم التبديل ·
`passkey_add` إضافة مفتاح مرور · `passkey_remove` حذف مفتاح مرور · `provider_credit` حد ائتمان المزود ·
`provider_esim_price` سعر eSIM للمزود · `provider_matching` إعداد المطابقة · `provider_payment` دفعة للمزود ·
`provider_reconcile` مطابقة كشف · `provider_reconcile_item` بند مطابقة · `provider_statement` كشف المزود ·
`refresh` تحديث الرقم · `role_save` حفظ دور · `transfer` نقل رقم · `session_rules` قواعد الدخول ·
`user_contact` بيانات الاتصال
