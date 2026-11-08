# Inner pages refresh — plan

Spec: `docs/superpowers/specs/2026-11-08-inner-pages-refresh.md`. One slice at a time; gate per slice (lint,
check:copy, typecheck, test:api, build, e2e) and screenshots.

- [x] R1 Trail instead of «رجوع» (`components/crumbs.tsx`, `lib/crumbs.ts` `useCrumbs`): user, number, task, provider package and company provider pages name their levels; a page outside the sidebar keeps the back button. `tests/crumbs.spec.ts`.
- [ ] R2 `Tabs` component (segmented, counts, arrow keys) replaces the six `.steps` lists.
- [ ] R3 Cards: `Stat` restyled, `highlight` and `progress`.
- [ ] R4 User page: head with status and actions (`AccountActions` shared with the users list), money cards (API `balance`, `ceiling`), tab counts.
- [ ] R5 Finance: `finance/summary` and `finance/export` routes, cards, 30-day chart and figures, CSV button.
