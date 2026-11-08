# Architecture refactor — plan

Status: **approved by owner 2026-11-08** — in progress. Evidence: audits summarised in `docs/architecture/frontend.md` and `docs/architecture/backend.md`.

## Goal

Put the existing code on a clear, layered structure so new features land in obvious places, and fix the defects that make the web app feel broken. Behaviour-preserving except where a slice says "fix".

## Non-goals

- New features or business-rule changes (they come after, as separate specs).
- Visual redesign. The Pearl look in `DESIGN.md` stays; only its implementation is unified.
- Changing endpoint paths or response shapes.

## Decisions needing approval

| ID | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Web data layer | **TanStack Query** | `use-load`/`use-paged`/`use-action` re-implement caching, invalidation, keep-previous and reconnect, with bugs. Query fixes stale balance, refetch storms, table flicker. |
| D2 | API input validation | **zod** schemas per route, via one `ZodPipe` | Bodies are hand-parsed `unknown`. zod gives types + validation in one place and can share schemas later; lighter than class-validator decorators. |
| D3 | Web styling method for primitives | **CSS on `--rd-*` tokens** (keep global sheets, move rules per component); drop Tailwind from `components/ui` | 3,800 lines of CSS already carry the system; Tailwind is used only in 4 files and pulls in alias tokens that contradict `DESIGN.md`. |
| D5 | Project reference graph | **graphify** knowledge graph (`graphify-out/`, scope in `.graphifyignore`) used before reading code; refreshed after each slice | Owner decision 2026-11-08. Gives call/import relationships across 228 files without re-reading them; complements the text codemaps. |
| D4 | Wallet concurrency | **atomic `increment` + conditional update** (or `SELECT … FOR UPDATE`) inside the tx | Fixes the lost-update / ceiling race in `move()`. |

Each approved decision gets an ADR in `docs/architecture/decisions/`.

## Phase 0 — Foundation (docs + baseline) ✅

- [x] `CLAUDE.md`, `docs/architecture/frontend.md`, `docs/architecture/backend.md`, README version fix.
- [x] 0.1 Slow specs: argon2 hashed once per file (`office/test-hash.ts`); suite 74 s → 29 s, 429/429. `3eba271`
- [x] 0.2 ADRs: `docs/architecture/decisions/0001`–`0005`.

## Phase 1 — Critical fixes (small, independent, high value) ✅

- [x] 1.1 Dialog focus jump: `onClose` read through a ref; effect depends on `open`. Test `tests/dialog-focus.spec.ts` (fails before, passes after). `5649ba8`
- [x] 1.2 Wallet race (D4): `SELECT … FOR UPDATE` in `move()`. `wallet-concurrency.db.spec.ts` on Postgres: before 950/1000 left after 10×50 (9 lost) and 15/15 past the ceiling; after 500 and 10/15. `4d5b03c`, `798e5af`
- [x] 1.3 Topbar balance: `useAction` refreshes `me` after every successful write. Test `tests/topbar-balance.spec.ts`. `53ae15b`
- [x] 1.4 Logout: revoke, then forget identity and `location.replace('/login')`; a failed revoke stays signed in. Test `tests/logout.spec.ts`. `ad473c7`
- [x] 1.5 `useLoad` stale record — dropped: not reproducible (App Router remounts on a new dynamic segment; checked with a Playwright test). Covered by ADR 0001.
- [x] 1.6 Provider sheet: untouched fields follow the server, typed ones keep their draft; numbers tab reads every cursor page. Test `tests/package-sheet-drafts.spec.ts`. `9dbbe67`

## Phase 2 — Backend kernel ✅ (2.3 moved to 3.0)

