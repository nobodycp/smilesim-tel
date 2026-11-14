# Refactor execution report (ADR 0020, plan `2026-11-13-office-retirement`)

The running log of the autonomous execution started on 2026-11-14 from base `d7259ef`. One section a slice.
A new session resumes from the first slice that is not `DONE`: read this file, `git log --oneline d7259ef..`, the
plan (`docs/superpowers/plans/2026-11-13-office-retirement.md`) and the backend map, then continue. Nothing here is
pushed; the owner approves before one push and one CI run.

## How to resume (tools used, all local)

- Architecture counts: `apps/api/src/architecture-boundaries.spec.ts` and `architecture.spec.ts` (ratchet
  baseline `apps/api/src/architecture.baseline.json`); a failing rule prints its violations.
- Tests run through the workspace script (Nest 12 is ESM: plain `npx jest` cannot load it):
  `TEST_DATABASE_URL=postgresql://smilesim:smilesim@127.0.0.1:55432/smilesim_test TEST_REDIS_URL=redis://127.0.0.1:56379/15 npm test --workspace api -- --forceExit <paths>`.
- Moves are `git mv` plus import paths only; a split file keeps each function's text as it was.
- Rules that hold for every slice: no transaction body, statement order or lock order edited; no table, column,
  migration, queue name, job payload, outbox topic, Redis key or HTTP contract changed
  (`docs/architecture/financial-invariants.md`).

## Status

| Slice | Status | Local commit |
|---|---|---|
| R.2.1 Worker shutdown race | DONE | `000e411` |
| R.3 Kernel and rules | DONE | `cf984d4` |
| R.4 Tasks and sales | DONE | `d07ebf2` |
| R.5 Worker composition | DONE | `6375d24` |
| R.6 Sales | DONE | `6eeea2f` |
| R.7 Providers | DONE | `9ec5b65` |
| R.8 Remaining domains | DONE | `dc59623` |
| R.9 Umbrella removal | DONE | `71f38aa` |
| R.10 Prisma model names | DONE | `c9f10f9` |
| R.A Authentication | PARTIAL | see its section |
| W.1, W.2 Web names | pending | |
| R.11a HTTP security | pending | |
| R.11b Route migration | pending | |
| R.11c Legacy route removal | pending | |

## Guard counts

| Rule | Base `d7259ef` | After R.2.1 | After R.3 | After R.4 | After R.5 | After R.7 | After R.8 | After R.9 |
|---|---|---|---|---|---|---|---|---|
| module-layering | 28 | 28 | 19 | 11 | 11 | 7 | 0 | 0 |
| module-mutual | 10 | 10 | 8 | 6 | 6 | 3 | 0 | 0 |
| root-domain-code | 5 | 5 | 4 | 4 | 3 | 2 | 2 | 2 |
| operation-writes | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| transaction-outside-unit-of-work | 5 | 5 | 5 | 5 | 4 | 2 | 2 | 2 |
| write-without-activity | 7 | 7 | 7 | 7 | 7 | 7 | 7 | 7 |
| catch-all-module | — | — | 0 (new) | 0 | 0 | 0 | 0 | 0 |
| module-surface | not in force | not in force | not in force | not in force | not in force | not in force | not in force | 0 (in force for 5) |

## R.2.1 Worker shutdown race — DONE (`000e411`)

- **Found:** with the real readiness loop and timers (`worker-shutdown-race.spec.ts`), a slow readiness round let
  a relay, a recovery and a sweep round start after SIGTERM (readiness was awaited before the timers were told),
  and SIGTERM then SIGINT closed everything twice. Red run kept in the session's scratchpad.
- **Fixed:** `workerShutdown` (`provider-dispatch.ts`): readiness, timers and queues told in the same turn; running
  work awaited; then the notice writer; then the database and Redis; a second call returns the first promise.
- **Files:** `provider-dispatch.ts`, `worker.ts`, `worker-shutdown.spec.ts`, `worker-shutdown-race.spec.ts`
  (new), backend map, plan, open items.
