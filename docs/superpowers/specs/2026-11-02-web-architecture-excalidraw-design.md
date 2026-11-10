# Web architecture maps (Excalidraw) — design

## Why

The office frontend (`apps/web`) is a Next.js app with four doors, nested providers, a shared
shell, many desk pages, and a thin API client. Without a visual map it is hard to place a bug
(which layer owns the state?), see how files relate, or onboard against the real tree.

This slice documents the **frontend only**, as two Excalidraw boards that open in the Cursor
Excalidraw extension: every source file with a one-line role, plus the live state and data paths
used when debugging.

## Goal

Ship two checked-in Excalidraw files under `docs/architecture/`:

1. `web-components-tree.excalidraw` — containment tree + **every** `apps/web` source file and its
   role (grouped by folder, colour-coded).
2. `web-state-dataflow.excalidraw` — boot, contexts, page hooks → `api.ts` → backend, error and
   identity paths (arrows only for live data, not a second file dump).

A short `docs/architecture/README.md` points at both files and how to open them in Cursor.

## Non-goals

- No backend / Prisma / worker maps in this slice (later specs).
- No Madge auto-layout as the delivered diagram (optional later as a checklist only).
- No in-app architecture page, no Canvas artifact, no change to runtime code or styles.
- No test configs, Playwright specs, `.next*` / build-output, or `node_modules` on the boards.
- Not a substitute for `DESIGN.md` or the UI rules — these maps explain structure and flow, not
  visual craft.

## Decisions

**D1 — Delivery.** Native `.excalidraw` JSON in the repo, opened via the Cursor Excalidraw
extension. No PNG-only handoff; the editable source is the source of truth.

**D2 — Two boards, not one.** Board 1 = files + roles + containment. Board 2 = state/data/error
flow. Mixing both makes neither readable.

**D3 — Full file inventory on Board 1.** Every maintained source file under `apps/web` (approx. 75
files: `app/`, `components/`, `lib/`, root config used at runtime) appears with a short role line.
Grouping is by folder/zone; nodes are not collapsed into “pages” without naming each `page.tsx`.

**D4 — Language on the boards.** Diagram labels and role lines are **Arabic** (operator-facing
reference). Paths and identifiers stay English as in the repo. This spec and the plan stay English.

**D5 — Update discipline.** When a frontend file is added, removed, or its responsibility shifts,
the matching board is updated in the same change set (or an immediate follow-up). No automation
gate in this slice.

**D6 — Priority fit.** Structure/relations first (Board 1), then error-capable flow (Board 2),
usable daily beside the editor (Excalidraw in Cursor). Matches the agreed B → A → C order.

## Board 1 — Components tree + file roles

**Path:** `docs/architecture/web-components-tree.excalidraw`

### Layout

Four colour zones, left-to-right (or top-to-bottom if the board is taller), linked by containment
arrows from parent to child:

| Zone | Colour meaning | Contents |
|---|---|---|
| Root | Neutral ink | `layout.tsx`, home/door entry, `proxy.ts`, `globals.css`, `tailwind.config.ts` |
| `app/` | Pages | Every route `page.tsx`, nested dynamic routes, `app/styles/*` |
| `components/` | UI building blocks | Shell, desk, tables, dialogs, chrome, `ui/*` |
| `lib/` | Data & prefs | API client, contexts, hooks, copy, doors, grants, identity, utils |

Legend on the board: folder colour → zone. Each node: **filename** + one Arabic role sentence.

### File role catalogue (source of truth for labels)

Roles below are the text that must appear on Board 1 (Arabic on the diagram; English here for the
spec). Implementation may shorten visually but must not drop a file.

#### Root / entry

| File | Role |
|---|---|
| `app/layout.tsx` | Root layout: fonts, door from host, seeds Preferences / Toasts / Door / OfficeSession |
| `app/page.tsx` | Home desk when a door is active (stats / shortcuts / panes) |
| `app/globals.css` | Imports the `app/styles/*` sheets only |
| `proxy.ts` | Per-request CSP nonce, door-aware edge behaviour |
| `tailwind.config.ts` | Tailwind `darkMode: class` and theme wiring |
| `app/icon.svg` | App favicon / icon asset |

#### Auth & account routes

| File | Role |
|---|---|
| `app/login/page.tsx` | Door login form |
| `app/password/page.tsx` | Forced / change password step |
| `app/two-factor/page.tsx` | 2FA enroll or code step |
| `app/settings/page.tsx` | Account settings desk |

#### Desk routes

| File | Role |
|---|---|
| `app/users/page.tsx` | Users list desk |
| `app/users/[login]/page.tsx` | Single user detail / operations |
| `app/roles/page.tsx` | Roles and grants desk |
| `app/providers/page.tsx` | Providers list |
| `app/providers/[code]/page.tsx` | Provider detail |
| `app/providers/[code]/[packageCode]/page.tsx` | Package under a provider |
| `app/companies/page.tsx` | Companies list |
| `app/companies/[code]/page.tsx` | Company detail |
| `app/companies/[code]/[provider]/page.tsx` | Company × provider slice |
| `app/packages/page.tsx` | Packages desk |
| `app/numbers/page.tsx` | Numbers / SIMs list |
| `app/numbers/[id]/page.tsx` | Single number line operations |
| `app/tasks/page.tsx` | Tasks desk |
| `app/operations/page.tsx` | Operations desk |
| `app/accounting/page.tsx` | Accounting desk |
| `app/reports/page.tsx` | Reports index |
| `app/reports/[kind]/page.tsx` | One report kind |
| `app/audit/page.tsx` | Audit log desk |

#### Styles

