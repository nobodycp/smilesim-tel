# Inner pages refresh — plan

Spec: `docs/superpowers/specs/2026-11-08-inner-pages-refresh.md`. One slice at a time; gate per slice (lint,
check:copy, typecheck, test:api, build, e2e) and screenshots.

- [x] R1 Trail instead of «رجوع» (`components/crumbs.tsx`, `lib/crumbs.ts` `useCrumbs`): user, number, task, provider package and company provider pages name their levels; a page outside the sidebar keeps the back button. `tests/crumbs.spec.ts`.
- [x] R2 `Tabs` component (segmented, counts, arrow keys) replaces the six `.steps` lists. `tests/tabs.spec.ts`.
- [x] R3 Cards: `Stat` restyled (label and small icon on one line, value under them, 12px radius), `highlight` and `progress`.
- [x] R4 User page: name with its status badge, a muted line (layer · follows · role), fund and ceiling as buttons and ⋯ for the rest (`features/accounts/account-actions.tsx` `useAccountActions`, shared with the users list); four wallet cards from the account answer's new `listed` row; tab counts (custom prices, stopped operations). `tests/account-head.spec.ts`. The ceiling dialog now opens with the ceiling in shekels (it showed agorot).
- [ ] R5 Finance: `finance/summary` and `finance/export` routes, cards, 30-day chart and figures, CSV button.
