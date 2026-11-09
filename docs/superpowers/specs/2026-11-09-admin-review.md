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
   The «آخر العمليات» card's «كل المبيعات» link becomes «كل العمليات» → `/finance?scope=operations` (it lists
   operations, not totals).
   Commit 77799b2 added filters to «المبيعات» (point of sale, movement) and to «الطلبات» (operation, task link,
   handler). They go with the pages (owner 2026-11-09: «تمام نشيلهم»): the search and kind filters of «المالية» and
   the «المهام» list cover them.
5. **«المالية» is a statement only** (owner 2026-11-09: «هدفي منها تتبع حركات كل المحافظ لو حصل عند حدا خطأ اقدر
   اراجع»). The head goes: the figure band (balance, money in/out 30 days, entries and profit 30 days), the ceiling
   cards and the balance chart. They describe the signed-in account's own wallet, not the wallets being reviewed, and
   the same `WalletHead` stays on «المحفظة» `/wallet` (with its 7 / 30 / 90 days switch and trend line, commit
   95fcac5), so nothing is lost. The page opens straight on the statement
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

## Section 2 — Typing instead of lists; the language in the topbar

### 2a. Pick by typing, with the closest names first

Today every entity is picked from a `<select>` (no combobox exists in the app). The owner wants typing everywhere a
name is picked: suggestions appear from the first letter, closest names first.

**One component, `NameField`** (`components/name-field.tsx`), the ARIA combobox pattern:
- A text field; from the first character a list of up to 8 suggestions under it; ↑/↓ moves, Enter picks, Esc
  closes; a click picks. Picked, the field shows the name and a clear (×) button. Empty input with focus shows the
  first 8 (recent or alphabetical) so a short list can still be browsed.
- **Ranking:** exact → starts with → a word starts with → contains → one-letter-off (typo), then alphabetical.
  Matches name and login (accounts), name and code (packages, companies, providers). The matched part is bold.
- **Arabic-aware matching:** ignore diacritics and tatweel; أ إ آ ا are one letter, ة = ه, ى = ي; Arabic-Indic digits
  equal Latin digits; case-insensitive for Latin and Hebrew final forms equal their base.
- No match: «لا يوجد اسم مطابق». The field never accepts free text that is not a picked item.
- Sources: accounts from the cached `GET /office/users` list (as `ShellSearch` does); packages, companies, providers
  from their full lists (small). No API change.

**Where it replaces a select** (entity pickers only; fixed enums like status, layer, kind, period stay selects):

| Screen | Picker |
|---|---|
| package sheet, offers tab | account to scope prices to; account to give a custom price |
| users, create form | parent account |
| account actions, move dialog (`transfer-dialog`) | destination parent |
| numbers, new activation | point of sale; package |
| number card | point of sale to move to |
| tasks, numbers, packages, provider operations, user packages tab | company / provider / package filters |

In a `FilterBar`, the field sits as a chip-sized input with the same look as the chip's own list (commit 0c7967e); under 768px inside the «كل الفلاتر» drawer.

### 2b. Language in the topbar

The language moves from the sidebar foot to the topbar, beside the theme toggle, as the same menu the login page uses
(`LanguageSwitch` without `shell`: the current language, a menu of the others). The sidebar foot loses it. Under
360px it stays in the drawer foot, as theme does today.

## Section 3 — Add a package and a company from the provider

### Today

There is no create flow for packages, companies or providers: all come from a seed in code, and the company list is a
code constant (`office-catalog.ts`; `CompaniesService.shelf` maps the constant, not the table). No provider API
adapter exists; matching is simulated. Provider run modes are copied to a package once, at seed, never read again.

### What the owner wants

- **«إضافة رزمة»** (branch, edit grant): pick the company and the provider → «استعلام» → the provider's products for
  that company → pick one → set its facts, settings, extra operations and how each operation runs (branch task or
  direct) → set the prices → save. The settings come from the provider and are **folded** unless the owner opens and
  changes them. The prices are set on the same price-chain editor the package page uses.
- **«إضافة شركة»** the same way: pick the provider → «استعلام» → the provider's companies (operators) → pick → SIM
  rules (length, prefix, eSIM, eSIM price) → save.

### Design

