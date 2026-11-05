# Line statuses: rename "active" label and add "suspended"

## Goal

A line has exactly four statuses, named the same everywhere the office shows or filters them:

| key | ar | en | he | badge tone |
|---|---|---|---|---|
| `active` | فعال | Active | פעיל | success |
| `disconnected` | مفصول | Disconnected | מנותק | danger |
| `frozen` | مجمّد | Frozen | מוקפא | warning |
| `suspended` | معلق | Suspended | מושהה | neutral |

`suspended` is new. Its meaning (who sets it, when it clears, what it allows) is not decided yet; this
slice only makes the status a first-class value so later work does not touch every screen again.

## Decisions

- `Line.status` stays a string column; no migration. `suspended` joins `LINE_STATUSES` so the list
  filter accepts it.
- A suspended line offers **no operations** (`offeredOperations` returns `[]`, `operationsFor` adds
  nothing, the row menu shows nothing). Nothing in this slice writes `suspended`.
- The Arabic label for `active` changes from "يعمل" to "فعال". Other labels keep their current text.
- One pair of helpers in `components/names.ts` decides the label and the badge tone for a status;
  screens stop hand-rolling `status === 'active' ? ... : ...` ternaries.
- Row actions: "disconnect" is offered only for `active` and `frozen` lines (previously "anything but
  disconnected", which would have leaked onto suspended lines).

## Non-goals

- Transitions into or out of `suspended`, a reason field, or a hint on the card. Those come with the
  status details the owner will give later.
- Account freeze/restore (`User.frozen`) is a different thing and is untouched.
