# Finance: eSIM tag on a sale

## Goal

A point of sale that activates a line as an eSIM pays the package price plus the eSIM fee in one wallet entry, so the finance row shows an amount larger than the package price with nothing to explain it. The row should say it was an eSIM sale and show the fee.

## Decisions

- `WalletEntry.esimPrice Int?` holds the eSIM fee that is part of that entry's `amount`. It is written at the moment the money moves:
  - immediate activation with eSIM: the fee from `esimPriceOf` used in `posDelta`;
  - a settled `activate` task with `task.esim`: `-task.posDelta - packagePrice`, the fee that was folded into the task at open time (floored at 0);
  - a settled `esim` task: `-task.posDelta`, the whole entry.
- `GET /office/finance` returns `esimPrice: number | null` per entry.
- The finance table's kind cell shows the movement name and, when `esimPrice` is set and the kind is not `esim` itself, a neutral `.badge` reading `eSIM` with the fee as `Money`. Amount = package price + eSIM fee is then readable on the row.
- Rows written before this column keep no tag. No backfill.

## Non-goals

- No change to how the fee is priced or charged.
- No tag on reports or the number detail page in this slice.
