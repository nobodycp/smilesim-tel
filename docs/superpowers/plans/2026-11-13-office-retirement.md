# Plan: retiring `office` (ADR 0020)

Audit, target design, renaming table, compatibility and risks:
`docs/architecture/2026-11-13-backend-audit-and-office-refactor-plan.md`. This file is the checklist.

Rules for every slice: behaviour-preserving (same routes, shapes, activity, permissions, SQL); no transaction
body, statement order or lock order is edited (`docs/architecture/financial-invariants.md`); one slice a commit;
lint, typecheck, check:copy, the full API suite with PostgreSQL and Redis, and Playwright green; the baseline only
goes down; the backend map updated in the same commit.

- [x] **R.0 Safety baseline.** Guards that name no folder (`architecture-map.fixture.ts`,
  `architecture-boundaries.spec.ts`), the existing rules widened to every module, the HTTP security contract,
  the worker wiring contract, the financial invariants in one file. No production file changed. Commit: see
  `git log --grep 'R.0'`.
- [x] **R.1** `OfficeFailure` → `ApiFailure` (`shared/office-failure.ts` → `shared/api-failure.ts` by `git mv`; 111
  references in 70 files and the lint rule that names the file; `fail(status, code)` unchanged; no alias kept:
  nothing outside `apps/api` used the name). `api-failure.spec.ts` pins the contract. Commit: see `git log --grep 'R.1'`.
- [x] **R.2** Auditing and notifications out of the umbrella (`modules/auditing`, `modules/notifications`), two ports
  in the platform: `shared/notices.ts` (`NoticeWriter`; the unit of work holds it, `NoticeService` implements it) and
  `shared/activity.ts` (`ActivityRecorder`; `PrismaActivityRecorder` implements it; sign-in and every controller
  record through it). Auditing owns recording and reading and sits above access (ADR 0020, amended). No route,
  table, Redis channel, message or transaction changed. `module-layering` 32 → 28, `module-mutual` 14 → 10.
  Corrections before the push: one CSV writer in the platform (`shared/csv.ts`, byte for byte the old output,
  `csv.spec.ts`), so auditing does not import reporting; the worker closes the notice writer it built, after its
  running rounds and jobs (`worker-shutdown.spec.ts`).
  `shared/ports.db.spec.ts` on PostgreSQL and Redis. Commit: see `git log --grep 'R.2'`.
- [x] **R.2.1** The worker's stop (`workerShutdown`): a test that runs it with the real readiness loop and timers
  showed that, while a slow readiness round finished, the timers still started relay, recovery and sweep rounds
  (readiness was awaited before the timers were told), and that SIGTERM then SIGINT let go of everything twice.
  Now everything that starts work is told in the same turn, then the running work is waited for, then the notice
  writer, then the connections; a second call gets the first one's promise. No timeout, queue, money or dispatch
  rule changed. How long a stop may take is not bounded by a constant: each path is bounded only by its own
  limits (a transaction's 5 s, a queue publish's 5 s, a provider call's 30 s), and plain reads have none.
  Commit: see `git log --grep 'R.2.1'`.
- [x] **R.3** Rules to their owners; the kernel dissolved into platform and access. `modules/shared/` is
  `modules/platform/` (with the unit of work, `query`, `values` and `PlatformModule`); the actor, the tree, the
  policy and the grants are `modules/access/` (`AccessModule`, which imports `AuthModule` and hands on nothing of
  it: notifications and accounts import it themselves); the rules went to catalog (`package-prices`, `actions`,
  `run-modes`, `sim-rules`, `package-code`), pricing (`prices`, `user-terms`, `line-prices`, `profit-ladder`,
  `package-terms`, `line-terms`), wallets (`sale`, `ceiling`), sales (`periods`, `line-filters`), tasks
  (`task-status`) and the platform (page sizes); `Layer` is the platform's (`doors.ts`), `PathNode` access's. Split
  files keep every function's body as it was. New guard `catch-all-module` (no `kernel` by name; a Nest module
  exports only what its module owns). `module-layering` 28 → 19, `module-mutual` 10 → 8 (catalog ↔ pricing is
  new: `packages.service.ts` still prices, R.8), `root-domain-code` 5 → 4. Commit: see `git log --grep 'R.3'`.
