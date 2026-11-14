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
  table, Redis channel, message or transaction changed. `module-layering` 32 → 29, `module-mutual` 14 → 10.
  `shared/ports.db.spec.ts` on PostgreSQL and Redis. Commit: see `git log --grep 'R.2'`.
- [ ] **R.3** Rules to their owners; the kernel dissolved into platform and access.
- [ ] **R.4** Tasks and sales untangled (`tasks` imports nothing of `sales`). May change how services are composed
  (a port, a provider moved to another module); changes no business rule and no transaction.
- [ ] **R.5** One composition for the worker. May change how the worker is built (a shared factory, or a Nest
  application context); changes no business rule, no transaction, no queue, no job payload.
- [ ] **R.6** Sales (`lines`, settlement, decisions).
- [ ] **R.7** Providers in three folders (directory, account, integration).
- [ ] **R.8** Catalog, pricing, wallets, access, reporting.
- [ ] **R.9** The umbrella goes; public surfaces in force (`module-surface`).
- [ ] **R.10** Prisma models `Task`, `TaskNote` with `@@map`; no migration.
- [ ] **R.A** `auth.controller.ts` thinned; the seven unrecorded writes judged.
- [ ] **W.1, W.2** Web names.
- [ ] **R.11a** The duplicate guard and the path-named middleware rules separated from the prefix.
- [ ] **R.11b** Both paths served; the web moved; old-path hits counted for one release.
- [ ] **R.11c** `/office/*` removed.

Before S.12b: R.0, R.1, R.2, R.3, R.4, R.5, R.7.

## Open from R.0 (not closed, only measured)

| Guard | Count | What it is | Closed by |
|---|---|---|---|
| `module-layering` | 29 (was 32; R.2 closed 4 and made 1: `audit.service.ts` uses `reports/report-csv.ts`) | imports the target graph does not allow | R.3–R.8 |
| `module-mutual` | 10 (was 14; R.2 closed access ↔ notifications, auditing ↔ identity, platform ↔ notifications, notifications ↔ sales) | pairs of modules that import each other | R.3–R.8 |
| `root-domain-code` | 5 | domain code at `src/` root | R.3, R.5 |
| `operation-writes` | 1 | `tasks/task-operation.ts` writes a provider operation | R.4 |
| `transaction-outside-unit-of-work` | 5 | `$transaction` beside `UnitOfWork` | R.3, R.5, R.A |
| `write-without-activity` | 7 | sign-in routes that record nothing | R.A |
| `module-surface` | not in force | no module has a public surface | R.9, module by module |
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
