# Refactor execution report (ADR 0020, plan `2026-11-13-office-retirement`)

The running log of the autonomous execution started on 2026-11-14 from base `d7259ef`. One section a slice.
A new session resumes from the first slice that is not `DONE`: read this file, `git log --oneline d7259ef..`, the
plan (`docs/superpowers/plans/2026-11-13-office-retirement.md`) and the backend map, then continue. The slices
below were pushed by the owner on 2026-11-16 with the UI work that followed them; see "After the push" at the end.

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
| R.A Authentication | DONE | `77c1cf8`, then the controller (2026-11-16) |
| W.1, W.2 Web names | DONE | `99c50fa` |
| R.11a HTTP security | DONE | `518f039` |
| R.11b Route migration | DONE | `5cc9f2f` |
| R.11c Legacy route removal | DONE on the owner's word, without the watched release (2026-11-16) | see `git log --grep 'R.11c'` |
| R.12 Surfaces for the other seven modules | DONE | see `git log --grep 'R.12'` |

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

## R.A Authentication audit and cleanup — PARTIAL (`77c1cf8`)

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

## W.1, W.2 Frontend naming — DONE (`99c50fa`)

- **Renamed (101 files, identifiers and paths only):** `OfficeShell`/`OfficeFrame` → `AppShell`/`AppFrame` (files
  `app-shell.tsx`, `app-frame.tsx`); `OfficeSession`, `OfficeContext`, `OfficeMe`, `OfficeSessionValue`, `useOffice`
  → `DeskSession`, `DeskContext`, `DeskMe`, `DeskSessionValue`, `useDesk` (`lib/desk-session.tsx`); the `api`
  methods `officeX` → `x` (no clash: checked against every method of `features/*/api.ts`); the query keys' root
  `'office'` → `'api'` (structure unchanged, so prefix invalidation is unchanged); CSS `.office`, `.office-main` →
  `.app-shell`, `.app-main`; the copy key `navOffice` → `navDesk` (texts unchanged; check:copy green);
  `OFFICE_LAYERS` → `ACCOUNT_LAYERS`; `serveOffice` → `serveApi`. One clash found by the compiler and fixed in the
  shell (`officeGroups` would have become `groups`; it is `deskGroups`).
- **Kept:** `/office/*` paths (R.11), raw SQL table names in the audit scripts, comments that use "office" as the
  business's word.
- **Checked in the browser (port 3000, the one dev copy):** signed in as the trial owner from the seed file; home,
  numbers and companies render as before; `.app-shell` computed `display: flex`, height 100% of the viewport;
  `.office` no longer in the DOM; the moved shelf route `GET /api/office/packages` answers 200.
- **Results:** web typecheck 0 (outside the git-ignored local `apps/web/audit-output/` scratch folder, which still
  imports the old helper name and is not part of the repository), lint 0, check:copy 0; Playwright `tools-pages` and
  `users-desk`: 22/22. Full Playwright runs at the end.

## R.11a HTTP security independence — DONE (`518f039`)

- **Change:** `DuplicateGuardInterceptor` no longer reads the path: a write of a signed-in session is guarded unless
  `@NotDuplicateGuarded(why)` is on its handler or its controller (`Reflect.getMetadata` on both, as the other two
  markers of the guard are read). `AuthController` and `BrandingController` carry it with their reason. What is
  guarded today is unchanged: the same 76 write routes, the same 27 not.
- **Auth classification kept:** the ten authentication steps stay `no-replay` (their answers carry a session, a
  secret or a challenge; nothing of them is kept); `PATCH /auth/profile` judged `equivalent` (its current password).
