# Refresh is an operation on an active number only

## Goal

"تحديث الرقم" (`refresh`) was offered on frozen and disconnected numbers, and the endpoint accepted it. The
agreed rule is that a refresh, like extend, SIM swap, freeze, and rename, is a provider operation on a live
subscription: it exists on an **active** number and nowhere else.

## Decisions

- The API offers `refresh` only when `status === 'active'`, the line is not locked for a package switch, and the
  package's run mode for refresh is not `off`. `offeredOperations` in `office-rules.ts` already applies the status
  gate to the other actions; `operationsFor` in `office.service.ts` now applies it to `refresh` as well.
- `POST /office/lines/:id/refresh` refuses a non-active line with `400 INVALID`, the same answer the other
  status-gated endpoints give.
- The web fallback in `components/line-actions.ts` (used when a row has no `operations` list) follows the same
  rule, so the row menu and the line card never show it on a frozen, disconnected, or suspended number.
- The mock UI test that listed "تحديث الرقم" on frozen and disconnected rows is corrected; it had codified the
  drift.

## Non-goals

- No change to what a refresh does, to its run mode defaults, or to how it is logged.
- Suspended numbers still offer nothing; their rules are a separate decision.
