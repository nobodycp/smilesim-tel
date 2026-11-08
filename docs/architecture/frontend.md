# Frontend codemap — `apps/web`

Living map of the web app. Read this instead of re-reading `app/`, `components/`, `lib/`. **Update it in the same commit** whenever a route, shared component, hook, or data flow changes (see `CLAUDE.md` → "Keep the maps current"). The Excalidraw boards in this folder are the visual companion.

Last verified: 2026-11-08 (branch `refactor/phase-1`, after Phase 5.4a). e2e 110/110 · tsc 0 errors · lint 0 errors / 27 warnings (unused vars are reported) · `check:copy` ok (583 keys × 3 languages).

## Stack

Next.js 16 (App Router) · React 19 · plain CSS on `--rd-*` tokens (`app/styles/*.css`, no Tailwind) · TanStack Query · lucide-react · Playwright (e2e on a mock API, `tests/mock-api.mjs`).

## Request path

1. `proxy.ts` — `doorFromHost` (`lib/doors.ts`) → sets `x-door` header + CSP nonce.
2. `app/layout.tsx` — resolves the door again; bare host → `<Doors>` picker; else `DoorProvider` → `OfficeSession` → `OfficeFrame` (shell).
3. Pages — 26 of 27 are `'use client'` and fetch after mount. Layer guard is client-side `useRequireLayer` (redirect after mount).
4. `lib/http.ts` `request()` (called by `features/*/api.ts`) reads the door from `window.location`, sends cookie `sid` + `x-door`; 401/door mismatch → `window.location.assign('/login')` (hard reload).

## Folders

| Path | Holds |
|---|---|
| `app/error.tsx`, `app/not-found.tsx` | page error (retry + home) and 404, inside the shell |
| `app/<route>/page.tsx` | flat routes: numbers, numbers/[id], tasks, tasks/[id], users, users/[login], packages, providers, providers/[code], providers/[code]/[packageCode], companies, companies/[code], finance, reports, audit, notices, roles, settings, branding, operations, provider-operations, login, password, two-factor |
| `features/<domain>/api.ts` | one call group per API module (auth, branding, desk, wallets, catalog, terms, lines, transfers, notices, tasks, accounts, roles, audit, reports) |
| `app/styles/*.css` | global CSS in cascade order via `globals.css` (see `DESIGN.md` → Stylesheets). `desk.css` ~2070 lines, `shell.css` ~690 |
| `components/` | shell (`office-shell`, `office-frame`, `shell-search`, `chrome`), `dialog`, `row-menu`, `data-table` (DataTable + PagedTable — the live table), `desk` (page frame), domain dialogs (`transfer-dialog`, `line-prices-dialog`, `disconnect-confirm`) |
| `components/ui/` | primitives `button`, `badge`, `select`, `pagination`, styled by `app/styles/ui.css` (no Tailwind since 5.4a, ADR 0003) |
| `lib/` | `api.ts` (composes `api` from `features/*/api.ts`, re-exports `api-types.ts`), `http.ts` (`request`, door header, session redirect), `query.tsx` (TanStack provider, `queryKeys`, `unwrap`, `ApiFailure`), hooks (`use-load`, `use-paged`, `use-action`, `use-notices`, `use-require-layer`), contexts (`office-session`, `door-context`, `prefs`, `branding`), `connection.ts` (reachability store; `generation` triggers refetch), `copy/{ar,en,he}.ts` (flat `t` objects), helpers (`money`, `names`, `grants`, `sim-rules`, `ops`) |

## State and data

