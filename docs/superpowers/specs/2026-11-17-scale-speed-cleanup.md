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
