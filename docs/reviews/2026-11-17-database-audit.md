# Database audit: schema, access, queries, indexes, search (2026-11-17)

- **Scope:** `apps/api` (NestJS 12, Prisma 7 with `@prisma/adapter-pg`), PostgreSQL 18.7. Read-only towards the
  application. No code, schema or migration changed. Everything below was measured on a scratch database
  (`smilesim_scale`) that was built from the 75 migrations, filled with synthetic data, measured and then **dropped**.
- **Evidence:** scripts and raw `EXPLAIN (ANALYZE, BUFFERS)` output are under
  `/private/tmp/claude-501/-Users-nobody1-Desktop-prosim-smilesim-tel/8ea10687-07f4-42ad-991b-10124dce6db9/scratchpad/db-audit/`
  (`sql/` the generators and the query cases, `out/plans-cold/` first run, `out/plans/` second run and the "after"
  runs, `out/summary-cold.tsv`, `out/run-warm.log`, `out/prisma-sql.log` the SQL Prisma really sends,
  `out/fk-unindexed.txt`, `out/40-index-usage.txt`). A case is cited as **[L1]**, the name of its plan file.
- **Reading the numbers:** the machine is the owner's laptop. PostgreSQL ran in Docker Desktop (3.8 GB RAM for the
  VM, `shared_buffers` 128 MB, `work_mem` 4 MB, 2 parallel workers) next to the dev copy and two other agents. Data
  (10 GB) was larger than memory, so most reads hit the VM's disk, as a small production server would. Times vary
  by about ±40 % between runs. Where two numbers are given they are run 1 / run 2. Treat them as an order of
  magnitude. The verdicts depend on the plan shapes (full scan, sort, spill), and those did not change between runs.

---

## 1. Summary: the five things that hurt first

| # | Finding | Measured (at the sizes in §2) | Grows with |
|---|---|---|---|
| 1 | **The provider books read every operation entry ever, with no limit, every 120 s on every API process, and twice on each branch home load.** `WalletsService.pricedOperations` → `ProviderAccountsService.books()` is called by the health watch (`ProviderHealthService`, every `HEALTH_CHECK_SECONDS` = 120), by the providers screens, by the reconciliation and by the branch overview (`providers()` → `list` **and** `health.current`). It also loads every line of those entries. | **13.4–25.5 s** and **3.78 M rows** handed to Node at 6 M entries, plus a 1.5 GB sort spilled to disk **[W6]**. The process holds each row as an object, so this is gigabytes of memory every 2 minutes. | every sale, without bound |
| 2 | **"Newest first" lists have no index on their order.** Lines, tasks and finance are read `ORDER BY "createdAt" DESC, id DESC`. Only `(posId, createdAt)`, `(userId, createdAt)` and `(kind, createdAt)` exist, so the branch view (and any view with an `IN` list) is a full scan with a top-N sort. | Branch lines page **2.7–3.9 s** **[L1]**. Branch finance page **4.1–6.1 s** **[W1]**. Tasks page **0.74–0.80 s** **[T1]**. Overview "all time" **9.1–15.4 s** with a 1.4 GB disk sort **[W8]**. With an index on `(createdAt DESC, id DESC)` the same pages take **0.2–1.7 ms** **[A_L1in, A_W1, A_T1]**, and the overview takes **18 ms** with a partial index **[A_W8]**. | rows in the table |
| 3 | **Every list page also counts its whole filter.** `count(*)` runs beside each page (lines, tasks, finance, activity, notices, request log), and the cursor's `OR` form stops the index from bounding deep pages. | Branch lines count **3.5–5.9 s** **[L1c]**. Finance count **5.2–6.7 s** **[W1c]**. Request-log count **2.7–2.9 s** **[R1c]**. Page 2,000 of the lines by cursor **2.96 s** even with the right index **[A_L1p]**, against **0.06 ms** with an `AND` form of the same cursor **[C_L1p2]**. A capped count ("10,000+") takes **5.7 ms** **[A_L1cap]**. | rows matching the filter |
| 4 | **Search is `%text%` on unindexed columns, OR-ed across joined tables.** The top-bar search is `/v1/lines?q=`. It matches a number, a serial, a package name and a company name in one `OR` over `LEFT JOIN`s, so no index can serve it, and it runs a count too. Finance search ORs five columns. Account search is `String.includes` in memory, case-sensitive, with no Arabic normalisation. | Top-bar search **2.8–2.9 s + 2.5–2.7 s count** **[L4, L4c]**. Exact full number **2.9–3.0 s** **[L5]**. Finance search **8.8–9.5 s + 8.5–9.2 s count** **[W2, W2c]**. With `pg_trgm` and the name match split out: number search **10.6 ms** and count **2.5 ms** **[A_L4num, A_L4numc]**, full number **0.8 ms** (prefix btree) **[A_L5]**, name search **0.9 ms** **[A_L4name]**. | lines and entries |
| 5 | **Account deletes and the money transaction pay for foreign keys without indexes.** 14 FK columns have no index. Deleting an account makes PostgreSQL scan `WalletEntry` (by `actorId`), `Task` (by `posId`), `TaskNote` and `Session`. `Task.lineId` has no index, yet `openTaskOn` runs on every line operation and `tasksOfLine` on every line card. Inside the sale's transaction, with the point of sale's wallet row locked, `saleLadder` loads **every account** (`AccountTree.accounts(tx)`). | Account delete check on `WalletEntry.actorId`: **5.1–5.2 s** seq scan of 6 M rows **[S2]**; with an index **1.0 ms** **[A_S2]**. A line's tasks: **100–185 ms** seq scan of `Task` **[T6]**, **1.7 ms** with an index **[A_T6]**. All accounts: **7.5–8.2 ms** at 3,230 accounts **[A1]**, run on almost every request and once more inside each sale's lock. | accounts and rows |

Two more findings are almost as urgent:

- **The visibility model sends the whole tree to every query.** It also works out each account's subtree in
  memory, once per request (§5).
- **No retention:** `Notice`, `Session`, `OutboxMessage`, `LineCountSnapshot` and `AccessLog` grow without bound
  (§9).

---

## 2. How the scratch database was built

| Table | Rows | Why this size | Size on disk (heap + indexes) |
|---|---|---|---|
| `User` / `Wallet` | 3,230 | 1 owner, 9 staff, 20 main agents, 200 agents, 3,000 points of sale: a four-level tree for a large wholesale office | < 1 MB |
| `Package` / `Company` / `Provider` | 60 / 6 (+11 from the migrations) / 3 | a realistic catalog | < 1 MB |
| `Line` | 2,000,000 | 5 years at about 1,100 new numbers a day; 65 % active, 10 % frozen, 22 % disconnected, 3 % suspended | 1,050 MB (579 + 471) |
| `WalletEntry` | 6,000,000 | 5 years: activations, monthly charges, holds and releases, funding; 3.78 M of them are operation kinds | 3,306 MB (2,051 + 1,255) |
| `Task` | 1,000,000 | 5 years, 5,000 open | 489 MB |
| `TaskNote` | 1,000,000 | | 353 MB |
| `ProviderOperation` | 505,000 | one per task for half the tasks plus every open one; 100 `unknown`, 700 `requested` | 341 MB |
| `OutboxMessage` | 1,009,200 | one send message and one settle message per operation (none pruned today) | 494 MB |
| `ActivityEvent` | 2,000,000 | the 90-day window at about 22,000 events a day | 761 MB |
| `RequestLog` | 3,000,000 | the 14-day window at about 214,000 requests a day | 1,943 MB (837 + 1,106) |
| `Notice` | 2,000,000 | 5 years, 85 % read | 791 MB |
| `Session` | 300,000 | 5 years of sign-ins (rows are never deleted today) | 175 MB |
| `LineCountSnapshot` | 2,002,600 | every account, 620 days | 288 MB |