- [x] **R.4** Tasks and sales untangled (`tasks` imports nothing of `sales`). The task-facing rules moved to
  `tasks/task-operation.rules.ts` (text unchanged); the line and claim locks reach `openTask` as the `OpeningLocks`
  port sales hands in (same functions, same points); the cancel's one operation write is the operations'
  repository's (`markAbandoned`, through `ProviderOperationsService.abandonRequested`; `TasksService` injects the
  service, `TasksModule` imports `ProvidersModule`); `stored-text.ts` and `esim-code.ts` are the platform's;
  `DEPENDS_ON` gains `tasks → providers` (ADR 0020, amended). `module-layering` 19 → 11, `module-mutual` 8 → 6,
  `operation-writes` 1 → 0. Lines, tasks, providers, wallets, worker and HTTP contract specs on PostgreSQL and
  Redis: 74 files, 1210 tests. Commit: see `git log --grep 'R.4'`.
- [x] **R.5** One composition for the worker. `src/worker/composition.ts`: the money path's classes
  (`WORKER_MONEY_PATH`) built by `composeWorker` from the constructor metadata Nest reads, once each; the worker
  hands in three tokens (its unit of work, its operations service, an auth store it never reads) and calls `new`
  on none of the twelve classes. A Nest application context was not used: it would start the API modules' timers
  (provider health, line snapshots) in the worker. `src/provider-dispatch.ts` → `src/worker/provider-dispatch.ts`
  (owner `app`, no query: guarded); `readCredentials` and `startReadiness` → `providers/dispatch/worker-readiness.ts`,
  the attestation in `uow.runTx` (the same statements; `runTx` is the client's transaction with the same defaults
  and publishes nothing when nothing is queued). `worker-wiring.spec.ts` holds the description to the API's
  providers. `root-domain-code` 4 → 3 (the command-line scripts stay: `node dist/<name>.js` is in the handbook),
  `transaction-outside-unit-of-work` 5 → 4. Full API: 138 files, 1771 tests. Commit: see `git log --grep 'R.5'`.
- [x] **R.6** Sales (`lines`, settlement, decisions). `office/lines/` → `modules/sales/` by `git mv` and import paths;
  the completion, the settlement, its rules and the decisions → `modules/sales/settlement/` (the line repository is
  `modules/sales/lines.repository.ts`, so the settlement imports it from inside its module: `cross-domain-repository-
  import` stays 0); `office-esim.ts` → `esim-activation-code.ts`. Nest classes keep their names (`LinesModule`).
  `transfers` stays in `office/` until R.8 (it moves an account and a line). Commit: see `git log --grep 'R.6'`.
- [x] **R.7** Providers in three folders (directory, account, integration) under `modules/providers/`; the module,
  its repository and its schemas at the module's root (so each folder reads the repository from inside its module).
  `GET provider-operations` (the operations with their match state) moved from `WalletsService`/`WalletsController`
  to `ProviderAccountsService`/`ProviderAccountsController`: same path, decorators, permission and answer; it reads
  the priced operations through the wallets, so `wallets → providers` is gone (the wallets' unused provider query
  removed). `report-csv.ts` → `modules/wallets/` (money as text). `production-config.ts` is bootstrap (owner `app`).
  The reconciliation's transaction and the run modes' batch run in `uow.runTx` (same writes, same order; the batch
  form had no interactive time limit, the interactive one has Prisma's 5 s: a provider with very many following
  packages would meet it; recorded). Guard: the integration imports nothing of the directory or the account.
  `module-layering` 11 → 7, `module-mutual` 6 → 3, `root-domain-code` 3 → 2, `transaction-outside-unit-of-work`
  4 → 2. Commit: see `git log --grep 'R.7'`.
- [x] **R.8** Catalog, pricing, wallets, access, reporting. Every domain folder left `modules/office/` (`git mv`):
  `access/{accounts,roles}`, `catalog/{shipped,companies,packages,offers}` (`office-catalog.ts` →
  `shipped-catalog.ts`), `pricing/`, `wallets/`, `tasks/`, `sales/transfers/`, `reporting/{reports,desk}`,
  `platform/outbox/`. Code: the priced shelf and the sell prices (`list`, `setSellPrice`, `clearSellPrice`, their
  three routes and their queries) moved from the packages to pricing (`PackageShelfService`,
  `PackageShelfController`; same paths, decorators, answers); access declares two ports (`AccountWallets`,
  `AccountTasks`), bound globally by wallets (`WalletLedger.lockWallets`) and tasks (`TasksService.releaseHandledBy`,
  the frozen account's tasks, moved with its query; the tasks' identical `releaseTask` reused). `module-layering`
  7 → 0, `module-mutual` 3 → 0. `modules/office/` holds `office.module.ts` and `testing/`. Full API: 138 files, 1772
  tests, 2 files failed and analysed (see the report). Commit: see `git log --grep 'R.8'`.
