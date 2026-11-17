# 0025 — A provider operation's provider and cost are stored on its wallet entry; the books are SQL sums

- Date: 2026-11-17
- Status: **accepted.** The owner answered every question on 2026-11-17 (last section); the answers override the recommendations above where they differ.
- Spec: `docs/superpowers/specs/2026-11-17-scale-speed-cleanup.md`, decision 3 ("a stored provider ledger, written in
  each operation's transaction"; approved in principle, "own spec section and ADR before code").
- Plan: `docs/superpowers/plans/2026-11-17-database-scale.md`, DB.5 [MONEY][LOCK]. Evidence:
  `docs/reviews/2026-11-17-database-audit.md` §1 finding 1, §3.3, §4 item 4, §6 "Aggregates", §12 row D.5, §13 item 3.
- Builds on ADR 0004 (the wallet lock), 0019 (the settlement and the lock order), 0023 (nothing reads the tree under
  the wallet lock). Changes none of them.

## Context

### What is computed today, and by which code

A provider's **purchases**, **balance** and **available** are not stored anywhere. Every read works them out again:

- `ProviderAccountsService.books()` (`providers/account/provider-accounts.service.ts`) reads
  `WalletsService.pricedOperations()` (`wallets/wallets.service.ts`) with no filter, then `summaryOf()` adds, per
  provider: `purchases = Σ cost`, `balance = payments + settlements − purchases`,
  `available = balance + creditLimit − held`. Payments and settlements are already a SQL sum of `ProviderEntry`
  (`repo.entrySums()`); `held` is the cost of the open tasks (bounded by the open tasks).
- `pricedOperations()` loads **every `WalletEntry` of the 13 operation kinds ever written** (`PROVIDER_OPERATION_KINDS`,
  `wallets/provider-cost.ts`; `repo.operationEntries`, newest first, no limit), then **every line those entries
  name** with its package, provider and company (`repo.linesWithPackage(lineIds)`), then the catalog.
- For each entry, `pricedOp()` decides in Node:
  - **the provider**: the catalog package whose name (or label "N جيجا · M أشهر") and company equal the entry's
    stored `packageName` / `companyName` (`samePackage`), else the line's **current** package. An entry whose
    package cannot be found gets provider `''` and is in no provider's books.
  - **the cost**: `row.providerCost` when the entry stored one; otherwise `providerBranchCost(kind, terms, package)`
    (`pricing/rules/prices.ts`) — the line's **current** `terms` when the package found is the line's current
    package, else the package's **current** `branchCost` / `renewalBranchCost`. Kinds other than `activate`,
    `switch`, `charge`, `extend`, `reactivate` cost 0 by this fallback.
- `detail()` adds the ledger: every operation of the provider plus every `ProviderEntry`, sorted, a running balance
  in Node, then cut to `LEDGER_LIMIT` (1,000).
- `summaryOf()` also counts `openDifferences` with the **simulated** matching (`matchOf`, a hash of the entry id,
  `match-simulator.ts`) over every operation of the provider.

Callers: the providers list and detail screens and their CSV, the branch overview's providers card (once since DB.4),
the system monitor's providers part and the health watch (`ProviderHealthService`, every `HEALTH_CHECK_SECONDS` = 120;
since DB.4 it reuses the summaries it worked out within that window, per process). `GET provider-operations` and the
reconciliation take a time window into SQL since DB.4; the list and detail screens do not.

### What it costs (audit, measured on 3.78 M operation entries of 6 M)

- **[W6]** `pricedOperations` unbounded: **13.4–25.5 s**, 3.78 M rows to Node, a 1.5 GB sort spilled to disk; then an
  `IN` list of every line id with an operation (about 2 M), which the audit could not show Prisma splits under
  PostgreSQL's 65,535 bind-parameter limit (§14: it may fail outright at that size).
- **[A_W6agg]** the same purchases done in SQL over history (join `Line` → `Package`,
  `sum(coalesce(providerCost, branchCost))`): **10.8 s**. Better indexes do not fix it: it is still all history.
- DB.4 removed the repeat calls (health watch cached, overview once). Each providers screen, its CSV and each health
  window still pay one full read.

### What is wrong for the owner

