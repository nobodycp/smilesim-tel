# Plan — Tailwind CSS v4 + owned Radix components (code maintenance, no visual verification)

Spec: `docs/superpowers/specs/2026-11-15-tailwind-radix-migration.md` · Decision: ADR 0022 · Branch: `design-system`
(cut from `ui-maintenance` at `596bfa7` on 2026-11-15, owner: "a new branch until we agree, then merge"; the
2026-11-13 plan is superseded from P1.3 on).

> **Owner, 2026-11-15 (later):** the current visual identity stays; it is the system's main identity. There is no
> new identity (the separate identity session and `docs/design/identity-2026-11-15/` are cancelled and not used). The
> work is: port the current look faithfully, clean the random one-offs out of it, and complete what is missing in
> the same style (T6).

## Status

| Phase | Slices | State |
|---|---|---|
| T0 Decision docs | T0.1 | done — T0.1 4478666 |
| T1 Foundation | T1.1–T1.4 | in progress — T1.1 d4ed139, T1.2 bd4b1d8; T1.3a d35dd74, T1.3b 67fb314; T1.3c ebca557; T1.4 9f6efc8 |
| T2 Primitives (`components/ui`) | T2.1–T2.9 | in progress — T2.1 67e9a7f, T2.2 8683ea4, T2.3 b142d69, T2.4 8f22e47, T2.5 c8da893, T2.6 50bab52, T2.7 46dd706, T2.8 45b3fdd, T2.9 84ac38e |
| T3 Shell and frames | T3.1–T3.3 | in progress — T3.1 8cfb31b, T3.2 2c40547, T3.3 f4dc3ff |
| T4 Screens | T4.1–T4.10 | in progress — T4.6 eb26248, T4.5 dfbcf6f, T4.3 57adebc, T4.2 7f0b82d, T4.1 7b541ca |
| T5 Delete legacy CSS | T5.1–T5.2 | not started |
| T6 Complete and clean the current identity | T6.1–T6.4 | not started |
| T7 Docs final | T7.1 | not started |

## Protocol (binding)

