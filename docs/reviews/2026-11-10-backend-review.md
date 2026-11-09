# Backend review — `apps/api` — 2026-11-10

Read-only review at commit `4a15500` (`main`). Nothing was changed. Scope: API design, money and state paths,
authentication and authorization, structure, duplication, dead code. The frontend was out of scope.

How it was done: three focused reviews (API contract, money/state, security) plus a structure pass with
`tsc --noUnusedLocals`, an unused-export scan and grep. The findings in sections 1–2 marked **(verified)** were
re-read in the code by the lead reviewer; the others were confirmed by one reviewer reading the code path. Nothing
was executed against a running app, so every finding still needs a failing test before its fix.

Baseline: typecheck, lint and check:copy pass; CI is green.

---

## 1. Money and state — fix before real money runs through it

The wallet primitive is sound (see section 6). The problem is the **line**: its state is read before the
transaction and never locked or re-checked inside it.

| # | Finding | Where | Fix |
|---|---|---|---|
| M1 | **Refund paid twice through two disconnect tasks (verified).** `openTask` does not refuse a second open task for the same line and action, and `completeTask` settles a disconnect without checking the line is still `active`. `openPeriods` ignores earlier `disconnect` rows, so the second completion credits the same remaining value again. | `lines/lines.service.ts:695-715`, `tasks/tasks.service.ts:300`, `office-rules.ts:108` | Lock the line row (`SELECT … FOR UPDATE`) first in every line-mutating transaction and re-check its status; refuse a second open task per line + action (partial unique index). |
| M2 | **A stale freeze/unfreeze task revives a refunded line (verified).** The task writes `status: 'frozen'` / `'active'` by id with no guard on the current status. Disconnect → complete old freeze task → unfreeze gives an active line that was already refunded. | `lines/lines.service.ts:717-718` | `updateMany({ where: { id, status: <expected> } })`, fail on count 0. |
| M3 | **Immediate operations act on a line read outside the transaction.** Two concurrent disconnects both refund; two concurrent extends both debit and write the same `endsAt` (two charges, one period). Same for switch and restart. | `lines/lines.service.ts:324-353, 385-432, 440-481, 890-920` | Same line lock as M1. |
| M4 | **Paying tasks apply on a line in the wrong state.** A charge/extend task completed after the line changed state debits again or leaves the line disconnected. | `lines/lines.service.ts:719-758` | Same guard as M1. |
| M5 | **Freezing a staff account strands its tasks and their holds (verified).** `setFrozen` writes `status: 'pending'`, a status retired on 2026-11-09: `take`, `reject` and `completeTask` all require `working`. It also updates by id outside a transaction, so it can overwrite a `done` task. | `accounts/accounts.service.ts:274-286` | `updateMany({ where: { assigneeId, status: 'working' }, data: { assigneeId: null } })`; keep `working`; backfill existing `pending` rows. |
| M6 | **Activation task charges the opening price but records the completion price.** Debit = `task.posDelta` (price at opening); entry `packagePrice` = price at completion. A later disconnect refunds from the recorded price, so a price change between the two makes the refund larger or smaller than what was paid. | `lines/lines.service.ts:676-691` | Store the unit price on the task at opening and record that. |
| M7 | **Idempotency is a 10-second, fail-open body hash.** A Redis error counts as "not seen"; without `REDIS_URL` it is per-process memory; the web app sends no `Idempotency-Key`; an explicit key ignores method, path and body. Two legitimate identical activations within 10 s collapse into one. | `shared/duplicate-guard.interceptor.ts:79-87` | Client-generated key per form, stored in a unique column written in the sale transaction. |
| M8 | **ICCID reuse is never checked.** Only `@@index([iccid])`; the same SIM serial can be activated on two numbers and both are charged. | `prisma/schema.prisma` (Line), `lines/lines.service.ts:222-301` | Partial unique index on live lines + `SIM_TAKEN`. |
| M9 | **Lock order can deadlock (verified).** `fund` locks parent then child; `deduct` locks child then parent. Line flows lock wallet-then-line in one place and line-then-wallet in another. Postgres aborts one side → unmapped 500 (no money lost). | `wallets/wallets.service.ts:62-63` vs `89-90` | Lock wallets in sorted id order; one order for wallet and line everywhere. |
| M10 | **Root-client reads inside open transactions.** `accounts()`, `actorName`, `termsFor`, `freshMsisdn`, `resolveBuyPrice` use `this.prisma` while a transaction holds a connection; under load every connection waits for a second one until the 5 s default timeout. Pool size not verified. | `kernel/office-kernel.ts:240-246, 312`; `lines/lines.service.ts:664, 676` | Pass `tx` to every read inside `runTx`, or read before it. |
| M11 | **Provider cost is not snapshotted on most sales.** Editing a package's branch cost rewrites past purchases and the provider balance. | `kernel/office-kernel.ts:281`, `wallets/provider-cost.ts:42-47` | Always store `providerCost` on the entry. |
| M12 | Unique violations (number, login) surface as 500 instead of `NUMBER_TAKEN` / `LOGIN_TAKEN` (check-then-create). | `lines.service.ts:262-266`, `accounts.service.ts:~112` | Map Prisma `P2002` in a global filter. |
| M13 | To confirm with the owner: a disconnect on the last day is a 50-agorot **debit** but answers `debited: false`; a line transfer moves refund rights to the new point of sale while open tasks keep their hold on the old one. | `office-rules.ts:150`, `transfers/transfers.service.ts:171-183` | Decide and write the rule into `docs/project-plan.md`. |
| M14 | Schema: no foreign key on `WalletEntry.lineId`, `OfficeTask.posId/packageId/nextPackageId`; no `CHECK (held >= 0)`; status/kind/layer are free `String`. | `prisma/schema.prisma` | Add FKs and checks; move statuses to enums. |

