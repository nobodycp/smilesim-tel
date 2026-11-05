# eSIM fee in provider operations

## Problem

"Provider operations" (`GET /office/provider-operations`, page `/provider-operations`) shows the branch's cost
per line operation. Today an eSIM never reaches that cost:

- An activation with an eSIM debits the point of sale `package + eSIM fee`, but the row shows the package
  branch cost only. Evidence: line 0523717010 debited 46.00 ₪, row shows 41.00 ₪.
- An eSIM request (`kind = esim`) debits the eSIM fee, but the row shows 0.00 ₪, and the page's kind filter
  has no `esim` option, so the rows cannot be filtered to.

Root cause: `providerBranchCost(kind, terms, pkg)` only knows subscription and renewal kinds, and neither
`activate()`, `requestEsim()` nor `completeTask()` writes `providerCost` on the wallet entry for an eSIM.
The fee is debited and then forgotten.

## Decision

The provider's eSIM cost is the same eSIM price already resolved by `esimPriceOf` (package > provider >
company). No new price field. (Owner's call, 2026-11-05.)

The fee is recorded on the wallet entry at posting time as `providerCost`, so provider operations and its
totals read it back without recomputing from today's prices:

- `activate` with eSIM, immediate or through a task: `providerCost = subscription branch cost + eSIM fee`.
- `esim` (eSIM request), closed through its task: `providerCost = eSIM fee` (the task's debit).
- Physical SIM activation and `sim` swap are unchanged (package cost / free).

`/provider-operations` adds `esim` to the kind filter.

## Non-goals

- A separate "eSIM cost from provider" field.
- Changing what the point of sale pays.
- Changing the finance page or the wallet balance; only `providerCost` on new entries.

## Existing rows

Dev data only. Rows written before this change keep `providerCost = null` and fall back to the package cost;
a one-off script outside the repo sets `providerCost` on the existing eSIM rows in the dev database.
