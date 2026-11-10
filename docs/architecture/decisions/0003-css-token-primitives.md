# 0003 — UI primitives styled with CSS on `--rd-*` tokens

Date: 2026-11-08 · Status: accepted (owner)

## Context
~3,800 lines of global CSS carry the visual system. Tailwind is used only in four `components/ui/*` files and depends on alias tokens (`--accent` = ink, `--ink-*`, `--bg`) that `DESIGN.md` says are removed; `--accent` vs `--rd-accent` (red) is a trap. Two systems style the same controls (`.badge` vs `<Badge>`, raw `<select>` vs `<Select>`, `.btn` vs `<Button>`).

## Decision
Primitives in `components/ui/` are styled with plain CSS that reads `--rd-*` tokens only. Tailwind is removed from the primitives, then from the project once nothing uses it. Add spacing, type, radius, z-index and motion tokens to `tokens.css`; delete the alias set.

## Consequences
- Phase 5 work. `DESIGN.md` is updated in each slice.
- Visual output must not change unless a slice states it (checked in ar + en, light + dark).
- 5.4a (2026-11-08): Tailwind is gone from the project. The four primitives read `app/styles/ui.css`; its declarations are the ones Tailwind generated, so 29 screens × 3 modes (light ar, dark ar, light en) are pixel-identical except the badge rings, which now draw the intended tinted colour instead of Tailwind's default blue.