## 2. Authorization and sessions

| # | Sev. | Finding | Where | Fix |
|---|---|---|---|---|
| S1 | High | **Staff with the `enter` grant can become the branch owner (verified).** `enter()` refuses only a missing, frozen or self target. The entered session has `scope: 'full'`, and `ownerSession()` checks scope and `isBranchOwner` but not `session.kind`, so `POST /auth/users/<owner>/password` succeeds. | `accounts/accounts.service.ts:313-325`, `auth/auth.service.ts:498-503` | Refuse owner and branch-layer targets in `enter()`; one auth helper that requires `session.kind === 'account'` for every `/auth` write. |
| S2 | High | **Every layer receives the full price ladder (verified).** `GET /office/packages` returns `branchCost`, `mainPrice`, `agentPrice`, `posPrice`, `providerCode` and the auto modes to a point of sale. | `packages/packages.service.ts:77-92` | Return the viewer's buy price and the column it sells to; the rest branch-only. |
| S3 | High | **Office password reset has no grant check (verified).** Any branch staff account, with no grants, can reset the password of any main agent, agent or point of sale; a `staff`-grant holder can reset a stronger colleague. The reset revokes no session. | `accounts/accounts.service.ts:155-173` | Owner or `staff` grant; staff-on-staff owner-only; `dropLiveSessions` on every reset. |
| S4 | Med | TOTP second step has no attempt limit; an accepted code can be replayed in its 30 s window. | `auth/auth.service.ts:350-352` | Per-user counter in Redis (atomic `INCR`); remember the last accepted step. |
| S5 | Med | An entered session can switch off the target's 2FA, enrol its own authenticator, edit its profile and list its sessions. | `auth/auth.service.ts:183-336, 487-496` | Same helper as S1. |
| S6 | Med | Session ids are the cookie value, stored in clear and returned by `GET /auth/sessions`. | `auth/auth.service.ts:270-277`, `auth/prisma-auth.store.ts:272-284` | Random token in the cookie, SHA-256 stored, separate public id. |
| S7 | Med | Who really acted during impersonation is read from the client's `home` cookie; deleting it writes every entry as the entered account. | `kernel/office-kernel.ts:85-89`, `activity-recorder.ts:80-86` | Store the operator id on the impersonation session row. |
| S8 | Med | No CSRF defence beyond `SameSite=Lax`, and the urlencoded body parser is on: a form on any sibling subdomain can post writes. | `main.ts:15`, `door.middleware.ts:23` | Drop the urlencoded parser; reject writes whose `Origin` is not allowed. |
| S9 | Med | Login: per-name lockout only (anyone can lock the owner out; spraying across names is unlimited because the rate limit skips requests without `sid`); `trust proxy` is never set. | `auth/auth.service.ts:55-63`, `rate-limit.middleware.ts:62` | Per-IP limit on login, passkey login and handoff; set `trust proxy`. |
| S10 | Med | Sign-in codes are written to the server log in production (`LogSender` bound unconditionally). | `auth/message-sender.ts:19`, `auth/auth.module.ts:16` | Refuse to start with `LogSender` in production. |
| S11 | Med | Branch staff with no grant can delete history-free accounts, create main agents/agents/POS, and change company images — beyond ADR 0006. | `accounts.service.ts:292-296, 88-153`, `companies.service.ts:114` | Owner or the matching grant. |
| S12 | Low | Passkey sign-in accepts possession alone (`requireUserVerification: false`); the notices stream never re-checks its session; handoff code and passkey challenge are read-then-deleted, not `GETDEL`; xlsx statement upload inflates without a limit; TOTP secrets stored in clear; `COOKIE_SECURE` defaults to false. | `auth/passkeys.ts:117,178`, `notices/notices.controller.ts:41-60`, `providers/statement.ts:57-58` | As listed. |