- **Server state:** TanStack Query (`lib/query.tsx`: `QueryProvider`, `queryKeys`, `unwrap()`, `ApiFailure`), ADR 0001. Wraps the office doors in `app/layout.tsx`.
- **Session:** `OfficeSession` runs `queryKeys.me` (read once, `staleTime: Infinity`; own 2–30 s backoff while the API is away, 4xx final) and `queryKeys.directory`. Same context as before (`ready`, `failed`, `retrying`, `retry`, `refresh`, `me`, `names`); once `me` answered the page stays drawn. Name/balance cookies seed the shell for SSR. `refresh()` invalidates `me`; `useAction` calls it after every successful write.
- **Fetching:** `usePaged` (cursor lists) runs on `useInfiniteQuery`, key `['paged', pathname, key]`: keep-previous rows (`stale`), `reload()` invalidates every filter of that list, always revalidated, errors translated when drawn. `useApiQuery(key, fetcher)` (`lib/use-api-query.ts`) is `useLoad`'s shape over a cached query; `sharedKeys` in `lib/query.tsx` (`packages`, `users`, `line(id)`) are read by the line card, numbers, tasks, packages, users and the shell search. `packageKeys(code)` group a package sheet's own reads (an action invalidates `packageKeys.all`). `useLoad` remains only on single reads: home board, branding draft, roles, two dropdowns, the line-prices dialog. `useAction` (mutation + `onDone` reload + `me` refresh). Each page owns its error/note `useState`.
- **Prefs:** locale, theme, page size via `useSyncExternalStore` over `document.cookie`.
- **i18n:** API errors are translated by **code** first, then by the Arabic message (`apiText(result)`; `Fetched` carries `code`). Still open: a hook stores the translated text, so an error on screen keeps its language after a locale switch (goes away as lists move to queries).
- **URL state:** `lib/url-state.ts` — `useUrlFilters(keys)` keeps a list's filters in the query string (`router.replace`, scroll kept, each write builds on the last pending one); `useDebouncedField` keeps typing local and commits after 300 ms. Used by numbers, tasks, users.

## Design system

Tokens in `app/styles/tokens.css`: `--rd-*` colours/shadows for both themes, `--rd-primary-soft`, `--rd-login-*`, and theme-independent scales `--rd-radius-{xs,sm,md,card,panel,pill,lg}` and `--rd-text-{2xs…2xl}`. The hotspot alias set is gone (5.3a). No spacing / z-index / motion scales yet. Rules: `DESIGN.md`, `.cursor/rules/pearl-ui.mdc`, `direction-theme.mdc`, `content-ui.mdc`, `screen-size.mdc`.

## Known defects (audit 2026-11-08, fix plan in `docs/superpowers/plans/2026-11-08-architecture-refactor.md`)

1. ~~Dialog focus jumps on every keystroke~~ — fixed `5649ba8` (`onClose` via ref).
2. ~~Topbar balance stale after money ops~~ — fixed `53ae15b` (`useAction` refreshes `me`; interim until ADR 0001).
3. ~~Provider sheet overwrote drafts / read one page of lines~~ — fixed `9dbbe67` (`follow()` per field, `packageLines()` reads all pages).
4. ~~`lib/use-load.ts` keeps the previous record after a param change~~ — not reproducible: App Router remounts a page when its dynamic segment changes, and the only in-component deps (`line-prices-dialog`) mount per opening. Theoretical only; goes away with ADR 0001.
5. ~~Refetch storms~~ — line card re-reads only the number after an action (`ac3a279`); shell search reads accounts once (`a969b86`). The package sheet re-reads only its own three reads (`7aed7aa`).
6. ~~Paged tables blank on mutation/filter change~~ — fixed `095162c` (infinite query, keep-previous, refetch every read chunk).
7. ~~Logout relied on a 401 side effect~~ — fixed `ad473c7`. Still open: several in-app links do full reloads (`office-shell.tsx` notices/leave, `users` enter).
8. ~~No `error.tsx` / `not-found.tsx`~~ — added (5.1). No `loading.tsx`: pages show their own skeletons.
9. ~~a11y: closed drawer focusable, topbar menus no Escape, `RowMenu` keys by label~~ — fixed (5.5a). Focus rings and `.nav-link.locked` contrast fixed (5.3c).
10. `/users` unpaged, client-side filtering; `DataTable` sorts by rendering cells.

## Target shape

```
app/(auth)/…               login, password, two-factor
app/(office)/layout.tsx    shell + server-side layer guard + error.tsx/loading.tsx
app/(office)/<route>/page.tsx   thin → features/<domain>/screens/*
features/<domain>/         api.ts · queries.ts · components/ · screens/
components/ui/             primitives only, one styling method
components/shell/          sidebar, topbar, drawer, search, wallet, notices
lib/http.ts                request(), door header, ApiError{status,code,message}
lib/i18n/                  copy + translate by code first
lib/url-state.ts           search-param backed filters
```
Data layer: TanStack Query (ADR 0001) — session done; pages next.