- **Totals:** the database was 10 GB, and 12 GB with the candidate indexes of §11. **That is above the 8 GB I was
  asked to stay under.** The `text` uuid keys and their indexes came out about 35 % larger than I estimated.
- **Disk:** host free disk fell from 32 GB to **11 GB** while the candidate indexes were built, which is under the
  15 GB stop line. I then stopped writing:
  - no more data was generated;
  - three tables I had finished with were truncated;
  - only read-only "after" queries ran (with `temp_file_limit = 100MB`, so nothing could grow);
  - the uuid-versus-text table test was skipped (§10), and the database was dropped.

  Docker Desktop gives the space back to the host on its own schedule. At the end the host had 14 GB free. **Check
  `df -h /` before the next heavy job.**
- **Generation time:** about 20 minutes, in batches of 500,000 rows (`sql/01`–`06`). Wallet entries took
  14 minutes, mostly for random-uuid index inserts.
- **Real five-year volume:** a busy office probably has more entries than this (charges every month for every
  active number: 1.3 M active × 12 a year). **Every finding marked linear below gets worse in proportion: at 20 M
  entries, multiply the `WalletEntry` times by about 3.**

**The SQL that was measured** is the SQL Prisma sends. A throwaway script outside the repo ran the app's query
shapes against the scratch database with Prisma's query log (`prisma-log/log-queries.ts`, output
`out/prisma-sql.log`). What it shows:

- Prisma 7 sends `IN ($1,…,$n)` with one parameter per id.
- It loads every relation in a separate query (`… WHERE id IN (…)`).
- It turns relation filters (`package: { name: { contains } }`) into `LEFT JOIN` + `ILIKE '%' || $x || '%'`.
- It turns `count` into `SELECT count(*) FROM (SELECT … OFFSET 0)`.

The cases in `sql/cases.sql` copy those shapes, with the `IN` lists the services build (3,000 points of sale for
the branch, 150 for a main agent, 15 for an agent).

---

## 3. Every query on a growing table

**Verdicts:** ✅ served by an index · ⚠ served, but degrades · ❌ full scan or no usable index. Times are run 1 / run 2.

### 3.1 `Line`

| Query (file:line) | Filter · order · paging | Index used today | Time | Verdict |
|---|---|---|---|---|
| Numbers list, `LineReads.list` (`sales/line-reads.ts:28-42`, `lines.repository.ts:22`) | `posId IN (visible points of sale)` + filters · `createdAt DESC, id DESC` · cursor, `LIMIT 31` | branch: none (parallel seq scan + top-N sort) **[L1]**; agent: bitmap on `(posId, createdAt)` + sort **[L2]** | branch 2.7 / 3.9 s; main agent 2.0 / 0.75 s **[L3]**; agent 0.68 / 0.19 s | ❌ branch, ⚠ others |
| …its count, `countLines` (`line-reads.ts:41`) | same filter | index-only scan of `(posId, createdAt)`, every row | branch 3.5 / 5.9 s **[L1c]** | ❌ linear |
| …with `q` (top bar), `linesWhere` (`sales/rules/line-filters.ts:51-80`) | `msisdn LIKE %d% OR iccid LIKE %d% OR package.name ILIKE OR company.name ILIKE` | none | 2.9 / 2.8 s + count 2.7 / 2.5 s **[L4, L4c]**; exact number 3.0 / 2.9 s **[L5]** | ❌ |
| `status=suspended` / `expiring` (`line-filters.ts:18-41`) | status + `endsAt` per package period, through joins | `(posId, createdAt)` | 1.35 / 1.08 s **[L6]**; expiring 0.46 / 0.36 s **[L8]** | ❌ |
| Overview line donut (`reporting/desk/overview.service.ts:100-113`, `desk.repository.ts:31-37`) | 5 counts: `posId IN` + status / `endsAt` | `(posId, createdAt)` + filter | active 0.84 / 0.75 s **[L7]**: about 3 s for the five, on every home load | ❌ |
| Line snapshot pass (`line-snapshots.service.ts:39-58`) | 5 × `GROUP BY posId` over the whole table, every 60 min | seq scan | 0.53 / 0.38 s each **[L9]**, then one upsert per account (3,230) | ⚠ acceptable hourly |
| Package report `_count` (`reports.repository.ts:15-22`) | `GROUP BY packageId` over all lines | seq scan | 0.37 / 0.34 s **[L10]** | ⚠ |
| Price tables (`pricing/terms.repository.ts:59-95`, `terms.service.ts:259,280`) | `packageId = ? AND status IN`, every row's `terms`, no limit; a save rewrites each line in one transaction | `Line_packageId_idx` | 0.31 s to read 33 k lines **[L12]**; renewable counts for a tree 1.0 / 0.5 s **[L11]** | ⚠ the reprice transaction is long at scale |
| Line card (`lines.repository.ts:37`), by msisdn (`:105`) | primary key / unique | ✅ | < 1 ms | ✅ |

### 3.2 `Task`, `TaskNote`

| Query | Shape | Index today | Time | Verdict |
|---|---|---|---|---|
| Inbox, `TasksService.list` (`tasks/tasks.service.ts:41-66`, `tasks.repository.ts:19`) | branch `{}`; others `submitterId = ? OR posId IN (…)` · `createdAt DESC, id DESC` · `LIMIT 51` | branch: seq scan + sort **[T1]**; others: seq scan, because **`Task.posId` has no index** **[T3]** | 0.80 / 0.74 s; agent 0.32 / 0.23 s | ❌ |
| …count (`tasks.service.ts:65`) | same | seq scan | 0.19 s branch, 0.26 s agent **[T1c, T3c]** | ❌ linear |
| `status=working` | `(status, createdAt)` | ✅ | 1.6 ms **[T2]** | ✅ |
| `q` (number) (`tasks.service.ts:59`) | `msisdn LIKE %d%` | none | 0.24 / 0.12 s + count **[T5]** | ❌ |
| Line card tasks (`lines.repository.ts:44`); `openTaskOn` on every line operation (`tasks.repository.ts:111`) | `lineId = ?` | **none** (`Task.lineId` has no index) | 185 / 100 ms seq scan **[T6]** | ❌ |
| Last note per row (`tasks.repository.ts:25`) | `TaskNote.taskId IN (51 ids)` | `(taskId, createdAt)` | 0.29 s **[T8]**: Prisma reads **every** note of the 51 tasks and keeps one per task in memory | ⚠ |
| Overview: one count per status (5 statements) and the oldest open task (`desk.repository.ts:99-106`) | `taskWhereFor` + status | seq scan for non-branch accounts | 0.21 s each **[T11]** | ❌ |
| Health watch `tasksNotedSince` (`providers.repository.ts:178`) | `note = ? AND createdAt >= now-60m` | `(status, createdAt)` does not match; the planner used a `createdAt` range by luck of the data | 1–1.6 ms **[T9]** | ⚠ depends on the plan |
| Provider books, open tasks (`providers.repository.ts:107`) | `status IN (pending, working)` | `(status, createdAt)` | 2.8 ms **[T10]** | ✅ |

### 3.3 `WalletEntry`, the ledger

