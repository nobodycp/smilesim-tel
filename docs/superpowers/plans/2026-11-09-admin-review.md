# Admin panel review — plan

Spec: `docs/superpowers/specs/2026-11-09-admin-review.md`. One verified slice at a time; tick each with its commit.
New sections are appended as the owner names them.

## Section 1 — Reports: from eight to five

- [x] **1.1 API: `scope=operations` on finance.** (aba4ab9) `wallets.service.ts` `financeWhere`: `scope === 'operations'` keeps
  `kind in PROVIDER_OPERATION_KINDS`. CSV follows (same where). Spec in `finance-ledger.spec.ts`: the rows equal what
  `ledger(actor, 'operations')` returns for the branch, an agent and a point of sale. Additive; no shape change.
- [x] **1.2 Web: «العمليات فقط» in «المالية».** (c1bbc95) New option in the scope select of `finance-screen.tsx`; initial scope
  from `?scope=`; copy key in ar/en/he. e2e: picking it sends `scope=operations`; opening `/finance?scope=operations`
  starts on it.
- [x] **1.2b Web: «المالية» without the head.** (c1bbc95) Drop `WalletHead` and its `financeSummary` query from
  `finance-screen.tsx`; move `WalletHead` to `wallet-screen.tsx` (its only user then), with the imports it needs.
  e2e: «المالية» shows no `.wallet-band` / `.wallet-chart` and opens on the table; move `tests/finance-head.spec.ts`
  to the wallet page (its 7 / 30 / 90 switch and figures stay pinned there).
- [x] **1.3 Web: remove the three pages.** (eae1e99) `office-shell.tsx` group → five entries. `app/operations/page.tsx`,
  `app/reports/sales/page.tsx`, `app/reports/orders/page.tsx` become redirects (spec, item 3); `app/reports/page.tsx`
  → `/finance`. Delete `operations-screen.tsx`, `SalesReportScreen`, `OrdersReportScreen`, `reportSales`,
  `reportOrders` and their row types (with the 77799b2 filters); copy keys check:copy reports unused. Home shortcuts
  → `/profits`; `home-top.tsx` «كل المبيعات» → «كل العمليات» `/finance?scope=operations`. Update
  `tests/reports-hub.spec.ts`, `tests/dom-snapshot.mjs`, `audit/screens.audit.ts`. e2e: the group lists five pages
  for branch and pos; each old path lands where the spec says.
- [x] **1.4 API: remove the dead endpoints.** (35c334e) `reports.controller.ts` sales/orders, `insights.service.ts`
  `sales`/`orders` and their CSV branches, the `ledger` `operations` scope; `testing/office-routes.ts`,
  `permissions.http.spec.ts`, `operations-ledger.spec.ts`, `office-lists.spec.ts`, response-shape pins.
- [x] **1.5 Docs and check.** `frontend.md` (reports group, routes, redirects), `backend.md` (endpoints, finance
  scopes); bump "Last verified". Docker check: group and finance filter in ar + en, light + dark, desktop + mobile,
  as branch and pos. Full CI set before push.

## Section 2 — Typing instead of lists; the language in the topbar

- [x] **2b.1 Language in the topbar.** `office-shell.tsx`: `<LanguageSwitch />` (menu form) beside `<ThemeToggle shell />`;
  drop it from `.side-prefs`; keep `.drawer-prefs` under 360px. Menu styles for the topbar in the shell stylesheet,
  tokens only. e2e: topbar menu switches ar → en → he; sidebar foot has no language. Check RTL/LTR, light/dark, phone.
- [x] **2a.1 `NameField` component.** `components/name-field.tsx` + `lib/name-match.ts` (normalize + rank, unit
  tested: diacritics, alef forms, ة/ه, ى/ي, digits, typo). ARIA combobox, keyboard, clear button, no-match line;
  styles in `DESIGN.md`. e2e on a test page of the mock office.
- [x] **2a.2 Account pickers.** Package sheet offers tab (two), users create form parent, transfer dialog
  destination, numbers new activation point of sale, number card move-to. Same values sent to the API.
- [x] **2a.3 Package / company / provider pickers.** Numbers new activation package; the filters on tasks, numbers,
  packages, provider operations, user packages tab; in `FilterBar` it matches the chip's own list (0c7967e), and
  the drawer layout under 768px.
- [x] **2a.4 Docs and check.** `frontend.md` components list; every changed screen at all widths, ar + en.

## Section 5 — Layer sign-in rules out of the owner's settings

- [x] **5.1** New route `app/settings/access/page.tsx` (owner only, `useRequireLayer(['branch'])` + owner check) with
  `LayerSessionRulesPane`; entry «قواعد الدخول» in the sidebar settings group; remove the pane from
  `settings-screen.tsx`; copy keys ar/en/he; route table / permission specs; e2e (owner sees it, staff does not;
  `/settings` has no layer rules). Docs.

## Section 4 — Companies, providers, packages

Branch only; no prototype (owner 2026-11-09). Lower layers' pages are untouched — an e2e pins their `/packages`.
- [x] **4.1 Routes.** `/companies/[code]/packages/[pkg]` (package page moved, same screen); redirects from
  `/providers/[p]/[pkg]` and `/companies/[c]/[p]`; branch `/packages` → `/companies`; sidebar entries.
- [x] **4.2 Company page tabs** as approved: one packages table with provider column and filter; providers tab;
  settings tab. Remove `company-packages-screen.tsx`.
- [x] **4.3 Provider page** without its packages tab; its balance (lede) and the `/providers` balance / credit
  columns stay read-only, each a link to `/provider-accounts/[code]`.
- [x] **4.4 One home per value.** Package on/off only on the package head; inherited values with their source label;
  eSIM price/availability shown with source on the package. Response shapes kept; e2e updated.
- [x] **4.5 Docs** (frontend map, ADR «company is the catalog root»), full visual check.

## Section 3 — Add a package and a company from the provider

- [x] **3.1 Run-mode inheritance (API).** Written through instead of resolved at read (ADR 0009): `Package.inheritedModes`; the provider's change reaches the inheriting packages. Existing
  packages keep their stored modes (no data rewrite). `setMode` can clear an override. Specs for each source. ADR.
- [ ] **3.2 Companies from the table (API).** `CompaniesService.shelf` reads `Company` rows; the constant only seeds.
  Response shape pinned unchanged.
- [ ] **3.3 Provider adapter + simulated catalog (API).** `providers/adapters/` interface, simulated adapter;
  `GET /office/providers/:code/catalog/companies`, `.../catalog/products?company=`. Route table, permissions (edit
  grant), specs.
- [ ] **3.4 Create endpoints (API).** `POST /office/companies`, `POST /office/packages` (migration:
  `Package.providerProductCode`, unique per provider; `Company.providerCompanyCode`). Validation and error codes
  (ar copy = API message). Specs incl. duplicate product refused.
- [ ] **3.5 Run tab with inheritance (web).** Package page run tab: the Select table gives way to `ModeCards`
  (already on the provider page), each action «موروث» / «مخصص», folded, «رجوع للموروث».
- [ ] **3.6 «إضافة رزمة» page (web).** `/companies/[code]/packages/new`: provider → query → pick → details → addons →
  run (folded) → prices → save; reuses the package page editors. e2e on the mock API.
- [ ] **3.7 «إضافة شركة» page (web).** `/companies/new`: provider → query → pick → SIM rules → save. e2e.
- [ ] **3.8 Docs and check** (backend + frontend maps, all widths, ar + en, light + dark).
