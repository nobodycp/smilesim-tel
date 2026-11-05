# Package switch difference

A package switch moves the point-of-sale wallet by the difference in the value of the days still left. It does not charge the new package as a new sale, and it does not start a new paid window.

This replaces the switch amount in `2026-11-01-companies-packages-design.md`, which charged the full renewal price. Who may switch, which targets are allowed, and the manual-task path stay as they are.

Money is stored in agorot. A package month is 30 days of 24 hours, the same window as a disconnect.

## Settlement

The moment of settlement is the moment the switch is applied: a direct success, or the moment a manual task is marked done. Opening, rejecting, or cancelling a task moves no money. Days that pass while a task waits change the amount. The amount saved on the open task is this same settlement computed when the task was opened, and it is only a preview.

Remaining days are the whole days left in the line's current window, counted the way a disconnect counts them. A started day is a whole day, and a line still inside the window has used at least one day. The window ends at the line's current `endsAt` and started 30 × the line's current months before that. When that window has already ended, zero days remain.

Each package is priced at the point of sale's buy price for its own cycle:

- The current price is the package price on the last prepaid sale for this line (activate, charge, extend, reactivate, or switch). A switch sale stores the new package's full buy price there, not the difference. If the line has no prepaid sale, use the same subscription-or-renewal fallback a disconnect uses.
- The new price is the point of sale's offer for the target package when one exists, otherwise the target's renewal point-of-sale price.

```
current value = round(current price × remaining days / current cycle days)
new value     = round(new price × remaining days / new cycle days)
difference    = new value − current value
```

A positive difference is a debit. A negative difference is a credit back to the same point-of-sale wallet. Nothing moves on the agent, the main agent, or the branch. A zero difference still changes the package and writes a zero-amount operation row.

Shares round to the nearest agorot. A 30-shekel cycle with 5 days left, switched to a 41-shekel cycle of the same length, debits 183 agorot: the remaining value goes from 500 to 683. The same 5 days switched to a 20-shekel cycle credit 167 agorot. A 30-shekel 30-day cycle with 5 days left, switched to an 80-shekel 90-day cycle, credits 56 agorot (500 − 444).

The debit is checked against the point of sale's ceiling when the money moves. If it does not fit, the switch does not change the line or the wallet.

## Line

`endsAt` stays. The new package covers only the days still left.

The line adopts the target package and that package's saved renewal terms, including the target's own cycle length, so the next charge, extend, or reactivate uses the target. The cycle length that already defines `endsAt` is kept as well, and remaining days keep using that length until a later charge, extend, or reactivate replaces the window.

The wallet row's amount is the signed difference. Its package price is the new package's full point-of-sale buy price, so a later read of "what this window costs" sees the new price rather than the difference.

## Non-goals

- Rewriting the switch that already posted a full package price.
- Changing the provider-operations cost. A switch there remains the subscription branch cost.
- Changing activate, charge, extend, or the disconnect fee.
- Changing how a disconnect counts days. After a switch between packages of equal length, a later disconnect refunds the new remaining value minus the fee, because the stored package price is the new full price and the window is unchanged. A switch between different lengths can make that later disconnect disagree with the new remaining value; aligning those two is a later change.