- [x] 2.1 `modules/shared/prisma.service.ts` (global `PrismaModule`): one client instead of five pools (office service, two ActivityRecorders, auth store, branding store). `9a97eec`
- [x] 2.2 `OfficeFailureFilter` + `ActivityInterceptor` + `@Activity(action, kind, subject)`; controller `run()` gone (78 routes), `@Res` only where cookies/stream need it. `147e6b4`
- [ ] 2.3 → **moved to Phase 3.0.** `actor()` is already one place called first in each method; a guard pays off only when service methods take the actor instead of the gate, which is the per-domain split. Converting 57 methods now would churn hundreds of spec calls for no behaviour gain.
- [x] 2.4 zod (D2): `parseInput()` in `modules/shared/input.ts`, run after `actor()` to keep 401 before 400; pilot `FundBody`/`CeilingBody`. `ZodPipe` arrives with the guard (3.0). `c100a46`
- [x] 2.5 Login-failure counter — already in Redis in `PrismaAuthStore` (`login-fail:<login>`, TTL window); the in-memory map is `MemoryAuthStore`, used by specs only. Audit claim was wrong; nothing to change.
- [x] 2.6 CI: a `postgres:16` service job that runs `prisma migrate deploy` and the `*.db.spec.ts` specs with `TEST_DATABASE_URL`. `.github/workflows/ci.yml`.

## Phase 3 — Backend domain split ✅ (spec: `docs/superpowers/specs/2026-11-08-office-domain-split.md`)

Strangler: one domain per slice under `modules/office/<domain>/`; `OfficeService` delegates moved methods so existing specs guard behaviour unchanged. **A domain with no HTTP spec gets one written against the old code first** (`<domain>.http.spec.ts` via `kernel/office-test-app.ts`), committed before the move.

- [x] 3.0 Kernel (`73afb76`): `kernel/office-kernel.ts` (prisma + spec override, auth, notices, actor, grantsFor, accounts, visibleAccount, visibleLine, branchActor, runTx, queueNotices, publishQuietly, actorName, move, recordOp); `ActorInterceptor` + `@Actor()`; `ZodPipe`. `OfficeService` keeps one-line delegators.
- [x] 3.1 notices: `notices/` — list, read, SSE stream. Characterized first (`notices.http.spec.ts`, `8eb99d2`), moved `b01a464`.
- [x] 3.2 audit: `audit/` — activity log. Characterized first (`audit.http.spec.ts`), moved `aa59664`; `OfficeService.audit` is a facade.
- [x] Route table `routes.http.spec.ts` (`9afb7ff`): all 79 office routes, method + path + activity event, 401 without a session. Seven routes answer 400 first (they judge body/cookie before the session) — recorded as they are; moving them behind `ActorInterceptor` changes 400→401 and needs the owner's decision (packages, users slices).
- [x] 3.3 tasks: `tasks/` — list, detail, notes, take, release, reject, cancel + openTask, taskNotice, handlerIds, noteLog. `4dfc0cb`. **`complete` stays in OfficeService until 3.9** (it applies the line operation). Lint now bans Jest's global `fail` outside specs.
- [x] 3.4 wallets: `wallets/` — wallets, fund, ceiling, ledger, finance, provider operations (+ `provider-cost.ts`). `GET /office/wallets` characterized first. `75ab132`. **`reports/:kind` stays in OfficeService** until lines move (it lists tasks and lines).
- [x] 3.5 providers + companies: `providers/` (list, settings, eSIM price, action mode) and `companies/` (shelf, SIM rules, image). 6 of 7 routes had no spec: `catalog.http.spec.ts` written first. `086564a`
- [x] 3.6 packages, in four commits:
  - `7fca6cd` **behaviour change (owner decision: 401 first)** — five price/terms writes ask for the session before judging the body; route table drops their rows.
  - `06bdd61` `packages/` — catalog list, sell prices, mode, sheet, chain, renewal/switch targets (`package-catalog.http.spec.ts` first).
  - `fb16f91` kernel gets `ladderRows`, `stampWith`, `PRICE_COLUMNS`.
  - `6058a9b` `terms/` — user packages, user ops, custom prices, line prices (+ `kernel/line-terms.ts`).
  - Found: `PATCH packages/:code/mode` checked the `edit` grant only — fixed afterwards (see follow-ups).
