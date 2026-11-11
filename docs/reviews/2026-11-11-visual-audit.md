# Visual audit — 2026-11-11

Spec: `docs/superpowers/specs/2026-11-11-ui-consistency-pass.md` (D8). Plan: `docs/superpowers/plans/2026-11-11-ui-consistency-pass.md`.

## How to re-run

The audit drives the one running copy (port 3000, `npm run dev:local`) and starts no server.

```
cd apps/web
RUN=<name> npx playwright test -c visual-audit/audit.config.ts
git checkout -- tsconfig.json      # Playwright rewrites it
```

Env: `WIDTHS` (default `390,768,1280`), `COMBOS` (default `ar-dark,en-light`), `ONLY` (a substring of a route),
`DOOR` / `USER_LOGIN` (default `admin` / `branch`). Screenshots and `findings-<door>-<combo>.json` land in
`apps/web/audit-output/visual-audit/<RUN>/` (git-ignored). Each route is shot once per width, and once per tab when
the page has a tab strip.

What it flags on its own: sideways page scroll (`hscroll`), a box past the viewport edge (`past-edge`), clipped text
(`clipped-text`), a control under 32px on a phone outside a table (`small-target`), text under 11px (`tiny-text`;
the shekel sign `small.cur` is drawn at 0.65em on purpose), and a native checkbox or select (`native-control`).
What it cannot see — layout, order, duplication, wording — is read from the screenshots and listed below.

Do not edit the app while it runs: a hot reload mid-run breaks the page it is on.

## Baseline (RUN=before, ar-dark, 390 / 768 / 1280)

No sideways scroll and nothing past the edge on any route. Counted findings: 140 small targets, 112 tiny text (all
but `.bp-tag` on branding are the shekel sign), 9 native controls.

| # | Where | Finding | Phase | Status |
|---|---|---|---|---|
| 1 | everywhere | «شريحة عادية» / «شريحة إلكترونية» instead of SIM / eSIM | 1 | fixed b0d3e9a |
| 2 | `/numbers` | no SIM / eSIM filter | 1 | fixed b0d3e9a |
| 3 | `/companies` | «eSIM» tag on every card; ⋯ menu repeats «تعديل» (= opening the card) and holds the picture upload | 2 | fixed (phase 2) |
| 4 | `/companies` (phone) | one tall card per row, name link 23px high, the rest of the card not a link | 2, 5 | fixed (phase 2): two cards a row, the whole card is the link |
| 5 | `/companies/:c` settings | native checkbox for eSIM; fields scattered on two columns; no picture | 2 | fixed (phase 2) |
| 6 | `/companies/:c` packages | status is a read-only badge; on/off lives inside the package page; ⋯ menu with one item | 2 | fixed (phase 2) |
| 7 | `/users` ⋯ and `/users/:l` ⋯ | «إعدادات المستخدم» is a dialog reached from menus, not part of the user page | 3 | fixed (phase 3) |
| 8 | `/users/:l` «صلاحيات الحساب» | native select per grant, header row printed twice, native checkboxes for extra roles | 3 | fixed (phase 3) |
| 9 | `/users/:l` (phone) | the tab strip cuts the last tab with no hint that it scrolls | 5 | fixed (phase 5) |
| 10 | `/numbers/:id` | «شحن» and «تمديد» buttons in the head repeat two tiles of the «العمليات» grid | 4 | fixed (phase 4) |
| 11 | `/numbers/:id` «التفاصيل» | a plain fact list and empty usage dials, not the office's cards | 4 | fixed (phase 4) |
| 12 | dialogs | same component, but fields, widths and marks differ from one to the next | 4 | fixed (phase 4) |
| 13 | package page «الأسعار» | the price chain is two tall boxes of stacked inputs; eSIM price sits between them | 4 | fixed (phase 4) |
| 14 | every pager (phone) | page buttons 30px wide, page-size select 28px high | 5 | fixed (phase 5) |
| 15 | home (phone) | the numbers-by-status legend links are 27px high | 5 | fixed (phase 5) |
| 16 | `/providers/:p` (phone) | one tall run-mode card per row | 5 | fixed (phase 5) |
| 17 | lists (phone) | users and numbers tables scroll sideways inside their card; the status and actions are off screen | 5 | fixed (phase 5) |
| 18 | `/tasks`, `/users/:l` (phone) | tab strips cut the last tab | 5 | fixed (phase 5) |
| 19 | package page «التفاصيل» | «الرزمة متاحة كـ eSIM» is a native checkbox | 4 | fixed (phase 4) |
| 20 | `/companies/:c` packages (phone) | the on/off switch sits in a column off screen | 5 | fixed (phase 5) |

