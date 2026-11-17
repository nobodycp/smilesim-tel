# Scale, speed and clean-up — spec

Owner's request (2026-11-17): engineer the database so that years of data do not slow the system (access, queries,
indexes, search); make every slow place fast (pictures, caching, CDN, browsing and lists); and a deep clean-up of
dead code, unused files and finished plans, **keeping the plans that are not finished**.

Evidence: three read-only audits of 2026-11-17 in `docs/reviews/` (`database-audit`, `performance-audit`,
`dead-code-audit`). The database figures were measured on a scratch database of 2M lines, 6M wallet entries, 1M
tasks and 3,230 accounts; the web figures on the developer copy.

Status: **the decisions below were approved by the owner on 2026-11-17 as recommended.**

## Decisions

| # | Decision | Approved |
|---|---|---|
| 1 | `pg_trgm` for search | Yes |
| 2 | A list's `total` is counted up to 10,000; past it the answer says so (`totalCapped`) and the screen shows "more than 10,000" | Yes (list contract changes) |
| 3 | A stored provider ledger, written in each operation's transaction | Yes; money path, own spec section and ADR before code |
| 4 | Each sale's margin a layer stored on its entry, so reports are exact over all time | Yes; money path, own spec section and ADR before code |
| 5 | Retention for `Notice`, `Session`, `OutboxMessage`, `LineCountSnapshot`, `AccessLog` | Yes; the values are put to the owner with DB.13 |
| 6 | Arabic search: hamza forms, ta marbuta, diacritics, tatweel, Arabic-Indic digits | Yes |
| 7 | A statement time limit and an explicit pool size | Yes; the values are put to the owner with DB.15 |
| 8 | Partitioning the request log; `uuid` id columns | Not now |
| 9 | Pictures stay in the database; each is served by its own URL with a version, never inside a list | Yes |
| 10 | Company and offer picture routes are public, like the branding's | Yes |
| 11 | Pictures stored as WebP: company mark 256 px, at most 50 KB; offer 1600 px, at most 300 KB; QR stays PNG | Yes |
| 12 | Prices, balances, grants, line and task state are never served from a cache; a 5 s guard against the same read twice in one tab is allowed | Yes |
| 13 | A session's last-activity time is written at most once a minute (the idle limit is then exact to a minute) | Yes |
| 14 | Cloudflare in front | Deferred: a server and DNS change, the owner's. The code is made safe behind one (PF.11) |
| 15 | A CI job that builds for production and measures; it does not block a merge | Yes |
| 16 | The 45 finished or superseded plans are removed, after the files that point at them are reworded | Yes |
| 17 | The 42 specs nothing cites | Stay |
| 18 | The Excalidraw boards and their update rule | Removed; the text maps and the graph replace them |
| 19 | `Sparkline`, `Tooltip`, `Field`, the unused Radix re-exports and Sheet sides | Removed |
| 20 | Routes with no caller | Removed: `GET /v1/wallets`, `POST /auth/users/:login/password`, `POST /auth/users/:login/disable`, `PATCH /auth/exemptions/:login`. Kept: reactivate, company switch, bulk packages, the reports screen and its routes, `GET /auth/passkeys` (not decided, so it stays) |
| 21 | The certain dead code, `cookie-parser`, the comments that name deleted files | Removed |

## Search (DB.6)

What a person types into a list's search box is read once (`platform/search.ts`, `searchTerms`):

- **A number query** is one that, after Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits are written as
  ASCII and spaces, dashes and one leading `+` are dropped, is digits only. Any other query is a **text query**.
  There is no minimum length (none existed); one or two digits cannot use a trigram index and read the list in its
  order, as before.
- **Numbers list and top bar** (`linesWhere`): the number and the serial contain the number as typed (the digits of
  a number query, else the text with no spaces), **or** the line is on a package whose name, or whose company's
  name, contains the text. Those packages are read from the catalog first, so the lines are filtered by an id list.
  A number query therefore still finds the package that holds its digits: «100» finds «100 جيجا».
- **Inbox** (`tasks.service` `list`): the number contains the number as typed, as before.
- **Finance** (`financeSearch`): a number query matches the entry's number, the accounts whose login holds those
  digits, and the stored package or company name only when a package or company in today's catalog has a name
  holding them. It does not read the free note. A text query matches the number as typed, the note, the stored
  package and company names and the logins, as before (the logins from the accounts the service already holds).
- The name side matches the text as typed and, when it holds Arabic-Indic digits, the same text with ASCII digits.

The answers are the same as before for every digit input and every name input, with these differences, pinned by
`sales/search.db.spec.ts`: a number typed with Arabic-Indic digits, dashes or a leading `+` is now found; in finance,
a number query no longer finds an entry only because its note holds the digits, or because its stored package name
holds them while no package in the catalog does. Indexes: trigram GIN (`pg_trgm`) on `Line.msisdn`, `Line.iccid`,
`Task.msisdn`, `WalletEntry.msisdn`. No `text_pattern_ops` index: every number match stays `contains`, which a
btree cannot serve, and the trigram index serves a full number too.

## Pictures by URL (PF.7)

Decisions 9, 10 and 11, as built. A company's mark and an offer's picture stay in their columns (`Company.image`,
`Offer.image`, a data URL each) and are served by a route of their own; no list carries the bytes any more.

**Routes.** Public, outside the session, like the branding pictures (a controller of its own under the prefix
`pictures`, no actor interceptor, read only):

- `GET /pictures/companies/:code?v=<version>`: the company's mark. The code is the company's public code (`cellcom`,
  `wecom`: the lists already carry it and it is not a secret).
- `GET /pictures/offers/:id?v=<version>`: the offer's picture. The id is the offer's UUID (v4, 122 random bits).

Each answers the bytes decoded from the stored data URL with the stored type (`image/png`, `image/jpeg` or
`image/webp`), a strong `ETag` (the version), and `Cache-Control: public, max-age=31536000, immutable` only when
`?v=` is the current version; without it or with an old one, `no-cache`. `404 NOT_FOUND` when the company or offer
does not exist or has no picture (or the stored value is not a picture data URL). No session, no door: an `<img>`
request carries neither `Origin` nor `x-door`; the door, origin and rate-limit middlewares treat it as they treat
`/branding/*`.

**Versions.** An offer's version is its `updatedAt` in milliseconds: it moves on every edit (a reorder too), which
costs a re-download of a picture after an edit, never a stale one. A company has no `updatedAt` and no column is
added: its version is the first 16 hex digits of the MD5 of the stored data URL, computed by PostgreSQL in the list
query's companion read (`md5("image")`, the column never leaves the database) and by the route over the same text.
It changes exactly when the picture does.

**Who may fetch what.** A company mark and an advertising picture are not secrets. Any company's mark answers by
its code. Any offer's picture answers by its id, live or not: the route needs nothing secret beyond the id, and the
id of an offer that was never live reaches only the accounts that list every offer (`GET /v1/offers`, the branch
owner and the edit grant). An offer that was live and was switched off keeps answering to whoever kept its id.

**Lists.** Every answer that carried a picture data URL carries the URL in the same key, as the web reaches it
(`/api/pictures/companies/<code>?v=<version>`, `/api/pictures/offers/<id>?v=<version>`; the web rewrites `/api` to
the API), or `null` when there is no picture:

- `GET /v1/companies` `companies[].image` (was `''` when none, now `null`);
- `GET /v1/packages` `companies[].image` (only companies with a picture are listed, as before);
- `GET /v1/providers` `providers[].companies[].image` (was `''` when none, now `null`);
- `GET /v1/offers`, `GET /v1/offers/live` and every offer write's answer `offers[].image` (`null` when none, as before);
- `GET /v1/lines/:id` `line.companyImage` (was the data URL, `''` when none, now the URL or `null`), and every row of
  `GET /v1/lines` carries the same `companyImage` (the key was not in the list before: the numbers table's company
  mark, which read it, showed the letters only; it now shows the picture where the company has one).

The list queries select no picture column: the company and offer reads name their columns, whether a company has a
mark comes from one raw read of `code, md5(image)`, and whether an offer has a picture from a read of the ids whose
picture is set. The numbers list and card, the inbox and a task's page, and the package sheet (with the reads of its
renewal and switch targets) select the company columns they answer with; the numbers list and card take the mark's
URL from the same one raw read (pinned by `catalog/pictures/pictures.http.spec.ts`).

**Writes.** A picture field takes a data URL or `null`; a URL (anything not a PNG, JPEG or WebP data URL) is
`400 INVALID`. "Unchanged" is said by leaving the key out: the offers form sends `image` only when the picture was
replaced (a data URL) or removed (`null`). An offer edit that sends back the stored data URL still skips the size
check, as before. The company mark has its own route (`PUT /v1/companies/:code/image`), sent only on a change.

**Stored format and limits (decision 11).** The web shrinks a company mark to WebP, 256 px on its longest side and
at most 50 KB decoded (`lib/branding-image.ts` `shrinkImage`); the API refuses a new mark over 50,000 decoded bytes
with `400 INVALID` ("بيانات غير صالحة", as any refused mark). Offers stay at 1600 px and 300 KB (PF.6). Pictures
already stored are served as they are; nothing is migrated.

## Package sheet's operations (PF.8)

The package sheet's numbers tab («الأرقام»; the audit's "operations tab", F6) shows the package's numbers: a box to
pick each, the number and its status. Until PF.8 the sheet read every number of the package before it showed at all,
one `GET /v1/lines?packageCode=` page of 30 after another (up to 100 in a row), and filtered them again by package
code in the browser. The picked boxes drive no action.

Now the tab reads the numbers list it already used, `GET /v1/lines?packageCode=<code>`, as every list does
(`usePaged`, `PagedTable`): one request for the first page when the tab first opens, the next page only when the
table's pager asks for it, the server's `total` counting the pages. No filter is added to any route: the lines list
already filters by package code and already answers the rows the tab shows. The sheet itself no longer waits for the
numbers: opening it reads no line. «تحديد الكل» picks the numbers read so far. An action on the sheet asks for the
tab's pages again with the sheet's other reads. The rows are the same as before, in the list's order (newest first).

## Capped totals (DB.8)

Decision 2, as built. Every list answer carries `total` and `totalCapped` (ADR 0014, amended):