- **Results:** race specs 6/6; worker, settlement, outbox, PostgreSQL and Redis specs 242/242; full API 1763/1763
  (138 files); lint, typecheck, check:copy 0; Playwright 238 passed, 2 skipped, 1 failed
  (`tools-pages.spec.ts` "the list menu and the line card…": the line card's `main` stayed empty, 37.6 s over the
  30 s limit; the file passed alone, 18/18). R.2.1 changes no web file; the cause is not proved and is recorded in
  `docs/superpowers/plans/2026-11-10-open-items.md`.
- **Residual risk:** none known in the stop path. No constant bounds a stop: each path is bounded by its own limit
  (transaction 5 s, queue publish 5 s, provider call 30 s).

## R.3 Kernel and business rules — DONE (`cf984d4`)

- **What moved (git mv + imports):** `modules/shared/` → `modules/platform/`; kernel `unit-of-work`, `query`,
  `values` → platform; `account-tree`, `actor-resolver`, `actor.interceptor`, `types` (Actor, Account), `policy.ts`,
  `office-grants` (→ `grants`), `account-visibility` → `modules/access/`; `sale` → `modules/wallets/`; `line-terms`
  → `modules/pricing/`; `kernel.providers.ts` → `office/testing/collaborators.ts` (`SHARED_COLLABORATORS`, test
  only); rules → `modules/catalog/rules/` (`run-modes`, `sim-rules`, `package-code`), `modules/pricing/rules/`
  (`prices`, `user-terms`, `line-prices`, `profit-ladder`, `office-terms` → `package-terms`),
  `modules/sales/rules/` (`periods`, `office-paging` → `line-filters`).
- **What was split (each function's text unchanged):** `kernel/types.ts` (Sale → `wallets/sale.ts`, Action →
  `catalog/rules/actions.ts`, the `Gate` re-export dropped for `platform/cookies`); `rules/prices.ts` (money unit,
  eSIM fee, a package's `Prices`, `chainHolds`, `PriceField` → `catalog/rules/package-prices.ts`; `withinCeiling`,
  `uncoveredDebit` → `wallets/ceiling.ts`); `office-paging.ts` (page sizes → `platform/paging.ts`, task statuses →
  `tasks/task-status.ts`); `PathNode` → `access/types.ts`; `Layer` → `doors.ts`.
- **Wiring:** `KernelModule` replaced by `PlatformModule` (UnitOfWork) and `AccessModule` (AccountTree,
  ActorResolver; imports AuthModule and re-exports nothing); `NoticesModule` and `AccountsModule`, the two that
  inject the auth store, import `AuthModule` themselves. One `UnitOfWork` instance as before (one provider in one
  module).
- **New guard:** `catch-all-module` (fixture `catchAllModules`): a file or folder named `kernel`, or a Nest module
  exporting a provider or module another module owns (a port it binds with `provide:` excepted). Proved on a
  made-up kernel module.
- **Results:** lint 0, typecheck 0, check:copy 0; 47 suites / 802 tests (platform, access, catalog, pricing, the
  cross-domain HTTP contract specs, transfers, worker, HTTP security, architecture, notifications, auditing).
- **Counts:** layering 28 → 19, mutual 10 → 8, root-domain-code 5 → 4.
- **Deviation:** `editableField` stays in pricing (which price a layer may edit is a ladder rule), so
  `packages.service.ts` still imports pricing; the pair catalog ↔ pricing appears because pricing now imports the
  catalog's prices. Both close when R.8 settles who owns package prices.
- **Left for later slices:** access ↔ tasks, access ↔ wallets (R.8), providers ↔ tasks, providers ↔ reporting,
  providers ↔ wallets, platform ↔ providers (R.7, R.5), sales ↔ tasks (R.4).

## R.4 Tasks and sales boundaries — DONE (`d07ebf2`)

- **Decision (ADR 0020 amended):** `tasks → providers` is allowed. A task and its operation are locked together
  in the task's transaction (task, line, claim keys, operation, wallet) and the task asks what its operation allows;
  the integration imports neither tasks nor sales (named test). A port that providers implements for tasks was
  rejected: it would hide a lock taken inside the task's transaction behind an interface for no gain.
