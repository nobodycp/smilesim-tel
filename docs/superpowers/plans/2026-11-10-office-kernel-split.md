# Office kernel split, domain modules, repositories — plan

Spec: `docs/superpowers/specs/2026-11-10-office-kernel-split.md`. One slice = one commit; tick it with the hash.
All paths are under `apps/api/src/modules/office/` unless they start with `src/`.

## Before the first slice

- [x] **P.1** (run 42732381673 green) The nine hardening commits are pushed and the run on `main` is green (owner's word needed to push).
- [x] **P.2** The local copy runs from one `smilesim` start (web 3000, API 3001), and `/health` answers.

## The check every slice ends with

```
cd apps/api
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.build.json
npx eslint src
npm test -- --forceExit src/architecture.spec.ts
npm test -- --runInBand --forceExit <the spec files the slice names>
```

Module slices (phase M) add: `PORT=3099 node dist/main.js` with the dev env, `curl localhost:3099/health`, stop it.
A slice that touches money (K.4, R.3, R.4) also runs the two `*.db.spec.ts` files against a throwaway database
(`TEST_DATABASE_URL`, see `wallets/wallet-concurrency.db.spec.ts` header).

---

## Phase K — take the kernel apart (behaviour-preserving, delegates first)

- [x] **K.0 Ratchets.** (9263287) `src/architecture.spec.ts`: add `kernel-use` (production files outside `kernel/` importing
  `OfficeKernel`; today 26), `prisma-in-service` (matches of `\.prisma\.\w+\.|\btx\.\w+\.(find|create|update|delete|upsert|count|group|aggregate)`
  in `*.service.ts`; record today's number), `flat-office-module` (entries in `OFFICE_PROVIDERS`; today 29).
  Baselines in `architecture.baseline.json`. Rule text in `.cursor/rules/backend-engineering.mdc` section 5.
  Specs: `src/architecture.spec.ts`.

- [x] **K.1 (eb1fbd8) `UnitOfWork`.** New `kernel/unit-of-work.ts`: `prismaClient` (spec hook), `prisma` getter, `runTx`,
  `queueNotices`, `publishQuietly`, the `queued` WeakMap; constructor `(@Optional() notice?: NoticeService,
  @Optional() db?: PrismaService)`. `OfficeKernel` takes a `UnitOfWork` and keeps `prisma`, `prismaClient`
  (get/set forwarding), `runTx`, `queueNotices`, `publishQuietly`, `notice` as delegates. `testing/office-facade.ts`
  and `testing/office-test-app.ts`: build/forward to the `UnitOfWork`. `office.module.ts`: provider added.
  Specs: `lines/line-state`, `wallets/deduct`, `tasks/task-notes`, `testing/office-errors`, `kernel/actor.interceptor`.

- [x] **K.2 (eb1fbd8) `AccountTree`.** New `kernel/account-tree.ts`: `accounts(db)`, `pathOf`, `chainIds`, `visibleAccount`,
  `nodeOf` (function). Depends on `UnitOfWork`. Kernel delegates. Specs: `transfers/transfer-service`,
  `terms/user-terms-service`, `accounts/accounts.http`.

- [x] **K.3 (eb1fbd8) `ActorResolver` and `LayerRoles`.** New `kernel/actor-resolver.ts`: `actor(gate)`, `grantsFor(user, db)`
  (needs `AUTH_STORE`, `UnitOfWork`). New `roles/layer-roles.ts`: `ensureLayerRoles()`. `kernel/actor.interceptor.ts`
  injects `ActorResolver`. Kernel delegates `actor`, `grantsFor`, `ensureLayerRoles`, `auth`.
  Specs: `kernel/actor.interceptor`, `testing/permissions.http`, `testing/routes.http`, `accounts/accounts.http`.

- [x] **K.4 (eb1fbd8) `WalletLedger`.** New `wallets/wallet-ledger.ts`: `lockWallets`, `hold`, `release`, `move`, `recordOp`,
  private `saleLadder`, `refundOf`. Depends on `UnitOfWork`, `AccountTree`, `PriceLadder` (K.5 lands first if the
  ladder read is needed: do K.5 before K.4 when `saleLadder` moves). Kernel delegates.
  Guard `wallet-writes` in `architecture.spec.ts`: allowed prefix becomes `modules/office/wallets/wallet-ledger.ts`.
  Specs: `wallets/deduct`, `wallets/wallets.http`, `wallets/finance-ledger`, `wallets/margins`, `lines/line-state`,
  `lines/esim-ops`, `lines/operation-log`, both `*.db.spec.ts`.

- [x] **K.5 (eb1fbd8) `PriceLadder`.** New `terms/price-ladder.ts`: `PRICE_COLUMNS`, `LadderRows`, `termsFor(packageId, db)`,
  `ladderRows(codes, pathIds, db)`, `stampWith(terms, path, rows)`. Kernel delegates.
  Specs: `terms/user-terms-service`, `rules/line-prices`, `rules/profit-ladder`, `wallets/margins`.

- [x] **K.6 (eb1fbd8) `LineAccess`.** New `lines/line-access.ts`: `visibleLine(actor, lineId)` (needs `UnitOfWork`,
  `AccountTree`). Kernel delegate. Specs: `lines/line-state`, `lines/addons`, `transfers/transfer-service`.

After K.6 the kernel is a file of delegates only. Next, each domain stops using it. For each slice: change the
service constructors, update `testing/office-facade.ts` where it builds that service, update the hand-built kernels
in the named specs, lower `kernel-use`.

- [x] **K.7 (1c4faf1) Leaf domains** (only `prisma`, `runTx`): `offers`, `companies`, `providers/providers.service`,
  `providers/provider-catalog.service`, `providers/provider-accounts.service`, `reports/reports.service`,
  `audit` (+`AccountTree`), `reports/insights.service` (+`AccountTree`), `desk/overview.service` (+`AccountTree`),
  `desk/desk.service` (+`AccountTree`). → `UnitOfWork` (+ `AccountTree`).
  Hand-built kernels to update: `offers/offers.service.spec`, `providers/provider-accounts.service.spec`,
  `providers/provider-catalog.service.spec`, `desk/overview.service.spec`, `reports/insights.service.spec`,
  `packages/mode-inheritance.spec`. Specs: those + `catalog/catalog.http`, `reports/reports-lines.http`, `audit/audit.http`.

- [x] **K.8 (1c4faf1) Roles, catalog seed, notices, provider health.** `roles` → `UnitOfWork`, `LayerRoles`;
  `catalog/catalog-seed` → `UnitOfWork`, `LayerRoles`; `notices/notice-inbox.service` → `UnitOfWork`,
  `NoticeService`, `AUTH_STORE`; `providers/provider-health.service` → `UnitOfWork`, `NoticeService`.
  Specs: `accounts/accounts.http` (roles), `notices/notices.http`, `notices/notice.service`, `providers/provider-health`.

- [x] **K.9 (1c4faf1) Accounts.** `accounts.service` → `UnitOfWork`, `AccountTree`, `LayerRoles`, `AUTH_STORE`;
  `account-session.service` → `AUTH_STORE`. Specs: `accounts/accounts.http`, `testing/permissions.http`.

- [x] **K.10 (1c4faf1) Packages and terms.** `packages.service` → `UnitOfWork`, `AccountTree`, `PriceLadder`;
  `terms.service` → the same three. Specs: `packages/package-prices`, `packages/package-catalog.http`,
  `packages/mode-inheritance`, `terms/user-terms-service`, `rules/user-terms`.

- [x] **K.11 (1c4faf1) Wallets and tasks.** `wallets.service` → `UnitOfWork`, `AccountTree`, `WalletLedger`, `PriceLadder`,
  `NoticeService`; `tasks.service` → `UnitOfWork`, `AccountTree`, `WalletLedger`, `ActorResolver` (`grantsFor`),
  `NoticeService`. Specs: `wallets/*`, `tasks/task-notes`, `lines/line-state`, `testing/office-lists`.

- [x] **K.12 (1c4faf1) Lines and transfers.** `lines.service`, `line-reads`, `line-pricing`, `task-completion` →
  `UnitOfWork`, `AccountTree`, `WalletLedger`, `PriceLadder`, `LineAccess` as each uses them (table in the spec);
  `transfers.service` → `UnitOfWork`, `AccountTree`, `LineAccess`, `WalletLedger`, `NoticeService`.
  Specs: every spec under `lines/`, `transfers/`, `testing/response-shape`, both `*.db.spec.ts`.

- [x] **K.13 Delete `OfficeKernel`.** (this commit) `kernel/office-kernel.ts` removed; `assertBranch` moves to `policy.ts`;
  `testing/office-facade.ts` holds the collaborators itself; `kernel-use` rule becomes "no file named
  office-kernel" (baseline 0). Map: `docs/architecture/backend.md` kernel row and "Known gaps".
  Specs: the whole `src/modules/office` folder with `--runInBand`.

### How phase K was done (2026-11-10)

- K.1–K.6 landed as one commit: the kernel built the six collaborators itself and delegated, so no spec changed
  except nine that had built a kernel without its constructor.
- `ActorInterceptor` moved to `ActorResolver` with K.7–K.12 (it needed the collaborators as providers), not in K.3.
- `WalletsService` names its ledger `money`, because it has a `ledger()` method.
- Specs build services from `testing/office-graph.ts` (`OfficeGraph`: the collaborators wired by hand, with the
  `prismaClient` hook and `providers()` for spec apps). `KERNEL_PROVIDERS` in `kernel/kernel.providers.ts` lists the
  seven classes until phase M gives each its module.

## Phase M — one Nest module per domain

Each slice: add `<domain>/<domain>.module.ts` exporting `CONTROLLERS`, `PROVIDERS` consts and the `@Module`; remove
those entries from `office.module.ts`, which imports the module and keeps `OFFICE_CONTROLLERS` / `OFFICE_PROVIDERS`
as the concatenation. Lower `flat-office-module`. Boot check on port 3099.

- [x] **M.1 (this commit) `KernelModule`** (`kernel/kernel.module.ts`): `UnitOfWork`, `ActorResolver`, `AccountTree`,
  `NoticeService`, `ActorInterceptor`; imports `AuthModule`; exports all. `@Global()` is **not** used: every
  domain module imports it by name.
- [x] **M.2 (this commit) Modules that import only the kernel:** `RolesModule` (exports `LayerRoles`), `CompaniesModule`,
  `OffersModule`, `AuditModule`, `NoticesModule`, `CatalogModule` (imports `RolesModule`), `AccountsModule`
  (imports `RolesModule`).
- [x] **M.3 (this commit) `TermsModule`** (exports `TermsService`, `PriceLadder`), `PackagesModule` (imports `TermsModule`),
  `WalletsModule` (exports `WalletsService`, `WalletLedger`; imports `TermsModule`).
- [x] **M.4 (this commit) `TasksModule`** (imports `WalletsModule`; exports `TasksService`), `ProvidersModule` (services, health,
  catalog, accounts, `PROVIDER_GATEWAY`; imports `WalletsModule`; exports `ProviderAccountsService`,
  `ProviderHealthService`, `PROVIDER_GATEWAY`), `LinesModule` (imports `TasksModule`, `WalletsModule`,
  `TermsModule`, `ProvidersModule`; exports `LineReads`, `LineAccess`), `TransfersModule` (imports `TermsModule`,
  `LinesModule`, `WalletsModule`).
- [x] **M.5 (this commit) `ReportsModule`** (imports `TasksModule`, `LinesModule`, `WalletsModule`; exports `InsightsService`),
  `DeskModule` (imports `WalletsModule`, `ReportsModule`, `ProvidersModule`). `office.module.ts` is now imports
  plus `APP_INTERCEPTOR`. Add the import-boundary rule (spec decision 7) to `architecture.spec.ts` with baseline 0.
  Specs: the whole `src/modules/office` folder; map updated.

### How phase M was done (2026-11-10)

One commit: sixteen `<domain>/<domain>.module.ts` files and `kernel/kernel.module.ts`. `KernelModule` provides
`NoticeService`, `UnitOfWork`, `AccountTree`, `ActorResolver` and re-exports `AuthModule` (the auth store and the
activity recorder that the interceptors on every office controller need). `LayerRoles` is in `RolesModule`,
`PriceLadder` in `TermsModule`, `WalletLedger` in `WalletsModule`, `LineAccess` in `LinesModule`. `office.module.ts`
imports the modules and registers the duplicate-write guard; `OFFICE_CONTROLLERS` / `OFFICE_PROVIDERS` are the
modules' own lists spread, for the HTTP specs. The import-boundary rule is `cross-domain-repository-import`
(with the older `cross-domain-controller-import`). Checked by booting the compiled API: 153 routes mapped.

## Phase R — repositories (largest services first)

Each slice: new `<domain>/<domain>.repository.ts` (`@Injectable`, constructor `UnitOfWork`); every Prisma call of
the service moves into a named method (`db` parameter where it runs in a transaction); the service keeps
permissions, parsing, rules, response shaping. Lower `prisma-in-service`. No query changes: `select`, `include`,
`orderBy` and `where` are moved as written.

| Slice | Service (Prisma calls today) | Specs |
|---|---|---|
| - [x] **R.1** | `accounts/accounts.service` (33 + 3 in tx) | `accounts/accounts.http`, `testing/permissions.http` |
| - [x] **R.2** | `packages/packages.service` (26 + 4) | `packages/*`, `testing/response-shape` |
| - [x] **R.3** | `wallets/wallets.service` (19) and `wallets/wallet-ledger` (11 in tx) | `wallets/*`, both `*.db.spec.ts` |
| - [x] **R.4** | `lines/*` (`line-reads` 11, `lines.service` 9 + 5, `task-completion` 3 + 13, `line-state` 4) → `lines/lines.repository.ts` | every spec under `lines/`, both `*.db.spec.ts` |
| - [x] **R.5** | `terms/terms.service` (17 + 3), `transfers/transfers.service` (5 + 9) | `terms/*`, `transfers/*` |
| - [x] **R.6** | `tasks/tasks.service` (11 + 8) | `tasks/*`, `testing/office-lists` |
| - [x] **R.7** | `providers/provider-accounts.service` (16), `providers.service` (9), `provider-catalog.service` (8), `provider-health.service` (6) → `providers/providers.repository.ts` | every spec under `providers/`, `catalog/catalog.http` |
| - [x] **R.8** | `offers` (9), `companies` (6), `desk/*` (14), `reports/*` (7), `audit` (4), `roles` (4), `notices` (2): only where five or more queries remain in one service | their specs |

- [x] **R.9 Close.** (this commit; pushing waits for the owner's word) `prisma-in-service` baseline is what R.8 deliberately left (listed by file in the rule's
  comment). `docs/architecture/backend.md` rewritten sections: entry table, kernel row, modules, "Known gaps".
  ADR `0012-kernel-split-and-domain-modules.md`. Whole `src` suite with `--runInBand`. Ask the owner to push.

### How phase R was done (2026-11-10)

Two commits: the groundwork (an empty repository per domain wired into every constructor, module and hand-built
call site), then the move itself, done by domain in parallel and reviewed as one diff. Thirteen repositories:
accounts, offers, companies, packages, terms, transfers, wallets, tasks, lines (shared by `LinesService`,
`LineReads`, `TaskCompletion`, `LinePricing`), providers (shared by its four services), desk (two), reports (two).
`prisma-in-service` 228 → 10: `audit` (4), `roles` (4) and `notices` (2) keep their few queries, as the spec's
decision 6 allows. `WalletLedger` and `line-state.ts` keep their own writes: they are the guarded money and status
primitives, not services. Reviewed for the two ways a move can break money: no write moved from a transaction
client to the root client, and no repository call inside `runTx` without the transaction's client.

Left as they were, noted during the move (none is new): `AccountsService.remove` deletes in several statements
outside a transaction; a rename applied by a task has no unique-violation mapping (500 instead of 409 on a race);
`OverviewService` writes the day's line snapshot on a read; `termRowsOf` / `sellRowsOf` exist in three
repositories; six services still receive a `uow` they no longer use.

## Order and size

K.0–K.6 are small and mechanical (one class each). K.7–K.12 are the bulk of the edits but each is a constructor
change. M.1–M.5 are wiring. R.1–R.8 are the long part; they can stop after any slice with the app in a good state.
Suggested first sitting: K.0 → K.6.
