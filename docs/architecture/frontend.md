# Frontend codemap — `apps/web`

Living map of the web app. Read this instead of re-reading `app/`, `components/`, `lib/`. **Update it in the same commit** whenever a route, shared component, hook, or data flow changes (see `CLAUDE.md` → "Keep the maps current"). The Excalidraw boards in this folder are the visual companion.

Last verified: 2026-11-08 (commit `75cbcaf`). tsc 0 errors · lint 0 errors / 31 warnings · `check:copy` ok (583 keys × 3 languages).

## Stack

Next.js 16 (App Router) · React 19 · Tailwind 3 (preflight off, used only in `components/ui/*`) · lucide-react · Playwright (e2e on a mock API, `tests/mock-api.mjs`).

## Request path

1. `proxy.ts` — `doorFromHost` (`lib/doors.ts`) → sets `x-door` header + CSP nonce.
2. `app/layout.tsx` — resolves the door again; bare host → `<Doors>` picker; else `DoorProvider` → `OfficeSession` → `OfficeFrame` (shell).
3. Pages — 26 of 27 are `'use client'` and fetch after mount. Layer guard is client-side `useRequireLayer` (redirect after mount).
4. `lib/api.ts` (~700 lines, every endpoint + types) — `request()` reads the door from `window.location`, sends cookie `sid` + `x-door`; 401/door mismatch → `window.location.assign('/login')` (hard reload).

## Folders

| Path | Holds |
|---|---|
| `app/<route>/page.tsx` | flat routes: numbers, numbers/[id], tasks, tasks/[id], users, users/[login], packages, providers, providers/[code], providers/[code]/[packageCode], companies, companies/[code], finance, reports, audit, notices, roles, settings, branding, operations, provider-operations, login, password, two-factor |
| `app/styles/*.css` | global CSS in cascade order via `globals.css` (see `DESIGN.md` → Stylesheets). `desk.css` ~2070 lines, `shell.css` ~690 |
| `components/` | shell (`office-shell`, `office-frame`, `shell-search`, `chrome`), `dialog`, `row-menu`, `data-table` (DataTable + PagedTable — the live table), `desk` (page frame), domain dialogs (`transfer-dialog`, `line-prices-dialog`, `disconnect-confirm`) |
| `components/ui/` | Tailwind primitives: `button`, `badge`, `select`, `pagination` (live); `table`, `card` (**dead, 0 importers**) |
| `lib/` | `api.ts`, hooks (`use-load`, `use-paged`, `use-action`, `use-notices`, `use-require-layer`), contexts (`office-session`, `door-context`, `prefs`, `branding`), `connection.ts` (reachability store; `generation` triggers refetch), `copy/{ar,en,he}.ts` (flat `t` objects), helpers (`money`, `names`, `grants`, `sim-rules`, `ops`) |

## State and data

- **Session:** `OfficeSession` fetches `/office/me` once (backoff), then `/office/directory`. Name/balance cookies seed the shell for SSR. `refresh()` only called from settings → topbar balance goes stale after money ops.
- **Fetching:** `useLoad` (single resource), `usePaged` (cursor book), `useAction` (mutation + reload). No shared cache, no keep-previous, no invalidation; each page owns error/note `useState`.
- **Prefs:** locale, theme, page size via `useSyncExternalStore` over `document.cookie`.
- **i18n:** API errors are translated from the Arabic **message** (the `code` is dropped in `Fetched`).
- **URL state:** filters read once from `?status`/`?q` on mount, never written back.

## Design system

Tokens in `app/styles/tokens.css` (`--rd-*` colours/shadows/one radius + undocumented `--rd-login-*` + an alias set `--accent`/`--ink-*`/`--bg` used by Tailwind config). **Trap:** `--accent` = ink, `--rd-accent` = logo red. No spacing / type / radius / z-index scales yet. Rules: `DESIGN.md`, `.cursor/rules/pearl-ui.mdc`, `direction-theme.mdc`, `content-ui.mdc`, `screen-size.mdc`.

## Known defects (audit 2026-11-08, fix plan in `docs/superpowers/plans/2026-11-08-architecture-refactor.md`)

1. `components/dialog.tsx:108` effect depends on `onClose` → focus jumps on every keystroke in dialogs with inline `onClose`.
2. Topbar balance stale after fund/charge/activate (`lib/office-session.tsx`).
3. `providers/[code]/[packageCode]/page.tsx:125` reload overwrites unsaved drafts; `:76` uses first cursor page only.
4. `lib/use-load.ts:46-64` keeps the previous record after a param change.
5. Refetch storms (`numbers/[id]` action reload, shell search loads all users per keystroke).
6. Paged tables blank on mutation/filter change (`data-table.tsx:244`, `use-paged.ts:86`).
7. Logout relies on a 401 side effect (`office-shell.tsx:138`); several in-app links do full reloads.
8. No `error.tsx` / `loading.tsx` / `not-found.tsx`.
9. a11y: closed drawer focusable, topbar menus no Escape, `RowMenu` keys by label.
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
Data layer: TanStack Query (pending owner approval — see plan, decision D1).
