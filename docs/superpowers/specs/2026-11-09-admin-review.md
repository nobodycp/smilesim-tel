# Admin panel review — spec

Date: 2026-11-09. Owner request, in sections. Each section is added here as the owner names it; the plan
(`docs/superpowers/plans/2026-11-09-admin-review.md`) gets one slice group per section.

## Section 1 — Reports: from eight to five

### Why

The sidebar's «التقارير» group holds eight pages. Three of them show data another page already shows, and the owner
could not tell «العمليات», «المبيعات», «الطلبات» and «المهام» apart. What each page reads today:

| Page | Reads | Row | Overlap |
|---|---|---|---|
| «المالية» `/finance` | every wallet entry in the viewer's tree, operations and money movements, balance before/after, margin, shares | entry | — (the statement) |
| «العمليات» `/operations` | the same entries, line operations only (`ledger(…, 'operations')`) | entry | «المالية» with a kind filter |
| «المبيعات» `/reports/sales` | sale entries (activate, charge, extend, reactivate) with margin, total and average | sale | the list is in «المالية», the totals in «الأرباح» |
| «الأرباح» `/profits` | margin by package: sales, refunds, per-sale margin, total | package | — |
| «الطلبات» `/reports/orders` | finished operations (entries) mixed with open and cancelled tasks | entry or task | finished: «المالية»; open/cancelled: «المهام» |
| «الأرصدة» `/reports/balances` | balance, ceiling, held, available, frozen per account, now | account | — |
| «تكلفة المزودين» `/reports/supply` | per provider: operations, cost, net profit, share | provider | — |
| «عمليات المزودين» `/provider-operations` | each provider operation with expected cost, provider amount, matching state | operation | — |

Also: the «المبيعات» lede says it lists refunds; the query does not (it keeps sale kinds with a negative amount).

### What changes

1. **Kept, unchanged:** «المالية», «الأرباح», «الأرصدة», «تكلفة المزودين», «عمليات المزودين». Same order in the group.
2. **«المالية» gains «العمليات فقط»** in its existing scope select, beside «الحركات المالية فقط»: the line-operation
   kinds only (`PROVIDER_OPERATION_KINDS`). API: `GET /office/finance?scope=operations` (and its CSV). The page reads
   `?scope=` from the URL as it already reads `?q=`.
3. **Removed from the sidebar and the app:** «العمليات» `/operations`, «المبيعات» `/reports/sales`,
   «الطلبات» `/reports/orders`. Old links do not break:
   - `/operations` → `/finance?scope=operations`
   - `/reports/sales` → `/finance?scope=operations`
   - `/reports/orders` → `/tasks`
   - `/reports` → `/finance` (was `/reports/sales`)
4. **Home shortcuts:** the «المبيعات» shortcut (point of sale, and non-owner desks) becomes «الأرباح» → `/profits`.
5. **«المالية» is a statement only** (owner 2026-11-09: «هدفي منها تتبع حركات كل المحافظ لو حصل عند حدا خطأ اقدر
   اراجع»). The head goes: the figure band (balance, money in/out 30 days, entries and profit 30 days), the ceiling
   cards and the balance chart. They describe the signed-in account's own wallet, not the wallets being reviewed, and
   the same `WalletHead` stays on «المحفظة» `/wallet`, so nothing is lost. The page opens straight on the statement
   table with its filters (scope, kind, layer, search, from/to) and the CSV; the shares dialog stays.
   `GET /office/finance/summary` stays (the wallet page and home read it).
6. **API removed** once no page calls it: `GET /office/reports/sales`, `GET /office/reports/orders`, their CSV kinds,
   and the `ledger` `operations` scope (only `/operations` used it). Removed from the route table and the permission
   matrix in the same change.

### Who it applies to

Every layer. The «التقارير» group is one list shared by all doors, and «المالية» shows each layer its own chain
(a point of sale sees its own entries), so nothing a layer could read is lost.

### Not in this section

- The older `/reports/[kind]` lists (providers, tasks, numbers, operations), which are not in the sidebar.
- «سجل النشاط» and «المهام», which are not reports.

### Done when

- The group shows five pages on every layer; the three old paths redirect as listed.
- «المالية» with «العمليات فقط» lists the same rows `/operations` listed (same viewer, same period).
- lint, check:copy, typecheck, test:api, e2e, build pass; checked ar + en, light + dark, desktop + mobile.
- `docs/architecture/frontend.md` and `backend.md` say what the code now does.