| Query | Shape | Index today | Time | Verdict |
|---|---|---|---|---|
| Finance «المالية» page, `WalletsService.finance` (`wallets/wallets.service.ts:375-385`, `financeWhere` `:190`) | branch `{}`, others `userId IN (subtree)` · newest first · `LIMIT 81` | branch: seq scan + sort **[W1]**; main agent: `(userId, createdAt)` bitmap of 300 k rows + sort **[W4]** | branch 4.1 / 6.1 s; main agent 3.4 / 4.2 s | ❌ |
| …count (`:382`) | same | full index-only scan | branch 6.7 / 5.2 s **[W1c]**; main agent 0.85 s **[W4c]** | ❌ |
| …with `q` | `msisdn LIKE OR note ILIKE OR packageName ILIKE OR companyName ILIKE OR user.loginName ILIKE` (join) | none | 8.8 / 9.5 s + count 8.5 / 9.2 s **[W2, W2c]** | ❌ |
| …`layer=` | join to `User` | seq scan | 0.51 s count **[W3]** | ❌ |
| Own wallet «المحفظة», `ledger` (`:114-133`) | `userId = ? AND kind IN` | `(userId, createdAt)` ✅ | 2.6 ms **[W5]** | ✅ |
| **`pricedOperations`** (`wallets.service.ts:161-185`, `wallets.repository.ts:39`) | `kind IN (13 kinds)` · newest first · **no limit**; then `linesWithPackage(every line id)` | seq scan + external sort | **25.5 / 13.4 s, 3.78 M rows** **[W6]** | ❌❌ |
| Overview "month" `periodEntries` (`overview.service.ts:117-130`) | sales/refunds `OR`, `createdAt >= month` · `LIMIT 20000` | `(kind, createdAt)` bitmap | 0.93 / 0.13 s **[W7]** | ⚠ |
| Overview "all" | same, no date | seq scan + 1.4 GB disk sort | 15.4 / 9.1 s **[W8]**; results are **wrong past 20,000 sales** (`capped`) | ❌ |
| Overview "previous period" `totalsBetween` (`:204-223`) | unordered, `LIMIT 20000` | as above | (as W7) | ⚠ |
| Finance summary «90 days» `soldEntries` (`wallets.service.ts:344`) | sales/refunds over 90 days, **no limit**, margins worked out in Node | `(kind, createdAt)` | 1.3 / 1.5 s, 216 k rows to Node **[W10]** | ❌ |
| Profit report (`:303`) | sales/refunds, `LIMIT 50000` | seq scan + sort | 9.5 / 9.0 s **[W15]**; wrong past 50,000 | ❌ |
| Desk "latest operations" (`desk.repository.ts:45`) | `userId IN (3,000) AND kind IN` · `createdAt DESC LIMIT 8` | seq scan + sort | 6.5 / 4.1 s **[W11]** | ❌ |
| Balances report `lastMovementOf` (`insights.service.ts:62`, `reports.repository.ts:43`) | `GROUP BY userId` over `userId IN (all)` | full index-only scan of 6 M | 9.1 / 7.9 s **[W12]**; a LATERAL probe per account takes 0.59 s **[A_W12]** | ❌ |
| Providers report `supply` (`reports.repository.ts:48`) | `kind IN`, one month, `LIMIT 5000` | `(kind, createdAt)` | 0.19 s **[W13]** | ✅ (but capped at 5,000) |
| Line card entries, `refundOf` and `paidEntries` in the money transaction (`wallet-ledger.ts:187`, `lines.repository.ts:146`) | `lineId = ?` | `WalletEntry_lineId_idx` ✅ | 2 ms **[W14]** | ✅ |

### 3.4 Logs and the rest

| Query | Index today | Time | Verdict |
|---|---|---|---|
| Activity log page, branch, 90 days (`auditing/audit.service.ts:38-47`) | `(at)` | 0.5 ms **[E1]** | ✅ |
| …count | index-only, the window | 0.6 / 2.2 s **[E1c]** | ❌ linear (bounded by 90 days) |
| …`q` (`actorLogin ILIKE OR subjectRef ILIKE`) page / count | none | 5 ms page (matches are common) / 1.6 s count **[E2, E2c]**; trigram count 0.88 s **[A_E2c]** | ❌ |
| …a main agent's log, `actorId IN (171)` | `(actorId, at)` | 0.4 ms page, 0.26 / 1.7 s count **[E3c]** | ⚠ |
| Failed sign-ins `addresses` (`audit.repository.ts:23`) | `(action, at)` | 0.65 / 2.3 s **[E4]** | ⚠ |
| Notices inbox + unread count + total (`notice-inbox.service.ts:15-28`) | `(userId, createdAt)`, `(userId, readAt)` | 5 ms + 5–10 ms + 113–123 ms total **[N1, N1c, N1t]** | ✅ / ⚠ total |
| **`taskNoteSent`** (`sales/lines.repository.ts:178`), called from `tellUnknown` (`sales/settlement/activation-settlement.ts:244`) **inside the transaction that holds the task's and the operation's locks** | none: JSON-path filter on `Notice` | **0.87 / 0.72 s seq scan of 2 M notices** **[N3]**; 1.3 ms with an expression index **[A_N3]** | ❌ |
| Request log page, 14 days | `(at)` | 0.2–0.7 ms **[R1]** | ✅ |
| …count / totals / route figures (`request-log.repository.ts:56-89`) | scans the window | 2.7–2.9 s / 0.6–0.75 s / **5.6–6.4 s** **[R1c, R2, R3]** | ❌ (a summary table would serve) |
| …`ip` starts with (`:158, :176`) | `(ip, at)` cannot serve `LIKE 'x%'` under the `en_US.utf8` collation | 1.7 s count **[R4c]**; 50 ms with `text_pattern_ops` **[A_R4c]** | ❌ |
| …`path` contains | none | 2.4 / 2.8 s **[R5]** | ❌ |
| …one account (`login OR actorId OR operatorId`) | the `OR` defeats `(actorId, at)` | 0.12 s **[R6]** | ⚠ |
| Alert pass, every 30 s (`monitoring/alert.repository.ts:50-117`) | `(at)`, `(status, at)` over a few minutes | 0.3–0.8 ms **[R7, R8]** | ✅ |
| Retention purge batch (`monitoring/retention.ts:36`) | `(at)` | 5.5 ms a batch **[R9]** | ✅ |
| Sweeper, unsettled (`provider-operations.repository.ts:160`) | walks the primary key and filters `appliedAt IS NULL` | 1.05 s for 50 rows **[P1]**; it walks every settled row ever; 0.7 ms with a partial index **[A_P1]** | ❌ grows |
| Sweeper, unknown / recovery / waiting (`:105, :111, :175`) | `(status, id)`, `(status, updatedAt)` | 1–7 ms **[P2–P4]** | ✅ |
| Decisions queue (raw SQL, `:241`) | seq scan of operations | 0.39–0.41 s **[P5]** | ⚠ |
| Outbox claim / status (`outbox.repository.ts:14`, `status.repository.ts:41`) | `(publishedAt, createdAt)` | 0.4–7 ms **[O1, O2]** | ✅ (but see retention) |
| Sessions of an account (`auth/prisma-auth.store.ts:294, :370, :420`), delete by account (`accounts.repository.ts:147`) | **none** (`Session.userId` has no index) | 0.36 / 0.62 s **[S1]**; 7 ms with an index **[A_S1]** | ❌ |
| Account delete: `RESTRICT` checks | none on `WalletEntry.actorId`, `Task.posId`, `TaskNote.authorId` | 5.1 s / 0.5–1.5 s / 0.4 s **[S2–S4]** | ❌ |
| Line snapshot before the period (`desk.repository.ts:60`) | primary key `(userId, day)` | 1–2.5 ms **[S5]** | ✅ |

