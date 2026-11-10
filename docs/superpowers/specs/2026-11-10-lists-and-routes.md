# One list contract, bounded lists, consistent routes — spec

Review 2026-11-10: A7 (lists), A8 (naming), A4 (not-found codes), A12 (two generations of `/office/reports`).
**API and web together**: every slice changes one endpoint group in the API, its caller in `apps/web`, the web's
mock API used by the Playwright tests, and the pinned specs, in one commit. **The owner approved all seven
decisions below as proposed on 2026-11-10.**

## Today (commit 314d290)

Paged lists and what they answer:

| Route | Collection key | Extra keys | Cursor |
|---|---|---|---|
| `GET /office/lines` | `lines` | `total`, `poses` | row id (`idCursorArgs`) |
| `GET /office/tasks` | `tasks` | `total` | feed (`ms:id`, `encodeFeedCursor`) |
| `GET /office/users?paged=1` | `users` | `total` | `rank:login` (`users-page.ts`) |
| `GET /office/users` (no `paged`) | `users` | — | none: the whole tree |
| `GET /office/notices` | `notices` | `total`, `unread` | feed |
| `GET /office/audit` | `entries` | `total`, `addresses` | feed |
| `GET /office/finance` | `entries` | `total`, stats | feed |
| `GET /office/ledger/:scope` | `entries` | `total` | feed |
| `GET /office/provider-operations` | `rows` | `total`, `stats` | feed, over rows filtered in memory |
| `GET /office/reports/:kind` | `rows` / `entries` / `tasks` / `lines` | `total` | varies |

Unbounded lists: `GET /office/wallets`, `/office/directory`, `/office/packages`, `/office/companies`,
`/office/offers`, `/office/reports/balances`, `/office/provider-accounts` (loads every provider entry),
`/office/roles`.

Naming: the account is `users/:loginName`, `wallets/:loginName`, `posLogin`, `parentLogin`, `?account=`; state
changes are POST verbs except `PATCH users/:login/access`; `PATCH …/chain` beside `PUT …/renewals`;
`POST /office/roles` is an upsert keyed by a body id; `POST /office/companies/image` names the company in the body;
`GET /office/ledger/:scope` accepts one scope; `GET /office/reports/:kind` accepts `providers|operations|tasks|
numbers` while `…/:kind/export` accepts `balances|supply`. A missing target answers 404, 403 or 400 depending on
the route.

The web reaches the API through 135 distinct calls in `apps/web/features/*/api.ts`; 18 files read `nextCursor`
(through `lib/use-paged.ts`); 21 test and audit files mock paged answers.

## Decisions (approved by the owner as proposed, 2026-11-10)

1. **Envelope.** Proposed: every list answers `{ items, nextCursor, total }` plus its own extra keys (`unread`,
   `stats`, `poses`). The alternative is to keep each collection key and only align cursors.
2. **Cursor.** Proposed: one opaque cursor for every list (the feed cursor, base64url), `?cursor=` only; the id
   and `rank:login` forms are removed.
3. **Unbounded lists.** Proposed: `wallets`, `directory`, `reports/balances` become paged (they grow with
   accounts); `packages`, `companies`, `offers`, `roles`, `provider-accounts` stay whole but are **capped** with
   `capped: true` when cut (catalog size, bounded by the business), and `provider-accounts` sums in the database
   instead of loading every entry.
4. **`GET /office/users`.** Proposed: always paged; the pickers that need every account use `/office/directory`
   (paged, with `q`), so the `paged=1` switch goes away.
5. **Route names.** Proposed, smallest set that removes the traps without renaming the product's nouns:
   - `PUT /office/companies/:code/image` replaces `POST /office/companies/image`.
   - `PUT /office/roles/:id` and `POST /office/roles` (create) replace the upsert.
   - ~~`PUT /office/packages/:code/chain` instead of PATCH~~ — withdrawn while building it (2026-11-10): the body
     is partial (any of the prices), so PATCH is correct and stays.
   - `GET /office/ledger` instead of `/ledger/:scope`.
   - `GET /office/reports/{providers,operations,balances,supply}` as fixed routes with `…/export` beside each;
     `reports/tasks` and `reports/numbers` removed (they are `/office/tasks` and `/office/lines`).
   - Account path key stays `:loginName` everywhere; body and query fields that name an account become
     `loginName` / `parentLoginName` / `posLoginName` (today `posLogin`, `parentLogin`, `account`).
   Not proposed: renaming `/office/users` to `/office/accounts` (a large rename for no behaviour gain).
6. **Not found.** Proposed: a target that does not exist or is outside the caller's tree answers `404 NOT_FOUND`
   everywhere (today some routes say 403 or 400), so a caller cannot tell "exists but not yours" from "does not
   exist".
7. **How old and new live together.** Proposed: none. Web and API ship from one repository and one deploy, so each
   slice switches both sides at once; no `/v2`, no duplicate routes.

## Rules this adds

- `.cursor/rules/backend-engineering.mdc` 4.7: a list answers the envelope and takes the one cursor
  (`shared/paging.ts`); `architecture.spec.ts` rule `list-envelope` (a controller `@Get` whose service returns
  `nextCursor` goes through `page()`), baseline from today's count.
- `testing/response-shape.spec.ts` pins each list's keys against `apps/web/lib/api-types.ts` (it already reads that
  file).

## Non-goals

- Changing what any list contains, its order, or its filters. Query-filter validation (a separate small plan).
- Visual changes: the screens look the same.

## Risks

- Paging a list that a screen shows whole (`wallets`, `directory`) changes how that screen loads: each needs the
  "load more" or search pattern the paged screens already use (`usePaged`), checked at every width in ar and en.
- The Playwright suite runs on GitHub Actions only; each slice updates the mock API beside the web caller. Pushes
  happen when the owner asks (machine limits), so several slices may wait for one run: each is checked on the
  running copy (port 3000) and by `grep` for the old key in `apps/web/tests` before its commit.
