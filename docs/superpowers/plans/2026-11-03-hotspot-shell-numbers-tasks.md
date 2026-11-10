# Hotspot shell + numbers/tasks — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Reskin OfficeShell to hotspot density/icons; migrate `/numbers` and `/tasks` list status/filters to Badge/Select.

**Spec:** `docs/superpowers/specs/2026-11-03-hotspot-shell-numbers-tasks-design.md`

## Global Constraints

- Tokens only (`--rd-*` / mapped `--accent` etc.); no raw hex in new CSS.
- Do not change login/doors or `/numbers/[id]`.
- Keep OfficeShell public props and grants/nav behaviour.

---

### Task 1: Shell lucide + CSS density

**Files:** `apps/web/components/office-shell.tsx`, `apps/web/app/styles/shell.css`, `apps/web/components/chrome.tsx`

- [x] Map nav icon keys to lucide components; replace Icon usages in shell
- [x] Brand mark uses accent fill + lucide Wifi/sim equivalent; collapse uses PanelLeft/Right with ltr flip
- [x] chrome ThemeToggle shell uses lucide Sun/Moon
- [x] shell.css: brand mark rounded-2xl (1rem), nav min-height 40px desktop / 44px touch already, ensure shell-icon 40px desktop

### Task 2: Numbers + tasks desks

**Files:** `apps/web/app/numbers/page.tsx`, `apps/web/app/tasks/page.tsx`

- [x] Badge status mappings per spec D2
- [x] Filter `<select>` → `Select`

### Task 3: Verify

- [x] `npm run typecheck:web`
- [x] Browser RTL/theme spot check (covered by the later all-screens passes: `2026-11-08-architecture-refactor.md` 5.x, 29 screens in ar/en, light/dark)
