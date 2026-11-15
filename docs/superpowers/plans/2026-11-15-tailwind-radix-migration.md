# Plan — Tailwind CSS v4 + owned Radix components (code maintenance, no visual verification)

Spec: `docs/superpowers/specs/2026-11-15-tailwind-radix-migration.md` · Decision: ADR 0022 · Branch: `ui-maintenance`
(continues from `4053432`/`a74cf51`; the 2026-11-13 plan is superseded from P1.3 on).

## Status

| Phase | Slices | State |
|---|---|---|
| T0 Decision docs | T0.1 | in progress |
| T1 Foundation | T1.1–T1.4 | not started |
| T2 Primitives (`components/ui`) | T2.1–T2.9 | not started |
| T3 Shell and frames | T3.1–T3.3 | not started |
| T4 Screens | T4.1–T4.10 | not started |
| T5 Delete legacy CSS | T5.1–T5.2 | not started |
| T6 New identity (after owner approval) | T6.1–T6.3 | blocked on the identity approval |
| T7 Docs final | T7.1 | not started |

## Protocol (binding)

1. One slice at a time, in order, on `ui-maintenance`. A slice touches only the files it names (plus its tests and the
   docs it must update). If it needs another file, it names it in its notes and the reviewer checks why.
2. Executor: re-read the slice, the files and their callers; make the change; keep behaviour, routes, copy keys, data
   flow and accessible names; run **CHK**: `npm run lint`, `npm run typecheck`, `npm run check:copy` and, from T1.2 on,
   `npm run check:styles`; update `docs/architecture/frontend.md` ("Last verified") when a shared component, hook or
   data flow changes; stage only the slice's files; give the commit message (`<type>(web): … (Tailwind migration Tn.m)`).
3. No visual verification (owner, 2026-11-15): no screenshots, no browser measurement, no dom-snapshot, no
   visual-audit runner. The app on port 3000 is not needed.
4. One reviewer (a different model from the executor) reads `git diff --cached` and the callers: lost or renamed props,
   changed behaviour (handlers, conditions, effects, keys), removed roles or accessible names, physical-direction
   utilities, raw colours or arbitrary values that should be tokens, a styling class used by a test, a legacy class left
   behind in the slice's files, docs not updated. Blocker and major defects go back to a fixer (at most two rounds);
   a minor defect is fixed in the same round if trivial, otherwise listed in the commit body as known.
5. Commit clerk commits the slice with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (added by
   `git commit --trailer`), then records the hash in this file's slice heading and Status row (`docs(plan): record …`).
6. Never push, never merge, never touch `docs/client/` or `apps/api/`, never edit `apps/api/src/generated/`, no local
   build, Docker build, e2e or full test:api. The owner pushes; CI runs e2e and the build.
7. A slice that cannot keep behaviour, or needs an owner choice, stops and is parked (its diff saved to
   `apps/web/audit-output/tailwind/<slice>/parked.patch`, tree restored); the run continues with the next slice that
   does not depend on it.

## Conventions every slice follows

- Utilities: logical only (`ms/me/ps/pe/start/end/text-start/text-end`, `border-s/e`, `rounded-s/e`). Colours, radii,
  font sizes and spacing come from `@theme` tokens (`bg-surface`, `text-ink-2`, `rounded-control`…), not arbitrary
  values. Dark mode uses the `dark:` variant bound to the same selector the current tokens use.
- Variants in `cva` inside `components/ui/*`; screens compose components and layout utilities only.
- Radix only inside `components/ui/*`. `DirectionProvider` with the document's `dir` wraps the app once (T1.1).
- Tests: role / label / text / `data-testid`. A component that has no stable accessible handle gets a `data-testid`.
- Legacy classes: when a slice ports a component, the legacy class names that component used are removed from its
  markup; the CSS rules for them die in T5 (or earlier, in the slice, if the slice owns the whole rule block and no other
  file uses the class — check with `rg`).

## T0 Decision docs

### T0.1 ADR 0022, this spec and plan, old plan superseded

- Files: `docs/architecture/decisions/0022-tailwind-v4-and-radix-components.md` (new), this plan and its spec (new),
  `docs/superpowers/plans/2026-11-13-ui-maintenance.md` (Status: superseded from P1.3, pointer to this plan).
