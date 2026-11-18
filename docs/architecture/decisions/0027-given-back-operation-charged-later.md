# 0027 — A given-back operation is charged later by a sale entry with provider cost 0, and its mark is turned

- Date: 2026-11-18
- Status: **accepted** (the owner, 2026-11-18: «اقتراحك ممتاز امشي عليه»).
- Spec: `docs/superpowers/specs/2026-11-17-scale-speed-cleanup.md`, section "A given-back operation charged later
  (DB.5 P.9)". Plan: `docs/superpowers/plans/2026-11-17-database-scale.md`, "Provider ledger P.9".
- Builds on ADR 0025 (the operation's provider and cost on its entry; P.7's loss mark, P.8's losses in the profit) and
  ADR 0026 (each sale's margins stored on its entry). Changes neither invariant.

## Context

An activation the provider carried out and whose money was given back to the point of sale (`release-after-success`)
is a purchase and the branch's loss: its entry moves 0, stores the provider's cost and `branchMargin` = − cost, and
is marked `given_back` (P.7). The home, the profit report and the provider screens warn about it (P.8). The owner
(2026-11-18): such an operation can be charged to the point of sale again, and that is the fix; the warning should then
go and the profit be right.

## Alternatives

1. **A manual deduction** (`wallets/:loginName/deduct`). Moves the money, but nothing ties it to the operation: the mark
   and the loss stay, the warning stays, the deduction is no sale (no margin for anyone, `deduct_in` credits the
   branch's wallet instead), and the same operation can be deducted twice.
2. **Edit the marked row's money** (set its `amount`, `balanceAfter`, margins). Rewrites a written ledger row after the
   fact: the balance after it and every later row's would be wrong, and the purchase date and the sale date become one.
   Refused by the ledger's rules (an entry is never updated after it is written, ADR 0025/0026).
3. **A compensating third entry** (a reversal of the loss beside the charge). Two new rows per charge for one fact, a
   new kind every sum must learn, and the loss row would still say "loss".
4. **A sale entry that names the operation, with provider cost 0, and the mark turned** (chosen). The charge is an
   ordinary sale written by `WalletLedger.move` (the wallet lock, held money, the ceiling, the notice below zero); it
   stores `chargesEntryId` (unique: one charge per operation), the marked row's provider with cost 0 (the provider was
   paid once, on the marked row, at its own date), and the ladder on the point of sale's path now at the package's
   prices now with the provider's cost at the branch 0, so `marginOf` gives every layer below the branch its usual
   margin and the branch its sell price. The marked row changes only its mark, `given_back` → `charged_later`, by a
   guarded UPDATE (one row or 409).

## Decision

Option 4. With it the sums need no rule of their own: the operation's row keeps − cost, the charge row adds the
branch's sell price, together the margin of an ordinary sale of that package, each at its own date; the provider's
purchases count the cost once. The warnings (counts and amounts on the home, the profit report, the finance summary,
the provider screens, the filter `any`) read only the open marks (`given_back`, `priced_zero`); every profit sum keeps
every marked row's margin, `charged_later` included.

## As built

- `POST /v1/provider-operations/:entryId/charge` (`ProviderAccountsController` → `ProviderAccountsService` →
  `WalletsService.chargeGivenBack` → `WalletLedger.chargeLater`), activity `provider_charge`, subject the entry. The
  branch only, not while entered (403 `FORBIDDEN`), with the grant the manual deduction asks (none beyond the layer
  while staff roles are pending, ADR 0006). A `priced_zero` row: 400 `INVALID`; an unmarked or already charged one:
  409 `DUPLICATE_REQUEST`; an unknown id: 404 `NOT_FOUND`; over the ceiling: 400 `BALANCE_CEILING`, nothing written.
- **The amount** is the row's `packagePrice` + `esimPrice`: what the task held (`-posDelta`). Before P.9 the given-back
  entry stored no eSIM fee; it now does (`ProviderDecisions.givenBackSale` and the backfill's given-back pass,
  `heldEsimFee`: the task's debit less the package price, as the completion stores it). An amount of 0 (a task priced
  0 held nothing) is refused 400 `INVALID`.
- **The package** of the ladder is found by the row's provider, package name and company name (no line was made); none
  is 404, several are 400 `INVALID`.
- **One transaction, lock order:** the point of sale's wallet (`lockWallets`), then the marked row's guarded UPDATE,
  then `move` (which takes the same wallet lock again, confirms the path under it, `DB.9`, and writes the sale). A
  concurrent second charge waits on the wallet lock and then finds no `given_back` row: 409. The unique partial index
  `WalletEntry_charges_entry` is the database's backstop. Nothing is added to the ordinary sale path
  (`sale-lock-tree.db.spec.ts` unchanged).
- Migration `20261118100000_provider_loss_charged_later`: `WalletEntry.chargesEntryId`, the CHECK
  `WalletEntry_provider_loss` with the third value, the index `WalletEntry_charges_entry`.
- Reads: `OPEN_LOSSES` / `isOpenLoss` (`wallets/provider-cost.ts`); `DeskRepository.lossesByBucket` counts and prices
  the open marks with `FILTER` and sums every margin, `WalletsRepository.lossGroups` / `lossTotal` group by the mark,
  `providerLosses` keeps the open marks; every one keeps `"providerLoss" IS NOT NULL`, so the partial indexes still
  serve them (`branch-losses.db.spec.ts`, `EXPLAIN`).
- Web: «عمليات المزودين» — the button «خصم المبلغ من نقطة البيع» on a `given_back` row, a confirmation naming the point
  of sale, the number, the package and the amount (`loginName`, `chargeAmount` on each row), the neutral badge
  «خُصم لاحقاً» and the filter option; the badge and the filter option in «المالية», the badge in the provider's ledger.
- Proof: `wallets/charged-later.db.spec.ts`.
