# Package durations and deals — plan

Spec: `docs/superpowers/specs/2026-11-15-package-durations-and-deals.md`. One slice = one commit, ticked with
its hash. Per slice: `npm run lint`, `npm run typecheck`, `npm run check:copy`, the touched spec files,
`architecture.spec.ts`; web slices are checked on the running copy (port 3000), ar and en, light and dark, per
`.cursor/rules/verify-before-reply.mdc`. Each slice updates `docs/architecture/backend.md` / `frontend.md`,
`testing/response-shape.spec.ts` and `apps/web/lib/api-types.ts` when a shape changes. Paths are under
`apps/api/src/modules/` unless they start with `apps/` or `prisma/`.

- [x] **D.1 Money fixes on today's model** (`4be05aa`). `prisma/schema.prisma` `WalletEntry.periodCost Int?` (nullable, no
  backfill), written on every prepaid row; `sales/line-pricing.ts` and `settleDisconnect` read the running
  row's `periodCost`, falling back to terms for old rows. Disconnect with a refund at or below the fee is
  refused (`NOTHING_TO_REFUND`) in `sales/lines.service.ts` (direct, quote, and before its task opens); a task
  that waited until then closes in `sales/settlement/task-completion.ts` with no movement (spec, section 7).
  `sales/rules/periods.ts`: `periodEnd`, `lastWindow`, `switchOver`, `periodOf` take days (`daysOf`).
  `wallets/wallet-ledger.ts` `post`: a price chain that cannot be read stops the sale. The web's disconnect
  dialog shows the refusal and loses its "taken from the wallet" label.
  Specs: `pricing/rules/prices-and-periods.spec.ts` (5- and 15-day, mixed, own cost, the floor),
  `sales/settlement/execution-date-settlement.db.spec.ts` (refusals, the late task, `periodCost` on the row).
- [x] **D.2 Duration rows** (`5ad3491`). `PackageDuration` model and migration, one row backfilled per package (its months at
  its renewal prices); `catalog/rules/package-prices.ts` `mirroredDuration`, `durationDays`; the row is written
  in the same statement as the package's columns by the seed (`catalog/shipped/catalog-seed.ts`), the provider
  import (`providers/directory/provider-catalog.service.ts`) and `setChain`
  (`catalog/packages/packages.service.ts`); the sheet returns `durations`. Readers still use the package's
  columns: they move to the rows in D.3, where a renewal first has more than one duration to choose from, and a
  package that has no row (the database specs create packages bare) reads as one duration from its columns until
  D.10. Specs: `catalog/packages/package-durations.db.spec.ts`, `testing/response-shape.spec.ts`.
- [ ] **D.3a The branch edits durations (API).** `PUT /v1/packages/:code/durations` (unit, count and the whole
  ladder; the same pair again replaces the prices), `DELETE /v1/packages/:code/durations/:id`;
  `catalog/packages/packages.schemas.ts` `PackageDurationBody`, `packages.service.ts` `saveDuration`,
  `removeDuration`; the mirrored duration writes the renewal columns with it and is never turned off or removed.
  `testing/routes.ts`, `testing/permissions.http.spec.ts`, `package-durations.db.spec.ts`.
- [ ] **D.3b The «المدد» tab (web).** On the package sheet (`features/catalog/screens/package-sheet-screen.tsx`):
  the durations with their ladders, add, edit, remove; copy in ar, en, he. Checked on port 3000 per
  `verify-before-reply.mdc`.
- [ ] **D.3c Renewal picks a duration.** Price reads go through the duration rows (`pricing/rules/package-terms.ts`,
  `pricing/price-ladder.ts`; the package list returns `durations` masked by layer). `pricing/rules/prices.ts`
  `LineTerms` gains `options` (terms without them read as one option of `months`); `sales/line-pricing.ts`
  `stampFor` captures `options` from the durations; renew takes a duration and the number stays on its package;
  `GET /v1/lines/:id/renewal-quote`; `Task.periodDays`, `durationUnit`, `durationCount`. `PackageRenewal` stays
  as a fallback. Until D.5 a duration other than the package's own is priced by its layer columns (no per-user
  rows exist for it yet). Web: the renewal dialog lists durations (`apps/web/features/…` numbers).
- [ ] **D.4 The lock.** `Line.lockedUntil`; `PackageDuration.noDisconnect`; written at purchase;
  `LINE_LOCKED` on disconnect, disconnect quote, switch, and `sales/rules/line-state.ts` `assertTaskFits`;
  branch override. Web: the warning before paying, the lock on the number's card.
- [ ] **D.5 Per-user prices by duration, one place.** Price rows keyed by duration id; `UserPackage` keeps
  `hidden`; `pricing/terms.service.ts`: `GET/PUT/DELETE /v1/packages/:code/exceptions[/:login]` scoped by
  `canEditTerms` and filtered by `visibleAccountIds`; the old `custom-prices` routes and
  `PUT users/:login/packages/:code` go at once, with their web callers in the same slice (no counter and no
  period of both: `platform/legacy-paths.ts` was removed on 2026-11-16, and the owner keeps nothing in an old form
  before launch); the bulk hide stays.
  Web: package sheet tabs «المدد», «أسعار خاصة», «المستثنون» (`features/catalog/screens/package-sheet-screen.tsx`),
  the lighter package page for main agent and agent, the user tab read-only
  (`features/accounts/screens/packages-terms.tsx`).
- [ ] **D.6 Merge tool.** Branch action "merge package X into Y as a duration" with a dry-run preview: lines
  and terms under the line lock, `UserPackage`, `SellPrice`, `PackageSwitch`, open `Task` rows. Then
  `PackageRenewal` is retired. `providers/provider-cost.ts` `pricedOp` matches by code, not name.
- [ ] **D.7 Deals.** `Deal`, `DealExclusion`, `DealSellPrice`; `WalletEntry.dealName`, `Task.dealCode`,
  `Line.dealPriceUntil`; snapshot at activation (new numbers only, once per number); `forced` in
  `pricing/rules/user-terms.ts`; `pricing/rules/profit-ladder.ts` reads the deal snapshot; warning under branch
  cost; restart pays the base. Web: the «العروض» tab on the package sheet, the deal as an item on the sale
  screen, the deal line on the number's card.
- [ ] **D.8 Deal end and transfer.** `endDeal(tx, line, now)` under the line lock, called by quote, renew,
  restart and task completion; price by the new period's start against `priceUntil`; a deferred task settles at
  its held price. `transfers.service.ts`: a number on a deal keeps it; transfer to an excluded or hidden
  account is refused. Spec with two concurrent callers of `endDeal`.
- [ ] **D.9 Providers.** `ProviderProduct.durations` in `providers/directory/adapters/provider-adapter.ts` and
  `simulated-adapter.ts` (a Sky-like provider, 5 and 15 days); import proposes durations; drift pass on the
  provider-health timer with one notice per change.
- [ ] **D.10 Retire the old columns.** Count of packages whose activation ladder differs from renewal is zero
  (or each became a deal); drop `Package.months`, the ten price columns and `PackageRenewal`. ADR
  `docs/architecture/decisions/0022-durations-and-deals.md`; handover guides in `docs/handover/` updated.
