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

## Phase 3 — Backend domain split (one module per slice, tests green after each)

- [ ] 3.0 Kernel for the split: `ActorResolver` (from `actor()` + `grantsFor`), `ActorGuard` + `@Actor()` + `@RequireGrant()` / `@RequireLayer()`, `ZodPipe`. New domain controllers use them; their services take `Actor`, not `Gate`.

Order (least to most coupled): `notices` → `audit` → `tasks` → `wallets` (+finance, ledger, reports) → `providers` + `companies` → `packages` (+prices, user-packages) → `users` + `roles` → `transfers` → `lines` → `catalog-seed` (out of `onModuleInit`).
Each: `<domain>.controller.ts / .service.ts / .repository.ts / .schemas.ts / rules (existing pure files) / specs`. `office.service.ts` shrinks each slice until it is deleted.

- [ ] 3.x one checkbox per module as it lands.
- [ ] 3.last Migration: indexes (`Line.status/packageId/iccid`, `User.parentId`, `OfficeTask.assigneeId`, `WalletEntry.kind`); replace `accounts()` full scan with subtree queries.

## Phase 4 — Web data layer

- [ ] 4.1 `lib/http.ts`: `request()` + typed `ApiError{status, code, message}`; translate by code first. Keep `lib/api.ts` re-exporting.
- [ ] 4.2 Add `QueryClientProvider` (D1); move `me` + `directory` to queries; invalidate `me` after money mutations.
- [ ] 4.3 Split `lib/api.ts` into `features/<domain>/api.ts` (no behaviour change).
- [ ] 4.4 Pilot list: numbers — `useInfiniteQuery`, URL-synced filters (`lib/url-state.ts`), keep-previous rows. Then tasks, audit, finance, notices, provider-operations, users (server paging).
- [ ] 4.5 Detail pages: numbers/[id], tasks/[id], provider package sheet, users/[login] — keyed queries, per-mutation invalidation, form state separate from server state.
- [ ] 4.6 Shell search: dedicated query with debounce + cache, no full user list per keystroke.

## Phase 5 — Web structure and design system

- [ ] 5.1 Route groups `(auth)` / `(office)`; `error.tsx`, `loading.tsx`, `not-found.tsx`; server-side layer guard in `(office)/layout.tsx`; in-app links via `router`, not `location.assign`.
- [ ] 5.2 Pages become thin: `features/<domain>/screens/*`.
- [ ] 5.3 Tokens: add spacing, type, radius, z-index, motion scales; remove alias tokens (`--accent`, `--ink-*`, `--bg`).
- [ ] 5.4 Primitives (D3): Button/IconButton, Field/Input/Select/Checkbox/Switch, Dialog, Menu/Popover (one engine for RowMenu, topbar menus, wallet pop), Table (DataTable with `sortValue`), Badge (status→tone map), Alert/Toast, EmptyState, Skeleton, PageHeader/FilterBar/Pane. Delete dead `ui/table`, `ui/card`, `.data-table--stack`.
- [ ] 5.5 a11y: inert closed drawer, Escape + focus return on menus, unique keys. Then the remaining 31 lint warnings.
- [ ] 5.6 Move `desk.css` rules next to their feature/primitive; `DESIGN.md` updated per slice.

## Verification per slice

`npm run lint && npm run typecheck && npm run check:copy && npm run test:api && npm run build`; web slices also run the relevant Playwright specs and a browser check in ar + en, light + dark, desktop + 390px. Update the codemaps, run `graphify update .`, tick the box with the commit hash.

## After this plan

Improvement proposals (owner approves each): real worker jobs, office HTTP permission matrix tests, coverage gate, Prisma enums for status/kind/layer, observability.
