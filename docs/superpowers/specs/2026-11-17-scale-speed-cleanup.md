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