1. **Slow, and slower every sale.** The providers screens grow with every operation ever made, without bound.
2. **A past purchase can change.** For an entry that stored no cost (today: every plain, non-eSIM activation —
   `activationProviderCost` returns `undefined` unless eSIM, `sales/lines.service.ts`, `task-completion.ts`; and older
   rows), the cost is read from the line's *current* terms or the package's *current* price. A transfer re-stamps a
   line's terms from today's prices (`TermsService.repriceLines`, `to: 'current'`), so last year's purchase follows
   today's price. The provider is also re-derived on every read: a package renamed, or a line switched to another
   package, moves past operations between providers or out of the books.
3. **Two definitions of "cost".** The providers report (`InsightsService.supply`, `reporting/reports/insights.service.ts`)
   adds `providerCost ?? 0` — no fallback — so a plain activation costs 0 there and its package's cost in the books.

## The alternatives

Common to all: an operation's wallet entry is written by `WalletLedger.post` (`move`, `capture`; under the point of
sale's wallet lock, step 5 of the lock order) or `WalletLedger.recordOp` (no money, no wallet lock), always inside the
operation's transaction. A failed, cancelled or abandoned operation writes no operation entry.

### A. A purchase row per operation in a new table (`ProviderPurchase`)

- **Written:** one `INSERT` per operation entry, by `WalletLedger`, right after the entry, same transaction:
  `(id, walletEntryId UNIQUE, providerId, cost, createdAt)`.
- **Lock:** one more statement under the wallet lock (the sale's statement counts pinned by
  `sales/sale-lock-tree.db.spec.ts`, 11 and 12, become 12 and 13). A foreign key to `Provider` makes the insert take
  `FOR KEY SHARE` on the provider's row, which conflicts with the `FOR UPDATE` the send gate, approve, pause and
  credential writes take (`provider-dispatch.repository.ts`): a sale would wait on them, a new lock after the wallet
  in the order of ADR 0019. Without the foreign key it is plain data.
- **Reads:** `SUM(cost) GROUP BY providerId` on a narrow table; the ledger page by keyset.
- **Wrong if:** the entry and its purchase row disagree (two rows, one truth); a writer forgets the second insert.
- **For it:** a purchase could exist without a wallet entry (see question 4), and a later revision could be a new row.

### B. The provider and the cost as columns of the operation's wallet entry (recommended)

- **Written:** `WalletEntry.providerId` (new) and `WalletEntry.providerCost` (exists, made always present for
  operation kinds), in the **same `INSERT`** that `post` / `recordOp` already run.
- **Lock:** no new statement, no new lock, no foreign key; statement counts unchanged.
- **Reads:** `SUM("providerCost") … WHERE "providerId" IS NOT NULL GROUP BY "providerId"` on a partial index that
  holds the cost (index-only).
- **Wrong if:** a writer passes the wrong provider or cost (pinned per writer by a spec); the sum is still over all
  history, so its time grows slowly with history (see D).
- **For it:** the entry stays the only record of the operation; nothing can disagree with it.

### C. A running total per provider

- **Written:** `UPDATE … SET purchases = purchases + cost` in every operation's transaction.
- **Lock:** on `Provider` itself it collides with the send gate's `FOR UPDATE`; on a separate row it is **one hot row
  per provider**: every sale of that provider, at every point of sale, queues on it while holding its own wallet lock.
  That serialises the office's sales per provider and adds a step after the wallet in the lock order.
- **Reads:** one row. **Wrong if:** a write path skips it — the total then drifts with nothing to show where.
- Rejected: it trades a read cost for a write bottleneck on the money path.

### D. Closed monthly totals plus the open month

- **Written:** by the worker, after a month ends, `ProviderMonth(providerId, month, purchases, operations)` from the
  entries of that month. Nothing on the sale path.
- **Lock:** none on the sale path. An entry's `createdAt` is the column default `CURRENT_TIMESTAMP`, the transaction's start
  time (unless Prisma sends its own value: to confirm in P.5), so a month is closed only a day after it ends (longer than any transaction may stay open; DB.15 sets the limits).
