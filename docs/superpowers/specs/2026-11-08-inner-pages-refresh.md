# Inner pages refresh — trail, tabs, cards, the user page, the finance page

Date: 2026-11-08 · Status: approved by owner (chat, 2026-11-08, from two reference screenshots) · Plan: `docs/superpowers/plans/2026-11-08-inner-pages-refresh.md`

The owner liked parts of another dashboard and asked for the ideas, in our Pearl look (our tokens, our type, no copied
brand or colours). Approved: 1 (trail), 2 (user page + tabs everywhere), 3 (cards), 5 (tab counts), 6 (finance).
Declined: the greeting stays in the topbar; the topbar wallet stays as it is; no price-source banner.

## 1. Trail instead of «رجوع»

Where the shell drew the «رجوع» button above a detail page, it draws a trail: `المستخدمون › pos1 (نقطة بيع)`,
`المزودون › سلكوم › 150 جيجا`. Every part but the last is a link; the last is the page (`aria-current="page"`). The
first part is the section's sidebar label; a deeper part shows the name its page registers (`useCrumb`), or the raw
segment until it does. `nav[aria-label]` with an ordered list. The greeting in the topbar does not change.

## 2. Tabs everywhere, with counts (and 5)

One `Tabs` component (`components/tabs.tsx`) replaces the six hand-written `.steps` lists: a segmented control — a
soft rounded track holding the tabs, the selected one on the surface with a hairline and ink text. A tab may carry a
`count` (a small pill). Keyboard: ArrowLeft/Right/Home/End move and select (WAI-ARIA tabs).

## 3. Cards

`Stat` (and the user page's cards) take the reference's calmer card: white surface, hairline, 12px radius, label at
the start, a small muted icon at the end, a large value, a muted caption. `highlight` tints the card with
`--rd-success-soft` and a success hairline (the one figure that matters most on a screen). `progress` draws a thin bar
under the value (ceiling used).

## 2b. The user page

- **Head:** the account name (`login (full name)`) with its status badge, a muted line under it (layer · follows ·
  role), and the account's actions as buttons at the inline end: «تمويل», «السقف», «كلمة سر جديدة» where the actor may,
  and ⋯ for the rest (freeze/restore, enter, move, delete) — the same dialogs and rules as the users list (one
  `AccountActions` component shared by both).
- **Cards:** balance, ceiling (with the used share as a bar), used from the ceiling, available to sell (highlighted).
  The account answer (`GET /office/users/:login`) gains `balance` and `ceiling`; the list's `canFund`/... rules move
  with the actions.
- **Tabs:** the new `Tabs`, with counts: packages with a custom price, operations stopped.

## 6. Finance page

For the signed-in account's own wallet, above today's ledger table:

- Four cards (balance, ceiling, used, available — the last highlighted).
- «الرصيد عبر الوقت»: the end-of-day balance for the last 30 days, an SVG line (no chart library), with now and the
  change over the period.
- Three figures for the last 30 days: money in, money out, entries.
- «تصدير CSV»: the ledger with the filters on screen, as a UTF-8 CSV (BOM, so Excel reads Arabic), at most 10,000
  rows.

API: `GET /office/finance/summary` (own wallet: balance, ceiling, `in30`, `out30`, `count30`, `series[30]`) and
`GET /office/finance/export?…` (same filters as `/office/finance`, `text/csv`). Both for every signed-in account,
scoped like the ledger.

## Checks

e2e for the trail, the tabs (keys, counts), the user page head and cards, the finance summary and export; API specs
for summary, export and the account's balance; route table and permission matrix gain the two routes. Screenshots
light/dark, ar/en, desktop/390 px.