- **Moved, text unchanged:** the task-facing rules of `lines/activation-settlement.rules.ts` (`TaskOperation`,
  `OperationPhase`, `phaseOf`, `TaskRequest`, `sameRequest`, `TaskActions`, `taskActions`, `inFlight`, `HoldState`,
  `holdOf`, `shownPhase`, `DECISION_GRANT`, `mayDecide`) → `tasks/task-operation.rules.ts`; `office/stored-text.ts`
  and `lines/esim-code.ts` → `modules/platform/`.
- **Port:** `OpeningLocks` (in `tasks.service.ts`): `openTask` takes `locks`, and calls `lockLine`, `lockClaim`,
  `assertClaimFree` through it at the same three points; `LinesService` passes `OPENING_LOCKS`
  (`lines/opening-locks.ts`, the functions of `line-state.ts`). No other caller of `openTask` exists.
- **The one operation write of a cancel:** `ProviderOperationsRepository.markAbandoned` holds the identical
  guarded `updateMany` (`requested` → `failed`, `lastError: 'abandoned'`, `appliedAt`, `leaseUntil: null`);
  `withdrawOperation(tx, taskId, operations, now)` calls it through `ProviderOperationsService.abandonRequested`
  with the same client, after the same row lock. `TasksService` injects `ProviderOperationsService`; `TasksModule`
  imports `ProvidersModule`; the three hand-built `TasksService` (worker's `buildActivationSettlement`, the test
  facade, `task-notes.spec.ts`) pass it.
- **Not changed:** any transaction body's statements or their order, the lock order, a status rule, a queue, a
  message. Duplicate import lines left by R.3's rewrites were merged (22 files, imports only).
- **Results:** typecheck, lint 0; architecture 63/63; lines, tasks, providers, wallets, the cross-domain HTTP
  contract specs, worker, provider-dispatch, platform, access, HTTP security and eSIM sealing specs on PostgreSQL
  and Redis: 74 files, 1210 tests, all passed.
- **Counts:** layering 19 → 11, mutual 8 → 6, operation-writes 1 → 0.
- **Left:** access ↔ tasks (accounts reads `task-log`), access ↔ wallets, catalog ↔ pricing (R.8); providers ↔
  wallets, providers ↔ reporting (R.7); platform ↔ providers (R.5/R.7).

## R.5 Worker composition — DONE (`6375d24`)

- **One description:** `src/worker/composition.ts` — `WORKER_MONEY_PATH` (12 classes) and `composeWorker(root,
  given, description?)`, which builds each class once from `design:paramtypes`, `@Inject` (`self:paramtypes`) and
  `@Optional` (`optional:paramtypes`), Nest's own metadata, and throws naming what it neither builds nor is given,
  or a class with no metadata. `ActivationSettlement` got `@Injectable()` (metadata only; no module registers it)
  and value imports of its five collaborator types, so its metadata names them.
- **The worker hands in three tokens:** its `UnitOfWork` (on its own client), the `ProviderOperationsService` it
  built (one in the graph), and `AUTH_STORE` (a store that throws if read). It calls `new` on none of the twelve.
- **Why not a Nest application context:** the API's modules start timers in their hooks (provider health, line
  snapshots, the catalog seed); started in the worker they would run twice. Recorded in ADR 0020 (amended).
- **Moves:** `src/provider-dispatch.ts` → `src/worker/provider-dispatch.ts` (owner `app`; a guard proves the folder
  holds only `composition.ts` and `provider-dispatch.ts` and no query); `mayBuild`, `readCredentials`,
  `storedGenerations`, `startReadiness` → `modules/office/providers/dispatch/worker-readiness.ts`, the attestation
  in `uow.runTx` (same statements, same order; `runTx` is `prisma.$transaction(fn)` with no options, as before, and
  publishes nothing since nothing is queued). `startReadiness` takes the unit of work (worker: `dispatch.uow`).
- **Specs:** `worker-wiring.spec.ts` (+4: the description is the API's providers as themselves; the three given
  tokens and no `new` of the twelve; `composeWorker` refusals on made-up classes; the real description refuses a
  missing `AUTH_STORE` by name); `provider-dispatch-switch.spec.ts` updated to the new file homes (the sealed
  credential is selected only in `worker-readiness.ts`, which the API never loads); `provider-dispatch.db.spec.ts`
  and `worker-shutdown-race.spec.ts` pass a unit of work.