- [x] **R.9** The umbrella goes; public surfaces in force (`module-surface`). `OfficeModule` deleted; the registry
  lists one module per domain and the platform's `DuplicateGuardModule` (the same `APP_INTERCEPTOR`); test helpers in
  `modules/testing/` (`ApiFacade`, `ServiceGraph`, `apiTestApp`, `routes.ts`, `DOMAIN_CONTROLLERS`/`DOMAIN_PROVIDERS`);
  the `flat-office-module` rule went with the file it judged; `module-surface` in force for reporting, auditing,
  notifications, tasks and sales (generated from the real imports; a composition root may reach inside); one
  Swagger tag a module; `recordOffice`/`recordOfficeOrFail` → `record`/`recordOrFail`, the request's `officeActor` →
  `actor`. Found and fixed: the move made two web cross-check suites skip silently (17 tests, wrong relative path);
  each now has a test that fails if it cannot find the web. Commit: see `git log --grep 'R.9'`.
- [x] **R.10** Prisma models `Task`, `TaskNote` with `@@map("OfficeTask")`, `@@map("OfficeTaskNote")`; no migration.
  `prisma migrate diff --from-config-datasource --to-schema` against the migrated test database: empty before the
  change and empty after it (constraint and index names follow the table, so they did not move). Code: the client's
  delegates `officeTask`/`officeTaskNote` → `task`/`taskNote`, the types `Prisma.OfficeTask*` → `Prisma.Task*`; raw
  SQL, constraint names and the sealing script's table list keep `OfficeTask` (database names). The fault-injection
  spec names the model `Task` (Prisma's query hooks are given the model's name). Commit: see `git log --grep 'R.10'`.
- [~] **R.A** `auth.controller.ts` thinned; the seven unrecorded writes judged. **Partial.** Done: the two gaps are
  recorded (`PATCH /auth/profile` as `password` when a new password is sent, else `user_contact`;
  `DELETE /auth/two-factor` as `two_factor`; success and refusal; the action and the account only, chosen through the
  schema, never a value), the five steps declared `@NoActivity('a step: …')`; `write-without-activity` 7 → 0;
  `own-activity.http.spec.ts` proves no password, value or code reaches a record. Not done: thinning the controller
  (35 routes of sign-in, sessions and second steps): a structural change to security code that no test asked for;
  left for its own slice. Commit: see `git log --grep 'R.A'`.
- [x] **W.1, W.2** Web names. `components/office-{shell,frame}.tsx` → `app-{shell,frame}.tsx` (`AppShell`,
  `AppFrame`); `lib/office-session.tsx` → `lib/desk-session.tsx` (`DeskSession`, `DeskContext`, `DeskMe`,
  `useDesk`); API methods lose the `office` prefix (`officeLines` → `lines`, …); query keys root `'office'` → `'api'`
  (one root as before, so every invalidation by prefix is unchanged); CSS `.office`/`.office-main` → `.app-shell`/
  `.app-main` (the same rules); copy key `navOffice` → `navDesk` (same texts); `serveOffice` → `serveApi` in tests.
  Paths `/office/*` stay until R.11. Checked on port 3000 (signed in as the local trial owner): home, numbers and
  companies render as before, `.app-shell` is `display: flex`, 100dvh; `tools-pages` and `users-desk` Playwright 22/22.
  Commit: see `git log --grep 'W.1'`.
- [x] **R.11a** The duplicate guard separated from the prefix: `DuplicateGuardInterceptor` reads
  `@NotDuplicateGuarded(why)` from the route's controller or handler and never the path; `AuthController` and
  `BrandingController` say it (sign-in answers are never kept or replayed). The guarded routes are exactly those of
  before (the 76 `/office/` writes) and stay so wherever they move: proved on the real routes and over HTTP (a write
  under `/v1/` now runs once and honours its key; a not-guarded controller runs every repeat and keeps nothing).
  `PATCH /auth/profile` judged: its current password is its equivalent (a repeat after the change is refused and
  changes nothing), and its answer is personal data not to be kept for a replay; standing `equivalent`. The
  middleware's path lists (`/office/handoff` as a sign-in and a session start, the notices stream exempt from the
  limit) name single routes, not a prefix: they gain the new paths beside the old in R.11b. Commit: see
  `git log --grep 'R.11a'`.