## 3. API design

| # | Finding | Fix |
|---|---|---|
| A1 | **The client states whether the provider succeeded (verified).** Every line operation requires `body.outcome: 'success' \| 'fail'` (`lines.service.ts:220, 322, 382, 436, 485, 493, …`). `ProviderAdapter` covers only the catalog; there is no port for line operations. This is the largest gap between the current code and a production system. | A `ProviderGateway` port (activate, charge, extend, switch, disconnect, freeze, …) with the simulation as one implementation behind a non-production flag; `outcome` leaves the public contract. |
| A2 | **No global exception filter.** `{ message, code }` holds only for `OfficeFailure`. Unknown routes, malformed JSON, 413, Prisma errors and any unexpected throw answer Nest's `{ statusCode, message, error }`. A write with no body answers 500 on most routes (`req.body` is undefined under Express 5; only some handlers use `body ?? {}`). | One global filter mapping `OfficeFailure`, `HttpException`, Prisma `P2002`→409, `P2025`→404, the rest → `{ message, code }`. |
| A3 | **Validation is 87 % hand-written.** 9 of 70 body routes use zod (wallets, provider-accounts); 61 parse with `typeof body.x === 'string'`. Unbounded strings reach the database (`note`, reject `reason`, `currentDetails`, role `name`); `Number(...)` coercion in the catalog accepts `true` as 1. Unknown filter values are silently ignored (`?status=rejected` returns every task). | Finish ADR 0002: one `<domain>.schemas.ts` per controller, shared primitives (`money`, `login`, `note`, `msisdn`, `iccid`) with maxima, a `ZodPipe` on every `@Body()` / `@Query()`. |
| A4 | **Status codes differ for the same situation.** Conflict is 400 (`LOGIN_TAKEN`, `NUMBER_TAKEN`) or 409 (`COMPANY_EXISTS`); a missing target is 404, 403 or 400 `INVALID` depending on the route; a wrong code on a valid session is 401; office POSTs answer 201, auth POSTs 200. | One status table in `docs/architecture/backend.md`, applied everywhere. |
| A5 | **Account administration exists twice with different rules.** `POST /auth/users/:login/password` and `/auth/users/:login/disable` duplicate `POST /office/users/:login/password` and `/freeze`, without the layer rules, the activity log or the task release. | Delete the auth duplicates or make them call the office service. |
| A6 | **Privileged writes leave no activity event:** wallet ceiling, role save, package renewals/switches, line transfer, company image, and the owner routes in `auth.controller.ts` (password, disable, policy, exemptions, session rules, contact). | `@Activity` on each; record auth routes in one place. |
| A7 | **Lists:** `GET /office/users` has two response shapes (`?paged=1`); wallets, directory, packages, companies, offers, balances are unpaged; paged envelopes use different keys (`users`, `entries`, `lines`, `rows`…) and three cursor formats. `GET /office/lines` returns the eSIM QR data URL on every row. | One envelope `{ items, nextCursor, total }` and one cursor helper. |
| A8 | **Naming:** the account is `users/:loginName`, `wallets/:loginName`, `posLogin`, `?account=`, in a folder called `accounts/`; PUT vs PATCH for the same kind of change; `POST /office/roles` is an upsert by body id; `reports/:kind` and `reports/:kind/export` accept disjoint kinds; three addresses write the same per-account package price. | Fix in a versioned pass (`/v2`) so the web app migrates route by route. |
| A9 | **Routes in the wrong controller:** `POST tasks/:id/complete` in `LinesController`; `POST /office/companies` and `/packages` in `ProviderCatalogController`; `finance/*` and `provider-operations` in `WalletsController`; price routes under `packages/:code` in `TermsController`. | Move with the module split (section 4). |
| A10 | **Swagger does not match the handlers:** every field in `office.dto.ts` is optional, 17 routes are `freeFormObject`, no success schema, undocumented query parameters. | Generate OpenAPI from the zod schemas. |
| A11 | Date filters build `to` three different ways (local, local + ms, UTC); correct only when the server runs in UTC. No `POST /auth/logout`. | One `dayRange()` helper; add logout. |

