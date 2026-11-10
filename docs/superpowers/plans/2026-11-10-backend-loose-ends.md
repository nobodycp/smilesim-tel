# Backend loose ends — plan

Spec: `docs/superpowers/specs/2026-11-10-backend-loose-ends.md`. One slice = one commit on local `main`, ticked with
its hash. Per slice locally: `npm run lint`, `npm run typecheck`, the touched spec files, `architecture.spec.ts`;
checked on the running copy (port 3000) where a screen reads the change. Pushed when the owner asks.
A3 and A4 wait for decisions D1 and D2; the other slices do not.

## Phase A — defects (money and data first)

- [x] **A.1 Account delete in one transaction.** (931b66d; the race spec is its own file,
  `accounts/account-delete.db.spec.ts`, delete against a fund; the guard counts writes on one side of an `else` and
  skips a write handed a client, and found nothing else)
  - `accounts/accounts.repository.ts`: `childCount`, `lineCount`, `taskCount`, `walletEntryCount`,
    `removeSessions`, `removeWallet`, `removePackages`, `removeSellPrices`, `removeAccount` take the client (`db`).
  - `accounts/accounts.service.ts` `remove`: permission checks as now; then `uow.runTx`: `ledger.lockWallets(tx,
    [target.id])`, the four counts, `HAS_HISTORY` if any, the five deletes. `auth.dropLiveSessions` after the
    commit.
  - `accounts.module.ts` imports `WalletsModule` for `WalletLedger` if it does not already; check the module graph
    stays acyclic (spec office-kernel-split, decision 4).
  - Specs: `accounts.http.spec.ts` (a delete that fails on its last write leaves the wallet; `HAS_HISTORY` writes
    nothing); new case in `lines/line-concurrency.db.spec.ts`: delete and activate at once, exactly one wins.
  - Guard: `architecture.spec.ts` `multi-write-outside-tx` — a service method with two or more awaited repository
    writes (`remove*`, `set*`, `save*`, `create*`, `delete*`) outside `runTx`; baseline from today's count,
    lowered to what is left with a reason each.
- [x] **A.2 Rename by task answers 409.** (52e9cdc)
  - `numberTaken` from `lines/lines.service.ts:36` to `lines/line-state.ts`, exported.
  - `lines/task-completion.ts:265`: `.catch(numberTaken)`.
  - Spec: `lines/line-state.spec.ts` — completing a rename task onto a taken number is `409 NUMBER_TAKEN`, the task
    stays `working`, its hold is unchanged, no wallet entry.
- [ ] **A.3 The home does not write (after D1).**
  - `desk/line-snapshots.service.ts` (new): `writeToday()` — one `groupBy` over lines per point of sale, summed up
    each account's path, `upsert` per account; started by a timer like `ProviderHealthService` (`isTest()` guard,
    no timer without a database).
  - `desk/overview.service.ts`: the write at line 82 is removed; it reads the snapshot of the compared day.
  - `desk.module.ts` registers the service. Spec: `overview.service.spec.ts` (a read writes nothing: the
    repository's `upsert` is never called), `line-snapshots.service.spec.ts` (two runs in a day leave one row).
  - Guard: `architecture.spec.ts` `write-in-get` — a controller `@Get` whose service method reaches `runTx`, or a
    repository write, fails. Baseline from today's count.
- [ ] **A.4 Query filters by schema (after D2).** One commit per controller, largest first:
  `wallets` (31 parameters), `audit` (9), `lines` (7), `tasks` (7), `reports` (5), `accounts` (4), `notices` (3),
  `provider-accounts` (3), then the four with one each.
  - `shared/schemas.ts`: `cursor`, `day` (a date the day range accepts), `oneOf(list)`, `searchText(max)`.
  - `<domain>.schemas.ts`: `<List>Query`; the controller takes `@Query() query` and hands it to the service, which
    parses it with `parseInput` after its permission check (the order bodies already follow).
  - `openapi/body.ts`: `ApiZodQuery(schema)` documents the parameters from the same schema; the hand-written
    `@ApiQuery` lines go.
  - Specs: each domain's `*.http.spec.ts` gets "an unknown value is 400, an unknown name is ignored".
  - Web: `apps/web/scripts/check-copy.mjs` (or a sibling check) reads the option lists of the filter selects and
    fails when one sends a value its schema does not list.
  - Guard: `untyped-query` — `@Query('name')` with a bare `string` in an office controller; baseline 73 → 0.

## Phase B — clean-ups

- [x] **B.1 The last queries leave the services.** (2d05e36; `NoticeService`'s one insert is
  `notices/notice-insert.repository.ts`, a function with no import of the unit of work, because the unit of work
  builds the notice writer; `NoticeInboxService` now injects `NoticeService` itself instead of reaching it through
  the unit of work.) `audit/audit.repository.ts` (`eventsPage`, `eventCount`,
  `addressCount`, `eventsForExport`), `roles/roles.repository.ts` (`allRoles`, `roleById`, `createRole`,
  `updateRole`), `notices/notices.repository.ts` (`inboxPage`, `unreadCount`, `inboxCount`, `markRead`). Each
  registered in its module. `prisma-in-service` 10 → 0; the "fewer than five" sentence leaves
  `backend-engineering.mdc` 5.1 and the guard's comment.
- [x] **B.2 Unused injections.** (COMMIT; checked by the running API's boot instead of a compiled one) Remove `uow` from the eight constructors named in the spec and from
  `testing/office-graph.ts` / `office-facade.ts`. Guard `unused-injection` at 0. Boot the compiled API once
  (`PORT=3099 node dist/main.js`, `/health`): dependency injection errors show only at boot.
- [ ] **B.3 `office-rules.ts` by topic.** Create `rules/periods.ts`, `rules/prices.ts`, `rules/run-modes.ts`,
  `rules/sim-rules.ts`, `rules/account-visibility.ts`; move each export with its tests
  (`office-rules.spec.ts` → five spec files); rewrite the imports (`grep -rl "rules/office-rules"`); delete
  `office-rules.ts`. No line of logic changes: the diff of each moved function is empty. `backend.md` row for
  `office/rules/`.
- [ ] **B.4 `PackageRow` tells the truth.** `apps/web/lib/api-types.ts`: `branchCost`, `mainPrice`, `agentPrice`
  are `number | null`. Fix what `tsc` flags (a hidden price is not drawn). `testing/response-shape.spec.ts`:
  `PACKAGE_ROW_KEYS` pinned against the service and the web type. Check `/packages` as the branch, a main agent,
  an agent and a point of sale on the running copy, ar and en.

## Phase C — close

- [ ] **C.1** `docs/architecture/backend.md` "Known gaps" loses the eight items; the review file's notes; ADRs
  `0012-kernel-split-and-domain-modules.md` and `0013-session-token-and-sealed-secrets.md` (named in their plans,
  never written); tick 5.5 in `2026-11-10-backend-hardening.md` (done by the kernel split). Whole API suite in
  one worker, then push when the owner asks.

## Order and size

A.1 and A.2 first (data and money), then B.1–B.4 (no decision needed), then A.3 and A.4 once D1 and D2 are
answered. A.4 is the largest: twelve controllers, about a day of slices. B.3 is the widest diff and the smallest
risk.
