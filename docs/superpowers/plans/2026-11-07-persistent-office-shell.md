# Persistent office shell implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount `OfficeShell` once in the root layout so navigation replaces only the page.

**Spec:** `docs/superpowers/specs/2026-11-07-persistent-office-shell.md`

**Architecture:** `components/office-frame.tsx` (client) wraps `children` in `OfficeShell` unless the pathname is an auth path. `app/layout.tsx` renders it inside `OfficeSession`. `OfficeShell` derives the shown name itself and drops `account` / `hint` / `wide`. `Desk`, home, and settings return page content only. `OfficeSession.refresh()` re-reads `/office/me` after a profile save.

---

### Task 1: Shell in the layout

**Files:**
- Modify: `apps/web/lib/office-session.tsx` (export `authPath`; add `refresh()` to the context)
- Create: `apps/web/components/office-frame.tsx`
- Modify: `apps/web/app/layout.tsx` (render `OfficeFrame` inside `OfficeSession`)
- Modify: `apps/web/components/office-shell.tsx` (drop `account`, `hint`, `wide`; derive the name; render children unless `failed`)
- Modify: `apps/web/components/desk.tsx`, `apps/web/app/page.tsx`, `apps/web/app/settings/page.tsx` (`PageSkeleton` until `ready`)

- [x] `OfficeFrame` renders children bare on auth paths and inside `OfficeShell` elsewhere.
- [x] `OfficeShell` has no `account` / `hint` / `wide` props; the canvas is `canvas-inner wide`.

### Task 2: Pages return content only

**Files:**
- Modify: `apps/web/components/desk.tsx` (remove `OfficeShell`, `useIdentity`, `useOffice` imports if unused)
- Modify: `apps/web/app/page.tsx` (remove the wrapper and the `account` / `hint` locals)
- Modify: `apps/web/app/settings/page.tsx` (remove the wrapper; call `refresh()` after a profile save)

- [x] No file under `app/` imports `OfficeShell`.
- [x] Saving a name in settings updates the topbar without a reload.

### Task 3: Verify

- [x] `npm run lint`, `npm run check:copy`, `npm run typecheck`, `npm run test:api`, `npm run build`.
- [x] Browser: `.sidebar` / `.topbar` nodes identical across five navigations; collapsed state and open groups survive; login renders without the shell; ar/en, light/dark, 1440 and narrow.
- [x] Playwright e2e green locally; push; CI green.
