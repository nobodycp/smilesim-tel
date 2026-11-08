# Profit per layer (roadmap N4)

Date: 2026-11-08 · Status: done · Owner decisions: `docs/project-plan.md` → 2026-11-08 (and the chat of that day)

## Rules (owner)

- The chain is never broken: branch → main agent → agent → point of sale (account creation and moves already keep it).
- Each account sees only its own profit. A layer earns the price it sold at to the layer under it minus the price it
  bought at: branch = main's price − cost; main agent = agent's price − its own; agent = point of sale's price − its own;
  point of sale = its own sell price for the package (`sell-prices`, else the package's subscriber price) − what it paid.
  Branch staff see the branch's profit.
- Old sales count too.

## Design

- `profit-ladder.ts` (pure): `SALE_KINDS` (activate → subscription; charge, extend, reactivate → renewal; a switch moves a
  difference and is not a sale), `ladderOf` (each account's buy price along the chain with the same resolver as
  pricing, `buyPriceFor`; the point of sale's cost is what it actually paid), `marginOf(ladder, viewer)`.
- New sales keep their chain on the wallet entry: `WalletEntry.ladder` (JSONB, migration
  `20261108200000_wallet_entry_ladder`), written in `OfficeKernel.move` for a debit with a sale; a failure to read it
  never stops the sale.
- Older sales are priced with today's prices and the amount the point of sale actually paid (`WalletsService.marginsFor`).
- `GET /office/finance` rows gain `margin` (the viewer's); `GET /office/finance/summary` gains `profit` and `sales` over
  30 days for the viewer's chain.
- Web: «هامش ربحي» column on finance; «أرباحي (30 يوماً)» figure on finance and card on every home.

## Checked

`profit-ladder.spec.ts`, `wallets/margins.spec.ts` (every layer, staff, an old sale), `tests/finance-head.spec.ts`. On the
Docker API with the trial chain: a 400 GB sale (cost 35, main 38, agent 41, point of sale 45, subscriber 70) shows
+25 / +4 / +3 / +3 ₪ to the point of sale, agent, main agent and branch.

## Refunds and the report (owner, same day)

- A refund (`disconnect` with money back) takes back the same share of every layer's margin as the share of the price
  it returns: its entry keeps the line's last sale ladder with `share = −refunded / paid` (`refundLadder`). Older
  refunds use the line's last sale before them. Checked on Docker: 43 ₪ back of 45 ₪ paid (95.6 %) → −23.89 / −3.82 /
  −2.87 / −2.87 ₪ to the point of sale, agent, main agent and branch.
- `GET /office/finance/profits?from&to&q`: the viewer's sales, refunds and net profit by package (company and name),
  with totals; `…/profits/export` as CSV. Web: «الأرباح» in the sidebar for every layer (`/profits`), opening on the
  last 30 days: three cards (sales, refunds, net profit), the table by package, dates and search, «تصدير CSV».
