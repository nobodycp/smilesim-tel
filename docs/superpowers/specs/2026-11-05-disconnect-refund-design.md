# Disconnect refund

Money is stored in agorot (1 shekel = 100). Screens show shekels with two decimals and the shekel sign.

A package month is 30 days of 24 hours. The paid window ends at `endsAt` and starts 30 × months days before that.

Disconnect of a line still inside that window is one wallet movement on the point of sale:

- credit = the remaining whole days of the price the point of sale paid, minus 50 agorot
- provider cost = the used whole days of the branch cost, plus 50 agorot

A day is one of the 24-hour blocks in the 30-day window. Any time inside a block counts as that whole day, and a line still inside the window has used at least one day. The half shekel is the provider's disconnect fee. It is not a second ledger row. Day shares round to the nearest agorot. The eSIM fee stays outside the split. The price is the last prepaid sale on the line (activation or switch uses the subscription cost; charge, extend, and reactivate use the renewal cost).

The amount is computed when a direct disconnect succeeds, or when a manual task is marked done. Opening, rejecting, or cancelling a task moves nothing. A line whose window has already ended is not a disconnect service: the subscription lapsed, so no refund and no fee.

A task that already closed at zero is not rewritten.
