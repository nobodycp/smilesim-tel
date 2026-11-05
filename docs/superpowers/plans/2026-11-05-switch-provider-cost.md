# Switch provider cost

Spec: `docs/superpowers/specs/2026-11-05-switch-provider-cost-design.md`.

1. Rule test first in `apps/api/src/modules/office/office-rules.spec.ts`: `switchDifference` fed with branch costs returns 580 for the 3500 → 4100, 29-of-30-days case and a negative figure for the reverse. No new rule function; the existing one is reused with cost inputs.
2. `switchQuote` in `apps/api/src/modules/office/office.service.ts` returns `providerCost` alongside `difference` and `newPrice`, choosing the current branch cost the way `disconnectSettlementFor` does and the new branch cost from `packageTermsOf(target).subscription.branchCost`.
3. Both switch postings store it: the direct path in `switchPackage` (`saleOf(...)` plus `providerCost`) and the task settlement in the task-done branch. Zero-difference switches go through `recordOp` with the same `providerCost`.
4. Verify: `npm run test:api`, `npm run typecheck:api`, rebuild and restart the API, run one switch in the browser on `0568932623`, and confirm the new row's cost on `/provider-operations` equals the wallet debit on `/finance`.
5. Table width on `/provider-operations`: find why the sheet does not scroll or wrap at the narrow viewport (`apps/web/app/styles/desk.css`, `.canvas .sheet` / `.data`), fix it in the file that owns the surface, check 1440px and a narrow window in Arabic and English.