## After (RUN=after, ar-dark and en-light, 390 / 768 / 1280)

Run after phase 5. No sideways scroll and nothing past the edge on any route, in either combination. Findings fell
from 261 (ar-dark alone) to 42 per combination, then the page-size select and the number page's point-of-sale link
were raised to 40px on phones. What is left, on purpose:

- `/offers` (phone): the carousel dots are 20px wide inside a 44px-high hit area — the offers page keeps its design
  (spec non-goal).
- `/branding`: the breakpoint tags (`.bp-tag`) are 10px labels in a preview — branding keeps its design.
- A checkbox inside a `label.check` reports 18px; the whole label is the target.

Native controls: none left (checkboxes and radios are drawn by the system since phase 4).

The second-model review of phase 5 then found, and the follow-up commit fixed: the zebra tint painted each value of
a phone card instead of the card; a tab strip inside a pane (company page) still cut its last tab — tab strips are now
an even grid on phones (three a row, two a row for two or four tabs); the offers table made its picture the card
title; a cell whose header is hidden text (status) had no label. Known and accepted: on phones the column headers are
hidden, so a list cannot be re-sorted there (it keeps the server's order); the table keeps its roles for screen
readers through explicit `role` attributes.

## Deep pass (owner, 2026-11-11 evening)

The owner found «إضافة شركة» / «إضافة رزمة» unlike «تفعيل رقم» after I had called the buttons consistent. A new rule
(`.cursor/rules/verify-before-reply.mdc`) now requires comparing each kind of element on every page against the
reference, measured and clicked. This pass measured the page heads, tabs, filters, tables and forms of 22 routes and
looked at every route and tab full size. Found and fixed:

| Where | Finding | Fix |
|---|---|---|
| every page head | main actions ink, only «تفعيل رقم» crimson | one rule: a page head's primary button is crimson |
| user page | the boxed ⋯ drawn unlike the «المحفظة» button beside it | drawn as the secondary button |
| notices | «قراءة الكل» a ghost button | secondary, as other head actions |
| company, provider, number, package pages | tabs inside the card; six other pages put them above | tabs above their content everywhere |
| company packages | provider filter outside the filter bar | `FilterBar` |
| home providers card | a hand-written table without sorting | `DataTable` |
| finance, provider ledger, offers dialog | the browser's date input (`mm/dd/yyyy`) | `DateField` with the system's month |
| reconciliation | the browser's file input, in English | a system button and the chosen file's name |
| package page, settings, matching, session rules | «حفظ» small/secondary in some forms, primary in others | every form submit primary, default size |
| offers | four icon buttons per row | the row's ⋯ menu; the delete was read as «حذف الحساب» |
| tables | «إجراءات» shown in some heads; sort arrows on blank heads (picture, tick box) | hidden for readers only; no sort without words |
| user page | five figure cards as four and one | five in a row, three and two on a middle width |
| finance (phone) | the details cut at the card's edge (a 220px desktop minimum) | cell content fits the card; the audit now flags `cell-overflow` |

Final run (`RUN=final`, 390 / 1280, ar-dark and en-light): no sideways scroll, nothing past the edge, no native
control; left on purpose: the offers carousel dots, the branding preview's 10px tags, a tick box inside its label.
