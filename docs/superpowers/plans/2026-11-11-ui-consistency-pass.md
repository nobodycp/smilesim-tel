# UI consistency pass — plan

Spec: `docs/superpowers/specs/2026-11-11-ui-consistency-pass.md`. Each phase ends with lint, check:copy, typecheck,
screenshots of the touched pages at 390 / 768 / 1280 (ar-dark, en-light), a review by a second model, fixes, then a
local commit. e2e specs that read changed UI are updated in the same phase (they run on GitHub Actions).

## Phase 0 — Audit record

- [x] `apps/web/visual-audit/{audit.config.ts,audit.visual.ts}` — the re-runnable audit. (4272073)
- [x] Baseline run; `docs/reviews/2026-11-11-visual-audit.md` — method, findings per page, status. (4272073)

## Phase 1 — SIM / eSIM (D1)

- [x] Copy: `lib/copy/{ar,en,he}.ts` — the SIM kind names.
- [x] API: `apps/api/src/modules/office/lines/lines.schemas.ts` (`sim`), `rules/office-paging.ts` (`linesWhere`),
      spec beside it.
- [x] Web: `features/lines/api.ts`, `features/lines/screens/numbers-screen.tsx` — the SIM / eSIM filter. (b0d3e9a)

## Phase 2 — Companies (D2)

- [ ] `features/catalog/screens/companies-screen.tsx` — card without tag and menu.
- [ ] `features/catalog/screens/company-screen.tsx` — settings: picture, SIM rules, eSIM switch.
- [ ] `features/catalog/company-packages.tsx` — status switch, no row menu.
- [ ] `features/catalog/screens/package-sheet-screen.tsx` — no switch in the head.

## Phase 3 — User page (D3)

- [ ] `features/accounts/user-settings.tsx` → an inline `UserSettingsPane`.
- [ ] `features/accounts/screens/account-screen.tsx` — the merged tab; grants as `.seg`; roles as chips.
- [ ] `features/accounts/account-actions.tsx`, `users-screen.tsx` — the menu item goes.

## Phase 4 — Number page, dialogs, package page (D4–D6)

- [ ] `features/lines/screens/line-card-screen.tsx` — no head quick actions; details as fact cards.
- [ ] Dialogs found by the audit that are not the shared `Dialog` shape.
- [ ] `package-sheet-screen.tsx` — compact chain; eSIM block.

## Phase 5 — Mobile pass and re-audit (D7, D8)

- [ ] Fix the audit's phone findings (targets, tabs, cards per row).
- [ ] Re-run the audit; update the record; DESIGN.md and `docs/architecture/frontend.md`.
