# Content UI coverage — 2026-10-30

Source: working tree after the canvas design pass. Web `next dev` on port 3000. API was already running and was not rebuilt for this pass. Viewport used for the implementer pass: 845×894 unless noted. Locale starts as Arabic (`ar`, `rtl`).

Shell (sidebar and header) was not restyled. At 845px the greeting still clips the account name when the wallet chip is visible (`صباح الخير، .anch`, and `Good morning, bra` in English). Hebrew `בוקר טוב, branch` fits. That clip is in the header, which this pass left alone.

## Inventory

| ID | Surface | Route | Who sees it |
| --- | --- | --- | --- |
| home | Home | `/` | every door |
| users | Users | `/users` | branch, main agent, agent |
| plans | Plans | `/plans` | every door |
| numbers | Numbers | `/numbers` | every door |
| line | Line | `/numbers/:id` | every door |
| providers | Providers | `/providers` | branch owner or edit |
| provider | Provider packages | `/providers/:code` | branch owner or edit |
| package | Package sheet | `/providers/:code/:package` | branch owner or edit |
| tasks | Tasks | `/tasks` | every door |
| operations | Operations | `/ledger/operations` | every door |
| accounting | Accounting | `/accounting` | every door |
| audit | Audit | `/audit` | every door |
| report-consumption | Balance use | `/reports/consumption` | branch owner or reports |
| report-providers | Provider reports | `/reports/providers` | same |
| report-funding | Balance top-ups | `/reports/funding` | same |
| report-tasks | Task reports | `/reports/tasks` | same |
| report-numbers | Number reports | `/reports/numbers` | same |
| report-operations | Operation reports | `/reports/operations` | same |
| settings | Profile | `/settings` | every door, header menu |
| login | Sign-in | `/login` | logged out |
| password | Password change | `/password` | forced change |
| two-factor | Two-factor | `/two-factor` | challenge |

Redirects, not pages: `/staff` → `/users`, `/wallets` → `/users`, `/reports` → `/reports/consumption`, `/ledger/audit` → `/audit`.

POS has no Users, Providers, or Reports. Those are not applicable on `pos.localhost`.

## Implementer decisions

| ID | Locale | Viewport | State | Status | Note |
| --- | --- | --- | --- | --- | --- |
| home | ar | 845 | populated | pass | Title is الصفحة الرئيسية. KPIs are real counts. |
| users | ar | 845 | populated | pending | Filters and badges inspected before the row control became an ellipsis. Recheck the button. |
| plans | ar | 845 | populated | fail | Price editor column is cut to a sliver. The sheet scrolls. |
| plans | ar | 1440 | populated | pending | Editor (حفظ + price) was fully visible in a crop. Full frame not reviewed. |
| numbers | ar | 845 | one disconnected line | pending | تفعيل was covered by the date before padding tightened. Recheck. Do not press تفعيل. |
| providers | ar | 845 | populated | pending | List was readable. Recheck after panes stopped stretching. |
| provider | ar | 845 | Lian | pass | Companies, logos, يعمل badges, costs. |
| package | ar | 845 | operations tab | pass | Tabs التشغيل / السلسلة / المخصصون. Chain and offers not opened. |
| tasks | ar | 845 | populated | pass | Status badges and the −43 amount align. |
| operations | ar | 845 | empty | pass | Four filters and لا حركات بعد. |
| accounting | ar | 845 | empty | pass | Search and empty table. |
| audit | ar | 845 | populated | fail | Last column is cut to a single letter. |
| report-consumption | ar | 845 | populated | pass | Signed amounts. Other report kinds share this table and were not opened. |
| settings | ar | 845 | populated | pass | Account, password, two-factor, sessions. |
| settings | en | 845 | populated | pass | LTR. Sidebar on the left. |
| settings | he | 845 | populated | pass | `he` `rtl`. Greeting fits. |
| line | — | — | — | pending | Not opened. |
| package chain / offers | ar | 845 | — | pending | Tabs not opened. |
| users dialog | ar | 845 | — | pending | Not opened after the ellipsis change. |
| 390px | — | 390 | — | pending | Not captured. |
| POS / clerk doors | — | — | — | pending | This pass stayed on the branch door. |

Login, password, and two-factor are the auth frame, not canvas pages.

## Contract

Inner pages use `.page-head`, `.filter-bar`, `.pane`, `.steps`, `.data`, `.badge`, `Dialog`, and `RowMenu`. Rules: `DESIGN.md` (Inner pages) and `.cursor/rules/content-ui.mdc`.
