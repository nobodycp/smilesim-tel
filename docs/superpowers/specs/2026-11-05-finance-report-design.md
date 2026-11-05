# Finance report

## Goal

One financial report replaces accounting, the balance-use report, and the balance top-up report. Each layer reads every wallet movement on its own account and on accounts under it. The branch reads every movement.

## Row

Time, layer, account, who acted, movement, amount, balance before, balance after, number, company, package, package price, note.

A movement is a wallet entry: a line operation, `fund` (balance supplied to another account), or `self_fund` (balance added to the account).

## Screen

Route `/finance`. Nav label المالية. Filters: movement, layer, text on account or number, from, to. They apply as they change.

## Non-goals

Operations stay a list of what was done to a number. Provider, task, number, and operation reports stay.