## 4. Structure and readability (for the hand-over)

1. **One module holds everything.** `OfficeModule` registers 18 controllers and 24 providers; every service depends on
   `OfficeKernel` (436 lines: session → actor, grants, account tree, transactions, notices, wallet moves, price
   ladders, role seeding). Split the kernel into `ActorService`, `AccountTree`, `WalletLedger`, `PriceLadder`,
   `UnitOfWork`, and give each domain its own Nest module that exports only its service.
2. **No repository layer.** Services call `this.kernel.prisma.*` directly, mixing permission checks, input parsing,
   queries, rules and response shaping in one method. Target per domain:
   `controller → schemas (zod) → service (use cases) → rules (pure) → repository (Prisma)`.
   `branding/` already has this shape.
3. **God methods.** `LinesService.completeTask` is 258 lines with one `if (task.action === …)` block per action;
   `detail` 104, `activate` 102, `TasksService.detail` 101. Replace the action chain with one handler per action
   (`Record<Action, TaskHandler>`), which also gives one place for the M1–M4 guard.
4. **Repeated block.** "provider failed or manual mode → open a task" is written ten times in `lines.service.ts`
   with the literal `'مهمة فرع'` each time. One `runOrQueue(action, …)` helper.
5. **Permissions are inline `if`s** — about 120 across the services, nine spellings of the same check
   (`if (!actor.isBranchOwner && !actor.grants.includes('edit')) fail(403, …)`). Use a `@RequireGrant('edit')`
   guard and a small `can(actor).…` policy file, so `permissions.http.spec.ts` and the code read the same table.
6. **Cross-cutting decorators are copied on 17 controllers** (`@UseFilters`, `@UseInterceptors`, three `@Api*`).
   Register the filter and interceptors globally and add one `@OfficeController('lines')` composite decorator.
7. **Flat `office/` root.** 70 files sit beside the domain folders: rule files (`office-rules.ts` 585 lines,
   `user-terms.ts`, `transfer-rules.ts`, `line-prices.ts`, `profit-ladder.ts`), their specs, and test helpers
   (`tree-fixture.ts`, `test-hash.ts`). Move each rule file and spec into its domain; split `office-rules.ts` by
   topic (modes, SIM rules, refund periods).
8. **Test code lives in `src/`.** `testing/office-facade.ts` (583 lines, 26 unused private members),
   `kernel/office-test-app.ts`, `tree-fixture.ts`, `test-hash.ts`, and `auth/auth.store.ts` (407-line in-memory
   store used only by specs) are excluded from the build by a hand-kept list in `tsconfig.build.json`. Move them to
   `apps/api/test/`; migrate the eight specs off the facade and delete it.
9. **Strings instead of types.** Status, kind, layer and action are free `String` in the schema and in signatures
   (`kind: string`). `TASK_STATUSES` is declared twice with different members (`office-paging.ts:12` without
   `rejected`, `desk/overview.service.ts:21` with it). Use Prisma enums and one exported union per concept.
10. **Arabic text written by the API into the database** (`'مهمة فرع'`, `'فشل المزود'`, `'رجع لأن الحساب أُوقف'`,
    `'النظام'`) in a three-language product. Store codes; the web app translates.
11. **Configuration is read ad hoc.** `process.env` in 12 files, `DATABASE_URL` checked in five. One validated
    `config.ts` (zod) loaded at boot that refuses unsafe production values (S10, `COOKIE_SECURE`).
12. **No logger.** `console.*` in five files; no request id. Use Nest `Logger` with a request id.
13. **Timers in the API process.** Provider health runs on `setInterval` inside every API instance and the activity
    purge on `setInterval` in the worker, while BullMQ is installed with zero processors. Make both repeatable jobs.
14. **Small things a new reader trips on:** imports in `office-kernel.ts` are unsorted with three separate imports
    from `../user-terms`; the class doc comment sits above `PRICE_COLUMNS`; comments still name
    `OfficeController` / `office.service.ts`, which no longer exist (`tasks.controller.ts:13`,
    `office-errors.spec.ts:39`, `provider-cost.ts:5`, `kernel/types.ts:1`); the service is injected as `lineDesk`,
    `walletDesk`, `auditLog`, `accounts`, `insights` — pick one naming rule.