---

## 4. Lists and paging

**The contract is good.** `platform/paging.ts` gives one shape (`{ items, nextCursor, total }`), opaque cursors and
`size + 1` reads. No list uses `OFFSET` paging: Prisma's `OFFSET 0` is harmless. What goes wrong is beside it.

1. **No index matches `NEWEST_FIRST`.** See finding 2 and §3.
2. **Each page counts its whole filter.**
   - Measured: branch lines 3.5–5.9 s **[L1c]**, finance 5.2–6.7 s **[W1c]**, request log 2.7 s **[R1c]**,
     activity 0.6–2.2 s **[E1c]**.
   - This is linear in the rows matched, and no index makes it constant.
   - **Fix:** count up to a cap (`SELECT count(*) FROM (… LIMIT 10001)`, 5.7 ms **[A_L1cap]**) and answer
     `total: 10000, totalCapped: true`. The other way is to drop `total` from page 2 onward. Either one changes the
     list contract (`backend-engineering.mdc` 4.7, `response-shape.spec.ts`), so the owner has to approve it.
3. **The cursor's `OR` form gives the index no bound.**
   - `after()` (`paging.ts:49`) writes `createdAt < X OR (createdAt = X AND id < Y)`. PostgreSQL cannot turn that
     `OR` into an index range, so a deep page walks the index from the newest row. Page 2,000 of the lines took
     2.96 s with the right index **[A_L1p]**.
   - Written as `createdAt <= X AND (createdAt < X OR id < Y)`, which Prisma can express, it takes **0.06 ms**
     **[C_L1p2]**. The row comparison `("createdAt", id) < (X, Y)` takes 1.4 ms **[C_L1p]**.
   - This is a one-function change with the same results.
4. **Lists sorted or filtered in memory:**
   - Accounts (`usersPage`, `access/accounts/users-page.ts:35`) load every account, then filter and sort in Node.
     That is fine at 3,000 accounts and should be revisited past about 20,000.
   - The provider ledger (`provider-accounts.service.ts:186-210`) loads every operation and every payment, sorts
     them, works out a running balance, then cuts to 1,000.
   - Provider operations filter their match state in memory, which the map already lists as a known gap.
5. **Reads with no limit:**
   - `pricedOperations` (finding 1).
   - `soldEntries` (the 90-day finance summary).
   - `lineTermsIn` / `linesToReprice` (one package's lines).
   - `renewableLinesOn` (a transfer).
   - `salesOfLines` (every sale of the lines on a page).
   - `entriesOf(providerId)` (every payment).
   - `listSessions`.
   - The CSVs are capped (finance 10,000, audit 5,000).
6. **Capped aggregates give wrong totals.** The overview (20,000), the profit report (50,000) and the providers
   report (5,000) add up rows in Node and say `capped: true` when the limit is reached. **For "all time" on a busy
   office they are always capped, so the home figures are those of the latest 20,000 sales, not of all time.** This
   is a correctness problem, not only a speed problem (§6).

---

## 5. Visibility: "the rows of the accounts under me"

**How it works today:**

- `AccountTree.accounts()` (`access/account-tree.ts:17-22`) reads every account on almost every request. 49 call
  sites, among them inside transactions (`wallet-ledger.ts:208`, `line-pricing.ts:36,50`, `tasks.service.ts:432`).
- `visibleAccountIds` (`access/account-visibility.ts`) then walks the tree in memory.
- The result goes into Prisma as `posId IN (…)` / `userId IN (…)` / `actorId IN (…)` with one bind parameter per id.

**Cost:**

1. **The read of every account:** 7.5–8.2 ms at 3,230 accounts **[A1]**. It is linear in accounts, so about 25 ms
   at 10,000, and it runs on almost every request. In `post()` → `saleLadder` it runs **inside the money
   transaction while the point of sale's wallet row is locked** (`wallets/wallet-ledger.ts:141-160, 202-208`).
   Every sale of that point of sale waits for it. It is small today, but it is the one place where the tree's
   size lengthens a lock.
2. **The `IN (3,000)` list for the branch:**
   - The branch sees every account, yet `linesWhere` still sends all 3,000 point-of-sale ids, and
     `financeWhere`'s branch case sends none. With the `(createdAt, id)` index present the planner walks it and
     filters the list, in 0.2 ms **[A_L1in]**, so the list itself is not the cost once the index exists.
   - It is still 3,000 bind parameters a query, and each one has to be parsed.
   - **Fix:** no `posId` filter for the branch, which is what `taskWhereFor` and `financeWhere` already do.
3. **Lower layers are fragile.** With the new indexes:
   - Main-agent lines take 0.77 ms **[A_L3]** and finance 7.5 ms **[A_W4]**, because their rows are common among
     the newest.
   - When the subtree's rows are rare the planner walks the whole time index. An agent whose points of sale had no
     tasks took **1.19–4.45 s** **[A_T3, C_T3u]**, and the planner's estimate was 74,121 rows against 0 actual.
   - The safe options:
     - (a) a composite `(posId, createdAt, id)` with per-account merge (a `LATERAL` rewrite took 1.2 s cold for
       171 accounts **[A_W4lat]**: robust but not fast);
     - (b) store the owning chain on the row: `agentId` / `mainAgentId` columns, or one `ancestors text[]` with a
       GIN index, written at insert and rewritten by a transfer;
     - (c) keep the `IN` list and accept bitmap + top-N for small subtrees (agent lines 34 ms **[C_L2]**, agent
       finance 156 ms **[C_W4a]**).
   - **Recommendation:** (c) now, which costs nothing beyond the indexes of §11. Then (b) for `Line`, `Task` and
     `WalletEntry` if a layer's lists measure slow in production.
   - Option (b) touches transfers (`sales/transfers/`), which move accounts. It needs a spec and the owner's word.
4. **Computing the subtree in SQL instead of loading the tree:** a recursive CTE gives a main agent's 150 points
   of sale in **2.4 ms** **[X_CTE]**. A materialised path column (`'/owner/main/agent/pos/'` with a
   `text_pattern_ops` index) or `ltree` would make it one indexed prefix match.
   - **Recommendation:** keep `visibleAccountIds` as the rule. Cache `accounts()` per request (one read, not three
     or four) and keep it out of transactions: pass the path in, as `line-pricing.ts` already allows. A path or
     closure table is only worth it past about 20,000 accounts, or when (b) above is chosen.
5. **`LineSnapshotsService.writeToday`** works out `visibleAccountIds` for every account (3,230 walks of 3,230
   nodes) and writes 3,230 single upserts every hour. That is acceptable now. At 10,000 accounts it is 100 M steps
   and 10,000 round trips an hour. **Fix:** a single `INSERT … SELECT … ON CONFLICT` over a recursive CTE, or one
   batched upsert.

---

## 6. Aggregates

| Figure | How it is computed today | Stored? | Verdict and proposal |
|---|---|---|---|
| Wallet balance, held | `Wallet.balance` / `Wallet.held`, written only by `WalletLedger` under `FOR UPDATE` (ADR 0004) | **yes**, the maintained counter | ✅ Keep. The ledger stays the truth, and `balanceAfter` on each entry makes any balance checkable. No read sums entries for a balance. |
| Provider purchases / balance / available (`provider-accounts.service.ts:108-161`) | every operation entry ever, loaded and summed in Node, with a fallback to the package price for entries that kept no cost | no | ❌ Finding 1. Done in SQL (join `Line` → `Package`, `sum(coalesce(providerCost, branchCost))`) it takes 10.8 s **[A_W6agg]**: still too slow, because it is still all history. **Proposal:** a `ProviderLedger` table (or a column on `ProviderEntry` of kind `purchase`) written in the same transaction as each operation's entry, so the balance is `sum` over a small indexed table. Alternatively, a monthly closed total plus the open month. **Money path, needs the owner.** First step, no money change: stop the health watch from calling `books()` (cache the summaries for 120 s in one process), and do not call it twice per overview. |
| Overview cards and trend (`overview.service.ts:115-201`) | ≤ 20,000 entries loaded; counts, sums, per-day buckets and margins in Node | no | ❌ Counts, sums and the daily trend done in SQL take **119 ms for a month** **[A_W7agg]**. The branch's margin from the kept ladder JSON in SQL takes 53 ms **[A_W7prof]** (a stand-in formula: `marginOf` is richer, so this needs care). **Proposal:** (1) SQL aggregates for counts, sums and trend now; (2) a per-entry stored margin (`branchMargin`, or the ladder's shares as columns) written by `post()` so profit sums in SQL; (3) a daily summary table (`SalesDay(day, accountId, packageId, count, amount, profit)`) once "all time" must be exact. (2) and (3) touch the money write path. |
| Finance summary, profit report, providers report | same pattern (90 days unbounded / 50,000 / 5,000) | no | as above |
| Line counts by status (donut) | 5 counts over `posId IN` | daily snapshot for the change only | ⚠ 5 × about 0.4–0.8 s for the branch **[L7, L8, L6]**. **Proposal:** one `GROUP BY status` query with `FILTER`, plus the composite index `(posId, status)`. Or read "now" from the hourly snapshot (stale by up to an hour: the owner decides). |
| Task counts per status | 5 counts | no | One `GROUP BY status`, plus the `Task(posId, …)` index. |
| Last movement per account (balances report) | `GROUP BY userId` over the ledger | no | 0.59 s with a LATERAL probe **[A_W12]**. Or keep `Wallet.lastMovedAt`, written by `post()` (a money-path write, but not money). |
| Request-log summary (`routeFigures`) | percentile over 14 days of rows | no | 5.6–6.4 s **[R3]**. **Proposal:** an hourly rollup table `(hour, method, route, count, p50, p95, errors)` written by the worker, read for windows over an hour. |