- Commit: `docs: Tailwind v4 + Radix migration decision, spec and plan (ADR 0022)`.

## T1 Foundation

### T1.1 Tailwind v4 next to the legacy sheets

- Files: `apps/web/package.json`, root `package-lock.json`, `apps/web/postcss.config.js`, `apps/web/app/tailwind.css`
  (new), `apps/web/app/globals.css`, `apps/web/app/layout.tsx`, `apps/web/components/ui/direction.tsx` (new),
  `docs/architecture/frontend.md`.
- Steps: add `tailwindcss` and `@tailwindcss/postcss` (exact versions, each released ≥14 days ago; keep autoprefixer
  only if still needed). `app/tailwind.css`: `@layer theme, base, legacy, components, utilities;`,
  `@import "tailwindcss";`, a `@theme` block that maps every `--rd-*` token in `styles/tokens.css` to Tailwind names
  (colours `--color-*`, radii `--radius-*`, text `--text-*`, spacing, the breakpoint scale `--breakpoint-*`), the dark
  overrides on the selector `tokens.css` uses, and `@custom-variant dark (…)` on that same selector. `globals.css`
  imports every legacy sheet with `layer(legacy)` in its current order, after `tailwind.css`. Disable Tailwind's
  preflight if it changes the legacy base (import `tailwindcss/theme` and `tailwindcss/utilities` only) and say so in
  frontend.md. A `DirectionProvider` from `radix-ui` reads `dir` from the document in `layout.tsx`.
- Done when: CHK passes; no screen file changes; `rg -n "@import" app/globals.css` shows every legacy sheet in
  `layer(legacy)`.

### T1.2 Class helper, variants and the style check

- Files: `apps/web/lib/cn.ts` (new), `apps/web/package.json` (`clsx`, `tailwind-merge`, `class-variance-authority`,
  script `check:styles`), root `package.json` (alias `check:styles`), `apps/web/scripts/check-styles.mjs` (new),
  `.github/workflows/ci.yml` (run `npm run check:styles` after check:copy), `docs/architecture/frontend.md`.
- Steps: `cn(...inputs)` = `twMerge(clsx(inputs))`, `tailwind-merge` configured for the custom token names.
  `check-styles.mjs` scans `app/`, `components/`, `features/` `.tsx/.ts` for: physical-direction utilities
  (`ml-|mr-|pl-|pr-|left-|right-|text-left|text-right|border-l|border-r|rounded-l|rounded-r` as class tokens),
  arbitrary colour values (`-[#`, `-[rgb`, `-[hsl`, `-[oklch`), inline `style={{ color|background… }}` literals, and new
  `.css` files outside `app/tailwind.css` and the legacy list (frozen list in the script). It exits 1 with file:line.
  `--self-test` proves each rule.
- Done when: CHK and `check:styles` pass on the tree (the legacy sheets are on the frozen list).

### T1.3 Tests select by role, label or test id (three slices)

- T1.3a specs `account-head` … `finance-head` (alphabetical, 18 files); T1.3b `home-overview` … `profits` (18 files);
  T1.3c `provider-accounts` … `users-desk` (rest), plus `tests/desk.ts`.
- Files: those `apps/web/tests/*.spec.ts` files, and the components that gain a `data-testid` (each named in the slice
  notes).
- Steps: every `locator('.<class>…')` / `locator('<tag>.<class>')` that targets a styling class becomes `getByRole`,
  `getByLabel`, `getByText` or `getByTestId`. Assertions, flows and fixtures do not change. Where a test asserts a
  computed style (colour, size) on a class, keep the assertion and change only how it finds the element.
- Done when: CHK passes; `rg -n "locator\\(['\"\`][^'\"\`]*\\.[a-z]" apps/web/tests` lists only selectors that are not
  styling classes (each justified in notes).

### T1.4 Freeze the P1.1 CSS guard

- Files: `apps/web/scripts/check-css.mjs`, `apps/web/scripts/css-baseline.json`, `apps/web/package.json`,
  `docs/architecture/frontend.md`.
- Steps: the guard keeps failing on growth of legacy CSS and accepts shrinkage (re-baseline on shrink only); the
  dom-snapshot cases from P1.1 stay in the tree, unused by this plan.
