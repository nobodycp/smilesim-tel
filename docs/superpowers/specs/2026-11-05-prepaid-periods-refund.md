# Prepaid periods: refund every paid day, and confirm a disconnect

Goal: a line that was extended holds more than one paid period. A disconnect returns the unused days of every paid period, not only of the last 30-day window, and a package switch values every remaining day the same way. A disconnect asks for confirmation and shows the number and the amount that comes back first.

Found by the launch audit: an eSIM line that was activated and then extended at once refunded 31.40 ₪ on disconnect, where 64.40 ₪ had been paid and not used.

## Decisions

### A paid period is written on its wallet row

- `WalletEntry` gets two nullable columns: `periodDays Int?` and `periodEndsAt DateTime?`.
- Every row that buys time sets both: activate, charge (restart of a disconnected line), reactivate, extend. `periodDays` is `30 × months` of the window it bought, and `periodEndsAt` is the line's `endsAt` right after that row.
- A switch row sets `periodDays` to the target's window (`30 × target months`) and leaves `periodEndsAt` empty. It does not buy time. It reprices the time that was open when it ran.
- The task completion paths write the same fields as the direct paths.
- When an extend or charge is completed from a task, the row records the package that was bought (the target when extending onto another package) and the price that was actually paid (`-posDelta`), not the package's list price.

### Open periods

Reading the line's prepaid rows from newest to oldest, until and including the newest activate, charge, or reactivate (the start of the current run of the line):

- A switch row reprices every older period still open: their remaining days are valued at the switch's `packagePrice / periodDays`. Only the newest switch counts.
- Any other row is one period `[periodEndsAt − periodDays, periodEndsAt]` valued at its own `packagePrice`, unless a newer switch repriced it.
- Days left in a period: a period that has not started yet keeps all its days. The period that is running counts a started day as used, like today. A closed period has none.
- If any of those rows has no period (rows written before this change), fall back to today's rule: the last window only.

### Disconnect

- Refund to the point of sale = the sum over open periods of `round(price × left / periodDays)`, minus the 0.50 ₪ fee.
- Provider cost = the used share of the running period's branch cost, plus the 0.50 ₪ fee. This is today's rule. Periods that have not started have no used days.
- No open period: no refund, as today (the subscription lapsed).

### Switch

- Current value = the sum of the open periods' values.
- New value = `round(newPrice × total days left / target window days)`.
- Difference = new − current, as today.
- Branch side: today's rule, applied to the total days left.

### Disconnect confirmation

- Choosing disconnect from the row menu or the number card opens a `confirm` dialog. It names the number and shows the amount that will come back to the point of sale's wallet. When the disconnect will open a task, it says so, and nothing moves until the task is done.
- The amount comes from a new read-only endpoint, `GET /office/lines/:id/disconnect-quote` → `{ amount: number; runsNow: boolean }`. It uses the same calculation as the disconnect.
- The branch still picks the provider outcome. The dialog comes before the request either way.

## Later tasks (not in this change)

- Branch cost per period when an extend moved the line onto another package: the running period uses the current package's cost, as today.

## Non-goals

- Back-filling `periodDays` / `periodEndsAt` on old rows. Old lines keep the last-window rule until their next activate, charge, or reactivate.
- Showing the remaining days or periods on the number card.
- Changing which packages a point of sale sees (decided to leave them as they are).
