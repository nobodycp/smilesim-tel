# Spec — move `apps/web` from hand-written CSS to Tailwind CSS v4 + owned Radix components

Date: 2026-11-15 · Owner instruction (chat, 2026-11-15) · Decision: ADR 0022 · Plan:
`docs/superpowers/plans/2026-11-15-tailwind-radix-migration.md`

## Goal

One unified design system for the whole web app, expressed as design tokens plus a small set of owned components, with
no hand-maintained stylesheet left, carrying the **current** visual identity: ported faithfully, cleaned of one-off
values, and completed where a control or state is missing, in the same style (owner, 2026-11-15).

## Owner decisions (2026-11-15)

1. Stop the UI maintenance run of 2026-11-13. What it committed stays (P0.1–P0.9, P1.1, P1.2 on `ui-maintenance`).
   P1.3's unfinished work is kept as a patch only (`apps/web/audit-output/maintenance/P1.3-interrupted/partial.patch`).
2. The work becomes code maintenance **without visual verification**: no screenshots, no browser measurement, no
   visual review per slice.
3. Unify the design system.
4. Replace hand-written CSS: Tailwind CSS v4 + Radix primitives in owned components (ADR 0022).
5. ~~A new visual identity~~ — cancelled by the owner later on 2026-11-15: "the current visual identity is excellent; it
   needs ordering, completing what is missing and cleaning out the random things". The current identity stays as the
   system's main identity; missing parts are added in its own style; nothing of the new-identity work is used.

## What changes

- Styling moves into the markup (Tailwind utilities) and into `components/ui/*` variants (cva). Tokens live in one file.
- Hand-rolled behaviour (dialog, row menu, select, tabs, popover, tooltip, toast, date picker popover) moves onto Radix
  primitives, which bring focus management, keyboard support and `dir="rtl"`.
- e2e specs locate elements by role, label or `data-testid`.
- All 24 files in `apps/web/app/styles/` and `app/globals.css` are deleted by the end; `app/tailwind.css` remains.
- `DESIGN.md`, the frontend map and the UI rule files describe the token + component system.
- After the port: a gap inventory of the current identity, the missing components and states built in its style,
  one-off values folded into tokens and variants, and `DESIGN.md` completed as the system's one identity (plan T6).

## What does not change

- Routes, data flow, API calls, query keys, copy keys and their text, money handling (integer agorot), permissions,
  the four doors and their host resolution, `apps/api/`.
- Behaviour: what a click, a key or a form submit does. A slice that would change behaviour stops and is written up.
- Arabic-first RTL, Hebrew and English support, light and dark themes.

## Non-goals

- New features or new screens.
- Per-slice visual sign-off (owner decision 2). The port aims at the current look; a visible difference is a defect,
  found by code review against the legacy rules, not by screenshots.
- The remaining slices of the 2026-11-13 maintenance plan (P1.3–P8). Its audit findings stay as a reference; the
  migration and the T6 clean-up close most of them by construction, and the final report lists the rest.

## Checks per slice

`npm run lint`, `npm run typecheck`, `npm run check:copy`, `npm run check:styles` (added in T1.2), a code review that
reads the diff for lost props, behaviour changes, physical-direction utilities, raw colours and removed accessible
names. e2e (`npm test --workspace web`) and `npm run build` run on GitHub Actions only, when the owner pushes.

## Risks

- Without visual verification, a ported screen can look wrong until someone opens it. Mitigation: every element keeps
  its role and accessible name, and components carry the look so a fix lands everywhere at once.
- During coexistence, legacy rules could fight utilities. Mitigation: legacy sheets sit in a lower cascade layer.
- Large diff in e2e specs. Mitigation: the selector move (T1.3) lands before any class is removed and changes no
  assertion.
