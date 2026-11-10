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
| 7 | `/users` ⋯ and `/users/:l` ⋯ | «إعدادات المستخدم» is a dialog reached from menus, not part of the user page | 3 | open |
| 8 | `/users/:l` «صلاحيات الحساب» | native select per grant, header row printed twice, native checkboxes for extra roles | 3 | open |
| 9 | `/users/:l` (phone) | the tab strip cuts the last tab with no hint that it scrolls | 5 | open |
| 10 | `/numbers/:id` | «شحن» and «تمديد» buttons in the head repeat two tiles of the «العمليات» grid | 4 | open |
| 11 | `/numbers/:id` «التفاصيل» | a plain fact list and empty usage dials, not the office's cards | 4 | open |
| 12 | dialogs | same component, but fields, widths and marks differ from one to the next | 4 | open |
| 13 | package page «الأسعار» | the price chain is two tall boxes of stacked inputs; eSIM price sits between them | 4 | open |
| 14 | every pager (phone) | page buttons 30px wide, page-size select 28px high | 5 | open |
| 15 | home (phone) | the numbers-by-status legend links are 27px high | 5 | open |
| 16 | `/providers/:p` (phone) | one tall run-mode card per row | 5 | open |
| 17 | lists (phone) | users and numbers tables scroll sideways inside their card; the status and actions are off screen | 5 | open |
| 18 | `/tasks`, `/users/:l` (phone) | tab strips cut the last tab | 5 | open |
| 19 | package page «التفاصيل» | «الرزمة متاحة كـ eSIM» is a native checkbox | 4 | open |
| 20 | `/companies/:c` packages (phone) | the on/off switch sits in a column off screen | 5 | open |
