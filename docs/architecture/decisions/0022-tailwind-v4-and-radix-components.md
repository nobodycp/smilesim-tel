# 0022 — Tailwind CSS v4 and owned Radix components replace hand-written stylesheets

- Status: accepted (owner, 2026-11-15)
- Supersedes: the styling parts of ADR 0021's plan from P1.3 on (the decisions D1–D28 themselves stay in force )
- Plan: `docs/superpowers/plans/2026-11-15-tailwind-radix-migration.md`

## Context

`apps/web` styles 153 components with about 5,900 lines of hand-written CSS in 24 global stylesheets
(`app/styles/*.css`, `graphite.css` alone 1,500 lines). Rules for one surface are spread across several files, later
files override earlier ones, and the UI audit of 2026-11-13 (277 findings) traced most defects to that cascade. The
maintenance plan of 2026-11-13 tried to repair the cascade in place with per-slice visual verification; on 2026-11-15 the
owner stopped it as too slow and asked for: code maintenance without visual verification, one unified design system,
no more hand-maintained CSS if a better alternative exists. A new visual identity was started the same day and then
cancelled by the owner: the current identity stays, completed and cleaned (plan T6).

## Options

1. **Tailwind CSS v4 + owned components on Radix primitives (shadcn-style).** Utilities in the markup, design tokens in
   one `@theme` file, variants in `class-variance-authority`, behaviour (dialog, menu, select, tabs, popover, tooltip,
   toast) from `radix-ui` with keyboard and RTL support. The component code lives in the repo (`components/ui/`).
2. **A complete component library (Mantine).** Ready tables, fields and date pickers with RTL; faster at first, heavier,
   its own look themed from outside, and the app is tied to its release cycle.
3. **CSS Modules / vanilla-extract.** Scoped styles, but still hand-written CSS per component; does not meet the
   owner's "no more hand-maintained CSS".

## Decision

Option 1, chosen by the owner on 2026-11-15.

- Tailwind CSS v4 through `@tailwindcss/postcss`; one stylesheet, `app/tailwind.css`, holds `@import "tailwindcss"`,
  the `@theme` tokens (light) and the dark overrides. No other `.css` file remains when the migration ends.
- Behaviour primitives from the `radix-ui` package, wrapped once in `components/ui/*` and styled with Tailwind + cva.
  Screens use only `components/ui/*` and shared components, never Radix directly.
- `lib/cn.ts` (`clsx` + `tailwind-merge`) is the one class-joining helper.
- RTL first: logical utilities only (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`);
  physical ones (`ml-*`, `mr-*`, `pl-*`, `pr-*`, `left-*`, `right-*`, `text-left`, `text-right`) fail
  `npm run check:styles`. Arbitrary colour values (`bg-[#…]`, `text-[rgb(…)]`) fail it too: colours are tokens.
- During the migration the old sheets are imported into a low cascade layer (`@layer legacy`) below Tailwind's
  `components` and `utilities`, so a migrated element's utilities win over any leftover legacy rule.
- Tests select by role, label or `data-testid`, never by a styling class.

## Consequences

- Every component's markup changes; e2e specs that locate elements by CSS class (47 spec files) move to roles/test ids
  first, so the suite keeps proving behaviour while the classes go away.
- By the owner's instruction there is no per-slice visual verification. Slices are checked by lint, typecheck,
  check:copy, check:styles and a code review; e2e and the build run on GitHub Actions when the owner pushes. The port aims
  at the current look; a visible difference is a defect found by code review against the legacy rules.
- `DESIGN.md`, `docs/architecture/frontend.md` and the UI rule files (`smilesim-ui.mdc`, `content-ui.mdc`,
  `direction-theme.mdc`, `screen-size.mdc`) are rewritten for utilities and components instead of stylesheets.
- New dependencies: `tailwindcss`, `@tailwindcss/postcss`, `radix-ui`, `class-variance-authority`, `clsx`,
  `tailwind-merge` (exact versions pinned, each released at least 14 days before it is added).