- [x] **R.11b** Both paths served; the web moved; old-path hits counted for one release. Every resource
  controller is `@Controller(RESOURCE_CONTROLLER_PREFIXES)` (`/v1` and `/office`, `platform/route-prefixes.ts`); the
  middleware's single-route rules name both (`resourcePaths`); the duplicate guard keys the canonical path, so one
  write sent to both paths runs once; `LegacyPathCounter` logs old-path hits by method and route pattern every ten
  minutes, nothing else of the request; the web calls `/v1/…` (features, the notices stream, the hand-off; its
  Playwright mocks follow). Proved: `routes.http` and `permissions.http` assert the same answer, event and
  permission for every route under `/v1` (516 tests), the contract asserts both prefixes one for one and the
  two-path write, `legacy-paths.spec.ts` the counter; checked on port 3000 (`/api/v1/…` answers, the stream
  included). Handover (Arabic) says what the log line means. Commit: see `git log --grep 'R.11b'`.
- [x] **R.12** A public surface for the other seven modules (2026-11-16): `platform`, `identity`
  (`modules/auth/index.ts`), `access`, `catalog` (hands `modules/branding` too), `pricing`, `wallets`, `providers`.
  Each `index.ts` re-exports exactly what other modules imported; the importing files (283 file-and-module pairs) point at the surfaces; no
  other statement changed. `module-surface` is in force for all twelve, and its list is typed by the modules, so a new
  one cannot be added without a surface. `access` hands the `@Actor()` decorator and the actor's shape under the
  one name `Actor` (declared together in `actor.interceptor.ts`): one name cannot be re-exported from two files.
  Commit: see `git log --grep 'R.12'`.
- [ ] **R.11c** `/office/*` removed. **BLOCKED_EXTERNAL_VALIDATION** (2026-11-14). It needs what no local test can
  give: a deployed release that serves both paths (R.11b) and whose logs show no `[LegacyPaths] old paths used:` line
  for the whole release, and no web image older than R.11b left as a rollback target. Then: `RESOURCE_PREFIXES =
  ['v1']`, the `office` twins leave the middleware's lists by themselves, `LegacyPathCounter` and its module go,
  the route specs drop the `/office/` rows, and `scripts/backup/rehearsal-smoke.mjs` and the handover move to
  `/v1/…`. Until then nothing is removed.

Before S.12b: R.0, R.1, R.2, R.3, R.4, R.5, R.7.

## Open from R.0 (not closed, only measured)