---

## 7. Writes, indexes and locks

1. **Indexes that were not used by the replayed query set** (`out/40-index-usage.txt`; `idx_scan` after both
   runs). This covers my query set only, not production traffic, so read it as "candidates to check", not "drop".
   - `RequestLog_route_at_idx` (203 MB) and `RequestLog_actorId_at_idx` (196 MB) were not used. The account
     filter's `OR` across three columns stops `(actorId, at)` from being used. Five secondary indexes on
     `RequestLog` weigh 1.1 GB against 0.84 GB of heap, and **every request pays for six index inserts**.
     **Proposal:** keep `(at)` and `(status, at)`; turn the account filter into a `UNION` or an `actorId = ?` only;
     drop `(route, at)` unless a route-filtered screen exists; `(ip, at)` → `(ip text_pattern_ops, at)`.
   - `WalletEntry_kind_createdAt_idx` (242 MB) is used by the reports. It becomes partly redundant once the partial
     sales index exists, so re-check it then.
   - `ProviderOperation_providerId_createdAt_idx` and `_lineId_idx` were not used by any read I found. `lineId`
     still serves the `SET NULL` foreign key. Check before dropping.
   - `Line_status_idx` (19 MB) is low-selectivity (65 % active) and was used once. It is a candidate to replace with
     `(posId, status)`.
2. **Duplicate:** none exact. `Task (status, createdAt)` and `Task (assigneeId, status)` serve different reads.
3. **Random `text` uuids as primary keys** spread every insert across the whole key index.
   - `WalletEntry_pkey` is **443 MB for 6 M rows** (74 bytes a row). A key is 40 bytes as text against 16 as `uuid`.
   - Measured on the 6 M ledger: the wallet-entry build took 14 minutes, mostly index maintenance.
   - PostgreSQL 18 has `uuidv7()`, which is time-ordered (§10).
4. **Wide rows:**
   - `WalletEntry.ladder` jsonb is 237 bytes on average out of a 349-byte row: two thirds of the ledger's heap. With
     real 36-character ids in the chain it will be bigger.
   - `Line.terms` is 139 of 289 bytes.
   - Both are read whole by every list that loads the row: `linesPage` selects `terms`, finance selects `ladder`.
     **Proposal:** `select` only what a list shows. That is a code change and the same answer.
5. **`Task.log`** is a `text` column. The app rewrites it whole on every step (`stampTaskLog(current, line)` then
   `update`). In the scratch data it was 98 bytes. It is bounded per task and each update writes a new row version
   (no HOT if an indexed column changes in the same update). It is acceptable. The `notes` table is the better home
   for long histories.
6. **Hot rows:**
   - `Wallet` of a busy point of sale: one row locked `FOR UPDATE` per sale. That is correct (ADR 0004). The lock is
     held across the transaction's other reads, among them `accounts(tx)` (§5.1) and `refundOf`'s ledger read. They
     are short, but they belong outside the lock.
   - `balance` and `held` are not indexed, so updates can be HOT if the page has room. **Proposal:**
     `ALTER TABLE "Wallet" SET (fillfactor = 70)`. It is small, safe and needs no rewrite for new pages.
   - `Session` is updated on **every request** (`touchSession` → `updateMany`, `auth/prisma-auth.store.ts:403-416`):
     the same case, and the same `fillfactor = 80`. Better still, write `lastSeenAt` only when it is older than a
     minute: Redis already holds the live expiry.
   - The `Provider` row lock (`dispatch-gate.ts:65`, `provider-dispatch.repository.ts:41`) is taken per send, and
     for the send's mark only. There was no evidence of contention.
7. **Long transactions:**
   - A price save rewrites every renewable line of a package in one transaction (`terms.service.ts:280`;
     33,000 lines a package here).
   - A transfer moves every line of a subtree.
   - Both hold row locks on thousands of lines while the sale path wants to lock the same lines (lock order:
     line, then wallet).
   - **Proposal:** batch them by id (as `seal-esim-codes.ts` does) or set a size limit. That changes how a save
     applies, so it needs a spec.

---

## 8. Search