- **Startup, shutdown, recovery:** start-up order (`assertWorkerConfig` before anything opens) and the shutdown
  race specs unchanged and green; readiness/attestation and recovery covered by `provider-dispatch.db.spec.ts` and
  `operation-dispatcher.db.spec.ts` in the full run.
- **Checkpoint 1 (full API, PostgreSQL + Redis):** 138 files, 1771 tests, all passed (152.6 s; load 2.4 before,
  11.9 after). lint, typecheck 0.
- **Counts:** root-domain-code 4 → 3, transaction-outside-unit-of-work 5 → 4.
- **Deviation:** the command-line scripts (`reservation-conflicts`, `seal-esim-codes`, `seal-secrets`,
  `two-factor-methods`) stay at the root: operators run `node dist/<name>.js` (handover runbook, backup rehearsal);
  moving them changes an operational contract. Left for a slice that updates the runbook with them.

## R.6 Sales module — DONE (`6eeea2f`)

- **Moves (git mv + import paths only):** `modules/office/lines/*` → `modules/sales/`; `task-completion`,
  `task-charge.rules`, `activation-settlement`, `activation-settlement.rules`, `provider-decisions` and their five
  specs → `modules/sales/settlement/`; `office-esim.ts` → `modules/sales/esim-activation-code.ts`.
- **Why one folder with a `settlement/` inside, not `sales/lines` beside `sales/settlement`:** the settlement reads
  through `LinesRepository`; a repository is private to its folder and the folders inside it
  (`cross-domain-repository-import`). With the repository at the module's root, the settlement imports it from
  inside its own module, as the guard allows; two sibling folders would need a second repository or a service in
  between, a change of code, not of place.
- **Not changed:** class names (`LinesModule`, `LINES_PROVIDERS`), routes, any statement. `transfers` waits for R.8.
- **Results:** typecheck, lint 0; architecture 64/64; sales, worker, provider-dispatch switch, HTTP contract,
  transfers and tasks specs on PostgreSQL and Redis: 36 files, 930 tests (one expectation's sorted order updated
  in `provider-dispatch-switch.spec.ts`: the paths are sorted and the folder name changed).
- **Counts:** unchanged (moves do not lower them; layering 11, mutual 6).

## R.7 Providers module — DONE (`9ec5b65`)

- **Found afterwards (in R.8):** `catalog/shipped/catalog.http.spec.ts`'s stand-in client knew only the array
  transaction form, so `PATCH providers/:code/settings` answered 500 there after `saveModes` moved to `runTx`. The R.7
  run had not included that file. Fixed in the R.8 commit (the stand-in hands the work its tables); expectations
  unchanged.

