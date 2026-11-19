# The finance list: one fact a column — spec

Owner (2026-11-19, on `/finance`): the list confuses, because every row's facts are gathered in one «التفاصيل» cell
(number · package · company, then the account, its layer and who made the operation). The branch wants to see every
money operation on every wallet. A point of sale cares about: the time, the kind of operation, the phone number, the
package with its company, the cost price, the sell price, the margin, the balance before and the balance after. When
that is too much for the width, an arrow at the side opens the rest and the row keeps: the date, the reason, the
number, the cost price, the balance before and the balance after.

This is the first step of the finance section's rearrangement (open item of 2026-11-17). It changes how the list is
drawn and adds two figures to its rows; no money rule, filter or permission changes.

Status: built (FL.1, FL.2) with the owner's changes of 2026-11-19 in; FL.3, the reading on the page, is open.

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

The principle (owner, 2026-11-19, after the first draft): **«المبلغ» is the movement that happened on the wallet, for
every viewer**; the balance before and after are before and after it; everything else on the row explains it.

| # | Column | Who sees it | When the row is narrow |
|---|---|---|---|
| 1 | الوقت | all | stays |
| 2 | السبب (the kind tag, the loss mark, the manual reason, an «eSIM» mark) | all | stays |
| 3 | الحساب (the wallet's account, its layer) | any viewer with accounts below it (not a point of sale) | folds 4th |
| 4 | الرقم | all | stays |
| 5 | الرزمة, the company under it | all | folds 1st |
| 6 | المبلغ (the movement on that wallet, signed) | all | stays |
| 7 | سعر التكلفة | all | folds 5th (last) |
| 8 | سعر البيع | all | folds 2nd |
| 9 | الهامش | all | folds 3rd |
| 10 | الرصيد قبل | all | stays |
| 11 | الرصيد بعد | all | stays |
| 12 | the arrow | all | stays |

- «سعر التكلفة» is the price of what was bought for the viewer — `costs[viewer]` from the stored ladder — never the
  movement: a package that costs the point of sale 30 ₪ sold as an eSIM with a 5 ₪ fee reads amount −35.00, cost
  30.00. A row that is not a sale or refund (funding, a deduction, a hold, a release, an operation that moved nothing)
  shows «—» in 7–9; its amount carries the figure.
- The «السبب» cell marks an eSIM sale with the tag «eSIM» only, without the fee's figure; the fee is read under the
  arrow («رسم eSIM: 5.00 ₪»). A funding row's tag says what it is; a deduction's reason is a badge beside its tag and
  its note is under the arrow; an add-on shows what the entry stores (number, package, note).
- **The arrow** opens the row's remaining facts under it, labelled, one a line: whatever columns the width has folded
  away, and always the ones that have no column — who made the operation (when it is not the wallet's own account),
  the note, the eSIM fee, the held amount, the branch's loss mark, and for the branch the chain's shares (who earned
  what; this replaces the shares dialog). A row with nothing more to say has no arrow.
- Wide screens show every column the viewer has; as the width falls, the columns leave one at a time, measured, in
  the order package, sell, margin, account, cost. The time, the reason, the number, the amount and the two balances
  never leave: on a phone the row is those six and the arrow. No horizontal scrolling at any width.
- **What the list holds** (owner's point 7: «المالية» is the movements on the wallets). By default, the money: an
  entry whose amount is not 0; a hold and a release (money held and freed, with the held figure); for the branch the
  entries marked as its loss (they move 0 but are the branch's money, and its loss filter keeps finding them). The
  «العرض» filter: «الحركات المالية» (the default, also `?scope=money`), «كل العمليات» (`scope=all`: every entry, the
  operations that moved nothing — a refresh, a freeze — included), «العمليات فقط» (`scope=operations`: the line
  operations, as the home's link opens it). Filtered in the database; the CSV follows the same filter.
- Sorting, paging, the other filters, the CSV link, the loss filter and the empty and loading states are as today.
  The CSV gains the two figures as columns.

## Where

`/finance` for every layer, agents and main agents with the branch's columns (owner, confirmed). `/wallet` (an
account's own statement) and the other finance pages stay as they are in this slice (owner: "stay on the current
page"); `GET /v1/ledger` already carries the two figures for when they follow.

## Proof

`npm run lint`, `typecheck`, `check:copy`, `check:styles`; the API specs of `wallets` and `testing`; the page read in
the browser as the branch and as a point of sale, ar and en, dark and light, at phone, tablet and desktop widths,
with a row opened; the figures of one sale checked against its entry (cost, sell, margin for each of the two
viewers).

## The owner's answers (2026-11-19)

1. Agents and main agents get the branch's columns: yes.
2. Every layer has «المبلغ», the point of sale included; the cost column never shows the movement.
3. The other pages of the finance section are not rearranged here.
4. Points 4–7 above: the fold order, the «eSIM» mark without its figure, the money by default.
