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
- [x] **L.11** (62a1710) `GET /office/wallets` paged in the tree's order (`keyPage`, 200 a page). No web screen calls
  this route, so only the API and its spec changed.
- [x] **L.12** (62a1710) `GET /office/reports/balances` paged with `totals` over every matching account; `capped` is
  gone from it. The screen sorts and sums its rows, so `api.reportBalances` reads the pages one after another
  (`lib/all-pages.ts`) and the screen did not change. The CSV export is unchanged.
- [x] **L.13** (62a1710) `GET /office/provider-accounts`: payments and settlements are summed by the database
  (`entrySums`); a provider's page reads only its own entries. **Purchases are still added in memory:** an
  operation's cost falls back to the package's price when its row stored none, which a query cannot do.
  `packages`, `companies`, `offers`, `roles`: read with `take: LIST_CAP + 1` (1,000) and answer `capped`.
  **Not done:** the web note when `capped` is true (no screen shows any of the API's `capped` flags today; a note
  needs a design decision, and no catalog is near 1,000 rows).

## Phase 3 — routes (decision 5) and not-found (decision 6)

Each: controller route, `testing/office-routes.ts` row, `permissions.http.spec.ts` row, the web `api.ts` function,
mocks, both maps.

- [x] **L.14** (98251f8) `PUT /office/companies/:code/image`: the company by its code in the path, the body is the
  picture alone.
- [x] **L.15** (98251f8) `POST /office/roles` creates a job role, `PUT /office/roles/:id` changes one; the body has
  no `id`.
- [x] **L.16** (98251f8) `GET /office/ledger` (the scope segment is gone). **`PATCH /office/packages/:code/chain`
  stays PATCH:** the spec said it replaces the chain, but its body is partial (any of the prices), so PATCH is the
  right verb and `PUT …/renewals` beside it is right too (it replaces the whole target list). The spec is corrected.
- [x] **L.17** (98251f8) Reports: `GET /office/reports/{providers,operations}` answer the envelope;
  `…/reports/balances/export` and `…/reports/supply/export` are fixed routes; `reports/:kind` and
  `reports/:kind/export` are gone, with `ReportsService`'s dependency on the tasks and lines services. The web's
  `/reports/tasks` and `/reports/numbers` pages stay and read `/office/tasks` and `/office/lines`. No export was
  added for `providers` and `operations`: they had none, and a new export is a feature, not a rename.
- [ ] **L.18** Partly (892c1ca): `GET /office/lines?loginName=` replaces `?account=`. **Not done, owner's call:** the
  body fields `posLogin` and `parentLogin`. The responses use the same two names (`LineRow.posLogin`,
  `UserRow.parentLogin`, about 150 uses in the API and the web), so renaming the request side alone would make a
  request and its answer disagree, which is the trap this slice was meant to remove. Either both sides are renamed
  (`posLoginName`, `parentLoginName`: a wide rename with `response-shape.spec.ts`) or neither.
- [x] **L.19** (892c1ca) Not found: an account, a number or a task that is not there or is outside the caller's tree
  answers `404 NOT_FOUND` (`visibleAccount`, `visibleLine`, password reset, fund, deduct, ceiling, terms and
  line-price scopes, task card and notes); `enter`, `freeze`, `restore` and `delete` answer 404 for a login that is
  not there. Grants that do not depend on the target are judged first (`freeze`, `delete`), so the permission
  matrix now shows who may call them. Rule 4.8. **Left as it was:** an account move
  (`transfers.service.ts` `resolveTransfer`) keeps its own order, written and tested so a refusal tells nothing.

## Phase 4 — close

- [x] **L.20** (2dadf1b) `rules/office-paging.ts` keeps only page sizes and filters; `list-envelope` baseline 0;
  rules 4.7 and 4.8 in `.cursor/rules/backend-engineering.mdc`; both maps; ADR
  `0014-list-contract-and-route-names.md`; the review file's A4, A7, A8 marked.

## Open after this plan

- L.18's body fields (`posLogin`, `parentLogin`): the owner's call, both sides or neither.
- The Playwright suite has not run on these commits (GitHub Actions only): the mocks were updated by hand and
  checked by `tsc` and by `grep` for the old keys.
- A web note when a catalog list is `capped`; search-as-you-type account pickers; provider purchases summed in the
  database (needs a stored cost on every operation row).
