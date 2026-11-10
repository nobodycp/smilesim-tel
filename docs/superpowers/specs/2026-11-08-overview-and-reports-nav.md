# Full overview, reports menu, finance ledger and two layer bugs

Date: 2026-11-08 · Status: approved 2026-11-09; slices A and B done · Owner request: chat 2026-11-08 («بدي تكون نظره شامله وكامله لكل واحد ف الطبقه حسب احتياجه وصلاحيته»)

## Goal

Every layer opens the office and sees its whole picture in one place, scoped to its chain and its grants. Finance, operations, profits and the other reports become one collapsible «التقارير» menu with one page per report. Two layer bugs are fixed first.

## Findings (code as of `8c8bd36`)

1. **Admin enters a point of sale and sees the admin menu.** `OfficeShell` takes the layer from the host (`door.layer`, `components/office-shell.tsx:105`). Entering an account keeps the `admin.` host, so the branch menu, the branch packages screen (`packages-screen.tsx:537`) and the branch line card (`line-card-screen.tsx:59`) are drawn. `useRequireLayer` needs both the door and the account to match, so a point-of-sale-only page sends the admin back home while entered.
2. **«العمليات» is empty for the branch.** `WalletsService.ledger('operations')` reads only `userId: actor.id`. A sale debits the point of sale's wallet alone (the upper layers' margins come from the ladder, not from postings), so the branch, the main agents and the agents have no operation entries of their own.
3. **Profits appear twice in the sidebar.** `/profits` has its own link, and it is also a tab of `/reports`.
4. **Reports are tabs.** `/reports` holds sales, profits, orders, balances and providers behind `?tab=`. Finance (`/finance`), operations (`/operations`) and provider operations (`/provider-operations`) are separate links in three different groups, and operations sits under «غير جاهز».
5. **The home page is thin.** `GET /office/home` returns open tasks, active, inactive and expiring line counts, the last operations and the board. It has no period filter, no frozen or stuck counts, no providers, no sales detail, no rankings, no users or debts, and no task breakdown.

## Decisions

### A. Entering an account opens that account's door (bug 1)
Owner (2026-11-09): «لما الادمن يدخل حساب يوديه علي لينك الطبقه».
- `POST /office/users/:login/enter` keeps its checks and creates the impersonation session as today, but it no longer rewrites the cookies on the admin host. It returns `{ door, code }`. `code` is a one-time handoff code (32 random bytes, in Redis under `auth-secret:handoff:*`, 60 s, deleted on first use) holding the impersonation session and the owner's current session.
- The web goes to the target layer's door, `doorOrigin(door)/enter#<code>`. The code travels in the fragment, so it never reaches a server log. That page posts the code to `POST /office/handoff`, which sets `sid` (impersonation) and `home` (the owner's session) on that host and answers `{ ok }`. Then the page loads `/`. With `COOKIE_DOMAIN` set (production) the cookies cover every door, as today. Without it (local) they belong to the target host only, and the admin tab keeps the owner's own session.
- `DoorMiddleware`: an impersonation session is checked against the entered account's layer, not the owner's. The point-of-sale door accepts it; the admin door refuses it (`DOOR_MISMATCH`). The office therefore draws the entered layer's menu, packages and line card because its door is that layer, and no screen needs a layer override.
- Leaving (`POST /office/leave`, unchanged on the API) restores `sid` from `home`. The web then loads `doorOrigin(admin)/users`.
- The "returning" bar keeps showing while entered.

### B. Operations across the chain (bug 2)
- `GET /office/ledger/operations` reads the line operations of every account the viewer can see (`visibleAccountIds`, the same rule as finance). Each row adds the account's login and layer, plus the viewer's margin (`marginsFor`).
- For a point of sale the result is the same as today, its own operations. The response shape gains fields and loses none.

### C. «التقارير» menu (findings 3 and 4)
- A collapsible sidebar group «التقارير», closed by default, that opens by itself when one of its pages is the current page (the `NavGroup` already does this). It replaces the separate finance, profits, reports, provider-operations and «غير جاهز» links.
- Items, each its own page (the URLs that exist are kept):
  - المالية `/finance`
  - العمليات `/operations`
  - الأرباح `/profits`
  - المبيعات `/reports/sales`
  - الطلبات `/reports/orders`
  - الأرصدة `/reports/balances` (main agent and agent and up)
  - المزودون `/reports/supply` (branch with the reports grant)
  - عمليات المزودين `/provider-operations` (branch with the reports grant)
  - مطابقة المزودين (branch with the accounting grant; see E)
- `/reports` redirects to `/reports/sales`. The tab strip goes away, and each tab's component becomes its page. The older `/reports/[kind]` lists keep working; any kind whose name collides with a new static page is renamed in the slice that adds the page.
- The point of sale gets the same group with the items its layer is allowed.

### D. Finance ledger
Owner (2026-11-09): «الماليه تكون شامله كل العمليات للاب والابناء الي تحته».
- Every entry of the viewer's own wallet and of every account below it, including the operations that move no money (freeze, rename, refresh and the like, which `financeWhere` drops today with `amount != 0`). One row each: when, account and layer, operation name, signed amount (green `+` in, `−` out, with a badge as well as the colour), balance before, balance after, the viewer's profit on that row, then number, company and package.
- The branch sees the whole tree; a main agent, agent or point of sale sees itself and its descendants. The profit column is the viewer's own margin. The branch can also open a row to see the whole ladder: who earned what on that sale.
- The filters gain "money only / all operations". The CSV follows the same filters.

