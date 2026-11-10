# One list contract, bounded lists, consistent routes — plan

Spec: `docs/superpowers/specs/2026-11-10-lists-and-routes.md`. **Blocked on the owner's answers to its seven
decisions**; the slices below assume the proposed answers and are rewritten if an answer differs. One slice = one
commit touching API + web + web mocks + pinned specs together, checked on the running copy (port 3000) in ar and
en, light and dark, phone and desktop, then pushed so the Playwright job runs before the next slice.

## Phase 0 — ground

- [ ] **L.0 Inventory, pinned.** `apps/api/src/modules/office/testing/list-contract.spec.ts`: for every list route
  call it on the tree fixture and pin its keys and cursor form as they are today (the table in the spec, made
  executable). `apps/web`: list every caller per route in `docs/architecture/frontend.md` ("list callers" table:
  `features/*/api.ts` function → screens → test files that mock it). No behaviour change.
- [ ] **L.1 `shared/paging.ts`.** `page(rows, size)` → `{ items, nextCursor }`, `cursorArgs(cursor)`,
  `encodeCursor` / `decodeCursor` (the feed cursor, moved from `rules/office-paging.ts`), `PAGE_MAX`. Spec.
  Nothing uses it yet. Guard `list-envelope` added with today's count.
- [ ] **L.2 Web: one reader.** `apps/web/lib/use-paged.ts` reads `items` **or** the old key through a small
  adapter argument, so each later slice flips one caller. `apps/web/lib/api-types.ts`: `Page<T>` type. e2e green.

## Phase 1 — the envelope, list by list (decisions 1, 2)

Each: service returns `page()`, controller unchanged, `api-types.ts` row type, the `features/<x>/api.ts` function,
the screen's `usePaged` call, the mock in `apps/web/tests/` / `audit/`, `response-shape.spec.ts`,
`list-contract.spec.ts`, guard baseline down.

- [ ] **L.3** `GET /office/tasks` (`tasks/tasks.service.ts`; web `features/tasks`).
- [ ] **L.4** `GET /office/lines` (`lines/line-reads.ts`; id cursor → the one cursor; web `features/lines`).
- [ ] **L.5** `GET /office/notices` (`notices/notice-inbox.service.ts`; keeps `unread`; web `features/notices`,
  `lib/use-notices.ts`).
- [ ] **L.6** `GET /office/audit` (`audit/audit.service.ts`; keeps `addresses`; web `features/audit`).
- [ ] **L.7** `GET /office/finance` and `GET /office/ledger` (`wallets/wallets.service.ts`; web `features/wallets`
  finance and wallet screens).
- [ ] **L.8** `GET /office/provider-operations` (`wallets/wallets.service.ts`; keeps `stats`; the date and match
  filters move into the query instead of filtering loaded rows; web provider-operations screen).
- [ ] **L.9** `GET /office/users` always paged (decision 4): `accounts/users-page.ts` on the one cursor; the
  callers that used the whole list (`grep "api.users("` in `apps/web`) move to `/office/directory`; `?paged=1`
  removed from web and API.

## Phase 2 — bounded lists (decision 3)

- [ ] **L.10** `GET /office/directory` paged with `q` (pickers: `components/name-field.tsx` users search as the
  owner types; first page preloaded).
- [ ] **L.11** `GET /office/wallets` paged (web wallets screen on `usePaged`).
- [ ] **L.12** `GET /office/reports/balances` paged; its CSV export unchanged (already capped at 5,000).
- [ ] **L.13** `GET /office/provider-accounts`: balances summed with `groupBy` in the database, no row loading.
  `packages`, `companies`, `offers`, `roles`: a cap constant each and `capped` in the answer; web shows nothing new
  unless `capped` is true (a one-line note, copy in ar/en/he).

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