1. **Provider adapter interface** (`providers/adapters/`): `companies()`, `products(companyCode)`, each product with
   the provider's code, name, GB, SMS, minutes, months, provider cost, the extra operations it offers. **For now a
   simulated adapter** answers from a fixed list per provider (as matching is simulated); a real adapter replaces it
   per provider when its API documentation exists (`project-plan.md` :319, «مزامنة المنتجات»). Owner 2026-11-09:
   «ابني وهمي حالياً» — simulated for now.
2. **Companies from the table.** `CompaniesService.shelf` reads the `Company` rows; the code constant stays only as the
   seed. New: `POST /office/companies` (from a provider company), `GET /office/providers/:code/catalog/companies`.
3. **Packages created.** `POST /office/packages` with the picked product, the company and provider, the facts, the
   addons, the ladders, the mode overrides. `GET /office/providers/:code/catalog/products?company=`. A package
   remembers `providerProductCode`, so the same product cannot be added twice.
4. **Real inheritance of run modes.** `Package.actionModes` holds only overrides; a missing action reads the
   provider's mode at run time (`resolvePackageMode`: package override → provider → manual). Existing packages keep
   their stored modes as overrides (no behaviour change); the run tab shows each action «موروث من المزود» or «مخصص»
   with «رجوع للموروث». The same folded block is used in the create flow and on the package page.
5. **The create flow is a page**, `/packages/new` (and `/companies/new`), steps in one column: company & provider →
   query & pick → details → extra operations → how it runs (folded, inherited) → prices → save. The package page's
   editors (details form, addons, modes, price chain) are reused, not copied.

## Section 4 — Companies, providers, packages: one place for each thing

### Today (duplications found)

- Packages are listed in four places (`/packages`, company packages tab, `/companies/[c]/[p]`, provider packages tab),
  all reading the same shelf, all linking to the same package page (`/providers/[p]/[pkg]`).
- Run modes are edited twice with two controls (provider ModeCards; package run tab Select table), not linked.
- eSIM price is edited in three places (company, provider, package); eSIM on/off in two (company, package).
- Package on/off in two places (`/packages` row, package head).
- Provider balance and credit in three places (`/providers`, provider page lede, `/provider-accounts`).

### The structure: the company is the root

| Thing | Its one home | Shown elsewhere only as a read-only link |
|---|---|---|
| Company: name, image, SIM rules, eSIM default | `/companies/[code]` «الإعدادات» tab | — |
| Package: facts, prices, addons, run overrides, on/off | the package page, `/companies/[code]/packages/[pkg]` | the company's «الرزم» tab rows |
| Provider: run defaults, eSIM price | `/providers/[code]` | the company's «المزودين» tab |
| Provider money: balance, credit, payments, matching | `/provider-accounts/[code]` | — |

- **Sidebar (branch):** «الشركات» is the catalog entry (rename «الشركات والرزم»); «المزودين» stays; «الرزم» for the
  branch goes (`/packages` redirects to `/companies`). Lower layers keep `/packages` (their own catalog, unchanged).
- **`/companies/[code]`**, three tabs: **«الرزم»** — every package of the company in one table, with the provider name
  as a column and a provider filter chip, on/off and margin read-only, «إضافة رزمة»; **«المزودين»** — the providers
  that serve this company, with package count and a link to each provider; **«الإعدادات»** — SIM rules and the eSIM
  default.