### H. User page: grouped actions and user settings
Owner (2026-11-09): the actions are scattered.
- **Wallet button:** one «المحفظة» button with a menu (charge, deduct, set ceiling, statement) replaces the separate charge and deduct buttons, on the list's row menu and on the user page.
- **User settings:** a «إعدادات المستخدم» dialog replaces «الجلسات». It edits email and mobile, turns two-factor on or off, changes the password, and keeps the sessions rules inside it. The quick password button stays where it is.
- **Tabs:** the user page keeps two tabs, «الحساب» and «الرزم والأسعار». Inside «الحساب», permissions, operations and numbers are collapsible sections, closed by default and loaded only when opened.

### I. Suspended lines (المعلّقة)
Owner (2026-11-09): «معلقه وليست عالقه — خط انتهي اشتراكه منذ 90 يوم ديفولت», and each package has its own period.
- New package field `suspendAfterDays` (integer, default 90), edited in the package's «التفاصيل» tab.
- A line is **suspended** when its subscription ended at least `suspendAfterDays` days ago (its package's value, else 90). It is derived, not stored: `status` stays as it is, and the numbers list gains a `status=suspended` filter.
- The home lines donut uses: active, expiring soon, frozen, disconnected, suspended.

### E. Provider operations and matching
- `/provider-operations` stays the live list of operations sent to providers. It gains the channel (API or manual link), the provider's answer and status, and a matching column: the system's cost against what the provider charged, with the difference highlighted.
- Owner (2026-11-09): «ممكن نربطه عبر الapi وممكن عبر الكشف — لما يكون api خلي المطابقه تلقائيه ولما يكون عبر الكشف المطابقه بتسير دوريه».
- Each provider has a matching source: **API** or **statement**.
  - **API:** each operation is matched as soon as the provider answers. The provider's charged amount is stored on the operation, and a difference from the system's cost marks it «فرق» at once. A difference also feeds provider health (G).
  - **Statement:** matching is periodic. The provider page shows when the last statement was matched, and the next one is due after a period set per provider (default 7 days). When it is overdue, the provider shows «مطابقة متأخرة» and the owner gets a notice. The existing statement upload and reconciliation runs do the matching.
- `/provider-operations` shows, per operation, the source, the system cost, the provider amount (or «بانتظار الكشف» until a statement covers it), and the difference.
- The menu item «مطابقة المزودين» links to the provider accounts list, which gains each provider's source, last matched, and open differences.

- **Simulated for now** (owner 2026-11-09: «اجل موضوع المطابقه… اعمل مطابقه وهميه حسب المزودين الي عندنا»): no provider is called through a real API yet (an «تلقائي» mode applies the operation inside the office). Until real providers are connected, each provider gets a demo source and the matching is simulated from our own provider cost, with a few deterministic differences, so the screens and the flow can be seen. The real adapters replace the simulator later; the screens, fields and notices stay.

### F. Home: one overview per layer
- A period switch: اليوم / الشهر / الكل. It applies to every money and count card below. Line status cards are "now".
- Cards, each shown only to the layers and grants that may see its data:
  1. **Lines (donut + legend beside it):** active, disconnected, frozen, expiring soon, stuck. Each slice links to `/numbers` with that filter.
  2. **Sales detail:** sales count, amount, my profit, refunds, net, and a small trend over the period.
  3. **Providers (branch):** per provider, the period's consumption, its balance and credit, and its status (working / problem) with the reason.
  4. **Rankings, with tabs:** top packages, top companies by profit, top providers by profit (branch).
  5. **Users:** counts by layer, total debt (accounts below zero), total ceilings, used ceiling.
  6. **Most active users, with tabs:** main agents / agents / points of sale. Each layer sees only the tabs below it.
  7. **Tasks:** counts by status (open, in progress, done, rejected, cancelled) and the oldest open task's age.
  8. The existing last operations and board, below.
- Visual: the cards follow `DESIGN.md` and `smilesim-ui.mdc`, with tokens only. The "geometric shapes" are a token-coloured decorative layer, behind the hero and the card corners, decided in the visual slice and recorded in `DESIGN.md`.
- One new endpoint, `GET /office/overview?period=day|month|all`, returns all cards in one read, computed in the database with the viewer's visibility. `GET /office/home` stays as it is.

### G. Provider health and alerts
- A provider is "problem" when any of these hold: its recent operations failed (the threshold is set in the slice), its available balance is under a floor the owner sets, or its last API call failed. Otherwise it is "working".
- A change from working to problem writes a notice to the branch owner and to staff with the edit grant, using the existing notices and SSE stream, plus a banner on the home page. The change back writes a "recovered" notice.

## Non-goals
- No change to how money moves, to margins, or to the ladder.
- No new chart library: charts are SVG, like `BalanceChart`.
- Not real provider API integration if it does not exist yet (see open question 3).

## Open questions (owner)
1. ~~Finance~~: answered 2026-11-09 (D).
2. ~~Stuck lines~~: they are suspended lines, answered 2026-11-09 (I).
3. ~~Provider-side amount~~: both, answered 2026-11-09 (E).

## Order
The plan `docs/superpowers/plans/2026-11-08-overview-and-reports-nav.md` has one slice per decision, in this order: A → B → C → D → H → I → F → G → E (simulated; owner 2026-11-09).
