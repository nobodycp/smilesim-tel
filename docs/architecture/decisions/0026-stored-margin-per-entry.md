# 0026 — Each sale's margins are stored on its wallet entry, one per layer; profit figures are SQL sums

- Date: 2026-11-17
- Status: **proposed — waiting for the owner's word.** Nothing here is built.
- Spec: `docs/superpowers/specs/2026-11-17-scale-speed-cleanup.md`, decision 4 ("each sale's margin a layer stored on
  its entry, so reports are exact over all time"; approved in principle, "own spec section and ADR before code").
- Plan: `docs/superpowers/plans/2026-11-17-database-scale.md`, DB.12 [MONEY]. Evidence:
  `docs/reviews/2026-11-17-database-audit.md` §3.3, §4 item 6, §6 "Aggregates", §12 row D.12, §13 item 4.
- Builds on ADR 0004, 0019, 0023, and on 0025 (the provider stored on the entry) for the providers figures.

## Context

### What is computed today, and by which code

A sale's wallet entry keeps its **price ladder** (`WalletEntry.ladder`, type `Ladder` in
`pricing/rules/profit-ladder.ts`): `{ kind, chain, costs, posSell, share? }` — the chain of account ids from the point
of sale up to the branch, what each paid, and the point of sale's sell price. `WalletLedger.post`
(`wallets/wallet-ledger.ts`) writes it:

- for a sale (`SALE_KINDS`: `activate`, `charge`, `extend`, `reactivate`; `amount < 0`) from `saleLadder()`, on the
  path the caller read and `AccountTree.confirmedPath` confirmed under the wallet lock (ADR 0023);
- for a refund (`REFUND_KINDS`: `disconnect`; `amount > 0`) from `refundOf()`: the line's last sale's ladder with
  `share = −(refunded / paid)` (`refundLadder`).

A **margin** is `marginOf(ladder, accountId)`: what the account below paid it (or `posSell` for the point of sale)
minus what it paid; for a refund `Math.round(margin × share)`. Null when the account is not in the chain. A switch
keeps no ladder and has no margin.

Every profit figure is worked out on read, in Node, from rows loaded with a cap:

| Figure | Code | Rows loaded | Viewer's margin |
|---|---|---|---|
| Home overview: sales, refunds, net, profit, trend, top packages / companies / providers, most active accounts a layer | `OverviewService.money`, `periodEntries` (`reporting/desk/overview.service.ts`) | newest **20,000** (`OVERVIEW_LIMIT`), `capped` | branch: `chain[last]`; others: themselves; "most active": every account of the chain |
| Previous-period cards | `totalsBetween` | **20,000** | same |
| Profit report and its CSV | `WalletsService.profitReport` (`wallets/wallets.service.ts`) | **50,000** (`PROFIT_REPORT_LIMIT`), `capped` | `marginsFor` |
| Providers report | `InsightsService.supply` (`reporting/reports/insights.service.ts`) | **5,000** (`REPORT_LIMIT`), `capped` | `marginsFor` (branch) |
| Finance summary (7 / 30 / 90 days) | `financeSummary`, `repo.soldEntries` | no limit | `marginsFor` |
| Finance list: each row's margin, the branch's `shares` | `finance` | one page | `marginsFor`, `sharesOf` |

Which rows a viewer sees is `financeWhere`: every entry for the branch, else `userId IN` the viewer's subtree **now**.
A margin then counts if the viewer is in the entry's kept chain. An entry with no kept ladder (rows from before
ladders were kept) gets one built on read by `laddersOf`: **today's** path and **today's** prices, with what the point
of sale paid; an old refund gets its line's earlier sale's ladder the same way.

DB.11 moved the line and task counts to SQL; the sales figures stay in Node because their profit needs the ladders.

### What it costs, and what is wrong

- **[W15]** profit report: **9.0–9.5 s**, seq scan and sort, and **wrong past 50,000 sales**.
- **[W7] / [W8]** overview month 0.13–0.93 s; "all time" **9.1–15.4 s** with a 1.4 GB disk sort, and **wrong past
  20,000 sales**.
- **[W10]** 90-day finance summary: 1.3–1.5 s, 216 k rows to Node, unbounded.
- **[W13]** providers report: 0.19 s for a month, **wrong past 5,000 operations**.
- **[A_W7prof]** the branch's margin computed in SQL from the ladder JSON: **53 ms** a month — a stand-in formula,
  not `marginOf` (refund rounding, missing ladders).

For the owner: on a busy office **"all time" on the home is the latest 20,000 sales, not all time**, and the profit
report the latest 50,000. The screen says `capped`; the number is still wrong. And an old entry's profit (no kept
ladder) changes when a price is edited or a point of sale is moved, because it is rebuilt from today's tree.