| Guard | Count | What it is | Closed by |
|---|---|---|---|
| `module-layering` | **0** (was 32; R.2 closed 4, R.3 9, R.4 8, R.7 4, R.8 7) | imports the target graph does not allow | R.3–R.8 |
| `module-mutual` | **0** (R.8 closed access ↔ tasks, access ↔ wallets, catalog ↔ pricing; R.7 closed providers ↔ wallets, providers ↔ reporting, platform ↔ providers; R.4 closed sales ↔ tasks, providers ↔ tasks; was 14; R.2 closed access ↔ notifications, auditing ↔ identity, platform ↔ notifications, notifications ↔ sales; R.3 closed identity ↔ platform, access ↔ pricing, access ↔ sales and opened catalog ↔ pricing, closed by R.8) | pairs of modules that import each other | R.3–R.8 |
| `root-domain-code` | 2 (R.3: `doors.ts`; R.5: the worker's wiring; R.7: the start-up check is bootstrap; left: two command-line scripts that reach a module, whose `dist/` path operators run) | domain code at `src/` root | R.3, R.5 |
| `operation-writes` | 0 (R.4) | `tasks/task-operation.ts` wrote a provider operation | done |
| `transaction-outside-unit-of-work` | 2 (R.5: the attestation; R.7: the reconciliation and the run modes; left: the auth store's boot seeder and the eSIM sealing script, both stated) | `$transaction` beside `UnitOfWork` | R.3, R.5, R.A |
| `write-without-activity` | 0 (R.A) | sign-in routes that recorded nothing | done |
| `module-surface` | in force for all twelve (R.9: five; R.12: the other seven) | — | done |
| unguarded writes | 27 | `auth` and `branding` writes have no duplicate guard: 1 needs protection, 16 have an equivalent, 10 are authentication steps that are never replayed (below) | R.11a, R.A |
| lock order | no guard | written in `financial-invariants.md`, held by the PostgreSQL specs | stays a review rule |
| unused exports | not scanned | no tool for it is installed; none was added in R.0 | a later slice, with the owner's word on the tool |

## R.0 verified (2026-11-13): what each count is

**The counts do not fall by moving files.** Proved on a scratch copy of the repository (a separate worktree,
removed afterwards): all 262 files of `modules/office/` were moved up to `modules/`, every import rewritten, and
the map's patterns changed with them. The copy type-checked, and the four guard specs passed against the **same**
baseline: 32, 14, 5, 1, 5, 7 and the zeros. Six made-up violations inside the moved tree were each caught. Three
things hold this from now on: `unmapped-file` (a file no pattern covers), `dead-owner-pattern` (a pattern no file
matches), and the floors of "looks at the real source" in both specs; a who-writes rule also fails when its
pattern matches nothing in its owner. The simulation found one fault in R.0 itself: the widened
`cross-domain-repository-import` read a folder position; it now compares folders and names none.

### `write-without-activity` = 7

The auth service and its store record no activity: only the controller does. So these seven leave no record
anywhere. The rule was right; it had not looked at `auth` before R.0.

| Route | Verdict | Why |
|---|---|---|
| `PATCH /auth/profile` | **gap** | changes e-mail, phone and password with no record; `POST /auth/password` records the same change, success and failure |
| `DELETE /auth/two-factor` | **gap** | an account turns its own second step off with no record; the owner clearing another account is recorded |
| `POST /auth/two-factor/setup` | step | issues a secret; `…/confirm` records the enrolment, success and failure |
| `POST /auth/two-factor/method` | step | sends a code; `…/method/confirm` records, success and failure |
| `POST /auth/two-factor/send` | step | sends a code; `…/verify` records, success and failure |
| `POST /auth/passkeys/options` | step | issues a challenge; `POST /auth/passkeys` records, success and failure |
| `POST /auth/passkey-login/options` | step | issues a challenge; `POST /auth/passkey-login` records the sign-in, success and failure |

Two real gaps, five steps the rule cannot be told about (the auth controller has no `@NoActivity`). A record of
any of them may hold the action and the account only: never a password, a code, a secret or a challenge (the
profile body carries the current and the new password; `setup` answers the secret). Closed by R.A: the two gaps
recorded, the five steps declared. Nothing was changed in R.0.

### The 27 writes with no duplicate guard

| Standing | Count | Routes |
|---|---|---|
| **Needs protection** | 1 | `PATCH /auth/profile`: with a new password the same request sent twice is refused the second time for a change that was made |
| **Has an equivalent** | 16 | a send limit (`two-factor/method`, `two-factor/send`); a challenge used once (`POST /auth/passkeys`); a delete (`sessions/:id`, `two-factor`, `two-factor/:loginName`, `passkeys/:id`); a stated value or state (`users/:loginName/password`, `users/:loginName/disable`, `policy`, `exemptions/:loginName`, `session-rules/:layer`, `users/:loginName/two-factor`, `users/:loginName/contact`, `users/:loginName/session-rules`, `PUT /branding`) |
| **Never replayed** | 10 | authentication steps whose answer is a session, a secret or a challenge: `login`, `passkey-login/options`, `passkey-login`, `logout`, `password`, `two-factor/setup`, `two-factor/confirm`, `two-factor/verify`, `two-factor/method/confirm`, `passkeys/options` |

The guard is not to be widened to sign-in, passkeys or one-time codes: it keeps an answer and hands it to a
repeat. R.11a separates the guard from the prefix for the routes that are guarded today and judges the one route
that needs protection; `http-security-contract.spec.ts` pins the three counts and fails for any write route that
is outside the prefix and not stated. A route of `/office/*` that moves is caught whichever way it moves
(proved on the real routes: one moved, and all 76 moved).

### `operation-writes` = 1

`tasks/task-operation.ts` `withdrawOperation`: when a task is cancelled before its operation was ever sent, the
operation is closed as `failed (abandoned)` inside the cancel's transaction, under the task's lock and then the
operation's. **The place in the transaction is necessary; the place in the source is the violation.** R.4 moves
the one guarded statement into the operations' repository, called with the same client at the same point. No
statement, guard or order changes.

### `transaction-outside-unit-of-work` = 5

| Site | Verdict |
|---|---|
| `seal-esim-codes.ts` | necessary: a script with its own client, run by hand; stays stated |
| `provider-dispatch.ts` (`attest`) | necessary today: the worker's attestation with the provider's row `FOR SHARE`; it moves under the worker's unit of work in R.5, same statements |
| `auth/prisma-auth.store.ts` | accepted: the boot seeder of trial accounts; `identity` has its own store and writes no notice |
| `providers/provider-accounts.service.ts` | **real**: a service opens a transaction on the root client beside `runTx`; R.7 |
| `providers/providers.repository.ts` (`saveModes`) | **real, small**: a batch of updates as one array transaction; R.7 |

None is on the path of a sale, a hold, a capture or a verdict.

### `module-mutual` = 14 (and the 32 imports behind them)

| Pair | Cause | Kind |
|---|---|---|
| sales ↔ tasks | `tasks` reads the settlement's task rules, the eSIM code helpers and the claim and line locks from `lines` | **real** (audit H1). The locks must stay where they are in the transaction: R.4 moves who owns the helper or adds a port, never the order |
| providers ↔ tasks | `tasks/task-operation.ts` locks and withdraws its provider operation; `provider-health` reads a stored note | the first is a **necessary coupling** (a task and its operation are locked together); R.4 decides whether the target graph should allow `tasks → providers`. The second is a constant in the wrong place |
| access ↔ wallets | deleting an account locks its wallet in the same transaction; `kernel.providers.ts` lists `WalletLedger` | the lock is **necessary**; the direction is decided in R.8 without touching the transaction. The list is test support in production |
| access ↔ tasks | freezing an account hands its tasks back with a stored note | real coupling; R.8 |
| platform ↔ notifications | `UnitOfWork` imports the notice writer to publish after commit | **real** (audit H3); a port in R.2, the publish-after-commit behaviour unchanged |
| access ↔ notifications | `KernelModule` provides `NoticeService` | real; R.2 |
| access ↔ pricing | `AccountTree` reads `user-terms`; the kernel's list names `PriceLadder` | a rule in the wrong folder; R.3 |
| access ↔ sales | the kernel's list names `LineAccess` | test support in production; R.3 |
| auditing ↔ identity | the recorder hashes the session token with a helper of `auth` | a helper in the wrong folder; R.2 |
| identity ↔ platform | `doors.ts` at the root reads `auth/decide-login` | a file in the wrong place; R.3 |
| platform ↔ providers | the production settings check reads the dispatch settings and the adapter manifest | a start-up check that knows a domain; R.7 |
| providers ↔ wallets | the finance read uses the match simulator | a helper in the wrong folder; R.7 |
| providers ↔ reporting | the provider-account CSV uses `reports/report-csv` | a helper in the wrong folder; R.8 |
| notifications ↔ sales | `notice-kinds` reads a type of `transfers` | a type in the wrong folder; R.8 |

Three kinds: **necessary couplings inside a transaction** (three: task and operation, task and claim locks,
account and wallet), which are closed by ownership or a port and never by reordering; **real inversions** (four);
**placement** (the rest). No counter is to be lowered by changing a business rule.

## End of the project: all of these hold

1. No folder, file, class, type, function or variable named `office` in `apps/api/src` or `apps/web`, except:
   the table names `OfficeTask`, `OfficeTaskNote` and their constraints (behind `@@map`), raw SQL that names
   them, the migration folder `20261030000000_office`, and dated documents (specs, plans, ADRs).
2. No route under `/office/`; the web, its tests and the audits call the new paths only; old-path hits were zero
   for one full release before removal.
3. Every guard of `architecture.spec.ts` and `architecture-boundaries.spec.ts` at 0, `module-surface` in force
   for all twelve modules, and the baseline file holds only zeros.
4. `http-security-contract.spec.ts`: every authenticated write is guarded against duplicates whatever its path,
   or is on a stated list with its reason; every write records its activity or says why not.
5. `routes.http.spec`, `permissions.http.spec` and `response-shape.spec` pass with the new paths and the same
   permissions, events and shapes as before the project.
6. The worker and the API are composed from one description (`worker-wiring.spec.ts` or its successor).
7. `prisma migrate diff` between the database and the schema is empty: the project created no migration.
8. The financial invariants file is true to the code, and every PostgreSQL and concurrency spec of S.1–S.12b.0
   passes unchanged in what it asserts.
9. Full Playwright green in ar and en, light and dark; the visual check of the shell at every width (W.1).
10. The maps (`backend.md`, `frontend.md`), the rules files and the handover documents name no `office` structure.
