# Admin panel review — plan

Spec: `docs/superpowers/specs/2026-11-09-admin-review.md`. One verified slice at a time; tick each with its commit.
New sections are appended as the owner names them.

## Section 1 — Reports: from eight to five

- [ ] **1.1 API: `scope=operations` on finance.** `wallets.service.ts` `financeWhere`: `scope === 'operations'` keeps
  `kind in PROVIDER_OPERATION_KINDS`. CSV follows (same where). Spec in `finance-ledger.spec.ts`: the rows equal what
  `ledger(actor, 'operations')` returns for the branch, an agent and a point of sale. Additive; no shape change.
- [ ] **1.2 Web: «العمليات فقط» in «المالية».** New option in the scope select of `finance-screen.tsx`; initial scope
  from `?scope=`; copy key in ar/en/he. e2e: picking it sends `scope=operations`; opening `/finance?scope=operations`
  starts on it.
- [ ] **1.2b Web: «المالية» without the head.** Drop `WalletHead` and its `financeSummary` query from
  `finance-screen.tsx`; move `WalletHead` to `wallet-screen.tsx` (its only user then), with the imports it needs.
  e2e: «المالية» shows no `.figure-band` / `.wallet-chart` and opens on the table; «المحفظة» still shows them.
- [ ] **1.3 Web: remove the three pages.** `office-shell.tsx` group → five entries. `app/operations/page.tsx`,
  `app/reports/sales/page.tsx`, `app/reports/orders/page.tsx` become redirects (spec, item 3); `app/reports/page.tsx`
  → `/finance`. Delete `operations-screen.tsx`, `SalesReportScreen`, `OrdersReportScreen`, `reportSales`,
  `reportOrders` and their row types; copy keys check:copy reports unused. Home shortcuts → `/profits`. Update
  `tests/reports-hub.spec.ts`, `tests/dom-snapshot.mjs`, `audit/screens.audit.ts`. e2e: the group lists five pages
  for branch and pos; each old path lands where the spec says.
- [ ] **1.4 API: remove the dead endpoints.** `reports.controller.ts` sales/orders, `insights.service.ts`
  `sales`/`orders` and their CSV branches, the `ledger` `operations` scope; `testing/office-routes.ts`,
  `permissions.http.spec.ts`, `operations-ledger.spec.ts`, `office-lists.spec.ts`, response-shape pins.
- [ ] **1.5 Docs and check.** `frontend.md` (reports group, routes, redirects), `backend.md` (endpoints, finance
  scopes); bump "Last verified". Docker check: group and finance filter in ar + en, light + dark, desktop + mobile,
  as branch and pos. Full CI set before push.

## Section 2 — (next owner request)