- **Reads:** Σ closed months + Σ entries since the last closed month: bounded by one to two months of rows.
- **Wrong if:** an entry dated in a closed month is written after the close (prevented by the day's lag), or a
  closed month is edited. A check recomputes closed months from the entries.
- Needs A or B underneath: it closes stored costs, not the read-time fallback.

### E. SQL over the history as it is, with better indexes

- Nothing written. The fallback (by package name, the line's current terms) is a join over `Line` and `Package`.
- **[A_W6agg] 10.8 s**, and it keeps problems 2 and 3. Rejected.

## Decision (recommended)

**B now; D as a second step only if B measures over budget at the audit's sizes.** As rules:

1. **What is written.** Every `WalletEntry` whose `kind` is in `PROVIDER_OPERATION_KINDS` carries:
   - `providerId` — the provider of the package the operation was carried out on, as the caller already holds it
     (the same package whose name goes into `packageName`: `line.package` for an operation on the line, the new
     package for a switch). `Sale` gains `providerId`; every caller of `move` / `capture` / `recordOp` for those kinds
     fills it from the package row it already read. No new read.
   - `providerCost` — signed agorot, what this operation adds to what the branch owes the provider. For the kinds
     that cost nothing (`freeze`, `unfreeze`, `rename`, `sim`, `refresh`, `transfer`) it is `0`, as `recordOp`
     already writes. For a plain activation and a renewal task, the value today's fallback gives at the moment of
     the write (the package's subscription / renewal branch cost from the line's terms as stamped by this operation),
     so the stored figure equals what the screens show on the day of the sale.
2. **In which transaction, in which order.** In the `INSERT` of the entry, inside the operation's transaction, after
   the wallet lock where `post` takes one, exactly where the entry is written today. **No statement, lock or foreign
   key is added**: `providerId` has no foreign key, because the key's `FOR KEY SHARE` on the provider's row would
   wait on the send gate's `FOR UPDATE` and add a lock after the wallet. The lock order of ADR 0019 / 0023
   (task → keys → operation → line → wallet) is unchanged, and `sale-lock-tree.db.spec.ts` keeps its counts.
3. **The source of truth** is the wallet entry. `providerId` and `providerCost` are fixed when it is written and never
   updated. The books are sums of them; `pricedOp`, `samePackage`, the label matching and the read-time fallback are
   deleted once the backfill is proven.
4. **Later events.**
   - *Refund (disconnect):* its own entry with its own `providerCost` (today `used share + DISCONNECT_FEE`,
     `settleDisconnect`, `sales/rules/periods.ts`). The rule is kept as it is, pending question 3.
   - *Switch:* its entry stores the quoted difference (`LinePricing.switchQuote`, may be negative), as today.
   - *Failed, cancelled, rejected or abandoned operation:* no operation entry, so no purchase — as today.
   - *A wallet correction* (`fund` / `deduct` with a reason): not an operation kind, never a purchase.
   - *The provider bills differently later* (a statement difference, a price the provider changed after the fact):
     the accountant enters a `ProviderEntry` of kind `settlement` (exists). The operation's stored cost is not edited.
5. **Reads.**
   - `books()` / `summaries()`: one grouped SQL sum for purchases (plus the existing `ProviderEntry` sums and open tasks).
   - `detail()`: the ledger page by keyset (newest first) over the provider's entries and `ProviderEntry` rows; each
     row's balance after it = the current balance − the sum of the amounts newer than it on the page and before it.
     No history in Node.
   - `GET provider-operations` and the reconciliation filter `providerId` in SQL.
   - `InsightsService.supply` reads the same `providerCost` and `providerId` (one definition of cost).
   - `openDifferences` is a simulated count over every operation (`matchOf` hashes the id in Node). It leaves
     `summaries()` (the health watch does not use it: `healthOf` reads failures and `available`) and is counted on the
     list screen only; when a real reconciliation exists it is counted from stored reconciliation items. Until then
     it stays a full-history Node pass on that one screen — named here, not solved.
6. **The invariant**, runnable as a spec and as a read-only CLI on a copy:
   - no operation-kind entry has a null `providerId` or `providerCost` (also a `CHECK` in the database);
   - every `providerId` names an existing `Provider` (a query; no foreign key, see rule 2);
   - for each provider, `purchases` returned by `summaries()` = `SELECT SUM("providerCost") … WHERE "providerId" = $1`;
   - if D is built: each closed `ProviderMonth` = the sum of its month's entries.

## Backfill

- **What:** for every existing operation-kind entry, write `providerId` and `providerCost` with exactly what
  `pricedOperations()` returns for it **at the moment the backfill runs** (`priced.providerCode` → its id;
  `cost = providerCost ?? fallback`). That freezes today's figures, including today's drift (context, problem 2).
- **How:** a CLI (`dist/cli/`, beside the others) using the same `pricedOp` code, run once with writes stopped (the
  deploy window the handover already requires for a release with migrations). It is a TypeScript step, not a SQL
  migration, because the fallback (label matching, the line's terms) lives in TypeScript.
- **Entries that cannot be attributed** (provider `''` today: package gone and no line) are in no provider's books
  today. The CLI lists them and stops; on trial data the owner decides each (expected: none or a handful).
- **Proof before the reads switch:** in the same run, before committing, the CLI compares for every provider
  `summaries()` computed the old way with the SQL sums of the backfilled columns, and the detail ledger of each
  provider row by row (id, amount, balance after). Equal to the agorot, or it rolls back. A db spec does the same on
  a fixture holding every case (stored cost, plain activation, renamed package, switched line, disconnect, zero-cost
  kinds).
- **The owner's rule** (trial data before launch, nothing kept in an old form for compatibility) allows the simple
  path: no period in which both readers run, no flag; the fallback code is deleted in the slice that switches the
  reads; the `CHECK` is validated once the backfill ran. The only care left is order: migrations run when the API
  starts, so the `VALIDATE` and the reads come in the release **after** the backfill ran (two deploys, below).

## Schema sketch

```prisma
model WalletEntry {
  // … as today …
  providerCost Int?     // exists; required for operation kinds by the CHECK below
  providerId   String?  // new; the provider of the operation's package; no relation, no foreign key (rule 2)
}
```

```sql
-- migration 1 (release 1): new rows are checked at once, old rows after the backfill
ALTER TABLE "WalletEntry" ADD COLUMN "providerId" TEXT;
ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_operation_priced"
  CHECK ("kind" NOT IN ('activate','charge','extend','reactivate','disconnect','freeze','unfreeze','switch',
                        'rename','sim','esim','refresh','transfer')
         OR ("providerId" IS NOT NULL AND "providerCost" IS NOT NULL)) NOT VALID;
-- migration 2 (release 2), alone, CONCURRENTLY
CREATE INDEX CONCURRENTLY "WalletEntry_provider_createdAt_id"
  ON "WalletEntry" ("providerId", "createdAt" DESC, "id" DESC) INCLUDE ("providerCost")
  WHERE "providerId" IS NOT NULL;
-- migration 3 (release 2)
ALTER TABLE "WalletEntry" VALIDATE CONSTRAINT "WalletEntry_operation_priced";
```

If D is built: `ProviderMonth(providerId TEXT, month DATE, purchases INT, operations INT, closedAt TIMESTAMP,
PRIMARY KEY (providerId, month))`, written by the worker only.

The kinds list in the `CHECK` duplicates `PROVIDER_OPERATION_KINDS`; a spec reads the migration and compares them, as
the settlement's lists are compared today (ADR 0019, S.3).

## Slices

Each one commit, each verified on its own.

| # | Slice | Verified by |
|---|---|---|
| P.1 | Columns and the `NOT VALID` check; `Sale.providerId`; every writer of an operation kind passes provider and cost (plain activation and renewal task included). Reads unchanged. | new `wallets/provider-priced-entries.db.spec.ts`: each writer (sale, task completion, settlement, charge, extend, switch ±, disconnect, every `recordOp` kind) stores the right provider and cost; `sale-lock-tree.db.spec.ts` counts unchanged |
| P.2 | The backfill CLI with its built-in proof. | a db spec on the case fixture; the CLI run on a copy of the staging database |
| — | ~~Release 1 (P.1, P.2), the CLI run in the window.~~ Superseded: see the amendment. | |
| P.3 | Index (`CONCURRENTLY`, own migration) and `VALIDATE`. | migration applies on a backfilled database |
| P.4 | Reads switched: `books`, `detail` by keyset, `provider-operations`, the reconciliation window, `supply`; `pricedOp` and the fallback deleted; `openDifferences` out of `summaries()`. | `provider-books.db.spec.ts` and `provider-accounts.service.spec.ts` with the same answers; `response-shape.spec.ts` unchanged; before/after plans on the audit's scratch sizes |
| — | ~~Release 2 (P.3, P.4).~~ Superseded: one deploy of HEAD, then the command (amendment). | |
| P.5 | (Only if P.4 measures over budget) `ProviderMonth` and its worker close. | the invariant over closed months; a db spec around a month boundary |

## Docs that change with it

- `docs/architecture/financial-invariants.md`: §1 a row "an operation's entry carries its provider and its cost,
  fixed at the write, in the same insert; the books are sums of them" with its proof; §3 a line that the provider
  books add no lock under the wallet lock.
- `docs/architecture/backend.md`: `wallets/` (`Sale.providerId`, `provider-cost.ts` gone), `providers/account/`
  (books from SQL), reporting (`supply`); remove the "Known gaps" lines on plain activations storing no
  `providerCost` and on provider accounts adding purchases in memory.
- `docs/handover/technical-operations-ar.md` §13: the deploy, the backfill command once, the check (amendment).

## Questions for the owner

1. **Is an operation's provider cost the cost on the day of the operation, fixed?** *Recommendation: yes.* Any later
   difference with the provider is a settlement entry, visible as such. Today a plain activation's cost moves with
   later price edits and transfers.
2. **Which provider does a past operation belong to?** *Recommendation: the provider of the package at the time of
   the operation.* Today it is re-derived from the package name or the line's current package on every read.
3. **The disconnect's provider cost.** Today the books count the full period cost at the sale **and** add the
   disconnect's `used share + 0.5 ₪ fee` as a further purchase (local data: disconnect rows with `providerCost` 167).
   If the provider credits the unused days less the fee, the disconnect should *lower* purchases instead. Which does
   the provider do? *Recommendation:* keep today's rule for the backfill (so it proves equal), and change it in its
   own slice once the provider's terms are known.
4. **An operation done at the provider whose money was given back** (`release-after-success`, ADR 0019) writes no
   operation entry, so it is no purchase today. *Recommendation:* keep that, and the accountant enters a settlement
   when the provider bills it. If every such case must be a purchase automatically, option A is needed instead of B.
5. **The providers report's cost will rise** for plain activations (it counts them as 0 today). *Recommendation:*
   accept it as a fix: one definition of cost.

## What I could not determine from the code

- Whether adding `used share + fee` on a disconnect is intended or a double count; no spec covers a disconnect with a
  stored cost (`provider-books.db.spec.ts` has one with none).
- Whether `repriceLine(…, { to: 'current' })` replaces a line's `subscription.branchCost` (I traced that a transfer
  re-stamps the terms from current prices, not field by field), so how much today's figures already drift.
- Whether a package can be moved to another provider (`Package.providerId` is required; I found no code that
  changes it, and did not prove there is none).
- How fast B's sum is at the audit's sizes: not measured. The scratch database was dropped; the generators are in the
  session scratchpad named in the audit and may be gone. P.4 measures before D is decided.
- How many operation entries on the staging server cannot be attributed (the local dev database has 46 operation-kind
  entries; I did not check staging).
- What real providers bill: no adapter exists; matching is simulated.

## The owner's answers (2026-11-17)

1. **The cost is fixed on the day: yes.** The ledger is a record to be reviewed; it is not edited afterwards. A later
   difference is a settlement entry.
2. **A past operation belongs to the provider of its package at the time: yes.**
3. **Disconnect: answered.** The provider gives back the price of the unused days less a disconnect fee of
   0.5 ₪ (50 agorot, the fee the system already defines). The owner's example: a 30 ₪ period, the number worked
   10 days, the provider gives back 19.5 ₪; the office's cost of that line is 10.5 ₪ (10 ₪ for the ten days and
   0.5 ₪ for the disconnect). So today's books are wrong: they count the full 30 at the sale **and** a further
   10.5 at the disconnect (40.5). Right: the disconnect lowers the purchases by what the provider gives back
   (−19.5), leaving 10.5. Built as its own slice after the backfill has proved the stored figures equal today's.
4. **An operation done at the provider whose money was given back to the customer: counted, and marked.** The
   owner: a number charged at the provider and not charged to the point of sale is a serious money problem. It is a
   purchase (the provider took its price), it shows as a loss of the branch, and it carries a visible mark so the
   office finds where the fault happened. Built as its own slice, with its spec.
5. **The providers report: a new requirement.** The owner wants, for every money operation, what the office
   recorded, what the provider recorded, and the difference between them. Today's "open differences" is a simulated
   match; a real one needs the provider's own statement (see `docs/providers/areen.md`) and its own spec. Recorded
   in `docs/superpowers/plans/2026-11-10-open-items.md`.

## Amendment (2026-11-17): one deploy, the backfill at HEAD, the provider from the line

Found in review after P.4; built as slice P.4b. Overrides "Backfill" above and the two releases of "Slices".

1. **There are no two releases.** The office pushes `main` once and the server deploys HEAD. Release 1 (P.1, P.2),
   with its backfill command, never runs on a server: the server goes straight to the code where P.4 deleted that
   command, the old rows have no `providerId`, and the books (sums of the stored columns) read zero for all history.
   So the backfill lives at HEAD (`cli/provider-ledger-backfill.ts`) and runs once on a database the new reads
   already use: deploy → run the command once, writes stopped → check (handover §13). Until it runs, the validate
   migration leaves the CHECK `NOT VALID` with a `WARNING`; the command validates it when no row breaks it.
2. **P.2's frozen name matching is replaced.** P.2 stored what the old books gave each entry, and the old books found
   the provider by the entry's package name and company: where that pair exists under several providers, the first
   found was taken (local dev: four entries of «500 جيجا», ويكوم, given to lian while their lines hold aren's and
   alloha's package). The owner's answer 2 is the rule: an operation belongs to the provider of its package at the
   time. A line cannot move to another provider's package (`switchOnto` refuses `OTHER_SHELF`), so the provider of the
   line's package is that provider. The command gives every operation entry its line's package's provider, moves the
   entries stored otherwise, and prints each move. A missing cost is filled by the rule its writer uses today, from
   the entry's own record of the day first (spec section "Provider ledger stored (DB.5)", P.4b).
3. **Entries it cannot resolve** (no line and no provider; a switch without its quoted difference) stop the run. The
   flag `--leave-unresolved` leaves them as they are — in no provider's books, as the books already read them — and
   the CHECK `NOT VALID`; nothing is invented for them.
4. **Rewriting stored columns of old rows** contradicts rule 3 ("never updated"). It is allowed here only because the
   system runs on trial data before launch, and the owner's standing rule is that nothing is kept in an old form.
   After launch the stored provider and cost are never updated: a later difference is a settlement entry (answer 1).
5. **The disconnect (answer 3, slice P.6).** A disconnect's entry stores minus what the provider gives back:
   `used share + fee − the open periods' cost` (`settleDisconnect`; spec section "A disconnect lowers the purchases
   (DB.5 P.6)"). Rule 4's "today `used share + DISCONNECT_FEE`" is replaced. The same command corrects the disconnects
   stored in the old form (a stored figure above the fee) to the stored figure less the open periods' cost at their
   own time, each printed; the same trial-data justification, and never after launch.

### The owner's answer on an activation priced zero (2026-11-17, later)

A package activated for a point of sale whose price for it is 0 (a task with `posDelta` 0, recorded without money)
stores a provider cost of 0 today, while the provider takes the package's price. The owner: it stores **the
package's real cost at the provider**; the operation then shows as a loss of the branch. Built with P.7 (the
operation done at the provider and given back to the customer), which is the same case: the provider was paid and
the point of sale was not charged.

### As built (P.7)

The spec section "Paid at the provider, not charged to the point of sale (DB.5 P.7)" holds the whole rule; in short:

- **The mark** is a column, `WalletEntry.providerLoss` (`given_back` | `priced_zero`, null otherwise), not a new entry
  kind: the row stays the operation it is, so the books, the kind filters and the CHECK `WalletEntry_operation_priced`
  read it unchanged. CHECK `WalletEntry_provider_loss` (a mark only on a row that moves 0 and names its provider and
  cost) and the partial index `WalletEntry_provider_loss`, migration `20261117240000_provider_loss`.
- **Answer 4, given back:** `ProviderDecisions.answer` (effect `release-after-success`) now records the activation
  the provider ran: `WalletLedger.recordOp` (through `TaskCompletion.recordGivenBack`) on the point of sale's wallet after `rejectByDecision`'s release, under
  the wallet lock that release takes, amount 0, the task's package's provider, the package's cost at the provider
  now (`packageActivationCost`: branch cost, plus the eSIM fee for an eSIM; the task keeps no cost of its day),
  `given_back`. Recommendation 4 above (no entry, a settlement by hand) is superseded. Option A was not needed: the
  entry is the purchase (rule 3 holds: one row, one truth).
- **Priced zero:** `operationColumns` marks an `activate` / `charge` / `extend` / `reactivate` that moves 0 at a cost
  above 0, in the entry's own INSERT. An activation task priced 0 now stores the cost a charged one stores
  (`TaskCompletion.applyClaimed` hands `recordOp` the sale with `postedCost`); before, it stored 0. An immediate
  activation and the renewals priced 0 already stored the real cost and now carry the mark. A switch with a
  difference of 0 is not a sale priced 0 and is not marked.
- **Margins:** a marked row stores `branchMargin` = − `providerCost` and no other margin or chain id (ADR 0026's
  invariant, `marginBreaks`, gains that case). It moves 0, so it is no sale in any count, volume or profit that reads
  the sales (`saleOrRefundWhere`); the providers report's branch profit includes it.
- **Reads, the branch only:** `losses` on every provider summary, `loss` on the ledger rows, on
  `GET provider-operations` (with `?loss=` and `stats.losses`) and on `GET finance` (null for any other viewer; the
  filter refused 403 to another layer).
- **Old rows:** the P.7 pass of `cli/provider-ledger-backfill.ts`: approved `release-after-success` events without
  their entry get one, dated at the approval; activations that moved 0 and stored cost 0 are re-priced; every sale at
  0 with a cost is marked. Local dev database (2026-11-17): no decision event and no entry that moved 0 exist —
  `P.7: marked priced_zero 0; given back written 0; sold at 0 left unmarked 0`, purchases unchanged (alloha 25500,
  aren 5000, sky 49288), the CHECK still validated; a second run wrote nothing.
- **Open for the owner:** whether the home's and the profit report's branch profit should also subtract these
  losses (today they are sales figures and do not). **Answered 2026-11-17: yes** — «الخسارة تبيّن في الداش بورد عندي
  خسائر، وتنطرح من الربح أكيد»; built as P.8 below.

### As built (P.8)

The owner's answer of 2026-11-17: the losses show on the home and are subtracted from the branch's profit. The spec
section "Branch losses in the profit figures (DB.5 P.8)" holds the rule; in short:

- **For the branch only**, every profit figure is the sales' and refunds' `branchMargin` plus the `branchMargin`
  (− cost) of the marked operations of the same period, bucket or group: the home's profit, its trend and period
  cards, the period before, its top packages / companies / providers (a group with losses and no sale ranks with count
  0), the profit report's rows and totals and its CSV, and the finance summary. Counts, volumes, activations and
  refunds stay the sales'. The providers report already counted the losses (P.7), so the home's top providers and it
  now agree.
- **New fields:** `sales.losses` `{ count, amount }` and `PulseTotals.losses` on `GET /v1/overview`; `losses` and
  `lossAmount` on each profit row and the totals of `GET /v1/finance/profits` (and two CSV columns, the branch's only);
  `losses` `{ count, amount }` on `GET /v1/finance/summary`. Amounts positive agorot; null / 0 for another layer.
- **How it is read:** a second read beside the sales read (which keeps its predicate and the partial sales index),
  `WHERE "providerLoss" IS NOT NULL` and the period, served by the new partial index `WalletEntry_loss_createdAt`
  (`createdAt` DESC), migration `20261118000000_provider_loss_created_at`; run for the branch only, so a lower layer's
  home, report and summary send no extra statement. Over all time the trend starts at the older of the first sale and
  the first loss (`firstLoss`), so every loss is on the axis. Nothing is added to a write path.
- **Web:** the branch's home profit card reads the net profit and its meta line names the losses (danger link to
  `/provider-operations?loss=any`) or «لا خسائر»; «الأرباح» has a «خسائر» column and the losses under its profit stat.
- **Proof:** `reporting/desk/branch-losses.db.spec.ts` (each figure for the branch, the lower layers unchanged with no
  loss read, the index chosen by `EXPLAIN` on two years of marked rows); `response-shape.spec.ts` pins the web types.