- **Folders:** `modules/providers/` holds `providers.module.ts`, `providers.repository.ts`, `providers.schemas.ts`,
  `testing/`; `directory/` (settings, health, the provider's catalog and its simulated adapters), `account/`
  (accounts, statements, reconciliation, matching), `integration/` (gateway, dispatch, operations). All `git mv`.
- **Couplings closed:** `GET provider-operations` moved from wallets to the provider accounts (method text unchanged
  but for reading the priced operations through `this.wallets` and the providers through the providers'
  repository, which already had the identical query; the wallets' copy deleted as dead). `ProviderOperationsQuery`
  moved to `providers.schemas.ts`. The route keeps its path, decorators, permission and body; `routes.http`,
  `permissions.http`, `response-shape` and `query-filters` specs green. `report-csv.ts` → `modules/wallets/`.
  `production-config.ts` → owner `app` (bootstrap; the root-domain rule lists it with `main.ts`, `worker.ts`).
- **Transactions:** the reconciliation (`runReconciliation`) and the run modes (`saveModes`) run in `uow.runTx`.
  Same writes, same order. Residual risk: `saveModes` was an array (batch) transaction with no interactive time
  limit; as an interactive transaction it has Prisma's 5 s, which a provider followed by very many packages could
  reach (one update per package). Not a money path.
- **Spec updates (no expectation weakened):** `mode-inheritance.spec.ts`'s stand-in client learned the interactive
  transaction form; `operation-dispatcher.db.spec.ts` reads the outbox's folder at its place and its import check
  now also names `sales/` (the lines' folder since R.6 — without it the check would have gone blind);
  `provider-dispatch-switch.spec.ts` names the new paths.
- **New guard:** the integration imports nothing of the directory or the account; wallets nothing of providers;
  the platform nothing above it.
- **Results:** typecheck, lint 0; architecture 65/65; providers, wallets, HTTP contract, sales, reports, packages,
  production-config, worker and platform specs on PostgreSQL and Redis green (two suites failed on the first run for
  the two stand-in/path reasons above; both fixed and re-run green: 14 files, 164 tests).
- **Counts:** layering 11 → 7, mutual 6 → 3, root-domain-code 3 → 2, transaction-outside-unit-of-work 4 → 2.

## R.8 Remaining domains — DONE (`dc59623`)

- **Code (behaviour kept):**
  - The priced shelf (`GET packages`) and the sell prices (`PUT|DELETE sell-prices/:code`) moved from
    `PackagesService`/`PackagesController` to pricing (`modules/pricing/package-shelf.service.ts`,
    `package-shelf.controller.ts`), text unchanged but for the shelf query's name (`shelfPackages`, the packages'
    `packagesOnSale` query moved to `TermsRepository`, which already had the identical `termRowsOf`, `sellRowsOf`,
    `packageByCode`); `saveSellPrice`, `clearSellPrice` moved with them. `PackagesService` lost its ladder and tree,
    `PackagesModule` no longer imports `TermsModule`; `TermsModule` registers the shelf.
  - Access declares `AccountWallets` and `AccountTasks` (`access/account-ports.ts`); wallets bind the first to
    `WalletLedger` (its `lockWallets`, in the removal's transaction as before) and tasks the second to
    `TasksService.releaseHandledBy` (the frozen account's tasks: the same read and the same guarded write, the copy
    in the accounts' repository deleted in favour of the tasks' identical `releaseTask`). Global binding modules
    `AccountWalletsModule`, `AccountTasksModule` (registry; flat test lists).
- **Moves:** every remaining domain folder of `modules/office/` to its module (see the plan). `office/` keeps
  `office.module.ts` and `testing/` for R.9.
- **Spec updates:** `registry.spec.ts` (two binding modules), `http-security-contract.spec.ts` (22 controllers, 19
  under the prefix: the new shelf controller), `catalog.http.spec.ts` (the R.7 stand-in fix above), paths in
  `provider-dispatch-switch`, `architecture-boundaries`, `operation-dispatcher.db` specs; the stored-text rule's seed
  exemption follows the shipped catalog to `catalog/shipped/` (it named `office/catalog/`).
- **Full API (PostgreSQL + Redis):** 138 files, 1772 tests: 1760 passed, 12 failed in 2 files. (1)
  `http-security-contract.spec.ts`: the controller counts (fixed, 14/14). (2) `platform/ports.db.spec.ts`: its
  `beforeAll` (six inserts) passed the 5 s hook limit in the full run; alone 10/10; R.8 changed nothing it runs;
  recorded in the open items, not attributed to load.
- **Counts:** layering 7 → **0**, mutual 3 → **0**.

## R.9 Umbrella removal — DONE (`71f38aa`)

- **Umbrella gone:** `modules/office/office.module.ts` deleted; `modules/registry.ts` lists the sixteen domain
  modules in the order the umbrella imported them, and `DuplicateGuardModule` (`modules/platform/`) registers the
  same `APP_INTERCEPTOR` (the only global interceptor). `modules/office/` no longer exists.
- **Test helpers:** `modules/office/testing/` → `modules/testing/`; `OfficeFacade` → `ApiFacade`, `OfficeGraph` →
  `ServiceGraph`, `officeTestApp` → `apiTestApp`, `office-routes.ts` → `routes.ts`, `OFFICE_CONTROLLERS/PROVIDERS` →
  `DOMAIN_CONTROLLERS/PROVIDERS` (`domain-lists.ts`, test-only).
- **Rules:** `flat-office-module` removed with its file (the rule said so); `module-surface` in force for reporting,
  auditing, notifications, tasks, sales: each `index.ts` re-exports exactly what other modules imported (generated
  from the imports), and those imports now go through it; the fixture no longer judges a composition root (`app`).
  The activity rules' patterns follow the recorder's new method name (`activity.record\w*`, same strength).
- **Names:** `recordOffice`/`recordOfficeOrFail` → `record`/`recordOrFail`; the request field `officeActor` →
  `actor` (in process only); Swagger tag `office` → one tag a module (documentation only).
- **Found and fixed, a test that had gone blind:** after the move, `query-filters.http.spec.ts` and
  `response-shape.spec.ts` looked for the web app one folder too high, found nothing and skipped 17 tests without a
  word. Paths fixed; each file has a test that fails when the web is not found (green: 66/66).
- **Checkpoint 2 (full API, PostgreSQL + Redis):** 138 files, 1771 tests: 1744 passed, 17 skipped (the blind suites
  above, fixed after the run), 10 failed in `platform/ports.db.spec.ts` (its `beforeAll`, six inserts, over 5 s,
  as in the R.8 run; alone and beside the heavy database specs it passes; recorded in the open items with what is
  and is not known). Architecture 64/64 (rules), lint, typecheck, check:copy 0.

## R.10 Prisma model names — DONE (`c9f10f9`)

- `schema.prisma`: `model OfficeTask` → `model Task` + `@@map("OfficeTask")`, `model OfficeTaskNote` → `model TaskNote`
  + `@@map("OfficeTaskNote")`; relation types follow; relation field names were already neutral (`task`, `tasks`).
- **No schema drift, proved:** `DATABASE_URL=<test db> npx prisma migrate diff --from-config-datasource --to-schema
  prisma/schema.prisma --script` answered "This is an empty migration." before and after the rename. No migration
  created; no table, column, constraint or index renamed.
- **Code:** delegates `officeTask` → `task`, `officeTaskNote` → `taskNote` (including the in-memory test tables);
  `Prisma.OfficeTask*` → `Prisma.Task*`; the generated type `OfficeTask` → `Task` in the three settlement files. Kept:
  raw SQL `"OfficeTask"`, constraint names (`OfficeTask_requestKey_key`), the sealing script's table list and its
  report keys (table names). The fault-injection spec's model name is `Task`.
- **Results:** typecheck 0; tasks, sales, sealing, settlement schema, architecture, worker, HTTP contract and access
  specs on PostgreSQL and Redis: 45 files, 1005 tests passed.
- **Rollback:** a revert; the database is untouched, so the previous image runs against it as before.

## R.A Authentication audit and cleanup — PARTIAL

- **Done:** `PATCH /auth/profile` records `password` when a new password is sent, else `user_contact`
  (`profileChangeAction`, through the body's schema), success and refusal with the refusal code; `DELETE
  /auth/two-factor` records `two_factor`, success and refusal. The record holds the action and the account (the
  session) only. The five steps (`two-factor/setup`, `two-factor/method`, `two-factor/send`, `passkeys/options`,
  `passkey-login/options`) carry `@NoActivity('a step: …')`: each only issues a secret, a challenge or a code, and
  the step that follows records the outcome. `write-without-activity` 7 → 0; the HTTP contract now requires every
  write route to record or declare, and pins the five declarations.
- **Tests:** `modules/auth/own-activity.http.spec.ts` (new): the contact change, a refused password change and the
  second step's removal are recorded under the right action, and no password, field value or code appears in any
  record. Auth, HTTP contract and architecture specs: 248 passed.
- **Not done:** thinning `auth.controller.ts` (35 routes, about 620 lines). It is security code whose contracts
  (cookies, session rotation, records) are spread over every handler; reorganising it is a structural change with no
  failing test to drive it and the risk sits on sign-in. Left for its own slice with the owner's word.
- **Seen in passing (not changed):** a stored password hash that is not an argon2 string makes `passwordMatches`
  throw, so such an account's sensitive profile change answers 500 instead of `WRONG_CURRENT_PASSWORD`. Real
  accounts are created with argon2 hashes; only hand-made test rows have such a hash.