- Done when: CHK passes; deleting a legacy rule does not fail the guard.

## T2 Primitives (`components/ui`)

Each primitive keeps the current public API of the component it replaces (props, names), or its slice updates every
caller in the same commit.

### T2.1 Button and IconButton

- Files: `components/ui/button.tsx`, `components/ui/icon-button.tsx` (new), every caller using `.ui-btn*` /
  `.icon-btn` classes directly (list from `rg -l "ui-btn|icon-btn" apps/web`).
- Variants: primary (crimson fill, `--rd-accent-fill`), secondary, ghost, danger (outline), link; sizes sm/md;
  `asChild` via Radix `Slot`; pressed (`aria-pressed`), loading, disabled. D2/D8/D13/D14/D19 hold.

### T2.2 Fields

- Files: `components/ui/input.tsx`, `components/ui/textarea.tsx`, `components/ui/label.tsx`, `components/ui/field.tsx`
  (label + control + help + error, ids wired), `components/price-field.tsx`, `components/name-field.tsx`,
  `components/table-search.tsx`, and callers using `.field*`/`.input*` classes in `app/styles/forms.css`/`controls.css`.

### T2.3 Choice controls

- Files: `components/ui/checkbox.tsx`, `components/ui/radio-group.tsx`, `components/ui/switch.tsx`,
  `components/ui/segmented.tsx` (new, Radix ToggleGroup), `components/live-switch.tsx`, `components/mode-cards.tsx`,
  and their callers.

### T2.4 Select and menus

- Files: `components/ui/select.tsx` (Radix Select), `components/ui/dropdown-menu.tsx` (new), `components/row-menu.tsx`,
  callers of both.

### T2.5 Dialog and sheet

- Files: `components/ui/dialog.tsx` (new, Radix Dialog), `components/ui/sheet.tsx` (new, Radix Dialog as a side/bottom
  sheet), `components/dialog.tsx` (becomes a thin wrapper or is replaced at every caller), `components/disconnect-confirm.tsx`,
  `components/transfer-dialog.tsx`, `components/line-prices-dialog.tsx`, `features/tasks/components/decision-dialog.tsx`,
  `tests/dialog-focus.spec.ts` if its handles change.

### T2.6 Popover, tooltip, tabs, toast

- Files: `components/ui/popover.tsx`, `components/ui/tooltip.tsx`, `components/ui/tabs.tsx` (new, Radix Tabs),
  `components/tabs.tsx`, `components/ui/toast.tsx` (new, Radix Toast), `components/toast.tsx`, callers.

### T2.7 Badge, pagination, feedback and marks

- Files: `components/ui/badge.tsx`, `components/ui/pagination.tsx`, `components/ui/skeleton.tsx` (new),
  `components/ui/avatar.tsx` (new), `components/alert.tsx`, `components/empty-state.tsx`, `components/load-failed.tsx`,
  `components/loading.tsx`, `components/account-name.tsx`, callers.

### T2.8 Date field

- Files: `components/date-field.tsx` (popover from T2.6, calendar logic kept), callers.

### T2.9 Table, filters

- Files: `components/ui/table.tsx` (new: Table, THead, TRow, TCell… with sticky header, sort button, selection cell,
  phone card layout), `components/data-table.tsx`, `components/filter-bar.tsx`, callers.

## T3 Shell and frames

### T3.1 App shell

- Files: `components/app-shell.tsx`, `components/chrome.tsx`, `components/crumbs.tsx`, `components/shell-search.tsx`,
  `components/preferences.tsx`, `components/doors.tsx`, `components/brand-logo.tsx`; sidebar (groups, folded rail),
  topbar (search, notices), drawer on Sheet (T2.5), impersonation return bar.

### T3.2 Auth

- Files: `components/auth-frame.tsx`, `components/auth-art.tsx`, `features/auth/screens/*.tsx`,
  `features/auth/sign-in-methods.tsx`, `features/auth/two-factor-policy.tsx`, `features/auth/session-rules.tsx`.

### T3.3 Desk frame, panes, data visuals, app states

- Files: `components/desk.tsx`, `components/app-frame.tsx`, `components/facts.tsx`, `components/stat.tsx`,
  `components/sparkline.tsx`, `components/trend-line.tsx`, `components/donut.tsx`, `components/outage.tsx`,
  `components/bootstrap.tsx`, `app/error.tsx`, `app/not-found.tsx`.

