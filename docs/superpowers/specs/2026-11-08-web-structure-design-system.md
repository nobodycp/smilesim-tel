# Web structure and design system — spec (Phase 5)

Date: 2026-11-08 · Parent plan: `docs/superpowers/plans/2026-11-08-architecture-refactor.md` (Phase 5) · ADR 0003

## Goal

Make the web app easier to change without breaking it: catch dead code in lint, remove primitives nobody uses, give every route an error and not-found screen, close the accessibility gaps the audit and `DESIGN.md` → Known gaps list, then unify the primitives on `--rd-*` tokens.

## Decisions

1. **Low risk first.** Order: lint → dead code → error/not-found boundaries → accessibility → tokens → primitives → page split. Each slice keeps every Playwright spec green; slices that change pixels are checked in the browser in ar + en, light + dark, desktop + 390px before they land.
2. **No route groups for now.** The door/doors switch and the auth screens are decided in `app/layout.tsx` and `OfficeSession.authPath`; moving every page under `(office)` changes no URL and buys only per-group boundaries, which a root `error.tsx` / `not-found.tsx` already gives. Revisit when a group needs its own layout.
3. **Boundaries use the shared empty state** (`EmptyState`, `.empty`), the copy tables in three languages, and offer the way back (retry for an error, home for not-found). No new look.
4. **Accessibility fixes are behaviour, not restyling:** the closed mobile drawer is `inert`; the topbar menus close on Escape and return focus to their button; `RowMenu` items key by position. Focus-ring and contrast items from Known gaps change CSS and go with the token slice.
5. **Primitives (ADR 0003):** CSS on `--rd-*` tokens, one styling method; Tailwind leaves `components/ui` and then the project; alias tokens (`--accent`, `--ink-*`, `--bg`) go once nothing reads them.

## Non-goals

A new look, new screens, new copy beyond the boundary screens, moving pages into `features/<domain>/screens` before the primitives are settled.

## Slices

5.0 web lint reports unused vars/imports · 5.0b delete `components/ui/table.tsx`, `components/ui/card.tsx`, `.data-table--stack` CSS · 5.1 `app/error.tsx`, `app/not-found.tsx` · 5.5a drawer `inert`, menu Escape + focus return, `RowMenu` keys · 5.3 tokens (spacing, type, radius, z-index, motion) + Known-gaps focus/contrast · 5.4 primitives off Tailwind · 5.6 `desk.css` split by owner · 5.2 pages thin (`features/<domain>/screens`).

## Addendum 2026-11-08 — one look per control (5.4b-4)

The owner compared both looks of each control in the same context (light/dark, ar/en) and chose: `<Badge>` (small, tinted inset ring); `<Button>` with 8px corners everywhere, replacing the pill buttons in panes and dialogs; the destructive button as a danger outline (as `DESIGN.md` already says), so `<Button variant="danger">` stops being filled red; `<Select>` with its own chevron instead of the browser's arrow. This overrides the "no new look" non-goal for these four controls only. Found during the comparison and fixed first (4a): `<Button>` draws the browser's 2px default border because the reset never zeroes it, and in the filter bar `<Select>`'s chevron covers the text because a context rule resets its end padding.