- **`/providers/[code]`**: run defaults and eSIM price only; its package tab goes (a «الشركات» list links to each
  company's «الرزم» filtered by this provider). Balance and credit stay **read-only** where the Graphite design shows
  them (the provider lede «رصيدك عنده», the `/providers` columns), each a link to `/provider-accounts/[code]`, which
  alone edits them (owner 2026-11-09).
- **Package on/off** only on the package page head; the company table shows it as a badge.
- **Every inherited value shows its source** («موروث من المزود» / «من الشركة») and is edited only where it lives;
  the package page shows it folded with its override.
- Old paths redirect: `/providers/[p]/[pkg]` → `/companies/[c]/packages/[pkg]`; `/companies/[c]/[p]` →
  `/companies/[c]?provider=[p]`.
- **No prototype** (owner 2026-11-09: «امشي علي الوصف»): built from this description.
- **Branch only** (owner 2026-11-09: «هادا التعديل عند الاداره»): main agent, agent and point of sale keep their
  `/packages` catalog and every page they see today, unchanged.

## Section 5 — Layer sign-in rules out of the owner's own settings

«الجلسات حسب الطبقة» (`LayerSessionRulesPane`: open sessions per account and idle timeout, per layer) sits on
`/settings`, the owner's personal account page. It is a system setting, not the owner's account.

- New page **«قواعد الدخول»** `/settings/access`, branch owner only, in the sidebar's «الإعدادات» group beside
  «هوية الموقع». It holds the per-layer rules pane, unchanged in behaviour.
- `/settings` keeps only the signed-in account: profile, password, its own sessions.
- Per-account rules stay on the account (owner 2026-11-09: «وعلى مستوى الحساب من إعداداته وصلاحياته»): the
  account's own values in «إعدادات المستخدم» on the user page, beside its permissions, falling back to its layer.

## Order

1 → 2b → 5 (small) → 2a → 4 → 3 (the create flows land in the new structure).


Status 2026-11-09: spec and plan agreed; the owner asked not to start yet.

## Section 6 — Corrections after review (owner 2026-11-09)

1. **No «قواعد الدخول» page.** Section 5's page goes: an account's own session values stay on its user page
   («إعدادات المستخدم»), and a layer's defaults are set on that layer's role in «الأدوار» (the layer role dialog gets
   the two session fields). `/settings/access` redirects to `/roles`; the sidebar entry goes.
2. **The old announcements board is deleted** from every layer and from the system: the home «لوحة الإعلانات»
   pane, `POST /office/announcements`, the home payload's `announcements` and `canPost`, the `announcement` notice
   kind and the notices group «الإعلانات»; migration drops the `Announcement` table and its notices. The offers hero
   («الإعلانات» page, spec 2026-11-09-offers-…) is the one announcements system.
3. **Branch home, trimmed:** no «آخر العمليات», no «مهام بانتظارك»; the top band loses «الرصيد المتاح» and
   «أرقام فعالة»; the head loses «تمويل حساب» and «تفعيل رقم». Other layers keep their home.
4. **Numbers donut:** each status shows its change over the period picked (اليوم / الشهر / كل المدة) as a count with a
   small arrow — green ↑ for more, red ↓ for fewer, nothing when equal or unknown. Its share moves into the ring's
   middle on hover or focus of a slice (ring or legend). Soft motion: the ring draws in, a hovered slice thickens,
   the others dim; none with reduced motion.
   - The API keeps one snapshot of the viewer's counts per day (`LineCountSnapshot`, written by the overview read).
     Change = now − the latest snapshot before the period: yesterday's for «اليوم», the last day of the previous
     month for «الشهر», zero for «كل المدة». No snapshot yet → no arrow (history starts with this change).
5. **Sidebar handle** shows on hover of the sidebar (and on keyboard focus), hidden otherwise, as in the Graphite
   design.
6. **Topbar search** keeps a steady size at every width (checked at 320 / 375 / 768 / 1024 / 1440).

## Section 7 — More trimming (owner 2026-11-09)

1. **Home:** the «اختصارات» card and the «نظرة عامة» heading go (every layer).
2. **Sidebar:** no language and no theme (also not in the phone drawer): both live in the topbar at every width.
3. **Topbar order** (reading order, so it follows the language's direction): … search, wallet, then **language,
   theme, notices**.
4. **The branch has no wallet:** its balance is unlimited. No wallet chip in its topbar; `/wallet` sends it home;
   the home and finance already show it no balance. Funding other accounts («المحفظة» on user rows) stays.

## Section 8 — Home cards polish (owner 2026-11-10)

1. **Numbers donut, sharp:** the ring and its middle number are drawn clean — square slice ends with a thin gap
   between slices (no rounded ends overlapping the next colour), and the middle number without the outline the
   global icon rule gave every SVG.
2. **Legend order:** label, then the change (arrow + count), then the count **at the line's end**.
3. **«المستخدمون» card, redesigned:** one tile per layer the viewer manages (count, label, link to the list), then
   the credit picture — used of all ceilings as a bar, the debt with the debtors count, and the frozen count.
   Same data, same links.
4. **Period cards:** the trend line sits inside the card under the figures (behind them, along the card's lower
   part) instead of taking a band of its own; the card gets shorter.
5. **Period switch** reads «يوم / شهر / الكل» (en Day / Month / All, he יום / חודש / הכל). The cards' caption keeps
   the long name («هذا الشهر»).