1. One slice at a time, in order, on `design-system`. A slice touches only the files it names (plus its tests and the
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

- The current look is the target (owner, 2026-11-15). Port each element faithfully: read the legacy rules that apply to it
  (all sheets, in cascade order, including `graphite.css` overrides) and reproduce the same values with tokens and
  utilities. No redesign; a visible difference is a defect unless the slice text names it.
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

### T0.1 ADR 0022, this spec and plan, old plan superseded — 4478666

- Files: `docs/architecture/decisions/0022-tailwind-v4-and-radix-components.md` (new), this plan and its spec (new),
  `docs/superpowers/plans/2026-11-13-ui-maintenance.md` (Status: superseded from P1.3, pointer to this plan).
- Commit: `docs: Tailwind v4 + Radix migration decision, spec and plan (ADR 0022)`.

## T1 Foundation

### T1.1 Tailwind v4 next to the legacy sheets — d4ed139

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

### T1.2 Class helper, variants and the style check — bd4b1d8

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

- T1.3a — d35dd74 specs `account-head` … `finance-head` (alphabetical, 18 files); T1.3b — 67fb314 `home-overview` … `profits` (18 files);
  T1.3c — ebca557 `provider-accounts` … `users-desk` (rest), plus `tests/desk.ts`.
- Files: those `apps/web/tests/*.spec.ts` files, and the components that gain a `data-testid` (each named in the slice
  notes).
- Steps: every `locator('.<class>…')` / `locator('<tag>.<class>')` that targets a styling class becomes `getByRole`,
  `getByLabel`, `getByText` or `getByTestId`. Assertions, flows and fixtures do not change. Where a test asserts a
  computed style (colour, size) on a class, keep the assertion and change only how it finds the element.
- Done when: CHK passes; `rg -n "locator\\(['\"\`][^'\"\`]*\\.[a-z]" apps/web/tests` lists only selectors that are not
  styling classes (each justified in notes).

### T1.4 Freeze the P1.1 CSS guard — 9f6efc8

- Files: `apps/web/scripts/check-css.mjs`, `apps/web/scripts/css-baseline.json`, `apps/web/package.json`,
  `docs/architecture/frontend.md`.
- Steps: the guard keeps failing on growth of legacy CSS and accepts shrinkage (re-baseline on shrink only); the
  dom-snapshot cases from P1.1 stay in the tree, unused by this plan.
- Done when: CHK passes; deleting a legacy rule does not fail the guard.

## T2 Primitives (`components/ui`)

Each primitive keeps the current public API of the component it replaces (props, names), or its slice updates every
caller in the same commit.

### T2.1 Button and IconButton — 67e9a7f

- Files: `components/ui/button.tsx`, `components/ui/icon-button.tsx` (new), every caller using `.ui-btn*` /
  `.icon-btn` classes directly (list from `rg -l "ui-btn|icon-btn" apps/web`).
- Variants: primary (crimson fill, `--rd-accent-fill`), secondary, ghost, danger (outline), link; sizes sm/md;
  `asChild` via Radix `Slot`; pressed (`aria-pressed`), loading, disabled. D2/D8/D13/D14/D19 hold.

### T2.2 Fields — 8683ea4

- Files: `components/ui/input.tsx`, `components/ui/textarea.tsx`, `components/ui/label.tsx`, `components/ui/field.tsx`
  (label + control + help + error, ids wired), `components/price-field.tsx`, `components/name-field.tsx`,
  `components/table-search.tsx`, and callers using `.field*`/`.input*` classes in `app/styles/forms.css`/`controls.css`.

### T2.3 Choice controls  — b142d69

- Files: `components/ui/checkbox.tsx`, `components/ui/radio-group.tsx`, `components/ui/switch.tsx`,
  `components/ui/segmented.tsx` (new, Radix ToggleGroup), `components/live-switch.tsx`, `components/mode-cards.tsx`,
  and their callers.

### T2.4 Select and menus — 8f22e47

- Files: `components/ui/select.tsx` (Radix Select), `components/ui/dropdown-menu.tsx` (new), `components/row-menu.tsx`,
  callers of both.

### T2.5 Dialog and sheet — c8da893

- Files: `components/ui/dialog.tsx` (new, Radix Dialog), `components/ui/sheet.tsx` (new, Radix Dialog as a side/bottom
  sheet), `components/dialog.tsx` (becomes a thin wrapper or is replaced at every caller), `components/disconnect-confirm.tsx`,
  `components/transfer-dialog.tsx`, `components/line-prices-dialog.tsx`, `features/tasks/components/decision-dialog.tsx`,
  `tests/dialog-focus.spec.ts` if its handles change.

### T2.6 Popover, tooltip, tabs, toast — 50bab52

- Files: `components/ui/popover.tsx`, `components/ui/tooltip.tsx`, `components/ui/tabs.tsx` (new, Radix Tabs),
  `components/tabs.tsx`, `components/ui/toast.tsx` (new, Radix Toast), `components/toast.tsx`, callers.

### T2.7 Badge, pagination, feedback and marks — 46dd706

- Files: `components/ui/badge.tsx`, `components/ui/pagination.tsx`, `components/ui/skeleton.tsx` (new),
  `components/ui/avatar.tsx` (new), `components/alert.tsx`, `components/empty-state.tsx`, `components/load-failed.tsx`,
  `components/loading.tsx`, `components/account-name.tsx`, callers.

### T2.8 Date field — 45b3fdd

- Files: `components/date-field.tsx` (popover from T2.6, calendar logic kept), callers.

### T2.9 Table, filters — 84ac38e

- Files: `components/ui/table.tsx` (new: Table, THead, TRow, TCell… with sticky header, sort button, selection cell,
  phone card layout), `components/data-table.tsx`, `components/filter-bar.tsx`, callers.

## T3 Shell and frames

### T3.1 App shell — 8cfb31b

- Files: `components/app-shell.tsx`, `components/chrome.tsx`, `components/crumbs.tsx`, `components/shell-search.tsx`,
  `components/preferences.tsx`, `components/doors.tsx`, `components/brand-logo.tsx`; sidebar (groups, folded rail),
  topbar (search, notices), drawer on Sheet (T2.5), impersonation return bar.

### T3.2 Auth — 2c40547

- Files: `components/auth-frame.tsx`, `components/auth-art.tsx`, `features/auth/screens/*.tsx`,
  `features/auth/sign-in-methods.tsx`, `features/auth/two-factor-policy.tsx`, `features/auth/session-rules.tsx`.

### T3.3 Desk frame, panes, data visuals, app states — f4dc3ff

- Files: `components/desk.tsx`, `components/app-frame.tsx`, `components/facts.tsx`, `components/stat.tsx`,
  `components/sparkline.tsx`, `components/trend-line.tsx`, `components/donut.tsx`, `components/outage.tsx`,
  `components/bootstrap.tsx`, `app/error.tsx`, `app/not-found.tsx`.

## T4 Screens

Each slice ports the named screens to components + layout utilities and removes their legacy classes.

- **T4.1 Home — 7b541ca:** `features/desk/home-top.tsx`, `features/desk/overview.tsx`, `features/desk/screens/home-screen.tsx`,
  `components/offer-hero.tsx`.
- **T4.2 Users and accounts — 7f0b82d:** `features/accounts/**/*.tsx`.
- **T4.3 Companies — 57adebc:** `features/catalog/screens/companies-screen.tsx`, `company-screen.tsx`, `add-company-screen.tsx`,
  `features/catalog/chain-board.tsx`, `inherited-modes.tsx`, `company-packages.tsx`.
- **T4.4 Packages and providers catalogue:** `features/catalog/screens/packages-screen.tsx`, `package-sheet-screen.tsx`,
  `add-package-screen.tsx`, `package-moved.tsx`, `provider-packages-screen.tsx`, `providers-screen.tsx`,
  `features/catalog/package-details-form.tsx`, `package-addons.tsx`, `components/package-facts.tsx`.
- **T4.5 Lines and numbers — dfbcf6f:** `features/lines/**/*.tsx`, `components/line-actions.ts`, `components/esim-qr.tsx`,
  `components/activation-result.tsx`, `components/data-image.tsx`.
- **T4.6 Tasks — eb26248:** `features/tasks/**/*.tsx`.
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

## T6 Complete and clean the current identity (owner, 2026-11-15)

The current identity (`DESIGN.md`, the `--rd-*` tokens, ADR 0021 D1–D28) is the target. Nothing is redesigned; gaps
are filled in the same style, and one-offs are folded into the system.

### T6.1 Gap inventory

- Files: `docs/design/current-identity-gaps.md` (new).
- Steps: list every control, surface and state the app renders or needs (buttons, icon buttons, fields, textarea,
  number/price, search, select, combobox, date picker, checkbox, radio, switch, segmented, tabs, pagination, table and
  its states and phone layout, filters, badges, stat tiles, cards/panes, donut, alerts, toasts, dialog, sheet, popover,
  menu, tooltip, sidebar, topbar, crumbs, empty, loading skeleton, avatar/marks, file drop, QR, auth screens, return
  bar, offer hero) and, for each, whether `DESIGN.md` defines it and which states (hover, pressed, focus-visible,
  disabled, loading, error, selected, empty) are missing. Also list the one-offs: sizes, paddings, radii, colours or
  shadows used by one screen only (`rg` over `components/ui` and the screens), and the open audit findings of
  `docs/reviews/2026-11-13-ui-audit.md` that still apply after T5.

### T6.2 Fill the gaps in the same style

- Files: `components/ui/*` (the components the inventory names), `app/tailwind.css` (only tokens the inventory proves
  are missing, in both themes), `DESIGN.md`.
- Steps: each missing component or state is built from the existing tokens and the existing components' anatomy
  (same radii, heights, borders, focus ring, motion, density); no new colour unless a state has none, then one token in
  both themes with its contrast pair. Text on fills keeps 4.5:1.

### T6.3 Fold the one-offs into the system

- Files: the screens and components the inventory lists, `components/ui/*`.
- Steps: every one-off value becomes the nearest token or an existing variant; a value used by two or more screens
  that no token covers becomes a token or a variant (named in `DESIGN.md`).

### T6.4 Fix it as the main identity

- Files: `DESIGN.md` (complete: foundations, every component with its states, page templates), `.cursor/rules/smilesim-ui.mdc`,
  `docs/design/current-identity-gaps.md` (closed).
- Steps: `DESIGN.md` states that this identity is the system's one identity (owner, 2026-11-15), lists every component
  in `components/ui` with variants and states, and the rule file points to it.

## T7 Docs final

### T7.1 DESIGN.md, maps, rules, handover

- Files: `DESIGN.md` (final pass after T6.4: the component API and the completed current identity), `docs/architecture/frontend.md`,
  `.cursor/rules/*.mdc` that mention stylesheets, `.cursor/rules/verify-before-reply.mdc` (owner's 2026-11-15
  no-visual-verification rule for this migration), `docs/handover/` pages that mention the UI, the Excalidraw boards
  (`node docs/architecture/generate.mjs`), ADR 0021 (note: styling plan superseded by 0022).