- **Tests:** `http-security-contract.spec.ts` rewritten where it pinned the prefix: the guard's source holds no
  path test; every write route is guarded or stated; only the auth and branding controllers are not guarded; moving
  every `/office/` route to `/v1/` leaves the same 76 guarded; over HTTP a write under `/v1/` runs once and is
  answered with `Idempotent-Replay` (the test that pinned the old hazard is replaced by its opposite, as R.0 said),
  and a not-guarded controller runs every repeat and replays nothing. CSRF (origin), rate limit, door, authorization
  and activity checks are unchanged and green. Contract, duplicate-guard, auth and branding specs: 215 passed.
- **Not changed:** the middleware's path lists (single routes). R.11b adds the new paths beside them.

## R.11b API route migration — DONE (`5cc9f2f`)

- **Both paths served:** `modules/platform/route-prefixes.ts` holds `RESOURCE_PREFIXES = ['v1', 'office']`; all 20
  resource controllers are `@Controller(RESOURCE_CONTROLLER_PREFIXES)`. `resourcePaths(x)` gives the middleware's
  single-route rules both forms (`/v1/handoff` and `/office/handoff` are sign-ins for the rate limit and start a
  session for the door; both notice streams are exempt from the limit).
- **One write across two paths:** the duplicate guard hashes `canonicalPath(originalUrl)` (any resource prefix →
  `/office/…`, so a key taken before the deploy still matches); proved over HTTP: the same write sent to `/v1/x`
  and `/office/x` runs once, with or without a key.
- **Old-path count:** `LegacyPathCounter` (`modules/platform/legacy-paths.ts`, global, registered before the guard
  so a replay is counted) counts `/office/…` hits by method and route pattern and logs one line every ten minutes
  (`old paths used: GET /office/lines/:id x2, …`), never a value, query, body, session or address
  (`legacy-paths.spec.ts`). The Arabic operations handover tells the operator what the line means and the condition
  for removal.
