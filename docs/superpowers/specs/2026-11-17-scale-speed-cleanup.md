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