- **`total`** is how many rows the list's filter holds, counted **up to 10,000** (`TOTAL_CAP`,
  `platform/paging.ts`). **`totalCapped: true`** says there are more; `total` is then 10,000. Otherwise
  `totalCapped: false` and `total` is exact. One shape for every list: lines, tasks, finance, the own ledger, the
  activity log, notices, the request log, alerts, the two provider-operations lists (the branch report, the provider accounts'), the
  provider decisions queue, accounts, the directory, the balances report, the providers report.
- **How it is counted.** A list read from the database counts with `countUpTo`: the list's own Prisma
  `count({ where, orderBy, take: 10_001 })`, which Prisma 7 sends as
  `SELECT COUNT(*) FROM (SELECT id … WHERE … ORDER BY … LIMIT 10001 OFFSET 0) AS sub`. The `orderBy` is the page's
  own: without one Prisma orders the subquery by `id`, which sorts every matching row. A list read whole in memory
  (accounts, directory, balances, the provider accounts' operations, the queue, the providers report) passes its length through `cappedTotal`, the
  same rule; at its sizes it is never capped. Rule `list-total` (`architecture.spec.ts`) refuses a list answer that
  writes `total` by hand.
- **Not list totals, still exact:** the status tabs (`GET /v1/tasks/counts`), the overview and the desk's figures,
  unread notices (`unread` beside the notices list), the queue's `totals`, the provider accounts' `stats`, the balances
  report's `totals.count`, and the server errors' `total` (a sum over the groups the same query reads).
- **Screens.** A capped total reads «أكثر من 10,000» / "More than 10,000" / «יותר מ־10,000» (`moreThan`), and the
  pager's line reads «الصفحة 3 · أكثر من 10,000 نتيجة» without a last page while more rows wait (`pageStatusCapped`);
  its pages go on as the rows are read. An answer without `totalCapped` (the Playwright mocks, an older API) reads as
  not capped. CSV exports are not lists: unchanged. Under the cap every screen shows the numbers it showed before.

## A request's sign-in cost (PF.9)

Until PF.9 a signed-in request sent 8–9 SQL statements before its handler ran, one of them an `UPDATE` of the
session on every GET, and a handler that asked for the account tree more than once read every account each time
(performance audit F4, S9; database audit §5, D.9). As built:

1. **The session's last-activity time is written at most once a minute** (decision 13). Every request still runs
   the whole live check against the stored row (`liveSession`): the Redis live key, the row's revocation and expiry,
   and the idle check `lastSeenAt + idle limit ≤ now`. The touch that follows (`touchSession`) still renews the Redis
   key by the idle limit on every request; it writes the row's `lastSeenAt` and `expiresAt` only when the stored
   `lastSeenAt` is 60 s old or older (`SESSION_TOUCH_SECONDS`, `activityDue` in `auth/sessions.ts`). The stored time
   is then always within the minute before the last request, so **with an idle limit of N minutes a session ends
   more than N − 1 and at most N minutes after its last request** — never later than before. Requests closer than
   N − 1 minutes apart always keep it open (the smallest limit is 15 minutes, so a tab's 30 s rhythm never ends it).
   Unchanged: a revoked session is refused at its next request (its key and row are ended at once); the sessions
   allowed are counted at sign-in from the rows and their live keys; an entered (impersonation) session goes the
   same way; the notices stream checks its session every 15 s as before and never wrote it. There is no absolute
   server lifetime to keep: the cookie lives 30 days and the server decides by the idle limit. The sessions list's
   "last seen" is exact to a minute.
2. **The layers' session rules are kept a minute in the process for the idle check.** `liveSession` reads the
   sessions allowed and idle minutes of the layers at most once a minute per process (`SESSION_RULES_CACHE_MS`);
   every write of the policy rows in that process drops them at once. Another API process follows within the
   minute: there a lowered idle limit closes an idle session up to a minute later, which is the precision decision
   13 already gives. Nothing the screens promise is weakened: the screens and their answers read afresh, so "In
   effect" is what was saved; the immediate security response, ending sessions (the two-step policy's "on save,
   the sessions … are ended", a password reset, a revocation), deletes the live keys and is refused everywhere at
   the next request. **Kept uncached:** the two-step policy (required, method), read at sign-in, enrolment and when
   two-step is turned off, never on an ordinary request: kept, a sign-in on another process could skip an enrolment
   just required. Sign-in's own rules (the sessions allowed, the new session's idle time) are also read afresh. An
   account's own values are on its row, read with the session on every request.
3. **The account and what decides its grants are read in one round trip.** The branch owner holds every grant, so
   its row is read once more without its roles (1 statement instead of 4; should the row no longer say owner, it is
   read whole). Any other account is read with its role and staff roles in one Prisma call, and the layer's role
   is read beside it rather than after it. The data and the `Actor` are the same. One SQL statement is not reached:
   Prisma 7 sends one statement per relation without the `relationJoins` preview (a schema change), and raw SQL
   would step around the in-memory tables the HTTP specs check grants on.
4. **The account tree is read once a GET request.** `ActorInterceptor` runs a GET's handler inside
   `withRequestTree` (`access/account-tree.ts`): every `AccountTree.accounts()` without a transaction client in that
   request shares one read, each caller with its own list. It is not a process cache: the read belongs to the one
   request, is never shared with another, and ends when the handler's answer is done, so a timer or a stream it
   leaves running reads afresh. A call that passes a transaction client (`accounts(tx)`) reads through that
   transaction every time, as before; the money paths' reads under the wallet lock (D.9's `saleLadder` and the
   rest) are not part of this slice and do not change. A route that writes (create, freeze, transfer, a role) is
   not a GET, so it reads the tree afresh after its write, as before; a GET writes nothing (ADR 0015,
   `get-writes-nothing.http.spec.ts`).

Measured with Prisma's query log over PostgreSQL (`access/sign-in-cost.db.spec.ts`, which pins the "after"):

| Request | Before (all / sign-in) | After (all / sign-in) |
|---|---|---|
| `GET /v1/me`, point of sale | 11 / 9 | 9 / 7 |
| `GET /v1/lines`, point of sale | 16 / 9 | 14 / 7 |
| `GET /v1/me`, branch owner | 11 / 8 | 6 / 3 |
| `GET /v1/lines`, branch owner | 15 / 8 | 10 / 3 |

Once a minute a session's request sends one more statement, its `UPDATE`. Not counted: the door check in front
of the routes (`door.middleware.ts`), which reads the session once more when the request names its door.

## The tree out of the wallet lock (DB.9)

The owner's word (2026-11-17, below): the sale path takes the account path from the caller and no longer reads the
tree inside the locked transaction. Decision and invariant: ADR 0023. As built:

1. **Where the tree was read inside a money transaction** (`accounts(tx)` or a price read that fell back to it):
   `WalletLedger.saleLadder` (every debit with a sale: an activation, an extension, a charge, a switch, a task's
   capture or debit, the provider's settlement and a person's decision on it), and its use by `refundOf` for an
   older sale without a stored ladder; `LinePricing.switchQuote` in an immediate switch's transaction and in a
   switch task's completion; `LinePricing.stampFor` and `resolveBuyPrice` in a task's completion (an activation's
   renewal stamp and an older task's buy price, a switch's stamp). One more read of the tree in a transaction is
   not on a money path and holds no wallet lock: `TasksService.taskNotice` for an internal note (`branchOnly`); it
   is left as it is.
2. **Read before, confirmed under the lock.** Each caller reads the seller's path before its transaction and
   passes it in (`Sale.path`, `posPath`, `Completion.posPath`). In the transaction `AccountTree.confirmedPath`
   reads the path's accounts by id and requires each one there, its parent the next one on the path, its layer
   unchanged; otherwise `409 DUPLICATE_REQUEST` and the transaction rolls back. Without a path the path is read up
   the parent links by id. `LinePricing` never reads the whole tree with a transaction's client.
3. **What a change between the read and the lock does** (ADR 0023's table): a move (of the seller or of an account
   above it), a deleted account or a changed layer refuses the sale, nothing written; a freeze, a stop or a login
   change does not (none prices or credits; stops are judged before the transaction, as before); a changed price
   does not: the debit is the price quoted before the transaction and the ladder reads the price rows under the
   lock, both as before. In the provider's settlement the refusal is technical: nothing is written and the sweeper
   tries again.
4. **No request memo for writes.** A sale already reads the tree once a request (the immediate switch's quote
   before its transaction now takes the line's path too); a write that changes the tree (create, move, freeze,
   delete an account) must not answer from a read made before its own write. Only GET shares a read (PF.9).

Measured with Prisma's query log (`sales/sale-lock-tree.db.spec.ts`): from the wallet's lock to the end of the
transaction an activation sends 11 statements and an extension 12, before and after; before, one of them read every
account, after it reads the path's rows by id.

## Database settings (DB.15)

The owner's values (second round below): a statement limit of 15 s for the API, 30 s idle in a transaction, a pool
of 20 for the API and 10 for the worker, the CSV export excepted from the statement limit. Evidence: the audit,
sections 7, 9 and 10.

**Where the limits are set: on each connection, by the application.** `apps/api/src/db.ts` builds every client from
`poolConfigOf(role, url)`, a `pg` pool config whose `statement_timeout` and `idle_in_transaction_session_timeout`
`pg` 8 sends as startup parameters of each connection (read in `pg/lib/client.js` `getStartupConf`). Not
`ALTER ROLE` / `ALTER SYSTEM`: the server's role is not the application's to change, and a role setting would also
bind `prisma migrate deploy` (a long index build would be cut), `pg_dump` and the backup scripts, and an operator's
`psql`. Each of those opens its own connection and gets none of these limits.

| Client (`DatabaseRole`) | Pool | Statement limit | Idle in a transaction |
|---|---|---|---|
| `api` (`PrismaService`) | `DATABASE_POOL_MAX`, default 20 | 15 s | 30 s |
| `export` (the CSV routes, `withExportLimit`) | 2 | 90 s | 30 s |
| `worker` (dispatch, settlement, sweeper, heartbeat, alerts) | `DATABASE_POOL_MAX`, default 10 | 60 s | 30 s |
| `purge` (the worker's daily purge, opened and closed with it) | 2 | 60 s | 30 s |
| `tool` (`cli/` reports an operator runs by hand) | 2 | none | 30 s |

- **The worker: 60 s, not none.** Nobody waits on it, so it gets more room than the API; but a statement that runs
  past a minute is a fault to see in the log, not a reason to hold a connection and its locks for ever. The daily
  purges delete at most 5,000 rows a statement (DB.13), far under it; a purge statement that is cut is logged by its
  code and the next day's run continues.
- **The exports: 90 s, on their own small client.** Each of the six export routes (finance, profits, balances,
  supply, a provider's ledger, activity) wraps its service call in `withExportLimit`, an `AsyncLocalStorage` under
  which `PrismaService.client` (and so `UnitOfWork.prisma`) answers the export client. A `SET LOCAL` was the other
  choice; it needs a transaction around reads spread over several services, and Prisma's interactive transaction
  ends at 15 s (`TRANSACTION_LIMITS`). 90 s stays under the 100 s Cloudflare waits for an answer, so a slow export
  is answered by the API, not cut by the proxy.
- **Idle in a transaction: 30 s for every client.** No transaction waits on anything but the database (a provider is
  called after its mark is committed, ADR 0019), so only a stuck process reaches it; PostgreSQL then ends the session
  (`25P03`) and its locks are let go.
- **The pool:** `DATABASE_POOL_MAX`, a whole number from 1 to 80, else a production process does not start
  (`production-config.ts`, ADR 0016) and any other throws when it builds the client. One API and one worker open at
  most 34 connections of PostgreSQL's 100.

**A cut statement.** PostgreSQL cancels it with `57014`; Prisma wraps it as `P2039` (a model query) or `P2010` (raw
SQL) with the driver's code in `meta` (`platform/prisma-errors.ts` `isStatementCancelled`). The error filter answers
**500 `TOO_SLOW`** ("The request took longer than allowed…", in the three languages) and keeps it as a server error
whose code is `57014` (`errorCode`), never the driver's words. Not 503 or 504: the web takes those for a gateway's
answer and would say the server cannot be reached (`apps/web/lib/http.ts` `reachedApi`).

**Table settings, migration `20261117200000_table_settings`.** `Wallet` fillfactor 70, `Session` 80;
`ActivityEvent` `autovacuum_vacuum_scale_factor` 0.02 (`RequestLog` already has it, migration
`20261117180000_request_log_indexes`); `WalletEntry` and `Line` `autovacuum_analyze_scale_factor` 0.02. Then the
three `NOT VALID` checks (`Wallet_held_not_negative`, `Line_status_known`, `Task_status_known`) are validated, each
only when no stored row breaks it (a `DO` block; otherwise a `WARNING` and the check stays `NOT VALID`), so the
migration cannot fail on a deployment's old rows. Every statement takes `SHARE UPDATE EXCLUSIVE` (checked: reads and
writes go on, the table's file is not rewritten); validation reads the table once. Prisma states none of it:
`schema.prisma` names each beside its model, `prisma migrate diff` stays empty, `rehearse-upgrade.sh` checks the six
storage settings. On the local dev and test databases every row passed and the three are validated.

`Session.lastSeenAt` at most once a minute was done by PF.9.

Proof: `platform/database-settings.db.spec.ts` (the limits each client's connections report, the export client
inside `withExportLimit`, the pool's size by distinct backends, a raw and a model statement cut and answered
`TOO_SLOW` and kept as `57014`, the storage parameters and the validated checks), `production-config.spec.ts`.

## Provider ledger stored (DB.5)

Decision and invariant: ADR 0025 (accepted; the owner's answers of 2026-11-17 at its end). An operation's wallet
entry carries the provider of its package and its provider cost, written in the entry's own INSERT and never
updated; the books become SQL sums of them. Built in slices, each one commit:

| # | Slice | State |
|---|---|---|
| P.1 | `WalletEntry.providerId` (no foreign key) and the CHECK `WalletEntry_operation_priced`, `NOT VALID` (migration `20261117210000_provider_ledger_stored`); `Sale.providerId`; every writer of an operation kind passes the provider and the cost (below). Reads unchanged. | done |
| P.2 | The first backfill command, which froze the read-time books (name matching included) and proved them equal. Deleted by P.4; replaced by P.4b. | done |
| P.3 | The partial index `WalletEntry_provider_createdAt_id` (migration `20261117220000_provider_ledger_index`, a plain `CREATE INDEX` by the rule below, not `CONCURRENTLY`) and `VALIDATE CONSTRAINT` (`20261117220100_provider_ledger_validate`: only when no stored row breaks the CHECK, else a `WARNING` and it stays `NOT VALID`). | done |
| P.4 | Reads switched to the stored columns (`books`, `detail` by keyset, `provider-operations`, the reconciliation window, `supply`); `pricedOp` and the read-time fallback deleted; `openDifferences` out of `summaries()`. P.2's command is deleted with it. | done |
| P.4b | **The backfill at HEAD** (`cli/provider-ledger-backfill.ts`, ADR 0025 amendment): the server deploys `main` once, so the command must exist in the release it runs on. It gives every operation entry its line's package's provider (moving the ones P.2's name matching gave to another provider), fills a missing cost by today's writer rule, and validates the CHECK. The overview's top providers read the stored provider. | done |
| P.6 | **A disconnect lowers the purchases** (owner, 2026-11-17, answer 3): the provider gives back the unused days less the 0.5 ₪ fee. The section "A disconnect lowers the purchases (DB.5 P.6)" below; the stored disconnects are corrected by the P.4b command (trial data). | done |
| P.7 | **Done at the provider, given back to the customer** (owner, answer 4): an operation carried out at the provider whose money was given back (`release-after-success`, ADR 0019) is a purchase, a loss of the branch, with a visible mark so the office finds where it went wrong. Today it writes no operation entry and is in no provider's books. Section "Paid at the provider, not charged to the point of sale (DB.5 P.7)" below; with it, an activation or renewal priced 0. | done |
| P.8 | **Branch losses in the profit figures** (owner, 2026-11-17): the losses show on the home and are subtracted from the branch's profit on the home, the profit report and the finance summary. Section "Branch losses in the profit figures (DB.5 P.8)" below. | done |

P.5 (closed monthly totals) only if P.4 measures over budget. Not measured: no database at the audit's sizes exists
(the scratch database was dropped), so P.5 waits for a measurement of the grouped sum on one; on the local data
(46 entries) the planner scans the table, and with sequential scans off it reads the sum from the partial index
alone (an index-only scan, no heap fetch).

**The reads (P.4).** Purchases: `SUM("providerCost") … WHERE "providerId" IS NOT NULL GROUP BY "providerId"`
(`WalletsService.providerPurchases`). A provider's ledger page: at most `LEDGER_LIMIT` + 1 of its operations with a
cost and of its `ProviderEntry` rows, newest first in the dates asked; the newest row's balance after it is the
balance up to the page's end date (two sums), each older row's worked back. `GET provider-operations` and the
reconciliation filter the provider in SQL. The providers report (`supply`) groups by the stored provider and adds the
stored cost. `openDifferences` (simulated) is counted for the list and the detail screens over the priced
operations a match covers, not by `summaries()`.

Before the old reads were deleted, both were run on the local dev database (read-only) and compared: the list with
its totals, `summaries()`, every provider's detail over six date ranges, the reconciliation window, and
`GET provider-operations` over 28 queries, every page: all equal. Per provider (purchases, balance, available,
operations): sky 63288, −63288, −63288, 27; lian 8500, −8500, −8500, 4; aren 0, 0, −3000, 0; quickline 0, 0, 0, 0;
alloha 22000, 8000, 99000, 15 — the same in both. The providers report moved on purpose (ADR 0025 rule 5, the
owner's answers 2 and 5): it took the provider from the line's current package and skipped an entry without a line;
it now counts the stored provider. On the dev data four entries whose package name and company («500 جيجا», ويكوم)
exist under three providers had been given to lian by the old books' name matching, frozen by P.2, while their lines
hold aren's and alloha's package and never switched. P.4b moves them (below).

**What each writer stores (P.1).** The provider is the one of the package the entry names (`Package.providerId` of
the row the caller already read: no read is added); the cost is the one of that moment.

| Writer | Kind | Provider | Cost |
|---|---|---|---|
| immediate sale (`LinesService.activate`) | `activate` | the package's | eSIM: branch cost + fee (as before); plain: the subscription's branch cost on the terms just stamped |
| task completion and the provider's settlement (`TaskCompletion.applyClaimed`) | `activate` | the package's | the same; a task that charges nothing records 0, as it always has |
| renewal now and by task | `extend`, `charge`, `reactivate` | the renewal target's, else the line's | the renewal branch cost on the new terms (as before) |
| switch now and by task, debit, credit or even | `switch` | the new package's | the quoted difference (as before; may be negative) |
| disconnect now and by task | `disconnect` | the line's | minus what the provider gives back: used share + 0.5 ₪ fee − the open periods' cost (P.6) |
| eSIM issue (task) | `esim` | the line's | the fee (as before) |
| freeze, unfreeze, refresh, rename, SIM, transfer (now and by task) | those | the line's | 0 |

`WalletLedger.post` and `recordOp` write both columns (`operationColumns`, `wallets/provider-cost.ts`): an operation
kind without a provider, or a priced kind that moves money without its cost, throws before the INSERT; the CHECK
refuses it in the database. No statement, lock or foreign key is added under the wallet lock:
`sale-lock-tree.db.spec.ts` still counts 11 statements for an activation and 12 for an extension.

**The backfill (P.4b).** The office pushes `main` once and the server deploys HEAD: there is no release in which
P.2's command and the old reads ran, so the backfill lives at HEAD and runs on a database the new reads already use
(until it runs, an entry without a provider is in no provider's books). `node dist/cli/provider-ledger-backfill.js`
(`--dry-run`, `--leave-unresolved`) runs once, after the deploy, with writes stopped; one transaction on the `tool`
client, `WalletEntry` locked against writes (`SHARE ROW EXCLUSIVE`). For every operation entry:

- **Provider:** the provider of the entry's line's package (owner's answer 2). A line never moves to another
  provider's package (`switchOnto` refuses `OTHER_SHELF`), so its package's provider is the one of every operation it
  had. A stored provider that differs is replaced, and each move is printed (id, kind, from → to). An entry with no
  line keeps the provider it stored.
- **Cost:** a stored cost is kept. A missing one is filled by the rule its writer uses today, from the nearest record
  of the day: `activate` — the period cost kept on the entry (`periodCost`, the subscription's branch cost the sale
  wrote), else the branch's cost on the entry's own ladder (the price chain kept at the sale), else the line's terms
  (stamped at the sale; a transfer re-stamps them from the prices of its day), else the package's current branch cost;
  plus the eSIM fee kept on the entry (`esimPrice`), as `activationProviderCost` adds it. `charge`, `extend`,
  `reactivate` — the same with the renewal branch cost. `disconnect` — the settlement worked out at the entry's own
  time from the line's prepaid entries written before it (`periodsAt`, `settleDisconnect`), 0 when no period was open,
  as the writer records it. `esim` — the fee kept on the entry. The kinds the provider does not price — 0. `switch` —
  none: its cost is the quoted difference of the day, which no row keeps.
- **Unresolved** (no line and no provider; a switch without its cost; a disconnect whose line's terms cannot be read):
  listed, and the run stops before writing. `--leave-unresolved` is the smallest safe choice: those entries stay as
  they are — in no provider's books, as the books already read them — everything else is written, and the CHECK is
  left `NOT VALID` (it still checks every new row). Nothing is invented for them.
- It prints each provider's purchases before → after, then validates `WalletEntry_operation_priced` in the same
  transaction when no stored row breaks it. A second run writes nothing. Exit 0 committed (or a dry run rolled back),
  1 stopped on unresolved entries, 2 could not run; nothing is changed unless it exits 0 without `--dry-run`.

Run on the local dev database (2026-11-17): 46 entries, 4 moved (`2512722b…` activate and `b388a730…` rename lian →
alloha, `c1fc7e92…` activate and `b83518e6…` extend lian → aren), no cost filled; purchases alloha 22000 → 25500,
aren 0 → 5000, lian 8500 → 0, sky 63288 → 63288; the CHECK validated; a second run wrote nothing.

This updates stored ledger columns of old rows: allowed only because the system runs on trial data before launch and
the owner's standing rule keeps nothing in an old form. After launch an entry's provider and cost are never updated.

## A disconnect lowers the purchases (DB.5 P.6)

The owner (ADR 0025, answer 3): when a number is disconnected before its period ends, the provider gives back the
price of the unused days less the disconnect fee, 0.5 ₪ (`DISCONNECT_FEE`, 50 agorot). A 30 ₪ period, the number
worked 10 days: the provider gives back 19.5 ₪, and the office's cost of that line is 10.5 ₪. Until P.6 the books
counted the full 30 ₪ at the sale and a further 10.5 ₪ at the disconnect (40.5 ₪).

**The rule, in agorot** (`settleDisconnect`, `sales/rules/periods.ts`; one rounding, the one it already had):

- The periods are the ones the disconnect has always read (`LinePricing.disconnectSettlementFor` → `periodsAt`): the
  line's prepaid entries newest first back to the activation, charge or reactivation that started the current run,
  each still open at the disconnect; for rows written before periods were kept, the line's last window.
- **A period's cost** is what the branch paid the provider for it: the cost kept on the entry that bought it
  (`periodCost`, written by the sale or renewal; a switch reprices the older periods to the cost it kept, as before),
  else, for rows written before the cost was kept, the line's terms (`subscription` or `renewal` `branchCost`).
- **used** = round(running period's cost × used days ÷ period days), exactly as before (a started day counts as used).
  The running period is the oldest open one; the others have not started and none of their days is used.
- **What the provider gives back** = Σ open periods' cost − used − fee. **The disconnect entry's `providerCost`** is
  minus that: `used + fee − Σ cost`. The owner's example: 1000 + 50 − 3000 = **−1950**; the books count
  3000 − 1950 = 1050 for the line.
- **Stacked periods:** a period bought ahead (an extension not yet started) is unused in full: its whole cost comes
  back, as the point of sale's refund already gives back its whole value.
- **The last day**, or any disconnect where the unused cost is under the fee: the formula is not clamped. On the last
  day used = the period's cost, so the entry stores **+50**: the provider gives back nothing and the fee is still owed.
  Under the fee in between, the entry stores fee − unused cost (> 0). There is no second rule and no second rounding.
- **No open period** (the subscription lapsed): not a disconnect settlement; recorded with cost 0, as before.

**The customer's side is unchanged.** The point of sale's refund (`amount` = the unused days at the point of sale's
price, less the fee; refused when not above the fee, `NOTHING_TO_REFUND`), the ladder kept on the refund, the
quote, and the task that moves no money once nothing is left are exactly as they were: P.6 changes only the
`providerCost` that `settleDisconnect` answers, and only the disconnect entry stores it. Verified by the existing
specs of the refund (`execution-date-settlement.db.spec.ts`, `prices-and-periods.spec.ts`), whose `amount`
expectations do not move.

**Writers:** the disconnect now (`LinesService.disconnectNow`) and by task (`TaskCompletion.disconnect`) both store
`settled.providerCost`; nothing else changes. **Stored rows:** the P.4b command corrects the disconnects already
stored in the old form (trial data before launch, ADR 0025 amendment): an old row stores used + fee > fee, a new row
stores ≤ fee (used never exceeds the running period's cost), so the form is told by the value; an old row becomes
`stored − Σ cost` of the periods open at its own time (`periodsAt` at its `createdAt`, from the prepaid entries
written before it), each printed. One that has no open period to find, or whose used share would exceed the periods'
cost, is unresolved and stops the run.

Run on the local dev database (2026-11-17): the four stored disconnects (`5687cc6c…`, `5affd963…`, `a9136b2b…`,
`32444b9a…`, all sky, a 3500 period with one day used) 167 → −3333; sky's purchases 63288 → 49288; the CHECK still
validated; a second run wrote nothing.

**Readers of a negative cost:** the books' sums and the ledger (amount = −cost) take any sign, as a switch to a
cheaper package already stores a negative difference; the ledger page and `provider-operations` keep every row with
a cost ≠ 0; the providers report and the overview add it. The providers report's share bar clamps a provider's share
to 0–100 % (a window holding only a disconnect gives that provider a negative cost).

## Paid at the provider, not charged to the point of sale (DB.5 P.7)

The owner (ADR 0025, answer 4 and "an activation priced zero", 2026-11-17): a number the provider charged the
office for and the point of sale was not charged for is a serious money problem. Such an operation **is a purchase**
(the provider took its price), it shows as **a loss of the branch**, and it carries **a visible mark** so the office
finds where it went wrong.

### Every path where the provider performs an operation and the point of sale ends up not charged

| # | Path (file, function) | Today | P.7 |
|---|---|---|---|
| 1 | **Given back after the provider's success**: `sales/settlement/provider-decisions.ts`, `ProviderDecisions.answer`, effect `release-after-success` → `TasksService.rejectByDecision` (ADR 0019 D15/D16, T11). Only an activation task has a provider operation (`operationKey` is `activate:<task>`), and the decision exists only for an operation in `exception` (succeeded at the provider, its line could not be made). | the task is rejected and its hold given back; **no operation entry**: in no provider's books | an `activate` entry, amount 0, on the point of sale's wallet, marked `given_back` |
| 2 | **An activation task priced 0**: `sales/settlement/task-completion.ts`, `TaskCompletion.applyClaimed` (the branch's completion, the settlement's `apply`, and the decisions `confirm-success` / `apply-corrected` all run it). `taskCharge` answers `none` for `posDelta` 0, so `recordOp` writes the entry with the sale as the handler built it: a plain activation names no cost there (`activationProviderCost` is undefined), so `operationColumns` stores **0**. | cost 0 | the package's cost (`postedCost`, the subscription's branch cost on the line's new terms, the figure a priced task stores), marked `priced_zero` |
| 3 | **An immediate activation priced 0**: `sales/lines.service.ts`, `LinesService.activate` (`ledger.move` with `posDelta` 0). | the real cost (`activationProviderCost ?? providerBranchCost`), amount 0, no mark | the same cost, marked `priced_zero` |
| 4 | **A renewal priced 0, now** (`LinesService.extend`, `restartDisconnected` for `charge` / `reactivate`; `ledger.move` with 0) **or by task** (`TaskCompletion.renew` → `recordOp`). | the real cost (`periodCost`, the renewal branch cost), no mark | the same cost, marked `priced_zero` |

Ruled out, with the reason:

- **A switch whose difference is 0** (`switchPackage`, `TaskCompletion.switch` → `recordOp`): not a sale priced 0. The
  point of sale pays a difference between two packages; a difference of 0 is the price list, and the entry already
  stores the provider's quoted difference. Not marked.
- **The kinds the provider does not price** (`freeze`, `unfreeze`, `rename`, `sim`, `refresh`, `transfer`) cost 0 and
  charge 0: nothing is lost. `disconnect` gives money back on both sides (P.6). `esim` is charged its fee or not run.
  An add-on (`addon`) is not a provider operation kind (no provider, no cost is stored for it).
- **The immediate route's provider call** (`LinesService.route` → `gateway.run`) followed by a transaction that fails
  (number taken, ceiling): `run` answers success only in the simulation (`SimulatedProviderGateway`; in production it
  answers `NOT_CONNECTED`), and a real provider's activation goes by the dispatch route (ADR 0019 D13), whose success
  is settled, decided or given back (path 1). Named here for when a real in-request gateway is built.
- **A decision `declare-failure`, a reject or cancel of a task**: the operation is `failed` (terminal: `failed` never
  moves to `succeeded`, `provider-operation.rules.ts`) or `abandoned`: the provider did not run it.
- **An exception still open** (succeeded, not applied, not given back): the hold is still held and the task open;
  it becomes path 1 or is applied. Not a loss until then.

### What is written

One `WalletEntry` per operation, as every operation is written, with one new column:

- **`WalletEntry.providerLoss`** — nullable text, `given_back` or `priced_zero`; null on every other row. A column
  naming the reason, not a new entry kind: the row stays an `activate` / `charge` / `extend` / `reactivate`
  operation, so the provider's books (`providerId`, `providerCost`), the finance kind filter, the number's history and
  the CHECK `WalletEntry_operation_priced` read it as the operation it is, and the reason is one column the screens
  filter on. A CHECK `WalletEntry_provider_loss` (migration `20261117240000_provider_loss`) refuses another value and
  refuses a mark on a row that moves money or has no provider. A partial index
  `WalletEntry_provider_loss` on (`providerId`, `createdAt` DESC, `id` DESC) `WHERE "providerLoss" IS NOT NULL` serves
  the summary's count and the filter.
- Path 1 (`given_back`): `kind` `activate`, `amount` 0, `balanceAfter` the wallet's balance (unchanged), on the
  task's **point of sale's** wallet (the account the number was for, where the office looks for it), `actorId` the
  approving account's operator, `note` the task's rejection note (`PROVIDER_RELEASED_NOTE`, so the point of sale
  reads it as given back), `msisdn` what the provider handed back else the task's, no `lineId` (no line was made),
  the package's name and company, `packagePrice` the task's `unitPrice` (what the sale would have charged),
  `providerId` the task's package's provider, **`providerCost` the package's cost at the provider now** —
  `Package.branchCost`, plus the eSIM fee for an eSIM task (`packageActivationCost`, `pricing/rules/prices.ts`: the
  figure an activation of that package stores; the task keeps no record of the cost of the day it opened).
  Written by `WalletLedger.recordOp` (through `TaskCompletion.recordGivenBack`, so the decisions keep the
  settlement's five collaborators, `worker-wiring.spec.ts`) in the approval's transaction, **after**
  `rejectByDecision`'s `release`, so under
  the wallet lock that release takes (when the task held money; a task priced 0 held nothing and `recordOp` reads the
  wallet without a lock, as every `recordOp` does — it writes no balance). The package is read **before** the
  transaction. The lock order (task → operation → wallet) is unchanged; nothing is added to the sale path.
- Paths 2–4 (`priced_zero`): set by `operationColumns` (`wallets/provider-cost.ts`) in the entry's own INSERT, from
  what it already has: a kind priced at the provider other than `switch` (`activate`, `charge`, `extend`,
  `reactivate`), amount 0, and a cost above 0. Path 2 only changes which sale `recordOp` is given (`charged`, which
  carries `postedCost`, instead of `sale`). **No statement, read or lock is added**: `sale-lock-tree.db.spec.ts` keeps
  11 and 12.

### The margins of a marked row

The point of sale paid 0, so nobody below the branch earned or lost anything on it; the branch paid the provider.
A marked row stores **`branchMargin` = − `providerCost`** and the other six margin columns null (no ladder, no
chain ids). Against `marginOf`: a ladder for it would hold `posSell` 0 and every cost 0 below the branch and the
provider's cost at the branch, giving the branch `0 − cost` and every other layer 0 — the stored figure, with the
lower layers' zeros left null (they add nothing to a sum, and a row with no chain ids is in no lower layer's figures).
ADR 0026's invariant (`marginBreaks`) gains the case: a row with no ladder stores none of the seven, **except a
marked row, which stores only `branchMargin` = − `providerCost`**. The CHECK `WalletEntry_sale_margins` (a ladder
needs its margins) is unchanged.

**Not a sale in the reports' counts.** The sales and refunds every count and volume reads are
`kind ∈ SALE_KINDS AND amount < 0` or a refund with `amount > 0` (`saleOrRefundWhere`, the overview's
`SALE_OR_REFUND`): a marked row moves 0, so it adds no sale, no volume and no profit to the home, the profit report or
the finance summary. **Where the loss is counted:** the providers report (`InsightsService.supply` sums
`branchMargin` over every operation entry of a provider, so its branch profit falls by the cost), the provider's
books (a purchase), and the branch's finance list (its margin column shows − cost). Whether the home's and the
profit report's profit should also subtract it is a question for the owner (below); it is not done here because those
sums read the partial sales index, whose predicate a marked row does not meet.

### Where the mark is seen, and by whom

The **branch only** — the owner and the branch accounts the screens already allow (`reports` for
`provider-operations`, `accounting` or `reports` for the provider accounts). Lower layers never read a provider's
cost today: `provider-operations`, the provider accounts and the providers report refuse any layer but the branch,
and the finance list's rows carry no cost (`margin` is the viewer's own stored margin: null on a marked row for
anyone but the branch, which has no chain ids). P.7 keeps it so:

- `GET provider-operations`: each item `loss` (`given_back` | `priced_zero` | null); the query `loss=any|given_back|priced_zero`
  filters in SQL; `stats.losses` counts the marked operations of the window.
- `GET provider-accounts` and `GET provider-accounts/:code`: each summary `losses`, the provider's marked operations
  ever (one grouped count over the partial index, read with the purchases); each ledger row `loss`.
- `GET finance` (and its CSV): each item `loss`, **null for any viewer but the branch**; the query
  `loss=any|given_back|priced_zero` is refused (403 `FORBIDDEN`) for another layer, so a lower layer cannot find the
  marked rows by filtering. The point of sale still sees its own row (an `activate` that moved 0, with the note), as
  it sees every operation on its wallet, without the mark, the cost or the margin.
- Web: a `Badge variant="danger" dot` labelled «خسارة: أُعيد المبلغ» / «خسارة: بسعر صفر» (en / he alike, a title saying
  what it means) on the row in «عمليات المزودين», the provider's ledger and «المالية»; a filter «خسارة الفرع» there
  (finance: shown to the branch only); on «حسابات المزودين» a column with the count as a danger badge linking to
  «عمليات المزودين» filtered on that provider's marked operations, and the same link on the provider's page when its
  count is above 0. Copy keys in ar / en / he (`npm run check:copy`). The existing badge, no new look.

### Old rows (trial data, the owner's standing rule)

`cli/provider-ledger-backfill.ts` gains the P.7 pass, in its one transaction, each change printed:

- **Given back:** found from stored data: every `ProviderDecisionEvent` approved with decision `release-after-success`
  names its operation, which names its task (point of sale, package, eSIM, number). For each one without its entry
  (an `activate` entry marked `given_back` on that point of sale's wallet for that number and package), the entry is
  written as above, dated at the approval, its `balanceAfter` the point of sale's balance after its last entry before
  that time, its cost the package's cost now (printed as such: no older figure is kept).
- **Priced zero:** every `activate`, `charge`, `extend`, `reactivate` entry that moved 0 and is not marked: an
  `activate` that stored cost 0 is re-priced by the rule the command already uses for a missing activation cost
  (the period cost kept on the entry, the line's terms, the package), and every one whose cost is then above 0 is
  marked `priced_zero` with `branchMargin` = − cost.
- A second run writes nothing. On the local dev database: no decision event and no entry that moved 0 exist (see the
  run in the ADR's "As built (P.7)").

### Proof

`wallets/provider-loss.db.spec.ts`: each path (the approved release; a task priced 0 by the branch; an immediate
activation priced 0; a renewal now and by task priced 0) writes the marked entry with its provider, cost and margins;
the provider's purchases include it and its summary counts it; `provider-operations` filters it; the point of sale's
balance and money entries are unchanged to the agora; a lower layer's finance rows carry no mark and no margin, its
filter is refused; the CLI pass on a fixture. `sale-lock-tree.db.spec.ts` unchanged; `response-shape.spec.ts` pins the
new fields.

### For the owner

- Should the home's and the profit report's branch profit subtract these losses (today they are sales figures:
  they do not move)? **Answered 2026-11-17: yes — section "Branch losses in the profit figures (DB.5 P.8)" below.**
- A given-back operation's cost is the package's price at the approval; if the provider's price changed between its
  success and the approval, the difference is a settlement entry (answer 1).

## Branch losses in the profit figures (DB.5 P.8)

The owner (2026-11-17, answering P.7's question): «الخسارة تبيّن في الداش بورد عندي خسائر، وتنطرح من الربح أكيد».
A marked operation (`providerLoss` not null, P.7) is a loss of the branch: the branch sees it on the home as a loss,
and every profit figure of the branch is net of it.

### The rule

**For the branch viewer, a profit figure over a period is the sum of `branchMargin` over the period's sales and
refunds plus the sum of `branchMargin` over the period's marked operations** (each stores − its provider cost, P.7).
A marked operation stays **not a sale**: it adds nothing to a count of sales, a volume, the activations or the
refunds. For any other layer nothing changes and nothing is told: a marked row has no chain ids, so it is in no lower
layer's sums, and the new fields below are null for them.

The date of a loss is its entry's `createdAt` (the approval of the give-back; the operation's own time for a sale
priced 0), the same instant its row shows in the finance list.

### Where

| Read | Today | P.8 |
|---|---|---|
| `GET /v1/overview` (home) | `sales.profit`, `sales.trend[].profit`, `pulse.current/previous/trend[].profit`, the profit of `top.packages/companies/providers`: sales and refunds only | each net of the losses of its period, bucket or group (a loss is grouped by the package name, the company name and the provider its row stores; a group with losses and no sale appears with count 0). New **`sales.losses`**: `{ count, amount }` for the branch (the period's marked operations and what they cost, `amount` positive agorot), `null` for another layer. `PulseTotals` gains **`losses`** (the amount, positive; 0 for another layer) so the tile and its change read one object. |
| `GET /v1/finance/profits` and its CSV | per package and totals: sales and refunds | for the branch each package's `profit` is net of its losses and each row and the totals gain **`losses`** (a count) and **`lossAmount`** (positive agorot); a package with losses and no sale is a row. For another layer both are 0. Same filters (`from`, `to`, `q`). The CSV gains the two columns **for the branch only**. |
| `GET /v1/finance/summary` | `profit` over the window: sales and refunds | net for the branch; new **`losses`**: `{ count, amount }` for the branch, `null` otherwise. |
| The providers report, the provider's books, the finance list's margin column | already count it (P.7) | unchanged |

So one figure wherever the branch reads its profit: the home's top providers and the providers report now agree.

### How it is read

A second read beside the sales read, added in Node: the sales read keeps its predicate, so it keeps the partial
sales index (`WalletEntry_sale_or_refund_createdAt_id`); an `OR` in one statement would lose it. The losses read is
`WHERE "providerLoss" IS NOT NULL` and the period, grouped in SQL (the home: by the finer of the trend's bucket and
the day, with the package, company and provider; the report: by company and package; the summary: one sum). Marked
rows are few by nature (each is a fault the office is meant to remove), and a partial index
**`WalletEntry_loss_createdAt`** on (`createdAt` DESC) `WHERE "providerLoss" IS NOT NULL` (one migration) serves the
period whatever the table's size. The read runs **for the branch only**: no statement is added to another layer's
home. Nothing is added to a write: the sale path's statements under the wallet lock stay 11 and 12.

No old row changes: P.7's backfill already stores `branchMargin` on each marked row.

### Web (branch only)

- **Home, the profit tile:** the figure is the net profit (as answered). Its meta line, which reads the period's name
  today, reads for the branch the period and the losses: «{period} · خسائر: {n} بقيمة {amount}» in the danger tone
  and a link to «عمليات المزودين» filtered on the marked operations (`/provider-operations?loss=any`) when there are
  any, and «{period} · لا خسائر» muted when none. No new tile: the band keeps its three.
- **الأرباح (the profit report):** for the branch a column «خسائر» (the count, danger when above 0) and, under the
  profit figure's stat, the losses of the period (count and amount). Another layer's page is as it is.
- **المالية:** the summary's profit is net; no new element (the section's rearrangement is an open item).
- Copy in ar / en / he; existing tokens and components only.

### Proof

`reporting/desk` and `wallets` db specs: with one sale and one marked operation in the period, the branch's home
profit, its bucket of the trend, its package/company/provider group, the report's row and totals and the summary's
profit are each the sale's margin minus the cost, the counts and volumes unchanged; the previous period carries a loss
dated in it; a main agent's, agent's and point of sale's figures are unchanged and their new fields null / 0; the
index is used (`EXPLAIN`, as the stored-margins indexes are proven). `response-shape.spec.ts` pins the new fields.
`sale-lock-tree.db.spec.ts` unchanged.

## Stored margin an entry (DB.12)

Decision and invariant: ADR 0026 (accepted; the owner's answers of 2026-11-17 and the amendment at its end). Each sale's
and refund's wallet entry stores its chain by layer and each layer's margin; every profit figure is a SQL sum of them.

| # | Slice | State |
|---|---|---|
| M.1 | `WalletEntry` `chainPosId`, `chainAgentId`, `chainMainAgentId`, `posMargin`, `agentMargin`, `mainAgentMargin`, `branchMargin` (no foreign keys) and the CHECK `WalletEntry_sale_margins` `NOT VALID` (migration `20261117230000_stored_margins`). `WalletLedger.post` writes them in the entry's INSERT from the ladder it builds (`marginOf`), the layers from the path `confirmedPath` returned (`chainIdsOf`; two accounts of one layer: 409); a refund copies its sale's ids. No statement under the wallet lock is added: `sale-lock-tree.db.spec.ts` counts 11 and 12. | done |
| M.2 | `cli/stored-margins-backfill.ts` (`--dry-run`, `--check`): every sale and refund entry gets its columns from its kept ladder; an old sale without one gets a ladder built once at today's prices on the path at the time of the sale (moved accounts put back from the `transfer.out` notices: answer 1), stored with it (answer 2); an old refund scales its line's earlier sale; the invariant in Node; the CHECK validated. Runs after the deploy, writes stopped, before `provider-ledger-backfill`. | done |
| M.3 | Partial indexes `WalletEntry_chainMainAgent_createdAt`, `…_chainAgent_…`, `…_chainPos_…` (chain id, `createdAt` DESC, `id` DESC) INCLUDE (margin, `amount`, `kind`) (migration `20261117230100_stored_margins_indexes`, plain `CREATE INDEX`); `20261117230200_stored_margins_validate` validates the CHECK when no row breaks it. | done |
| M.4 | Reads switched: the overview (counts, volume, refunds, net, profit, trend, pulse and the period before, rankings, most active — `DeskRepository` SQL), the profit report and CSV and the finance summary (`groupBy` of the viewer's column), the providers report (`groupBy` by stored provider with `branchMargin`), the finance list's `margin` and `shares` (the row's columns). The caps (20,000 / 50,000 / 5,000) and `capped` removed from the three answers and from the web types; `laddersOf`, `laddersFor`, `marginsFor`, `addEntry` and the repository reads only they used deleted. | done |
| M.5 | The worker's closed-day summary (ADR 0026 option C): only if "all time" measures over the owner's one-second budget. | waits for a measurement |

**Whose figures.** A viewer below the branch reads its own layer's column over the sales and refunds whose chain held
it at the time of the sale (`"chainAgentId" = viewer`, …), wherever its points of sale are now: a point of sale moved
to another agent leaves its old sales — profit, count and volume alike — with the old agent. The branch (owner and
staff) reads `branchMargin` of every sale. The finance list stays the entries of the accounts under the viewer now,
each row with the viewer's stored margin (null when the viewer was not in that chain).

**Response change.** `GET /v1/overview` `sales.capped`, `GET /v1/finance/profits` `capped` and `GET /v1/reports/supply`
`capped` are gone (none was pinned by `response-shape.spec.ts`; no screen drew them; the web types and the Playwright
stand-ins follow). Every figure is exact over any period.

**Proof on the local dev database (2026-11-17).** The backfill: 23 sale and 4 refund entries; 9 kept ladders given
their margins, 15 sales and 3 refunds built (none moved, none left without a ladder), 27 rows written, the invariant
holds, the CHECK validated; a second run wrote nothing. Old and new answers, 64 figures over five accounts (each layer)
and every period the screens offer: equal to the agora (ADR 0026 amendment). On 27 rows the planner reads the branch's
sums by a sequential scan (with sequential scans off, the partial sales index), an agent's from its chain index alone
(an index-only scan): that proves the indexes can serve the sums, not their speed; M.5 waits for a database at the
audit's sizes.

## Rules that hold for every slice

- Refactor slices keep behaviour: same paths, same response shapes, same screens, unless the slice is marked
  [CONTRACT] and this spec names the change.
- An index is added by a migration of its own. The production table is small today, so a plain `CREATE INDEX`
  inside the migration is used; `CONCURRENTLY` is for a later index on a table that has grown.
- A slice marked [MONEY] or [LOCK] is not built from this spec alone: it gets its own section here (or an ADR)
  with the invariant it keeps, and the owner's word, first.
- Nothing listed under "Looks dead, is not" in the dead-code audit is removed.
- The Arabic handover is updated in the slice that changes what an operator sees or sets.

## Out of scope

The server's own changes (Cloudflare, PostgreSQL settings on the host, the runtime upgrade): the handover lists
them. The security pass (limits everywhere, the account lock). Ancestor or path columns for visibility (DB.16):
only on evidence from production.

## The owner's answers of 2026-11-17 (second round)

- **Retention (DB.13), yes to every value:** a read notice 180 days, an unread one a year; an ended session
  30 days; a published outbox message 30 days (only one whose operation is applied); a line-count snapshot
  400 days; the account-entry log (`AccessLog`) kept for ever.
- **Settings (DB.15), yes:** statement time limit 15 s for the API, idle-in-transaction 30 s, pool 20 for the API
  and 10 for the worker; the CSV export is excepted from the statement limit.
- **The tree out of the wallet lock (DB.9), yes by name:** the sale path takes the account path from the caller
  and no longer reads the tree inside the locked transaction.
- **Company logos in the numbers table:** kept.
- **The finance number search no longer reading notes:** left open; the whole finance section is to be
  rearranged, and the question is decided there.
- **`apps/web/audit-output`** (old check output, untracked): deleted.
- **The Coolify upgrade:** not done yet; `docs/operations/2026-11-12-coolify-upgrade-preparation.md` stays.