## What must be stored for every viewer's figure to be a SQL sum

Viewers: the branch (owner and staff see `chain[last]`, the branch account), a main agent, an agent, a point of sale
(each sees itself). The "most active accounts" card needs every account of the chain. So the branch's margin alone is
not enough; **every account of the chain needs its margin, and the id of the account it belongs to.** The branch is
the tree's one root, so its id need not be stored.

In the code and in the local data, a chain holds one account a layer — point of sale, agent, main agent, branch (four
long in every kept ladder locally; `AccountsService.create` hangs each account under the layer directly above). That
lets the shares be columns named by layer. I did not prove a chain can never repeat or skip a layer (see the end).

## The alternatives

Common to all: the entry is written by `post()` under the point of sale's wallet lock, in the operation's transaction.

### A. Margin columns on the entry, one per layer, with the chain's ids (recommended)

- **Written:** in the same `INSERT` of a sale or refund, computed from the ladder `post()` just built:
  `chainPosId`, `chainAgentId`, `chainMainAgentId`, and `posMargin`, `agentMargin`, `mainAgentMargin`,
  `branchMargin` (= `marginOf(ladder, that account)`).
- **Lock:** no new statement, no read, no lock (the layers come from the path `confirmedPath` already returned; a
  refund copies the ids from the sale entry `refundOf` already reads).
- **Reads:** one table, one row an entry: a viewer's profit is `SUM` of its layer's column filtered by its id; group
  by `packageName`, `companyName`, `providerId` (ADR 0025), day, or by `chainAgentId` for "most active" — no join.
- **Wrong if:** a chain had two accounts of one layer (the write refuses then, as an unreadable chain already stops a
  sale); a writer computes a margin differently from `marginOf` (the invariant below catches it).
- Size: about 3 ids (≈ 37 bytes each as text) and 4 integers on sale and refund rows only.

### A′. The branch's margin only (`branchMargin`)

- Same write, one column. Serves the branch's figures and the providers report (branch only).
- Leaves main agents, agents, points of sale and the "most active" card on capped Node reads. Rejected: half a fix.

### B. A share table, one row per entry per account (`EntryShare(entryId, accountId, layer, margin, createdAt)`)

- **Written:** two to four `INSERT`s (or one multi-row) per sale under the wallet lock: more statements under the lock.
- **Reads:** `SUM(margin) WHERE accountId = viewer`; any grouping by package, company or provider joins `WalletEntry`
  (millions of rows for the branch over all time).
- **Wrong if:** the share rows and the entry disagree (two tables).
- **For it:** no assumption on layers; any chain length works. If the layer assumption of A turns out false, this is
  the fallback.

### C. A daily summary table (`SalesDay`)

- **Written in the sale's transaction:** an upsert per day × chain × package. Rows keyed by an agent, main agent or
  the branch are shared by many points of sale: **hot rows** locked after the wallet, a new step in the lock order.
  Rejected on the sale path.
- **Written by the worker for closed days** from A's columns: nothing on the sale path; reads = closed days + today
  from entries. Fast "all time" for the branch. A second store with its own invariant; worth it only if A measures
  slow for "all time".

### D. Keep the caps and label the figures

- Nothing written. The screens say "the latest 20,000 sales". Cheap; the figures stay wrong and slow (W15, W8), and
  old entries keep moving with today's prices. Rejected: the owner approved exact figures (spec decision 4).

## Decision (recommended)

**A now; C (worker-written closed days) only if A measures over budget for "all time".** As rules:

1. **What is written.** For a sale entry and a refund entry that has a ladder, in the same `INSERT`:
   - `chainPosId` = `ladder.chain[0]`; `chainAgentId`, `chainMainAgentId` = the chain's account of that layer, null
     when the chain has none; the branch is the chain's last account (the root), not stored.
   - `posMargin`, `agentMargin`, `mainAgentMargin`, `branchMargin` = `marginOf(ladder, id)` for that account, null
     when the chain has no account of that layer. Integer agorot; a refund's are negative (its ladder's `share`).
   - Entries without a ladder (not a sale or refund; a switch; a sale whose ladder could not be built) get nulls.
   - A sale's layers are those of the path `confirmedPath` returned; a refund copies the three ids from the sale entry
     `refundOf` reads. (Release 1 opens to traffic only after the backfill, so that entry has its ids; the refund
     of a sale left without a ladder by the backfill keeps none, as today.) If a path holds two accounts of one layer, the write refuses (`409`), as an unreadable chain
     already refuses the sale.