| Screen | SQL today | Index? | Arabic | Proposal (measured) |
|---|---|---|---|---|
| Top bar and numbers list `q` (`line-filters.ts:56-67`) | `msisdn LIKE %d% OR iccid LIKE %d% OR package.name ILIKE %t% OR company.name ILIKE %t%` over joins | ❌ | name match is `ILIKE` only, no normalisation | Split it in two. **Digits:** `pg_trgm` GIN on `msisdn` and `iccid` (41 + 61 MB), **10.6 ms** page and 2.5 ms count, against 2.8 s + 2.5 s **[A_L4num]**. A full number is a btree prefix (`text_pattern_ops`, 60 MB), **0.8 ms** **[A_L5]**. **Names:** match the 60-row catalog first and filter `packageId IN (…)`, **0.9 ms** **[A_L4name]**. Trigram needs 3+ characters: for 1–2 digits, answer "type more" or use prefix only. |
| Tasks `q` | `msisdn LIKE %d%` | ❌ | — | trigram on `Task.msisdn` (21 MB): 4.6 ms against 0.12–0.24 s **[A_T5]** |
| Finance `q` (`wallets.service.ts:197-207`) | 5-way `OR` incl. a join to `User` | ❌ | `ILIKE` | Split on the kind of input: digits → `msisdn` trigram (126 ms on 6 M **[A_W2]**, against 8.8 s); text → a normalised search column (below), or match the login against `User` first and filter `userId IN (…)` |
| Activity log `q` | `actorLogin ILIKE OR subjectRef ILIKE` | ❌ | — | trigram GIN: count 0.88 s against 1.6 s **[A_E2c]**, which is still the 90-day count. The page itself is fast (5 ms). |
| Request log `path` contains, `ip` starts with | `ILIKE %x%`, `LIKE x%` | ❌ (collation) | — | `ip text_pattern_ops`: 50 ms against 1.7 s **[A_R4c]**. `path`: trigram, or leave it (an owner-only diagnostic screen, 14 days). |
| Users list and directory `q` (`users-page.ts:35-40`) | `String.includes` on login and full name, in memory | — | **case-sensitive, no normalisation**: «احمد» does not find «أحمد», «فاطمه» does not find «فاطمة», «محمد» does not find «مُحمّد» | A pure `normalizeArabic()` (alef forms أ إ آ ٱ → ا; ى → ي; ة → ه; strip harakat U+064B–U+065F and U+0670; strip tatweel U+0640; Arabic-Indic and Persian digits → ASCII; lower-case Latin). Apply it to both sides. In memory it is free. Once accounts are searched in SQL: a stored `searchKey` column written with the account, plus trigram. |

**Recommendation for Arabic text:**

- Store a normalised `searchKey` column (written by the app with the same pure function, not a database trigger, so
  one rule exists) on `User`, and add one to `WalletEntry` only if finance text search is kept. Put a `pg_trgm` GIN
  index on it.
- Full-text search with a `simple` configuration does not help here: names are short, and `tsvector` does not
  normalise alef forms. **The `unaccent` extension does not cover Arabic diacritics reliably.**
- Digits typed in Arabic-Indic form (٠٥٠…) must be mapped to ASCII before `contains`. Today `digits = text.replace(/\s/g, '')`
  keeps them as they are, so a number typed on an Arabic keyboard finds nothing. This is an inference from the
  code; I did not test it through the API.

---

## 9. Growth, retention, partitioning, connections

**Tables without a bound** (from the code: no purge, no prune):

