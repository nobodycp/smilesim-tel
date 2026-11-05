# Switch provider cost

The provider-operations row of a package switch carries the branch-cost difference of the days still left, computed with the same settlement that `2026-11-05-package-switch-difference-design.md` uses for the point-of-sale wallet. It no longer carries the full subscription branch cost of the new package.

This replaces the switch line in `2026-11-05-provider-operations-design.md` ("Activate and switch use the subscription branch cost") and the matching non-goal in the package-switch-difference spec.

## Settlement

At the moment the switch is applied (direct success, or the moment a manual switch task is marked done):

- The current branch cost is the cost of the window that is open now, chosen the same way a disconnect chooses it: the renewal branch cost in the line terms when the last prepaid sale on the line was a charge, extend, or reactivate, otherwise the subscription branch cost in the line terms.
- The new branch cost is the target package's subscription branch cost, the same side a switch already uses in `providerBranchCost`.
- Remaining days, the current cycle length, and the new cycle length are the ones the wallet difference already uses.

```
current cost value = round(current branch cost × remaining days / current cycle days)
new cost value     = round(new branch cost × remaining days / new cycle days)
provider cost      = new cost value − current cost value
```

The result is stored on the switch wallet entry in `providerCost`, including when it is zero and when the wallet difference is zero. A negative value is allowed: a switch onto a cheaper package reduces what the branch owes the provider, and the provider-operations total sums it as such.

Example on the line in the report: a 30-day 300 GB package (branch cost 3500) with 29 days left, switched to 400 GB (branch cost 4100), stores a provider cost of 580 agorot, the same figure the point of sale paid because the two shelves share one price here.

## Report

`providerOperations` already prefers the stored `providerCost` over the computed fallback. New switch rows therefore show the difference. Rows written before this change have no stored cost and keep the full subscription branch cost through `providerBranchCost`; they are not rewritten.

## Table width

The provider-operations table at narrow widths pushes the cost column outside the visible sheet. The sheet must either fit the seven columns by letting text cells wrap, or show that it scrolls. This is a separate task in the plan and does not change any figure.

## Non-goals

- Rewriting switch rows that already exist.
- Changing the wallet difference, the ceiling check, or the task preview amount.
- Changing the disconnect provider cost or any other kind.
- Showing the provider cost on the operations desk or in the task list.
