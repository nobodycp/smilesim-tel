# Every logged action has a name in the web, and the last three auth writes are logged — spec

Review 2026-11-10, A6 (rest). API and web together; small.

## Today (commit 314d290)

- `ACTIVITY_ACTIONS` (`apps/api/src/modules/office/activity/activity-log.ts`) lists 63 names and `@Activity()`
  accepts only those. The web's audit filter (`apps/web/features/audit/screens/audit-screen.tsx` `ACTIONS`) lists
  40. These 23 are logged but cannot be filtered, and `actionName()` (`apps/web/components/names.ts`) has no label
  for most of them: `addon`, `ceiling`, `company_image`, `company_switch`, `deduct`, `esim`, `offer`,
  `package_addon`, `package_details`, `package_renewals`, `package_switches`, `passkey_add`, `passkey_remove`,
  `provider_credit`, `provider_esim_price`, `provider_matching`, `provider_payment`, `provider_reconcile`,
  `provider_reconcile_item`, `provider_statement`, `refresh`, `role_save`, `transfer`.
- Three owner writes in `/auth` record nothing: `PATCH session-rules/:layer`,
  `PATCH users/:loginName/session-rules`, `PATCH users/:loginName/contact`.

## Decisions

1. Two new action names: `session_rules` (subject: the layer, or the account) and `user_contact` (subject: the
   account). Recorded through the controller's existing `recordOwner`.
2. Every action name has a label in ar / en / he under one copy block, `auditActions.<name>`, and `actionName()`
   reads from it. The existing per-action keys it uses today (`actActivate`, …) stay for the screens that use them.
3. The web's filter list is generated from the labels (the keys of `auditActions`), grouped as today, so it cannot
   fall behind again.
4. **A rule so it stays true:** `apps/web/scripts/check-copy.mjs` reads `ACTIVITY_ACTIONS` from the API file (as it
   already reads `ERROR_MESSAGES`) and fails when a name has no `auditActions` label in a language, or a label has
   no action. Rule added to `.cursor/rules/backend-engineering.mdc` 4.4.

## Non-goals

- Changing what any existing action records. Redesigning the audit screen.
