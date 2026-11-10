# Backend loose ends — spec

Eight items the 2026-11-10 review and its four plans named and left: four defects seen while working, four
clean-ups that never entered a plan. Backend first; one item touches a web type. Measured on commit `70d85ef`.

## Part A — defects

### A1. Deleting an account is not one transaction

`accounts/accounts.service.ts` `remove` (line 279) counts the account's children, numbers, tasks and wallet
entries, then runs six separate writes: live sessions, sessions, wallet, user packages, sell prices, the user.

- A failure after the wallet is deleted leaves an account with no wallet; the next fund or sale on it fails.
- Nothing stops a number being activated for the account between the count and the delete: the delete then fails
  on the foreign key, after the wallet is gone.

**Target.** The count and the five database deletes run inside one `runTx`, after the account's wallet row is
locked (`lockWallets`), so no money or number can land on it meanwhile. The Redis sessions are dropped after the
commit: a failed delete must not sign the account out.

### A2. A rename done by a task answers 500 when the number is taken

`lines/lines.service.ts:327` maps a unique violation to `409 NUMBER_TAKEN` (`.catch(numberTaken)`).
`lines/task-completion.ts:265` does the same write without it, so the branch employee completing the task gets
`500 SERVER_ERROR` and no reason.

**Target.** The same `409 NUMBER_TAKEN`. The task stays `working`, its hold stays, nothing is written.
`numberTaken` moves to `lines/line-state.ts` so both callers share it.

### A3. Reading the home writes a row

`desk/overview.service.ts:82` writes today's line counts (`LineCountSnapshot`, `desk.repository.ts:44`) whenever
`GET /office/overview` is read, to have something to compare with next time.

- A `GET` that writes cannot be cached or retried safely, and a read-only database role cannot serve it.
- History exists only for the days an account opened its home: the change shown is "since the last visit", not
  "over the period".

**Target (decision D1).** A daily job writes the snapshot for every account that is not frozen; the read never
writes. Proposed place: the API's own timer beside `ProviderHealthService` (it already runs one, guarded by
`isTest()`), at the first tick after local midnight, idempotent through the existing `userId_day` unique key.
The alternative is the worker process (`src/worker.ts`), which today only purges.

### A4. Query filters are not validated

Bodies are parsed by zod (`hand-parsed-input` is 0). The 73 `@Query(...)` parameters in twelve controllers are
read as free text: `status=bogus` on `/office/lines` lists every number, a wrong date is ignored, and a mistyped
parameter name is silently dropped (the old `?account=` still answers 200 with every number).

**Target (decision D2).** One zod schema per list query in `<domain>.schemas.ts`, parsed with `parseInput` like a
body. Proposed: a known parameter with a value outside its set is `400 INVALID`; an unknown parameter name is
ignored (browsers and proxies add their own). The web sends only values from its own selects, so no screen
changes; `apps/web` gets a check that every filter value it can send is one the schema accepts.

## Part B — clean-ups

### B1. Queries left in three services

`architecture.baseline.json` `prisma-in-service` is 10: `audit.service.ts` 4, `roles.service.ts` 4,
`notice-inbox.service.ts` 2. The rule's own text lets a service with fewer than five queries keep them, which
leaves a judgement call in a rule that is otherwise mechanical, and the only non-zero number in the guard.

**Target.** `audit.repository.ts`, `roles.repository.ts`, `notices.repository.ts`; baseline 0; the "fewer than
five" exception is deleted from the rule text, so the rule has no judgement call left in it.

### B2. Services that inject a `UnitOfWork` they never use

Eight, not the six first counted: `desk/overview.service.ts`, `desk/desk.service.ts`,
`providers/provider-catalog.service.ts`, `providers/providers.service.ts`, `lines/line-reads.ts`,
`companies/companies.service.ts`, `reports/reports.service.ts`, `reports/insights.service.ts`. Left from the
repository phase: a reader cannot tell which services open transactions.

**Target.** The parameter is removed from the eight constructors and from `testing/office-graph.ts`. New guard
`unused-injection`: a constructor parameter of a `*.service.ts` that the class never reads.

### B3. `rules/office-rules.ts` holds four topics in 517 lines

Money periods and refunds (`periodEnd`, `openPeriods`, `settleDisconnect`, `renewStay`, `switchOver`, …), terms
and prices (`Prices`, `PackageTerms`, `captureTerms`, `chainHolds`, `editableField`), run modes (`ActionMode`,
`ACTION_KEYS`, `resolvePackageMode`, `offeredOperations`, …), SIM rules (`SimRules`, `simRefusal`, `issueSerial`),
and the account tree (`visibleAccountIds`).

**Target.** `rules/periods.ts`, `rules/prices.ts`, `rules/run-modes.ts`, `rules/sim-rules.ts`,
`rules/account-visibility.ts`, each with its part of `office-rules.spec.ts`. `office-rules.ts` is deleted, not
kept as a re-export: every importer names the file it needs. Pure move, no logic change.

### B4. `PackageRow` in the web says `number` where the API answers `null`

`packages.service.ts:87` answers `branchCost`, `mainPrice` and `agentPrice` as `null` for a layer that may not see
them (review S2). `apps/web/lib/api-types.ts:121` still types them `number`, so the compiler does not stop a
screen from doing arithmetic on a hidden price.

**Target.** The three fields are `number | null`; every use the compiler then flags is fixed where it stands
(a hidden price is not drawn; it is never read as 0). `response-shape.spec.ts` pins the list's row against the
web type, as it does for `LineRow`.

## Decisions for the owner

- **D1 — where the daily snapshot is written.** Proposed: the API's timer. It changes what the home's "change"
  figure means: from "since your last visit" to "since the same day one period ago", which is what its label says.
- **D2 — a filter value the API does not know.** Proposed: `400 INVALID` (today: ignored, the list comes back
  unfiltered, which reads as "no such filter" to whoever is debugging).

## Non-goals

- Provider purchases summed in the database, search-as-you-type pickers, the `capped` note: each needs its own
  spec (a data migration, and two UI decisions).
- Any change to a response shape, a route or a business rule beyond A2's status code and D2.

## Risks

- A1 touches account deletion: the PostgreSQL spec job on GitHub Actions is the proof; a DB spec is added for the
  race.
- A3 changes a figure the owner sees on the home; the first days after it ships show no change until a snapshot
  exists for the compared day (the same as a new account today).
- B3 moves 57 exports imported from 36 files: one commit, `tsc` is the proof.