| Table | Grows by | Retention today | Proposal |
|---|---|---|---|
| `WalletEntry` | every money movement and operation | none, which is right: it is the ledger | Keep everything. Partition only if it passes about 100 M rows (below). |
| `Line`, `Task`, `ProviderOperation` | business | none, which is right | — |
| `ProviderDecisionEvent` | decisions | none, by design (append-only trigger) | — |
| `Notice` | every task event × audience, every money event | **none** | Delete read notices older than 180 days, and unread ones older than a year (owner's decision). It is 2 M rows here, mostly read. |
| `Session` | every sign-in; `touchSession` updates it per request | **none** | Delete rows revoked or expired more than 30 days ago (keep 30 days for the sessions screen and the request log's `sessionsByHash`). Add the `Session(userId)` index. |
| `OutboxMessage` | 1–2 per provider operation | **none** (the map lists "published outbox rows are never pruned") | Delete published rows older than 30 days. Keep the unique key `(topic, aggregateId, sequence)` meaningful: settlement uses it to refuse a second verdict, so prune only rows whose operation is `appliedAt` and older than the window. **Touches the outbox invariant: owner's word.** |
| `LineCountSnapshot` | one row per account per day (1.2 M a year at 3,230 accounts) | none | Keep 400 days (the home compares at most the previous month). |
| `AccessLog` | each entered session | none | Keep it like the activity log (90 days), or for ever if it is an audit record: owner's decision. |
| `ActivityEvent` | everything | 90 days, one unbatched `deleteMany` a day (`activity-log.ts:15`) | Batch it like `purgeMonitoring`. A day is about 22 k rows here (fine), but after downtime one statement deletes weeks. |
| `RequestLog`, `RequestError`, `Alert` | requests | 14 days, batched; closed alerts 90 days | ✅ |

**Partitioning (declarative, by month):**

- **`RequestLog`:** the best candidate. It is the highest insert rate (about 214 k rows a day here, more in
  production), it has a fixed retention and it is only read by time window. A monthly or weekly partition dropped by
  `DROP TABLE` replaces millions of `DELETE`s and their vacuum. **Cost:**
  - the primary key must include `at` (`@@id([id, at])`);
  - Prisma 7 does not create partitions: the migration is raw SQL, and the schema keeps describing the parent table
    (Prisma reads and writes it normally);
  - someone must create the next partition ahead of time (the worker, daily);
  - `prisma migrate diff` will show drift, so the guard that checks "diff is empty" must learn the exception.
  - **Recommendation:** not yet. At 14 days and batched deletes it is fine. Do it when it passes about 50 M rows,
    or if vacuum lags.
- **`ActivityEvent`:** the same reasoning, lower volume. Not yet.
- **`WalletEntry`:** not recommended. Every read is "newest first", or by `userId` / `lineId` across all time, so
  partition pruning helps little. Unique and foreign keys would need the partition key, and the ledger's integrity
  (ADR 0004, `financial-invariants.md`) is worth more than the gain.

**Autovacuum:** defaults. Worth setting per table (`ALTER TABLE … SET`):

- `RequestLog`, `ActivityEvent`: `autovacuum_vacuum_scale_factor = 0.02`, so the daily deletes are vacuumed the
  same day.
- `Session`, `Wallet`: `fillfactor` as in §7.
- `WalletEntry`, `Line`: `autovacuum_analyze_scale_factor = 0.02`, so the planner's statistics follow the newest
  data. Every "newest first" plan depends on it.

**Connections:**

- `createPrismaClient` (`apps/api/src/db.ts:5-9`) builds `new PrismaPg(connectionString)` with no pool option, so
  `pg`'s default pool is used: **at most 10 connections**.
- The API makes one client (`PrismaService`; the stores reuse it).
- The worker makes `dispatchPrisma` (≤ 10), plus a second client for the daily purge (≤ 10, disconnected after).
- So one API and one worker need at most about 30, against PostgreSQL's `max_connections = 100` (the dev
  container).
- **Risk:** one slow query (finding 1, 13–25 s) holds one of only 10 connections. The health watch, an overview
  and a finance page at the same time can exhaust the API's pool, and then every request waits.
- **Proposals:**
  - make the pool size explicit in config (`DATABASE_POOL_MAX`, for example 20 for the API and 10 for the worker);
  - set `statement_timeout` for the API role (for example 15 s) and a longer one for the worker;
  - set `idle_in_transaction_session_timeout` (for example 30 s).
- PgBouncer (transaction mode) is only needed with several API processes, or past about 80 connections. Prisma 7
  with `adapter-pg` works behind it if prepared statements are left to the driver's defaults. This is an inference;
  test it then.

---

## 10. Types and integrity

1. **`text` ids holding uuids:**
   - Each key is 40 bytes as text against 16 as `uuid` (measured: `pg_column_size`).
   - Each foreign-key column and each index entry that carries an id pays the same.
   - `WalletEntry` carries 3 ids (`id`, `userId`, `actorId`) plus `lineId`, and ids inside the ladder JSON.
   - **Estimate (I did not measure a side-by-side table, because of the disk limit):** primary-key and foreign-key
     indexes would be 40–50 % smaller, about 1 GB less across the scratch database. Key comparisons would also be
     cheaper (bytes, not collation-aware text).
   - **Cost of changing:** every table, every foreign key, Prisma `@db.Uuid` on every id, and a rewrite of each
     table under lock. Ids like `u-owner` in seeds and tests would break.
   - **Recommendation:** do not convert existing tables now. For high-insert tables (`RequestLog`, `ActivityEvent`,
     and later `WalletEntry`) use **time-ordered ids** (`uuidv7()`, PostgreSQL 18). Inserts then land at the right
     edge of the primary key instead of at random pages. That is a smaller change (a default), worth measuring in
     the build phase.
2. **Timestamps** are `timestamp(3) without time zone`, holding UTC written by Prisma.
   - It is consistent, and reports use UTC days on purpose.
   - The one `timestamptz` (`ProviderWorkerAttestation.attestedAt`) is deliberate.
   - The raw SQL that compares with `now()` (heartbeat, status) mixes the two. It works while the server's zone is
     UTC. **Proposal:** state `timezone = 'UTC'` for the database role in the handover. No column change.
3. **Enums as `text` with `CHECK … NOT VALID`:**
   - This is fine for speed (a short text in an index).
   - `NOT VALID` means old rows were never checked. **Proposal:** `ALTER TABLE … VALIDATE CONSTRAINT` once. It
     takes a light lock and a full scan, without blocking writes.
4. **Foreign keys with no index** (`out/fk-unindexed.txt`, 14):
   - `Session.userId`, `WalletEntry.actorId`, `Task.posId`, `Task.lineId`, `Task.packageId`,
     `Task.nextPackageId`, `TaskNote.authorId`, `SellPrice.ownerId`, `UserPackage.userId` (CASCADE),
     `User.roleId`, `Package.companyId`, `PackageRenewal.targetPackageId`, `PackageSwitch.targetPackageId`,
     `UserRole.roleId`.
   - **The ones that matter at scale:** `Task.posId`, `Task.lineId`, `WalletEntry.actorId`, `Session.userId`,
     `TaskNote.authorId`. The rest are on small tables.
   - Deleting a package scans `Task` for `packageId` (1 M rows). It is rare.
5. **Cascades that scan:**
   - `TaskNote` → `Task` CASCADE is indexed. ✅
   - `UserPackage.userId` CASCADE is not (small table).
   - `WalletEntry.lineId` SET NULL is indexed. ✅
   - `Task.lineId` SET NULL is **not**.

---

## 11. What is already good, and should not be redone

- **One list contract** with opaque keyset cursors and `size + 1` reads. No `OFFSET` paging anywhere.
- **Money:**
  - `Wallet.balance` / `held` are maintained counters, written only by `WalletLedger` under `FOR UPDATE`, two
    wallets in sorted order.
  - `balanceAfter` on every entry makes the ledger self-checking.
  - No read sums the ledger for a balance.
- **Integrity in the database, not only in code:**
  - `CHECK` constraints on statuses.
  - The partial unique indexes that reserve an open activation's serial and number
    (`Task_open_activation_iccid` / `_msisdn`).
  - `Alert_open_kind_key_key`.
  - The append-only trigger on `ProviderDecisionEvent`.
  - Unique request and idempotency keys.
  - `ON CONFLICT DO NOTHING` so a lost race does not abort the transaction.
- **The worker's passes walk by id, bounded,** and take the outbox with `SKIP LOCKED` and a lease **[P2–P4, O1]**.
  Only the unsettled walk needs a partial index **[P1]**.
- **The system monitor's tables:**
  - the request log is written in batches with no foreign key;
  - the purge deletes in bounded batches **[R9]**;
  - the alert pass reads a few minutes through `(at)` / `(status, at)` in under 1 ms **[R7, R8]**;
  - retention is set from the start.
- **The line card, the own wallet ledger, the notices inbox and the activity page** are served by their indexes in
  milliseconds **[W5, W14, N1, E1, R1]**.
- **Raw SQL is parameterised everywhere** (`Prisma.sql`, tagged templates), and `LIKE` input is escaped in the
  request log (`likeLiteral`).

---

## 12. Proposed slices

Each slice is one commit and is checked with the before/after plan and time on a scratch database of this size
(rebuild it with `sql/01`–`06`). Indexes are added with **`CREATE INDEX CONCURRENTLY` in its own migration** (a
Prisma migration file holding only that statement, since `CONCURRENTLY` cannot run inside a transaction). Build
times at these sizes were 0.3–19 s each (`out/31-indexes.log`).

**Marks:**

- **[MONEY]** touches a money path.
- **[LOCK]** touches a lock order or what runs under a lock.
- **[UNIQUE]** touches a unique constraint or the outbox's.
- **[CONTRACT]** changes a response shape or the list contract.

Each of these needs the owner's explicit word.

| # | Slice | Evidence of the gain | Risk |
|---|---|---|---|
| D.1 | **Indexes for the newest-first order:** `Line(createdAt DESC, id DESC)`, `WalletEntry(createdAt DESC, id DESC)`, `Task(createdAt DESC, id DESC)`; a partial `WalletEntry(createdAt DESC, id DESC) WHERE <sale or refund>` for the overview and reports; `Task(posId, createdAt DESC, id DESC)`; `WalletEntry(userId, createdAt DESC, id DESC)` replacing `(userId, createdAt)` | L1 2.7–3.9 s → 0.2 ms; W1 4–6 s → 1.7 ms; T1 0.8 s → 3 ms; W8 9–15 s → 18 ms; W11 4–6.5 s → 0.2 ms | Index only: +about 1.4 GB at this size (386 + 129 + 64 + 235 + 82 + 490 MB, minus the 386 MB replaced); every insert pays for one or two more. |
| D.2 | **Foreign-key and lookup indexes:** `Task(lineId)`, `WalletEntry(actorId)`, `Session(userId)`, `TaskNote(authorId)`; partial `ProviderOperation(id) WHERE taskId IS NOT NULL AND appliedAt IS NULL`; `Notice(kind, (payload->>'taskId'))` | T6 100–185 → 1.7 ms; S2 5 s → 1 ms; S1 0.36–0.62 s → 7 ms; P1 1 s → 0.7 ms; N3 0.7–0.9 s → 1.3 ms | Index only. N3's index must match the query: `taskNoteSent` must filter `payload->>'taskId'` (a text compare), not Prisma's JSON-path `equals`. That is a small change in `lines.repository.ts:178`, inside the settlement transaction, so it is [LOCK]-adjacent: same statement position, faster. |
| D.3 | **The cursor's `AND` form:** `after()` writes `createdAt <= X AND (createdAt < X OR id < Y)` | deep page 2.96 s → 0.06 ms | One pure function, the same rows. Pin it with `paging.spec.ts`. |
| D.4 | **The health watch and the provider books** [MONEY-read]: cache `summaries()` per process for `HEALTH_CHECK_SECONDS`; `overview.providers()` uses one `books()`, not two; `pricedOperations` reads only what each caller needs (a date range for the operations report, `providerCode` pushed into SQL) | removes 13–25 s and about 3.8 M rows from every 120 s and every branch home | Read path only; balances unchanged; spec on `provider-accounts.service.spec.ts`. |
| D.5 | **Provider ledger stored** [MONEY][LOCK]: a purchase row (or a per-provider running total) written in the operation's transaction; balances read from it; a backfill migration | provider pages and health become constant-time | Writes on the sale path; needs a spec, an ADR, and the financial-invariants file updated. |
| D.6 | **Search split and `pg_trgm`:** extension; trigram GIN on `Line.msisdn`, `Line.iccid`, `Task.msisdn`, `WalletEntry.msisdn`; `Line.msisdn text_pattern_ops`; `linesWhere` and `financeWhere` split digits from names; names matched against the catalog first | L4 2.8 s + 2.5 s → 10.6 + 2.5 ms; W2 8.8 s → 126 ms | Same results for digit input. For names, the result can differ only where a package name contains digits the user typed: specify it. Arabic-Indic digits mapped to ASCII. |
| D.7 | **Arabic normalisation:** pure `normalizeArabic()` (tested) used by `usersPage` and the directory; later a stored `searchKey` on `User` | functional fix: «احمد» finds «أحمد» | [CONTRACT] in the sense that results change (more matches). |
| D.8 | **Capped counts** [CONTRACT]: `total` counted up to 10,001 with `totalCapped`; or no `total` after page 1 | L1c 3.5–5.9 s → 5.7 ms; W1c 5–6.7 s → same | Changes the list contract, `response-shape.spec.ts` and the web's "N results". |
| D.9 | **Visibility read once per request and kept out of transactions** [LOCK]: a per-request memo of `accounts()`; `saleLadder` takes the path from the caller (as `line-pricing.ts` allows) instead of `accounts(tx)` | 7.5–8 ms × 3–5 a request saved; no tree read under the wallet lock | Changes what runs under the wallet lock (less): ask. |
| D.10 | **The branch sends no `posId IN` list** (`linesWhere`, overview, desk): the same as `taskWhereFor` / `financeWhere` already do | 3,000 bind parameters less a query; L7 / L8 counts become `status` counts | Behaviour-preserving (the branch sees every point of sale); a spec pins it. |
| D.11 | **SQL aggregates for the overview's counts, sums and trend:** five line counts → one `GROUP BY status`; five task counts → one; sales counts, sums and the daily trend → `GROUP BY day` | about 3 s of line counts → one query; W7/W8 Node work → 119 ms | Read path; profit still from the ladders until D.12. |
| D.12 | **Stored margin per entry** [MONEY]: `post()` writes the viewer-independent shares (or the branch's margin) as columns; reports and overview sum them in SQL; fixes the "capped = wrong totals" problem | W15 9 s → SQL sum in about 50 ms (A_W7prof as a stand-in) | Money write path; a backfill from the kept ladders; ADR. |
| D.13 | **Retention** [UNIQUE for the outbox]: batched purges in the worker for `Notice`, `Session`, `LineCountSnapshot`, `OutboxMessage` (published and applied, older than N days), and `ActivityEvent` batched | bounded tables | The outbox prune must keep the settlement's unique key safe: only rows whose operation is applied. |
| D.14 | **Request log trims:** drop `(route, at)` and `(actorId, at)` if not needed; `(ip text_pattern_ops, at)`; account filter as an `OR` of indexed branches; an hourly rollup for `routeFigures` | R4c 1.7 s → 50 ms; R3 5.6–6.4 s → a small table | Owner-only diagnostic screens. |
| D.15 | **Settings:** explicit pool size; `statement_timeout` and `idle_in_transaction_session_timeout` for the API role; `fillfactor` for `Wallet` (70) and `Session` (80); per-table autovacuum; `VALIDATE CONSTRAINT` for the `NOT VALID` checks; `Session.lastSeenAt` written at most once a minute | protection, not speed | The timeouts need a value the owner accepts (a CSV export may need longer). |
| D.16 | **(Later) ancestor columns on `Line` / `Task` / `WalletEntry`, or a path column on `User`** [LOCK]: when lower-layer lists measure slow | worst case A_T3 1.2–4.4 s → an indexed range | Transfers must rewrite them in their transaction. |

**Suggested order:** D.1, D.2, D.3, D.4, D.10, D.6, D.11 first: no money writes, large gains. Then D.8, D.9, D.13,
D.15, D.14, D.7. Then D.5 and D.12 (money, with ADRs). D.16 only on evidence from production.

---

## 13. Decisions for the owner

1. **Install `pg_trgm`** (a contrib extension shipped with PostgreSQL; `CREATE EXTENSION` once per database).
   - *Recommendation:* yes. It is the only way to make "a part of a number" fast: 2.8 s → 11 ms.
2. **Change the list contract's `total`** to a capped count (or no total after page 1).
   - *Recommendation:* capped at 10,000 with `totalCapped: true`. The web shows «أكثر من 10,000».
3. **Store the provider ledger** (a purchase row per operation, in the operation's transaction).
   - *Recommendation:* yes, after D.4 has removed the urgent load. It is a money path and needs its ADR.
4. **Store each sale's margin per layer on the entry**, so reports and the home sum in SQL and are exact over all
   time.
   - *Recommendation:* yes. Until then the "all time" figures are those of the last 20,000 sales.
5. **Retention:**
   - `Notice`: read ones 180 days, unread ones 1 year.
   - `Session`: 30 days after expiry or revoke.
   - `OutboxMessage`: published and applied, 30 days.
   - `LineCountSnapshot`: 400 days.
   - `AccessLog`: 90 days, or for ever as an audit record?
   - *Recommendation:* the values above. `AccessLog` for ever if it is evidence of who entered whom; it is small.
6. **Partition the request log by time.**
   - *Recommendation:* not now (14 days, batched purge, fine at 3 M rows). Revisit past 50 M rows.
7. **Change id columns to the `uuid` type.**
   - *Recommendation:* no conversion of existing tables. Use `uuidv7()` defaults for the insert-heavy log tables in
     the build phase, measured first.
8. **A normalised search column for Arabic names.**
   - *Recommendation:* the pure normaliser now (in memory, the accounts list); a stored `searchKey` on `User` when
     accounts are searched in SQL.
9. **Ancestor columns / a path for visibility.**
   - *Recommendation:* not yet. Read `accounts()` once per request, keep it out of transactions (D.9), and decide
     with production timings of the agent-level lists.
10. **Database timeouts** (`statement_timeout`, `idle_in_transaction_session_timeout`) and an explicit pool size.
    - *Recommendation:* yes, with values in `config.ts` and the handover.
11. **Large price saves and transfers in one transaction.**
    - *Recommendation:* keep them atomic up to a limit (for example 5,000 lines) and refuse or batch above it.
      Owner's call, because the result of a partly applied save is visible.

---

## 14. What I could not measure, and why

- **The API end to end.** I measured SQL, not Node. These were inferred, not measured:
  - The cost of the rows that `pricedOperations` and the overview hand to Node (memory, JSON parsing of 3.78 M
    rows, `laddersFor`).
  - Whether Prisma 7 splits an `IN` list past PostgreSQL's 65,535 bind-parameter limit. `linesWithPackage(lineIds)`
    builds a list of every line id with an operation, about 2 M here. If Prisma does not split it, **that call
    fails outright** at this size. This needs a test on a scratch copy before D.4.
- **Concurrency:** lock waits on a hot wallet, pool exhaustion under parallel slow requests, `touchSession`'s update
  rate. I state the risks from the code; I did not run a load test.
- **uuid against text, side by side:** skipped when host disk fell under 15 GB. §10 gives an estimate from measured
  column sizes.
- **Realistic skew:**
  - The generator spreads rows evenly over points of sale and time. Real data is skewed (a few big points of sale,
    growth over the years), which makes the "walk the time index and filter" plans (§5.3) better for big subtrees
    and worse for small ones.
  - In one case the generator gave an agent's points of sale no tasks: that is how the worst case **[A_T3]** was
    seen.
  - Ladder JSON holds short ids (`u-pos-12`), so real ladders are bigger than the 237 bytes measured.
- **Production settings:** a real server will have more memory than this VM (3.8 GB, 128 MB `shared_buffers`), so
  warm times there will be better than mine. The full-scan plans scale with data either way.
- **Index usage under real traffic:** `idx_scan` reflects my replayed set only (§7.1).
