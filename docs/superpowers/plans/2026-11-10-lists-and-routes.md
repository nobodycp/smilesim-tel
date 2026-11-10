# One list contract, bounded lists, consistent routes — plan

Spec: `docs/superpowers/specs/2026-11-10-lists-and-routes.md`. The owner approved the seven decisions as
proposed on 2026-11-10. One slice = one commit touching API + web + web mocks + pinned specs together, checked on
the running copy (port 3000). Pushed when the owner asks; the Playwright job then runs over the slices together.

## Phase 0 — ground

- [x] **L.0 Inventory.** (345d36b) Done differently: today's keys were already pinned by `office-lists.spec.ts`,
  `response-shape.spec.ts` and the `*.http.spec.ts` of each list, so no second spec was written; they were moved to
  the envelope with each list. Original text: **Inventory, pinned.** `apps/api/src/modules/office/testing/list-contract.spec.ts`: for every list route
  call it on the tree fixture and pin its keys and cursor form as they are today (the table in the spec, made
  executable). `apps/web`: list every caller per route in `docs/architecture/frontend.md` ("list callers" table:
  `features/*/api.ts` function → screens → test files that mock it). No behaviour change.
- [x] **L.1 `shared/paging.ts`.** (345d36b; `page`, `after`, `cursorPosition`, `encodeCursor`, `encodeKeyCursor`,
  `NEWEST_FIRST`, `PAGE_MAX`; `kernel/feed.ts` and the cursor code of `rules/office-paging.ts` are gone; guard
  `list-envelope` at 3) `page(rows, size)` → `{ items, nextCursor }`, `cursorArgs(cursor)`,
  `encodeCursor` / `decodeCursor` (the feed cursor, moved from `rules/office-paging.ts`), `PAGE_MAX`. Spec.
  Nothing uses it yet. Guard `list-envelope` added with today's count.
- [x] **L.2 Web: one reader.** (345d36b; `Page<Row>` in `lib/api-types.ts`, `pageRows()` in `lib/use-paged.ts`) `apps/web/lib/use-paged.ts` reads `items` **or** the old key through a small
  adapter argument, so each later slice flips one caller. `apps/web/lib/api-types.ts`: `Page<T>` type. e2e green.

## Phase 1 — the envelope, list by list (decisions 1, 2)

Each: service returns `page()`, controller unchanged, `api-types.ts` row type, the `features/<x>/api.ts` function,
the screen's `usePaged` call, the mock in `apps/web/tests/` / `audit/`, `response-shape.spec.ts`,
`list-contract.spec.ts`, guard baseline down.

- [x] **L.3** (345d36b) `GET /office/tasks` (`tasks/tasks.service.ts`; web `features/tasks`).
- [x] **L.4** (345d36b) `GET /office/lines` (`lines/line-reads.ts`; id cursor → the one cursor; web `features/lines`).
- [x] **L.5** (345d36b) `GET /office/notices` (`notices/notice-inbox.service.ts`; keeps `unread`; web `features/notices`,
  `lib/use-notices.ts`).
- [x] **L.6** (345d36b) `GET /office/audit` (`audit/audit.service.ts`; keeps `addresses`; web `features/audit`).
- [x] **L.7** (345d36b; the path is still `/ledger/:scope` until L.16) `GET /office/finance` and `GET /office/ledger` (`wallets/wallets.service.ts`; web `features/wallets`
  finance and wallet screens).
- [x] **L.8** (345d36b; envelope only. The match filter stays in memory: a row's match state is computed by
  `matchOf`, not stored, so the database cannot filter by it until real provider statements are stored) `GET /office/provider-operations` (`wallets/wallets.service.ts`; keeps `stats`; the date and match
  filters move into the query instead of filtering loaded rows; web provider-operations screen).
- [x] **L.9** (fc77f16) `GET /office/users` always paged (decision 4): the envelope, the opaque key cursor
  (`encodeKeyCursor`), a foreign cursor is 400; `?paged=1` and `AccountsService.list` are gone.

## Phase 2 — bounded lists (decision 3)

- [x] **L.10** (fc77f16) `GET /office/directory` is a paged list of `{ loginName, nickname, layer, parentLogin,
  frozen, mine }` with `q`, `layer`, `mine=1` (the actor's own tree), 200 a page. **Done differently from the
  first text:** the pickers do not search as the owner types. `apps/web/lib/directory.ts` reads the pages one after
  another (`directoryNames()` for the session's name map, `everyAccount()` for the five pickers and the shell
  search), so every answer of the API is bounded and no screen changed. Search-as-you-type pickers stay a later
  web change, when an office has more accounts than a picker can list.
- [x] **L.11** (COMMIT) `GET /office/wallets` paged in the tree's order (`keyPage`, 200 a page). No web screen calls
  this route, so only the API and its spec changed.
- [x] **L.12** (COMMIT) `GET /office/reports/balances` paged with `totals` over every matching account; `capped` is
  gone from it. The screen sorts and sums its rows, so `api.reportBalances` reads the pages one after another
  (`lib/all-pages.ts`) and the screen did not change. The CSV export is unchanged.
- [x] **L.13** (COMMIT) `GET /office/provider-accounts`: payments and settlements are summed by the database
  (`entrySums`); a provider's page reads only its own entries. **Purchases are still added in memory:** an
  operation's cost falls back to the package's price when its row stored none, which a query cannot do.
  `packages`, `companies`, `offers`, `roles`: read with `take: LIST_CAP + 1` (1,000) and answer `capped`.
  **Not done:** the web note when `capped` is true (no screen shows any of the API's `capped` flags today; a note
  needs a design decision, and no catalog is near 1,000 rows).

## Phase 3 — routes (decision 5) and not-found (decision 6)

Each: controller route, `testing/office-routes.ts` row, `permissions.http.spec.ts` row, the web `api.ts` function,
mocks, both maps.

- [ ] **L.14** `PUT /office/companies/:code/image`.
- [ ] **L.15** `POST /office/roles` (create) and `PUT /office/roles/:id`.
- [ ] **L.16** `PUT /office/packages/:code/chain`; `GET /office/ledger`.
- [ ] **L.17** Reports: four fixed routes with `export` beside each; `reports/tasks` and `reports/numbers`
  removed with `ReportsService.report`'s branches for them; web `features/reports`.
- [ ] **L.18** Field names: `loginName`, `parentLoginName`, `posLoginName`, `?loginName=` in the schemas
  (`accounts.schemas.ts`, `lines.schemas.ts`, `transfers.schemas.ts`), the services that read them, and every web
  caller. One commit per schema file.
- [ ] **L.19** Not found: `setPassword`, `setFrozen`, `remove`, `setCeiling`, `enter`, the task actions answer
  `404 NOT_FOUND` for a missing or invisible target; `accounts.http.spec.ts`, `permissions.http.spec.ts` rows
  that pinned 403/400 for that case; the web shows the same message (it reads `code`).

## Phase 4 — close

- [ ] **L.20** `rules/office-paging.ts` keeps only filters (cursor code gone); `list-envelope` baseline 0;
  `.cursor/rules/backend-engineering.mdc` 4.7 final text; `docs/architecture/{backend,frontend}.md`; ADR
  `0014-list-contract-and-route-names.md`; the review file's A4, A7, A8, A12 marked done.