## T4 Screens

Each slice ports the named screens to components + layout utilities and removes their legacy classes.

- **T4.1 Home:** `features/desk/home-top.tsx`, `features/desk/overview.tsx`, `features/desk/screens/home-screen.tsx`,
  `components/offer-hero.tsx`.
- **T4.2 Users and accounts:** `features/accounts/**/*.tsx`.
- **T4.3 Companies:** `features/catalog/screens/companies-screen.tsx`, `company-screen.tsx`, `add-company-screen.tsx`,
  `features/catalog/chain-board.tsx`, `inherited-modes.tsx`, `company-packages.tsx`.
- **T4.4 Packages and providers catalogue:** `features/catalog/screens/packages-screen.tsx`, `package-sheet-screen.tsx`,
  `add-package-screen.tsx`, `package-moved.tsx`, `provider-packages-screen.tsx`, `providers-screen.tsx`,
  `features/catalog/package-details-form.tsx`, `package-addons.tsx`, `components/package-facts.tsx`.
- **T4.5 Lines and numbers:** `features/lines/**/*.tsx`, `components/line-actions.ts`, `components/esim-qr.tsx`,
  `components/activation-result.tsx`, `components/data-image.tsx`.
- **T4.6 Tasks:** `features/tasks/**/*.tsx`.
- **T4.7 Wallets and finance:** `features/wallets/**/*.tsx`.
- **T4.8 Providers:** `features/providers/**/*.tsx`.
- **T4.9 Reports:** `features/reports/**/*.tsx`.
- **T4.10 Notices, offers, roles, audit, branding:** `features/notices/**`, `features/offers/**`, `features/roles/**`,
  `features/audit/**`, `features/branding/**`, `components/branding-drop.tsx`, `components/branding-preview.tsx`.

## T5 Delete legacy CSS

### T5.1 Remove dead legacy rules and sheets

- Files: `apps/web/app/styles/*.css`, `apps/web/app/globals.css`, `apps/web/scripts/check-styles.mjs` (frozen list),
  `apps/web/scripts/check-css.mjs` + `css-baseline.json` (deleted with the sheets), `apps/web/package.json`,
  `docs/architecture/frontend.md`.
- Steps: for each sheet, list its selectors and `rg` every class in `app/ components/ features/ lib/`; delete unused
  rules; move the few still-needed global rules (fonts, `body`, `:focus-visible`, reduced motion, print) into
  `app/tailwind.css` `@layer base`; delete empty sheets. End state: `app/styles/` gone, `globals.css` gone or a single
  import of `tailwind.css`.

### T5.2 Tokens file is the only style source

- Files: `apps/web/app/tailwind.css`, `apps/web/scripts/check-styles.mjs` (no `.css` file other than `tailwind.css`
  allowed), `.cursor/rules/smilesim-ui.mdc`, `.cursor/rules/direction-theme.mdc`, `.cursor/rules/screen-size.mdc`,
  `.cursor/rules/content-ui.mdc`, `DESIGN.md` (interim: tokens + components, no stylesheet ownership table).

## T6 New identity (after the owner approves `docs/design/identity-2026-11-15/`)

- **T6.1 Tokens and fonts:** `app/tailwind.css` takes the identity's `tokens.css` values (both themes), `app/layout.tsx`
  fonts; contrast pairs listed in the identity README hold.
- **T6.2 Component anatomy:** `components/ui/*` variants and sizes per the identity's component inventory.
- **T6.3 Shell and templates:** `components/app-shell.tsx`, `desk.tsx`, auth frame and page templates per the identity.

## T7 Docs final

### T7.1 DESIGN.md, maps, rules, handover

- Files: `DESIGN.md` (rewritten from the identity README + the component API), `docs/architecture/frontend.md`,
  `.cursor/rules/*.mdc` that mention stylesheets, `.cursor/rules/verify-before-reply.mdc` (owner's 2026-11-15
  no-visual-verification rule for this migration), `docs/handover/` pages that mention the UI, the Excalidraw boards
  (`node docs/architecture/generate.mjs`), ADR 0021 (note: styling plan superseded by 0022).