15. **Lint is the default recommended set.** Add `import/order`, `no-floating-promises`, a `max-lines-per-function`
    budget, and an import-boundary rule (a domain may import `shared/` and another domain's public service only).
    Turn on `noUnusedLocals` / `noUnusedParameters` once the facade is gone.

## 5. Duplication and dead code

**Duplicated**

- `readCookie` three times: `src/cookies.ts`, `office/gate.ts`, `auth/auth.controller.ts` (`sessionIdOf`), and again
  in the branding controller. `cookieBase` twice with different options (`path: '/'` only in `gate.ts`).
- `type Gate` declared three times (`kernel/types.ts`, `activity-recorder.ts`, `branding.service.ts`).
- Three CSV writers: `reports/report-csv.ts` `csvOf`, `wallets/finance-summary.ts` `ledgerCsv` and `profitCsv`.
- Password reset and account disable in both `auth` and `office` (A5).
- Session → user resolution in both `OfficeKernel.actor` and `ActivityRecorder.actorFromGate`.

**Dead or test-only** (exports no production file reads)

- Unused: `isAutomatic`, `remainingDays` (`office-rules.ts`), `MATCH_SOURCES` (`match-simulator.ts`),
  `TaskNoteBodyDto` (`office.dto.ts`), type `ActivityAction` (`activity-log.ts`), `OfficeKernel.branchActor`.
- Read only by their own spec (production uses another path): `chargeDebit`, `subscriptionDebit`,
  `switchDifference`, `disconnectSettlement`, `withPrice`, `defaultActionModes` (`office-rules.ts`), `ZodPipe`
  (`shared/zod.pipe.ts` — written, never applied). Each needs a decision: use it or delete it with its test.
- `GET ledger/:scope` accepts only `audit`; `reports/:kind` `tasks` and `numbers` duplicate `/office/tasks` and
  `/office/lines`.
- `worker.ts` `backgroundProcessors` is an empty list.
- About 100 exports are used only inside their own file; drop the `export`.

## 6. What is solid

- `move`, `hold`, `release` lock the wallet row before reading; `held` uses increment/decrement; checks run on
  `balance − held`. `fund` and `deduct` do both sides in one transaction with zod-bounded integer amounts.
- Task complete, reject, cancel, take and release claim with `updateMany` on the current status inside the
  transaction; the hold is released once, in the same transaction.
- Notices are written inside the transaction and published after commit.
- Money arithmetic is integer agorot with one `Math.round` per proration.
- Subtree isolation (`visibleAccountIds`, `visibleAccount`, `visibleLine`) is applied consistently across wallets,
  lines, tasks, transfers, terms, finance, audit and the overview. Role and grant editing is owner-only.
- argon2id passwords, a new session id at each login step, frozen accounts refused on every request, exact-origin
  CORS, Swagger off in production, only tagged-template raw SQL.
- Pure rule files with specs, `routes.http.spec.ts` and `permissions.http.spec.ts` are a strong base for the fixes.

## 7. `docs/architecture/backend.md` has drifted

It is the file a new developer reads first, and it is wrong in places: 79 and 81 office routes (the controllers
have about 117); `move()` at `office.service.ts:~3715` and "`complete` is still in OfficeController" (neither file
exists); "37 migrations" (47); "41 suites" (77 spec files); `Announcement` listed although dropped, while
`ProviderEntry`, `LineCountSnapshot`, `ProviderReconciliation`, `ProviderReconItem`, `Passkey` are missing; the zod
pilot "wallets only" (also provider-accounts); `PUT packages/:code/sell-price` (actual `PUT sell-prices/:code`).
The 600-word "Last verified" line is a changelog; keep a date there and move history to git.

## 8. Suggested order

1. **Money correctness:** M1–M5 (line lock + status guards + one open task per line/action), each with a failing
   test first. Then M6, M8, M9.
2. **Authorization:** S1, S2, S3, then S5, S7, S11.
3. **Contract safety net:** global exception filter (A2), zod on every route (A3), status table (A4).
4. **Provider port (A1)** — before any real provider is connected.
5. **Structure:** split the kernel and `OfficeModule`, repositories, permission guard, task handlers, move test
   code out of `src/`, delete dead code, fix `backend.md`.
6. **Hardening:** S4, S6, S8–S10, idempotency keys (M7), enums and foreign keys (M14).

Each step is its own spec + plan under `docs/superpowers/` (`work-plan.mdc`).
