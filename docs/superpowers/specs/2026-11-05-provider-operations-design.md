# Provider operations

A branch report of every line operation that went through the office onto a provider. Balance movements (fund, self fund) stay on the finance report.

## Decisions

- Source is wallet entries whose kind is a line operation: activate, charge, extend, reactivate, disconnect, freeze, unfreeze, switch, rename, sim, refresh, transfer. An operation that does not move money still writes a row with amount 0, and that row stays out of the finance report. A pending task is not an operation yet. Completing the task writes the row.
- The cost is the branch price of the package, never the point-of-sale price stored on the wallet row. Activate and switch use the subscription branch cost. Charge, extend, and reactivate use the renewal branch cost. The other kinds cost nothing.
- When the line still sits on the same package the entry names, the cost comes from the line terms snapshot. When the entry names a different package, the cost comes from that package's current branch columns. The provider shown is the provider of that package.
- Filters: provider, kind, number, from, to. The table, the operation count, and the cost total follow every filter. The month card follows provider, kind, and number, and always covers the current calendar month, so picking a provider still answers "what did this month cost there".
- Stats are totals of the filtered set, not of the current page.
- Branch only, and the same reports grant as the provider report. An impersonation session does not see branch cost.

## Non-goals

- Editing the operations desk or the finance report.
- Estimating cost for a task that has not written a wallet entry.
- A second price history beyond the line terms snapshot.
