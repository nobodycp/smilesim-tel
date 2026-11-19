# The finance list: one fact a column — spec

Owner (2026-11-19, on `/finance`): the list confuses, because every row's facts are gathered in one «التفاصيل» cell
(number · package · company, then the account, its layer and who made the operation). The branch wants to see every
money operation on every wallet. A point of sale cares about: the time, the kind of operation, the phone number, the
package with its company, the cost price, the sell price, the margin, the balance before and the balance after. When
that is too much for the width, an arrow at the side opens the rest and the row keeps: the date, the reason, the
number, the cost price, the balance before and the balance after.

This is the first step of the finance section's rearrangement (open item of 2026-11-17). It changes how the list is
drawn and adds two figures to its rows; no money rule, filter or permission changes.

Status: built as a first version for the owner to read on the page; the open points are at the end.

## The figures

Each layer reads **its own** price on a sale, never another layer's:

| Column | A point of sale | An agent / main agent | The branch |
|---|---|---|---|
| سعر التكلفة (cost) | what it paid for the sale | what it paid its parent on that sale | what the provider was paid |
| سعر البيع (sell) | the subscriber's price | what the account below it paid | what the main agent (or the next account in the chain) paid |
| الهامش (margin) | sell − cost: the margin the entry stores for it (ADR 0026) | the same | the same |

All three come from the entry's stored ladder (`costs` by account, `posSell`) and its stored margins; nothing is
priced again. The API adds `cost` and `sell` to each item of `GET /v1/finance` (and its CSV) and of `GET /v1/ledger`,
**for the viewer's own account only** (null when the entry is not a sale or refund in its chain); the ladder itself
is never sent. A refund's figures are its sale's scaled by the part given back, signed as the margin is. `margin`
is unchanged. `response-shape.spec.ts` pins the two new fields; a spec proves a point of sale's row carries no figure
of a layer above it.

## The columns

| # | Column | Who sees it | Stays when the row is narrow |
|---|---|---|---|
| 1 | الوقت | all | yes |
| 2 | السبب (the kind tag and its badges, as today) | all | yes |
| 3 | الحساب (the wallet's account, its layer) | any viewer with accounts below it (not a point of sale) | in the opened part |
| 4 | الرقم | all | yes |
| 5 | الرزمة, the company under it | all | in the opened part |
| 6 | المبلغ (the movement on that wallet, signed) | any viewer with accounts below it | in the opened part |
| 7 | سعر التكلفة | all (a point of sale's cost is the amount it paid, so it has no column 6) | yes |
| 8 | سعر البيع | all | in the opened part |
| 9 | الهامش | all | in the opened part |
| 10 | الرصيد قبل | all | yes |
| 11 | الرصيد بعد | all | yes |
| 12 | the arrow | all | yes |

- A movement that is not a sale (funding, a deduction, a hold, a release, an operation that moved nothing) shows «—»
  in 7–9. For a point of sale column 7 then shows the movement's amount, signed, so no row hides what changed the
  balance.
- **The arrow** opens the row's remaining facts under it, labelled, one a line: whatever columns the width has folded
  away, and always the ones that have no column — who made the operation (when it is not the wallet's own account),
  the note, the eSIM fee, the held amount, the branch's loss mark, and for the branch the chain's shares (who earned
  what) that the row shows today. A row with nothing more to say has no arrow.
- Wide screens show every column the viewer has; as the width falls, the columns marked "in the opened part" leave
  first (package, sell, margin; then account and amount) and are read under the arrow. On a phone the row is the six
  the owner named. No horizontal scrolling at any width.
- Sorting, paging, the filters, the CSV link, the loss filter and the empty and loading states are as today. The CSV
  gains the two figures as columns.

## Where

`/finance` for every layer. `/wallet` (an account's own statement) takes the same row when it shares the list's
parts, so the two read alike; otherwise it is left for the next step.

## Proof

`npm run lint`, `typecheck`, `check:copy`, `check:styles`; the API specs of `wallets` and `testing`; the page read in
the browser as the branch and as a point of sale, ar and en, dark and light, at phone, tablet and desktop widths,
with a row opened; the figures of one sale checked against its entry (cost, sell, margin for each of the two
viewers).

## For the owner

1. Agents and main agents get the same columns as the branch (with «الحساب» and «المبلغ»). Right?
2. A point of sale's «سعر التكلفة» on a funding or a deduction shows the amount moved (it has no «المبلغ» column).
   Or should the point of sale also have «المبلغ»?
3. The other pages of the finance section (المحفظة, الأرباح, الأرصدة) are not rearranged here.
