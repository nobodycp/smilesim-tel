# Hotspot shell + numbers/tasks desks — design

## Why

The hotspot-store identity reflector landed foundation primitives and a `/users` pilot. The office
chrome (sidebar/topbar) and the numbers/tasks list desks still use legacy badge classes and
hand-rolled shell glyphs, so the product looks mixed after the pilot.

## Goal

Bring `OfficeShell` (sidebar, drawer, topbar tools) and the **list** desks `/numbers` and `/tasks`
onto the same hotspot presentation stack: mapped tokens, lucide glyphs in the shell, `Badge` /
`Select` / `Button` on those desks—without changing office business logic or API contracts.

## Non-goals

- `/login`, door picker, `/numbers/[id]`, other desks, reports, settings.
- Deleting `components/icon.tsx` globally (shell stops importing it; other pages may still use it).
- Real provider integration, worker jobs, backend maps.
- Changing nav structure, grants filtering, wallet/notices behaviour.

## Decisions

**D1 — Shell reskin in place.** Keep `OfficeShell` props and behaviour. Restyle via `shell.css` and
swap shell icons to `lucide-react`. Topbar controls stay ≥44px on touch widths; language/theme stay
`inset-inline-end` flex children.

**D2 — Desk status badges.** Lines: `active→success`, `frozen→warning`, else `danger`. Tasks:
`done→success`, `cancelled→danger`, else `warning`. Dot on badges for consistency with `/users`.

**D3 — Filters.** Bare `<select>` in numbers/tasks filter bars become `Select`. Existing `Button`
usage on numbers stays.

**D4 — Spec/plan pair.** This file + `docs/superpowers/plans/2026-11-03-hotspot-shell-numbers-tasks.md`.

## Verification

- `npm run typecheck:web`
- Browser: shell + `/numbers` + `/tasks` in ar/en × light/dark; icons/order follow `dir`
- No intentional API or auth changes