2. **In which transaction, in which order.** In `post()`'s `INSERT`, after the wallet lock, exactly where the entry
   and its ladder are written today. **No statement, read, lock or foreign key is added** (the ids are not foreign
   keys, as the ids inside the ladder JSON are not). The lock order of ADR 0019 / 0023 is unchanged;
   `sale-lock-tree.db.spec.ts` keeps its counts (11 and 12).
3. **The source of truth** is the entry's kept `ladder`. The columns are its projection by `marginOf`, fixed at the
   write and never updated. `marginOf` stays the one definition of a margin.
4. **Later events.**
   - *Refund:* its own entry, margins from its ladder (negative), written at the refund.
   - *Price edit, sell-price edit, transfer of a point of sale, layer change:* change no stored margin — as today for
     every entry with a kept ladder.
   - *Failed, cancelled, rejected or abandoned operation:* no sale entry, no margin (a hold and its release carry none).
   - *A wallet correction* (`fund` / `deduct` with a reason): no ladder, no margin — as today.
   - *A switch:* no ladder, no margin — as today (it moves a difference, not a sale).
   - *A provider settlement* (ADR 0025) changes the provider's balance, not a layer's margin; margins never included
     the provider cost.
5. **Reads.** The overview (`money`, `totalsBetween`), the profit report and CSV, the providers report and the
   finance summary become SQL aggregates over the period: counts, volumes, refunds, net and profit together, grouped
   as each screen needs. The caps and the `capped` fields go (a response change: `response-shape.spec.ts` and the web
   in the same slice). The finance list reads the stored margins for its page (and `shares` from the ids and margins).
   `laddersOf`'s rebuild from today's prices is deleted after the backfill; `refundOf` keeps reading the last sale's
   ladder at the write.
6. **The invariant**, runnable as a db spec and as a read-only CLI on a copy: for every entry with a ladder, each
   stored margin = `marginOf(ladder, the account of that layer)`, and the ids = the chain's; entries without a ladder
   have all seven null. It runs in Node, not SQL: a refund's margin is JavaScript's `Math.round` of a float
   (ties toward +∞), and PostgreSQL's `round` rounds ties away from zero, so a SQL re-computation would differ on
   negative halves.

### Whose figure: the open choice (question 1)

Today a main agent's profit counts an entry when its point of sale is under the main agent **now** and the main agent
is in the entry's chain. After a point of sale moves to another agent, neither the old nor the new agent sees its
earlier sales' margins (the old no longer sees the rows; the new is not in the chain). The stored ids allow either:

- **by the chain at the sale:** `WHERE "chainAgentId" = $viewer` — the old agent keeps the margins it earned. This is
  what `docs/project-plan.md` 2026-10-24 "نقل نقطة البيع" says («الاشتراكات الشغالة تبقى محاسبياً عند الوكيل القديم»).
- **as today:** add `AND "userId" IN (subtree now)` — exactly today's figures, and the visibility list stays in the
  query.

For the branch the two are the same. Only lower layers after a transfer differ.

## Backfill

- **What:** for every sale and refund entry, compute the seven columns from its kept ladder; for an entry without a
  kept ladder, the ladder `laddersFor` builds today (today's path and prices; an old refund from its line's earlier
  sale) — and write that ladder into `ladder` too, so every row then has its source. Entries for which no ladder can
  be built stay null, as they count 0 today.
- **How:** a CLI using `laddersFor` and `marginOf` (TypeScript, not SQL, for the rounding and the rebuild), run once
  with writes stopped in the deploy window. It writes ladders into old rows, which is acceptable on trial data only.
- **Proof before the reads switch:** in the same run, before committing, for every account in the tree and every
  period the screens offer (day, month, all, the previous windows, the 7 / 30 / 90-day summary, the profit report by
  package, the providers report), the old Node result equals the new SQL result to the agorot, or it rolls back. On
  trial data no cap is reached (the local database has 23 sale entries and 4 refunds; the CLI checks the counts are
  under every cap, otherwise the comparison is not valid and it stops). If the owner picks "by the chain at the sale",
  the comparison runs with the visibility filter (to prove the columns) and lists separately the entries whose
  figure moves, so the owner sees the change.
- **What equality means:** today's figure for an entry without a kept ladder floats with prices; the backfill
  freezes it at the run. Equal at that moment, by design different later. (Locally, 15 of 23 sale entries and 3 of 4
  refunds have no kept ladder.)
- **The owner's rule** (trial data, nothing kept in an old form) allows the simple path: no dual reading period, the
  rebuild code deleted in the switching slice, old rows rewritten with their ladder. As in ADR 0025, migrations run at
  the API's start, so the `CHECK`'s validation and the switched reads ship in the release after the backfill.

## Schema sketch

```prisma
model WalletEntry {
  // … as today …
  chainPosId       String?
  chainAgentId     String?
  chainMainAgentId String?
  posMargin        Int?
  agentMargin      Int?
  mainAgentMargin  Int?
  branchMargin     Int?
}
```