- [x] 3.7 users + roles + desk: `roles/` (list, save), `desk/` (me, home, announcements) `97266b6` and `accounts/` (list, directory, create, password, detail, access, freeze/restore, delete, enter) + `AccountSessionController` for `leave` (no ActorInterceptor). 10 of 13 routes had no spec: `accounts.http.spec.ts` and `desk.http.spec.ts` written first. `a9564fc`
- [x] 3.8 transfers: `transfers/` — account move, preview, line move; depends on `TermsService` for repricing. `visibleLine` and `saleOf` moved to the kernel first; the transfer spec's HTTP harness now mounts every office route (`a9cb759`). `c163c7c`
- [x] 3.9 lines: `lines/` — list, card, activate, every operation, disconnect quote, and task completion (depends on `TasksService`); `reports/` — branch reports over tasks and lines. **`OfficeController` deleted.** The carrier-switch stub now answers 401 first (same owner decision). `reports-lines.http.spec.ts` written first. `05e777c`
- [x] 3.10 catalog seed: `catalog/catalog-seed.ts` (`CatalogSeed.onModuleInit`, same skip rules). `55177eb`
- [x] 3.11 `OfficeService` left production: the `(gate, …)` adapters are a test-only `testing/office-facade.ts` (`OfficeFacade`, no Nest wiring); specs that took it from Nest take `OfficeKernel`. `c5d089f`
- [x] Boot check (2026-11-08): built API on fresh Postgres + Redis, trial seed on — 79 office routes mapped, catalog seeded (23 packages, layer roles), reads 200 for the branch, 401/403 where expected, and a write flow end to end: fund → eSIM activation task → take → complete → number active, point of sale charged 35 ₪, notices delivered, audit entries written.
- [x] 3.last Indexes (owner's go-ahead 2026-11-08): migration `20261108021907_lookup_indexes` — `User(parentId)`, `Line(status)`, `Line(packageId)`, `Line(iccid)`, `OfficeTask(assigneeId, status)`, `WalletEntry(kind, createdAt)`; additive only. The schema now states the delete rules the database already had (`Package.company` RESTRICT, `UserPackage` CASCADE), so `migrate diff` is empty. Subtree queries instead of `accounts()` stay a later proposal (measure first).

## Phase 4 — Web data layer ✅ (4.4c, 4.5c open)

- [x] 4.1 Errors carry their code end to end: `Fetched` has `code`, every `apiText(result)` translates by code first (`tests/error-codes.spec.ts`). `34d79ef`. `ApiFailure{status, code, message}` lives in `lib/query.tsx`; splitting `request()` into `lib/http.ts` goes with 4.3.
- [x] 4.2 `QueryProvider` + `queryKeys` + `unwrap()` (`lib/query.tsx`); `OfficeSession` runs `me` and `directory` as queries with its context unchanged; `refresh()` invalidates `me` (useAction already calls it after every write). Outage + failed-refresh specs (`tests/session-outage.spec.ts`). `b89afce`
- [x] 4.3 `lib/http.ts` (request machinery), `lib/api-types.ts` (shapes), `features/<domain>/api.ts` × 14 mirroring the API modules; `lib/api.ts` composes the same `api` object. `24b2d79`
- [x] 4.4a All eight paged lists at once: `usePaged` runs on `useInfiniteQuery` with the same contract — keep-previous rows on filter change, `reload` refetches every read chunk and invalidates the list's other filters, cache-then-revalidate on reopen, errors translated when drawn (`tests/list-cache.spec.ts`, fails on the old hook). `095162c`
- [x] 4.4b URL-synced filters: `lib/url-state.ts` (`useUrlFilters`, `useDebouncedField`) on numbers, tasks, users; back/forward, links and `/users?q=` from /users work (`tests/url-filters.spec.ts`, fails on the old pages). `7ead80c` + race fix `ef684b2`.
- [ ] 4.4c `/users` server paging (needs an API change: the list route returns everything today).
- [x] 4.5a `useApiQuery` (useLoad's shape over a cached query) + `sharedKeys` (packages, users, line). The line card reads the number, the catalog and the accounts as three queries; an action re-reads only the number. Numbers, tasks, packages and users read the same catalog/accounts entries. `ac3a279`
- [x] 4.5b Package sheet split into five cached reads; an action re-reads only the sheet, its numbers and its custom prices (`packageKeys`). Task, account (+ packages and ops tabs), providers and companies screens on `useApiQuery`/`sharedKeys`. `7aed7aa`
- [ ] 4.5c Remaining `useLoad`: home board, branding draft, roles, the staff-role and shelf dropdowns, the line-prices dialog (single reads, no storms; move when touched).
- [x] 4.6 Shell search reads the accounts once (shared users query) and filters locally; numbers stay a server search. `a969b86`

## Phase 5 — Web structure and design system (spec: `docs/superpowers/specs/2026-11-08-web-structure-design-system.md`)

- [x] 5.0 Web lint reports unused vars/imports (reuses the plugin Next registers); six fixed. `4eaa4d1`
- [x] 5.0b Unused `components/ui/table.tsx`, `ui/card.tsx` and their CSS removed (`.card`, `.data-table*`, `.card button`). `aff3fdf`
- [x] 5.1 `app/error.tsx` (Next 16 `retry`) and `app/not-found.tsx` (404), Pearl empty state + the way home, three languages. Route groups deliberately not added (see spec). `2fbe124`, centering fix `d03451c`; checked in the browser ar/en, light/dark, 390px.
- [x] 5.5a Closed drawer `inert`; Escape closes the topbar menus and returns focus; `RowMenu` keys by position. `2317498`
- [x] 5.3a Alias tokens removed; every use reads `--rd-*` (0 changed pixels, 4 screens × 2 themes). `28b4b4e`
- [x] 5.3b Radius and type scales (`--rd-radius-*`, `--rd-text-*`); 91 radius + 139 font-size literals (0 changed pixels, 6 screens × 2 themes). `03ab2b4`
- [x] 5.3c One solid focus ring for every keyboard-reachable control (shell buttons had none); `.nav-link.locked` contrast to AA. Browser-checked. `c7220f0`
- [ ] 5.3d Spacing, z-index, motion tokens (few literals each; do with 5.6).
- [x] 5.4a Tailwind removed: Button, Badge, Select, Pagination on `app/styles/ui.css` (declarations copied from Tailwind's output); `Button size="iconSm"`, `Select compact`; direction helpers `.only-rtl`/`.only-ltr`/`.flip-ltr`; `tailwind.config.ts`, `lib/utils.ts` (`cn`), `tailwindcss`, `tailwind-merge`, `clsx` gone. Badge rings fixed (were Tailwind's default blue). Pixel-identical otherwise: 29 screens × light ar / dark ar / light en via `tests/dom-snapshot.mjs` (now takes `THEME`/`LOCALE`). `01e4497`
- 5.4b One of each primitive (ADR 0003). Already single components on `--rd-*` CSS, no work: `Dialog`, `Toast`, `EmptyState`, `LiveSwitch`, `FilterBar`, `Stat`/`StatRow`, `Desk` (page frame + skeleton). What is left, one slice each:
  - [x] 5.4b-1 One popover engine: `lib/use-popover.ts` (outside press and Escape close, focus back to the button; a `menu` takes the focus on its first item and walks with ArrowUp/Down, Home, End) drives `RowMenu`, the account menu, the wallet pop, the notices panel and the language menu. Fixes: the row menu never focused its first item (the panel was still hidden), the account and language menus had no arrow keys, Escape on the language menu lost the focus. No markup change. `93e47fa`
  - [x] 5.4b-2 Status → badge tone in one map, `lib/status-tone.ts` (line, task, account, notice, on/off, package terms) plus `badgeClass(tone)` for the plain `.badge`; the two copies of `taskBadge`, `lineBadgeTone`/`lineBadgeClass` and every hand-written modifier go; `.badge.neutral` folds into `.badge.muted`. DOM of 29 screens unchanged. `0adc1c0`
  - [x] 5.4b-3 `components/alert.tsx`: the error / success line (`.error` + `role="alert"`, `.note` + `role="status"`, optional `banner`, nothing when empty) replaces the hand-written `<p>` on home, settings, login, password, two-factor, the eSIM QR, `PageAlert` and `Dialog`. Same markup. `eba07db`
  - 5.4b-4 One look per control. **Owner decided 2026-11-08** after a side-by-side (light/dark, ar/en): badge = `<Badge>` (small, tinted ring); buttons = `<Button>`, 8px corners everywhere (no pills in panes and dialogs); destructive = danger outline (DESIGN.md rule; `<Button variant="danger">` changes from filled red); select = `<Select>` (one chevron in every browser). Changes pixels on purpose; each sub-slice is browser-checked in ar + en, light + dark.
    - [x] 4a Component fixes first: `<Button>` drops the browser's 2px default border (primary, danger, ghost draw it today); `danger` becomes the outline; `<Select>` keeps its chevron room in the filter bar (`.desk .filter-panel select` resets `padding-inline-end`, so the chevron covers the text). Browser-checked: 29 screens × light ar / dark ar / light en differ only in page-head buttons (frame gone), filter selects (chevron clear of the text, fields a little wider) and the clear button; the disconnect dialog shows the outline danger in light and dark, hover included. `9493c55`
    - [x] 4b Every `.badge` span (14) → `<Badge variant={tone} dot>`; `badgeClass`, the `.badge` CSS and the dead `.task-facts .badge` rule go; context rules retargeted to `.ui-badge`. Screens: only the badges change (number card, package sheet, user terms checked). `3d76641`
    - [x] 4c Every native `<select>` (22, ten pages) → `<Select>`; its `className` moves to the wrapper (layout lives there), and `.data td .ui-select` is inline-block so a select in a table stays centred. Context rules keep sizing the field (no rule targets a select as a direct child). Screens checked: filter bars (light ar / dark ar / light en), the provider and package-sheet run modes; the user-page grant and role selects are covered by e2e only. `2f7e44c`
    - [x] 4d Of the 80 plain `<button>`s, the 19 action buttons (settings ×8, home announcement, password, two-factor, company / provider / package-sheet saves, the three retries, branding ×3) → `<Button>`; the not-found link takes `buttonClass()`. `Button` default 34px. Gone: `.btn`, `.btn-sm`, `form > button`, `.panel button`, `button.danger`, `.desk button.primary/.secondary`, `.field-row > button`, `.pane form > button`, `.canvas form > button` (the pill shape), `.dialog button.primary/.secondary/.danger`; the dialog's mobile 44px now targets `.ui-btn`. The other 61 are controls with their own look (tabs, seg, chips, tiles, cards, switch, menu items, shell icons) and stay. Screens: settings, home, packages, page heads (2px shorter), sign-in unchanged; `desk-system.spec` now pins `<Button>`'s 34px / 44px. `9e5b99c`
- [ ] 5.5b The remaining 27 lint warnings (mostly `set-state-in-effect`).
- [ ] 5.6 `desk.css` (~2050 lines) split next to its owners; `DESIGN.md` per slice.
- [ ] 5.2 Pages thin: `features/<domain>/screens/*`.

## Verification per slice

`npm run lint && npm run typecheck && npm run check:copy && npm run test:api && npm run build`; web slices also run the relevant Playwright specs and a browser check in ar + en, light + dark, desktop + 390px. Update the codemaps, run `graphify update .`, tick the box with the commit hash.

## Follow-ups found during the split (not done; each needs the owner's go-ahead)

- **Web lint:** `apps/web/eslint.config.mjs` does not report unused imports or variables (`@typescript-eslint/no-unused-vars`); nine dead `useLoad` imports went unnoticed in 4.5b. Turn it on in Phase 5.
- **API build:** `tsconfig.json` compiles `*.spec.ts` and test helpers into `dist`; a `tsconfig.build.json` excluding them keeps the image smaller.

- [x] **Security:** `PATCH /office/packages/:code/mode` let any account holding `edit` change package modes; no layer check. Default layer roles give `edit` to the branch only, so it opened only if the branch granted `edit` to an agent. Fixed with the same branch check as `setChain` (owner's go-ahead 2026-11-08); `package-catalog.http.spec.ts` now expects 403.

## After this plan

Improvement proposals (owner approves each): real worker jobs, office HTTP permission matrix tests, coverage gate, Prisma enums for status/kind/layer, observability.
