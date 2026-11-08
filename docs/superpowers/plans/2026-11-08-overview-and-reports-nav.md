# Plan: full overview, reports menu, finance ledger, layer bugs

Spec: `docs/superpowers/specs/2026-11-08-overview-and-reports-nav.md`. One slice at a time. Each slice is verified (typecheck, lint, check:copy, test:api, and the browser in ar + en, light + dark, for UI) before the next one starts, and each slice updates the codemaps it touches.

## Slice A: entering an account opens its layer's door — done 2026-11-09 `b9e1d37` (verified on Docker: enter → pos.localhost with the pos menu, leave → admin users)
- [x] `apps/api/src/modules/auth/`: handoff store (`saveHandoff`, `takeHandoff`, 60 s, one use) in the memory and Prisma auth stores.
- [x] `accounts.service.ts` `enter`: returns `{ door, code }`; `accounts.controller.ts` stops setting cookies.
- [x] New `POST /office/handoff` (no actor; reads the code, sets `sid` + `home`), in `account-session.controller.ts`; route table + permission matrix + activity.
- [x] `src/door.middleware.ts`: an impersonation session is checked against the entered account's layer.
- [x] Web: `app/enter/page.tsx` (reads the fragment, posts it, loads `/`); `account-actions.tsx` goes to `doorOrigin(door)/enter#code`; the shell's leave goes to `doorOrigin(admin)/users`; `tests/mock-api.mjs`.
- [x] Specs: handoff once only, expired, door middleware for an entered point of sale on the pos and admin doors; e2e: enter opens the pos door, leave returns to the admin users page.
- [x] `docs/architecture/backend.md`, `frontend.md`.

## Slice B: operations across the chain — done 2026-11-09 `b9e1d37` (verified on Docker: the branch reads 33 operations)
- [x] `apps/api/.../wallets/wallets.service.ts` `ledger('operations')`: `userId in visibleAccountIds`, plus `loginName`, `layer` and `margin` on each row; `audit` scope unchanged.
- [x] spec: the branch sees the points of sale's operations, the agent sees only its chain's, and the point of sale sees only its own.
- [x] `response-shape.spec.ts` (fields added only).
- [x] `features/wallets/screens/operations-screen.tsx`: account, layer and my-profit columns.
- [x] `docs/architecture/backend.md`, `frontend.md`.

## Slice C: «التقارير» menu, one page per report — done 2026-11-09 `b9e1d37` (e2e 145; Docker in ar/en/he, light/dark)
- [x] `components/office-shell.tsx`: a «التقارير» `NavGroup` (closed by default) holding the spec's items with their layers and grants; remove the old finance, profits, reports, provider-operations and «غير جاهز» entries. Same for the point-of-sale menu.
- [x] `app/reports/{sales,orders,balances,supply}/page.tsx` plus screens split from `reports-hub-screen.tsx`; `/reports` redirects to `/reports/sales`; resolve name collisions with `/reports/[kind]`.
- [x] Crumbs and page titles for the new pages.
- [x] e2e: `tests/reports-hub.spec.ts` becomes per-page tests; the group starts closed and opens on a report page.
- [x] `frontend.md`, copy keys in ar/en/he.

## Slice D: finance ledger — done 2026-11-09 (API 774, e2e 145; Docker: chain profits dialog)
- [x] `wallets.service.ts` `financeWhere`: own wallet + descendants, a `scope=money|all` filter (all drops the `amount != 0` rule); specs; CSV parity.
- [x] `finance-screen.tsx`: signed amounts with badges, the money/all filter, the ladder drawer for the branch.

## Slice H: user page actions and settings
- [ ] `features/accounts/account-actions.tsx`: «المحفظة» menu button (charge, deduct, ceiling, statement).
- [ ] «إعدادات المستخدم» dialog: email, mobile, two-factor on/off, password, session rules; API for the owner to edit another account's email/mobile/2FA if missing (`auth` or `accounts` module, specs, permission matrix).
- [ ] `features/accounts/screens/account-screen.tsx`: two tabs; permissions, operations and numbers as closed collapsible sections loaded on open.

## Slice I: suspended lines
- [ ] Migration: `Package.suspendAfterDays Int @default(90)`; package details form and API.
- [ ] `office-paging.ts`: `suspendedWhere`; `GET /office/lines?status=suspended`; numbers filter chip.

## Slice E: provider operations and matching
- [ ] Migration: `Provider.matchSource` ('api' | 'statement', default 'statement'), `Provider.matchEveryDays` (default 7); `WalletEntry.providerAmount Int?`, `providerMatchedAt DateTime?`.
- [ ] API source: store the provider's charged amount when the operation is answered; difference → «فرق».
- [ ] Statement source: a reconciliation run fills `providerAmount` for the operations it matched; overdue check (worker, daily) → notice.
- [ ] `provider-operations` screen: source, system cost, provider amount / «بانتظار الكشف», difference; provider accounts list: source, last matched, open differences.

## Slice F: home overview
- [ ] `apps/api/.../desk/overview.service.ts` + `GET /office/overview?period=` (route table, permission matrix, spec per layer).
- [ ] `features/desk/screens/home-screen.tsx`: period switch and the seven cards; `components/donut.tsx` (SVG) for the lines card.
- [ ] `DESIGN.md`: the overview card set and the geometric decoration tokens.
- [ ] e2e on the mock API for each layer.

## Slice G: provider health and alerts
- [ ] Health rule, owner floor setting, state change detection (worker), notices (`notice-kinds.ts`), home banner.
- [ ] Specs and the notices e2e.