```sql
-- release 1: new rows checked at once
ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_sale_margins"
  CHECK ("ladder" IS NULL OR ("chainPosId" IS NOT NULL AND "branchMargin" IS NOT NULL)) NOT VALID;
-- release 2, each CONCURRENTLY in its own migration; the branch uses the existing partial sales index
CREATE INDEX CONCURRENTLY "WalletEntry_chainMainAgent_createdAt"
  ON "WalletEntry" ("chainMainAgentId", "createdAt" DESC) INCLUDE ("mainAgentMargin", "amount")
  WHERE "chainMainAgentId" IS NOT NULL;
CREATE INDEX CONCURRENTLY "WalletEntry_chainAgent_createdAt"   ON … ("chainAgentId", …)   WHERE … IS NOT NULL;
CREATE INDEX CONCURRENTLY "WalletEntry_chainPos_createdAt"     ON … ("chainPosId", …)     WHERE … IS NOT NULL;
ALTER TABLE "WalletEntry" VALIDATE CONSTRAINT "WalletEntry_sale_margins";
```

Whether the branch's all-time sum needs an `INCLUDE (branchMargin, …)` on the partial sales index, or C, is decided
by measurement in M.4.

## Slices

| # | Slice | Verified by |
|---|---|---|
| M.1 | Columns and the `NOT VALID` check; `post()` writes them from the ladder; `refundOf` copies the ids. Reads unchanged. | new `wallets/stored-margins.db.spec.ts` (activation, renewal, extension, task capture, settlement, refund, a switch with none); `margins.spec.ts`; `sale-lock-tree.db.spec.ts` counts unchanged |
| M.2 | The backfill CLI with its proof and the invariant check. | a db spec on a fixture with kept and missing ladders, old refunds, a moved point of sale |
| — | **Release 1**, the CLI run in the window. | the CLI's comparison output |
| M.3 | Indexes and `VALIDATE`. | migrations apply on a backfilled database |
| M.4 | Reads switched: overview, previous period, profit report and CSV, providers report, finance summary, finance list margins; caps and `capped` removed; `laddersOf`'s rebuild deleted. | `overview.service.spec.ts`, `overview-counts.db.spec.ts`, `finance-ledger.spec.ts`, `operations-ledger.spec.ts`, `response-shape.spec.ts` updated for `capped`; before/after plans at the audit's sizes |
| — | **Release 2.** | |
| M.5 | (Only if M.4 measures over budget for "all time") the worker's closed-day summary (C). | invariant: closed days = sums of their entries |

ADR 0025 should go first: the providers figures (overview's top providers, the providers report) then group by the
entry's own `providerId` instead of the line's current package.

## Docs that change with it

- `docs/architecture/financial-invariants.md`: §1 a row "a sale's and a refund's margins are stored on the entry in the
  same insert, from its kept ladder by `marginOf`, never updated", with the invariant and its proof.
- `docs/architecture/backend.md`: `wallets/` (`post`, `laddersFor`), reporting (overview, reports: SQL, no caps).
- `docs/handover/technical-operations-ar.md` §13 (the two releases, the CLI); `client-handover-ar.md` if it describes
  the home's "all time" or the reports' limits (I did not find such a line).

## Questions for the owner

1. **After a point of sale moves to another agent, whose profit are its earlier sales?** *Recommendation: the
   accounts in the sale's chain at the time* — the old agent keeps the margin it earned, as the 2026-10-24 rule says
   for running subscriptions. Today neither agent sees it.
2. **Old sales recorded without their price chain:** freeze their profit at the backfill (*recommended*), or keep
   recomputing from today's prices (today: it moves with every price edit)?
3. **"All time" exact over speed?** *Recommendation: exact always*, the caps removed; if the home's "all time" takes
   longer than the budget you accept (I suggest 1 s), the closed-day summary is built (M.5). Which budget?

## What I could not determine from the code

- That a chain can never hold two accounts of one layer or skip one. The code I read and the local data have one a
  layer; the account creation and transfer rules were not proven exhaustively. If it can, option B replaces A.
- How fast the SQL sums are at the audit's sizes for each layer and for "all time": only the stand-in [A_W7prof]
  (53 ms, a month, the branch) was measured; the scratch database was dropped.
- Whether any existing refund margin would differ between JavaScript's and PostgreSQL's rounding (it does not matter
  for this design, which computes in Node, but it rules out a pure SQL backfill).
- Whether the web shows `capped` anywhere, and which screens a removal touches (web code not read).
- How many entries on the staging server lack a kept ladder, and whether `laddersFor` can rebuild all of them.