| File | Role |
|---|---|
| `app/styles/tokens.css` | `--rd-*` / mapped design tokens, light and dark |
| `app/styles/base.css` | Document base, typography, shared resets |
| `app/styles/shell.css` | Topbar, sidebar, drawer, shell chrome |
| `app/styles/desk.css` | Desk / pane / table / filter surfaces |
| `app/styles/forms.css` | Form fields and labels |
| `app/styles/controls.css` | Shared controls |
| `app/styles/dialog.css` | Dialog overlay and body |
| `app/styles/auth.css` | Login / auth room |
| `app/styles/doors.css` | Door picker page |
| `app/styles/responsive.css` | Breakpoints and dense layouts |

#### Components — shell & chrome

| File | Role |
|---|---|
| `components/bootstrap.tsx` | Inline first-paint script: locale/theme/identity cookie sync |
| `components/preferences.tsx` | Client prefs seed + apply locale/theme to `html` |
| `components/doors.tsx` | Host has no door: picker of the four office doors |
| `components/office-shell.tsx` | Authenticated chrome: nav, wallet, notices, account menu |
| `components/desk.tsx` | Page wrapper: shell + identity + shared desk helpers |
| `components/chrome.tsx` | Theme toggle and language switch |
| `components/shell-search.tsx` | Global search in the topbar |
| `components/auth-frame.tsx` | Layout frame for login / password / 2FA |
| `components/back-link.tsx` | Direction-aware back control |
| `components/icon.tsx` | Named SVG icons for shell/nav |
| `components/stat.tsx` | Home KPI tile |
| `components/toast.tsx` | Toast provider and stack |
| `components/loading.tsx` | Spinner and page/table skeletons |
| `components/empty-state.tsx` | Empty pane placeholder |
| `components/names.ts` | Map API codes to copy labels (layers, statuses) |
| `components/line-actions.ts` | Shared number-line write actions for desks |

#### Components — desk patterns

| File | Role |
|---|---|
| `components/filter-bar.tsx` | Filter bar / panel chrome above tables |
| `components/data-table.tsx` | Sortable columns, paging hook-up, empty/skeleton |
| `components/table-search.tsx` | Inline table search field |
| `components/period-chips.tsx` | Date period quick filters |
| `components/load-more.tsx` | Cursor “load more” row |
| `components/row-menu.tsx` | Per-row actions menu (only row trigger) |
| `components/dialog.tsx` | Modal dialog (confirm / form / wide) |

#### Components — `ui/` primitives

| File | Role |
|---|---|
| `components/ui/button.tsx` | Button variants and sizes |
| `components/ui/badge.tsx` | Status / tone badge |
| `components/ui/card.tsx` | Card surface wrapper |
| `components/ui/select.tsx` | Select control |
| `components/ui/table.tsx` | Table primitive + empty wrapping |
| `components/ui/pagination.tsx` | Page size and page controls |

#### Lib

| File | Role |
|---|---|
| `lib/api.ts` | Typed fetch client: session cookie, `x-door`, result/error `code` |
| `lib/doors.ts` | Door host ↔ layer catalogue |
| `lib/door-context.tsx` | React context for the active door |
| `lib/office-session.tsx` | Loads `/office/me`, exposes `me` / ready (skips auth paths) |
| `lib/prefs.tsx` | Locale, theme, page size, `t` / `apiText` |
| `lib/document-prefs.ts` | Cookie/localStorage keys and parsers for prefs |
| `lib/identity.ts` | Remembered account name / balance for shell flash |
| `lib/copy/index.ts` | Locale table entry + `translateApi` |
| `lib/copy/ar.ts` | Arabic copy source of truth |
| `lib/copy/en.ts` | English copy |
| `lib/copy/he.ts` | Hebrew copy |
| `lib/grants.ts` | Grant code list and labels |
| `lib/company-mark.ts` | Company mark letters, colour, logo shrink |
| `lib/use-load.ts` | One-shot / dependency-driven fetch hook |
| `lib/use-paged.ts` | Cursor-paged list hook |
| `lib/use-action.ts` | Write action with busy + error wiring |
| `lib/use-require-layer.ts` | Redirect when door layer is not allowed |
| `lib/utils.ts` | `cn()` class merge helper |

## Board 2 — State and data flow

**Path:** `docs/architecture/web-state-dataflow.excalidraw`

### Layout (five bands)

1. **Request boot** — Host → `doorFromHost` → door present? → `DoorProvider` + `OfficeSession` else
   `Doors`. Parallel: `Bootstrap` + cookies/localStorage → `Preferences` / `prefs`.
2. **Contexts** — Prefs · Door · OfficeSession · Toasts (what each holds; who consumes).
3. **Page I/O** — Page → `useLoad` / `usePaged` / `useAction` → `api.ts` → `/api` + `x-door` +
   session cookie.
4. **Error path** — Network / API `code` → `apiText` or toast → `LOGIN_REQUIRED` /
   `DOOR_MISMATCH` → `/login`.
5. **Shell identity** — `OfficeSession` ↔ `identity.ts` ↔ name/balance cookies ↔ `OfficeShell`.

Side boxes (no dense arrows): `grants`, `copy`, `utils`, `document-prefs` as supporting libs.

## README

`docs/architecture/README.md` lists the two files, says to open them with the Excalidraw
extension, and points to this spec for the catalogue and update rule (D5).

## Verification

- Both `.excalidraw` files open in Cursor Excalidraw without repair.
- Board 1 node set matches the catalogue above (no missing source file from the maintained set).
- Board 2 shows the five bands and the session-ending error path explicitly.
- No runtime app files change in this slice.

## Outcome

Operators and agents can open two boards beside the code: one answers “where does this file sit
and what is it for?”, the other answers “where does state move, and where do errors surface?”.
Backend maps remain a later slice.
