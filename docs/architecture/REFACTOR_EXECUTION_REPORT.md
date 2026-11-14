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
| R.4 Tasks and sales | DONE | see its section |
| R.5 Worker composition | pending | |
| R.6 Sales | pending | |
| R.7 Providers | pending | |
| R.8 Remaining domains | pending | |
| R.9 Umbrella removal | pending | |
| R.10 Prisma model names | pending | |
| R.A Authentication | pending | |
| W.1, W.2 Web names | pending | |
| R.11a HTTP security | pending | |
| R.11b Route migration | pending | |
| R.11c Legacy route removal | pending | |

## Guard counts

| Rule | Base `d7259ef` | After R.2.1 | After R.3 | After R.4 |
|---|---|---|---|---|
| module-layering | 28 | 28 | 19 | 11 |
| module-mutual | 10 | 10 | 8 | 6 |
| root-domain-code | 5 | 5 | 4 | 4 |
| operation-writes | 1 | 1 | 1 | 0 |
| transaction-outside-unit-of-work | 5 | 5 | 5 | 5 |
| write-without-activity | 7 | 7 | 7 | 7 |
| catch-all-module | — | — | 0 (new) | 0 |
| module-surface | not in force | not in force | not in force | not in force |

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

## R.4 Tasks and sales boundaries — DONE

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