- **The web:** every call moved to `/v1/…` (features' API files, the notices stream, the hand-off), Playwright mocks
  (`**/api/v1/**`) and regex routes with it; docs comments follow. Checked on port 3000: the pages call
  `/api/v1/…` and get 200, the event stream included.
- **Tests:** `routes.http.spec.ts` and `permissions.http.spec.ts` run every route under `/v1/` too (the same anonymous
  answer and activity event; the same permission matrix): 516 tests; the contract reads both prefixes (76 writes
  each, one for one) and the middleware's lists; registry spec. All green.
- **Not done:** Swagger marking `/office/…` deprecated (documentation only; the paths are listed twice).

## R.11c Final legacy route removal — BLOCKED_EXTERNAL_VALIDATION

- **Why blocked:** removing `/office/*` safely needs evidence that only a deployment can give: a release that serves
  both paths (R.11b) running long enough that its logs show no `[LegacyPaths] old paths used:` line, and no web image
  older than R.11b remaining as a rollback target. Local tests cannot show what real browsers and caches call.
- **Conditions to complete:** (1) R.11b deployed (API first, then worker, then web); (2) one full release with no
  old-path line in the API logs; (3) the previous web image retired as a rollback target; (4) the owner's word.
- **Then the slice is small:** `RESOURCE_PREFIXES = ['v1']` (the middleware's `office` twins go with it);
  `LegacyPathCounter` and `LegacyPathsModule` deleted; the route specs' `/office/` rows replaced by the `/v1/` ones;
  `scripts/backup/rehearsal-smoke.mjs` and the Arabic handover move to `/v1/…`; `canonicalPath` keeps mapping to one
  prefix (`v1`), which resets the guard's keys once at that deploy (a 10 s / 24 h window).
- **Rollback rule introduced by R.11b (recorded in the Arabic handover):** the new web calls `/v1/…`, which an API
  image older than R.11b does not serve. Deploy the API first; never roll the API back alone below R.11b while the new
  web runs: roll the web back first. The old web against the new API works.

## Final verification (2026-11-14)

- **Static:** lint 0 (api, web), typecheck 0 (api; web outside the git-ignored `audit-output/` and `.next-view/`),
  check:copy 0, architecture guards: every count at 0 but `root-domain-code` 2 and
  `transaction-outside-unit-of-work` 2 (both stated), `module-surface` in force for 5 of 12 modules.
- **Schema drift:** `prisma migrate diff --from-config-datasource --to-schema` against the migrated test database:
  empty; no file under `prisma/migrations` changed.
- **Playwright (full):** 239 passed, 2 skipped (as at the base).
- **Full API run 1 (after R.11b):** 140 files, 2036 tests: 1983 passed, 53 failed in 2 files. `response-shape`: I
  edited the spec during the run (the renamed web types); `get-writes-nothing`: its `beforeAll` passed 5 s with the
  load at 20. Both alone: green.
- **Full API run 2 (after the review fixes):** started with the load at 66 (macOS `mediaanalysisd` at about 294 % CPU,
  measured); 1996 passed, 40 failed in 6 files, every one a time limit (78 hook or test timeouts, and P2028 "unable to
  start a transaction in the given time" in the settlement's concurrency test). The six files alone, with the load
  under 10: 127 passed. **No fully green full run was obtained on this machine after R.11b**; the last fully green
  one is checkpoint 1 (R.5: 1771/1771). GitHub CI is the arbiter.
- **Independent review (two agents that had not seen the work):** money, transactions and worker: approve, no
  defect; one optional point (run modes' transaction under Prisma's 5 s) already recorded. Security, routes and web:
  no critical, high or medium; lows: anonymous rows on the two new records (fixed in `808f49f`), the sign-in limit's
  regexes miss a trailing slash or upper case (as before this project), `canonicalPath` is case-sensitive (only
  weakens a repeat's detection for `/V1/…`); medium operational: new web against an old API (rollback order
  documented).

## After the push (2026-11-16)

- **Pushed.** The owner pushed `main` on 2026-11-16: the fifteen commits above (`000e411`..`a84484f`) and, on top of
  them, the UI maintenance and the Tailwind and Radix migration (ADR 0021, 0022; 110 commits). `main` equals
  `origin/main` at `bbdde78`.
- **GitHub CI is green on that code.** The first run that holds every slice of this report is `43886154244` (head
  `4e71b27`), then `43891079296` and `43901270605` (head `bbdde78`): lint, check:copy, check:styles, typecheck, the
  full `test:api`, the `.db.spec.ts` files on PostgreSQL, the build and Playwright, all passed. This settles the
  line above that no fully green full run was obtained locally after R.11b.
- **The UI work changed nothing this report covers.** `git diff a84484f..bbdde78` holds no file under `apps/api`;
  outside `apps/web` it holds the `check:styles` step in CI, one script in the root `package.json` and docs. No
  name removed by W.1 and W.2 is back in `apps/web`, and the web still calls `/v1`.
- **Not known from here:** whether any deployment runs this code. The release order of R.11b (API, then worker,
  then web; rollback in the reverse order) applies to the first one that does, and R.11c stays blocked until then.

## R.12 Surfaces for the other seven modules — DONE (2026-11-16)

- **What:** `index.ts` for `platform`, `identity` (`modules/auth/`), `access`, `catalog`, `pricing`, `wallets`,
  `providers`: each re-exports exactly the names other modules imported (platform 110 names from 30 files, access
  25, pricing 32, catalog 28, providers 10, wallets 9, identity 8). 283 file-and-module pairs now name a surface; three
  re-exports (`auditing/activity-log.ts`, `notifications/notice-kinds.ts`, `notifications/notice.service.ts`) were
  pointed by hand. No statement other than an import or a re-export changed, but one: `access/actor.interceptor.ts`
  declares `type Actor` beside the `Actor` decorator, because a surface cannot re-export one name from two files
  (`types.ts` and the interceptor); importers keep their text (`Actor`, `Actor as ActorShape`).
- **Guard:** `module-surface` lists all twelve modules, typed `Record<ModuleName, string>`. Counts unchanged
  elsewhere.
- **Checked:** api typecheck 0, lint 0; `architecture*.spec.ts` 64/64. A batch of 42 files (routes, permissions,
  response shape, worker wiring, registry, the HTTP security specs, the activation settlement, the dispatch and
  ports database specs, every spec of catalog, pricing, wallets and access) on PostgreSQL and Redis.
- **One failure, not explained:** in the first run of that batch (load 5.7 at the start) one test of 936 failed:
  `provider-dispatch.db.spec.ts` › "forty rounds of a pause against a dispatch, at once", the file at 185.6 s. I had
  filtered the output, so the assertion's text was not kept. The file alone passed (52 tests, 35.5 s), and the same
  batch run again with its output kept passed whole (936/936, 109 s, load 6.5 to 9.0). Not attributed to load or to
  this slice: neither is proved. Recorded in `docs/superpowers/plans/2026-11-10-open-items.md`. The full suite is
  for GitHub CI.

## R.A completed: the auth controller — DONE (2026-11-16, the owner's word)

- **What:** `auth.controller.ts` (622 lines, 35 routes) is three controllers on the same `auth` prefix:
  `sign-in.controller.ts` (7 routes), `own-account.controller.ts` (15), `account-security.controller.ts` (13).
  Every route keeps its path, its decorators (Swagger included), its status, its body and its cookie. The handlers
  were generated from the old file: the decorators and the signature of each are its text, the body rewritten to
  one shape (ask the service, record, answer). `auth-http.ts` holds the request helpers and `answer`;
  `auth-records.ts` (`AuthRecords`, a provider of `AuthModule`) holds the three shapes of a record.
- **Records, one for one:** a refusal under the request's session; a done action under the session it left when
  the route replaces it (`password`, `two-factor/verify`, the two confirmations), else the request's; the two
  routes an anonymous request reaches record only when a session came (`ownIfSignedIn`); a passkey removal is
  recorded when done only, and a refused passkey sign-in only when it named an account — both as before.
- **Specs changed, and why:** `http-security-contract.spec.ts` (24 controllers, the 35 `/auth` routes counted, the
  three files named where the one was, the by-hand pattern reads `records.…(`), `architecture.spec.ts` (the same
  pattern in `write-without-activity`), one fixture path in `architecture-boundaries.spec.ts`. No expectation about
  a route, a status, a body or a record changed.
- **Checked:** typecheck 0, lint 0; the 20 spec files of `modules/auth`, the HTTP security contract, the
  architecture guards, `routes.http`, `permissions.http`, the registry, the response shapes and the OpenAPI specs:
  26 files, 788 tests passed (after the guard's pattern was updated; before it the guard counted 21 routes as
  unrecorded, which was the pattern, not the routes). On port 3000: `/api/auth/profile` 401 without a session,
  `/api/auth/login` 401 `BAD_CREDENTIALS` for an empty body.
- **Not done, on purpose:** the audit's "activity through the interceptor" and "0 branches" (plan, R.A).

## R.11c Legacy route removal — DONE on the owner's word (2026-11-16)

- **The condition that was not met.** The slice was blocked on a deployed release that served both paths and
  showed no old-path hit, and on no web image older than R.11b being a rollback target. No such release was
  observed from here; the owner asked for the removal as it is. The cost is stated in the handover (Arabic,
  sections 13 and 14): a web older than R.11b gets 404 from this API, and a deployment older than R.11b cannot
  reach this release in one step without an interruption (two steps through `bbdde78`, or one maintenance window).
- **What changed:** `RESOURCE_PREFIXES = ['v1']` (`platform/route-prefixes.ts`); the 19 resource controllers and
  the middleware's single-route rules follow from that list. `platform/legacy-paths.ts`, `LegacyPathsModule` and
  its spec removed, with the module's line in `registry.ts`. Specs and the route table call `/v1/…` (a mechanical
  `/office/` → `/v1/` in 32 files); the tests written for the two-prefix period are replaced: `routes.http.spec.ts`
  now proves each of the 132 old paths answers 404 and records nothing; `permissions.http.spec.ts` runs the matrix
  once; `http-security-contract.spec.ts` counts 103 write routes (76 under `/v1`, 26 under `/auth`, 1 branding)
  where it counted 179 with the twins.
- **What did not change, on purpose:** the duplicate guard's key. `canonicalPath` still gives a resource path the
  form it had under the first prefix before it is hashed, so an `Idempotency-Key` (24 h) or a same-write key
  (10 s) stored by a release before the removal matches the same write after it. The contract spec pins that form.
- **Checked:** api typecheck 0, lint 0 (api, web). The 28 changed spec files on PostgreSQL and Redis: 836 passed.
  Auth, the architecture guards, the duplicate guard and the worker wiring: 25 files, 268 passed. On port 3000:
  `/api/v1/me` and `/api/v1/lines` 401 without a session, `/api/office/me` and `/api/office/lines` 404, health 200.
  The web holds no `/office/` path (no web file changed). The full API suite and Playwright are for GitHub CI.
- **For the plan that follows (package durations, D.5):** it names `platform/legacy-paths.ts` to count the callers
  of the routes it retires. That file is gone; D.5 needs its own counter or none.
- **Corrected the same day (owner: nothing in the old form is to stay; the system runs on trial data only):**
  `canonicalPath` and its `/office` form are removed; the guard hashes `req.originalUrl`. A key stored by a
  release that had the old form does not match after this one (10 s for a same write, 24 h for an
  `Idempotency-Key`): accepted by the owner. The contract spec pins the new line. The "did not change, on purpose"
  point above no longer holds.

## Clean-up before the package plan — DONE (2026-11-16, the owner's word)

The owner: the system runs on trial data until launch; nothing is kept in an old form for compatibility. The ten
points are in the plan (`office-retirement`, "Clean-up before the package plan"). What is worth knowing beyond it:

- **Two migrations**, both applied to the test database and to this machine's own: `20261116100000_task_table_names`
  (renames only; `prisma migrate diff` against the schema is empty after it) and `20261116110000_task_log_lines_stamped`
  (text of `Task.log` only: 8 unstamped lines of 2026-11-03 on this machine's data, 0 after it). An API image older
  than this code does not run on a database that has them: the three services are released together (handover,
  section 13).
- **A real gap closed:** `/auth/login/` and `/AUTH/LOGIN` answered as the sign-in route (checked on the running
  copy) and the per-address sign-in limit never counted them. The new test failed on the old middleware and passes
  on the new one. The per-login failed counter was never affected.
- **Guards:** every count in `architecture.baseline.json` is 0.
- **Tests, as run:** each point's spec files on PostgreSQL and Redis, green: the rename (16 files, 252 tests, after
  one expectation's order was corrected: the index exists, the list is sorted), the comment clean-up (9 files, 399),
  the middleware (3 files), the unit of work and the stand-ins that take its transactions (6 files), the
  command-line scripts and the guards (11 files, 118), the dispatcher specs (3 files, 92), the tasks (6 files, 63).
  The auth specs failed once on time limits and passed on the measured rerun (open items, 2026-11-16).
- **Seen and left, a design question for the owner:** every refused write is recorded with the caller's address,
  an anonymous one included, and an anonymous caller has no rate limit outside the three sign-in routes. So a
  caller with no session can add activity rows as fast as it can send requests. The log is purged after 90 days.
- **Not run locally:** the full API suite and Playwright (machine limits). GitHub CI decides after the push.
- **The intermittent "forty rounds" failure is explained.** A last batch of 80 files (1372 tests; load 3 before, 15
  during, 14 after) failed that one test again, this time with its text kept: the sale of a round took the manual
  route because the spec's single worker attestation (60 s) had run out, the file being at 264 s. The test now
  attests each round. With that: the six heavy database spec files together, 211 passed. The other 1371 tests of
  the batch passed. Details in the open items.

