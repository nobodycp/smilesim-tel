# 0019 — A provider activation holds the price on a task and is settled by the provider's stored verdict

Date: 2026-11-10. Status: **proposed; direction agreed by the owner the same day** (the task carries the money,
the operation carries the provider's verdict, one settlement), with O1–O6 answered and three requirements added.
The full text waits for the owner's review; nothing is implemented. Builds on ADR 0004,
0017, 0018. Spec and plan: `docs/superpowers/{specs,plans}/2026-11-10-activation-settlement.md`.

## Context

An activation today either runs inside the request (line and debit in one transaction, no hold) or opens a branch
task that holds the price and is finished by a person. With a real provider the answer comes later and may never
come; the money must be safe in every state of the operation.

## Decisions

1. **The activation task carries the money.** The provider route opens the same `OfficeTask` (hold, fixed price)
   and records the `ProviderOperation` in the same transaction.
2. **A repeat is stopped at three levels**: the request (`OfficeTask.requestKey`, the web's `Idempotency-Key`,
   unique), the thing sold (serial and number), the provider call (`activate:<taskId>:<n>`). The request key is in
   place and required before any provider is switched on.
3. **The database reserves the serial and the number**: partial unique indexes on open activation tasks, for the
   manual and the provider route. The reservation ends when the task leaves `working`, in the write that closes it.
4. **The verdict is stored first; the money moves in a second transaction** driven by an outbox message and a
   sweeper (`appliedAt`).
5. **Success completes the task through the existing completion handler**; one line, one charge, guarded by the
   task claim, `appliedAt` and the unique number.
6. **Failure leaves an ordinary branch task** with its hold; the manual path is untouched.
7. **Unknown freezes the task**: no completion, rejection or cancellation, and the hold stays until a verdict.
8. **The verdict on an unknown operation is given only by an authorised account, on stated evidence, and is kept**
   (`ProviderVerdict`, an activity event); it happens once.
9. **A succeeded operation that cannot be applied is an exception**: the verdict, the hold and the reservation are
   kept, `applyError` is recorded, nothing is re-sent and nothing is refunded automatically; an authorised account
   closes it by applying corrected data or by a documented release.
10. **The hold is captured** (`WalletLedger.capture`), on both routes, never released and debited again.
11. **The route is chosen per provider** (`gateway.dispatches(code)`); simulation and "not connected" are unchanged.
12. **People first**: the waiting label, the exception view and the verdict screen exist before anything is
    dispatched for a real provider.

## Alternatives

- **Charge at the request and refund on failure.** The customer's wallet shows a sale that may not exist, the
  profit ladder and the reports count it, and an `unknown` operation would need a refund that may be wrong.
- **Create the line at the request in a new `activating` status.** Every reader of `Line.status` (lists, reports,
  snapshots, the status CHECK) would have to learn it, and a line that the provider never activated would exist.
- **A new "order" entity beside `OfficeTask`.** A second holder of money, price and number with its own
  completion; the manual fallback would have to convert one into the other.
- **Apply the money inside `settle`.** A business refusal at line creation would roll back the provider's verdict.
- **Release the hold when the operation becomes `unknown` and charge later if it succeeded.** The money may be
  spent in between; the office would carry the provider's charge.
- **Let the branch complete by hand while the operation is in flight.** Two activations of one card.
- **A reservation table** (`kind`, `value`, unique) written when a task opens and deleted when it closes: a second
  row to keep in step with the task's status; the partial index *is* the task's status, so release cannot be
  forgotten.
- **A claims table shared by lines and tasks**, so that a serial among live lines is a constraint too: every line
  status change would have to maintain it. Left as the next step if the advisory-lock rule proves too weak.
- **Advisory locks and a check only** (the first draft): correct while every writer goes through the service; the
  owner asked for the database itself to refuse.
- **Only the operation key, or only the request key**: the first lets two requests make two tasks, the second lets
  a retry with a new key reach the provider again.
- **Retry the application of a succeeded operation forever**: a taken number does not free itself; the sweeper
  would spin and the branch would not be told.
- **Let any task handler decide an unknown operation with one click**: the decision moves money and names what the
  provider did; it needs an accountable account and a record.
- **The HTTP `Idempotency-Key` as the provider key.** It names a request, not a sale; a browser retry would get a
  new key and a second activation.

## Risks

- `unknown` operations hold money until someone gives a verdict: the branch needs the screen (S.7) before any
  provider goes live, and the provider status check should follow.
- A task flagged "provider succeeded, not applied" needs a person and a written procedure.
- The submitter, not the operator of an entered session, is named on settlement entries (audit A5).
- The request key depends on the web sending it; until S.6 a repeat with no serial or number in common is still
  two tasks on the manual route. It is required on the dispatch route from the first day.
- The reservation indexes change the manual path: a second task for the same card is refused at opening. Existing
  duplicates must be resolved before the migration runs.
- A serial among live lines stays an advisory-lock rule, not a constraint.
- A verdict is only as good as its evidence: the record makes it auditable, not correct. A second approver is an
  open question.
- `providerCost` on the entry is the package's cost when the line is created, not what the provider billed;
  matching by `providerRef` is a later reconciliation step.
- Clock skew between workers affects recovery timing, not the money (ADR 0018).

## Consequences

- One new rule file, one new application service, one ledger primitive, nine columns, two partial indexes and one
  small table (`ProviderVerdict`); no new holder of money.
- Two routes (verdict, exception) and their screens; the activation form sends a request key.
- The answer of `POST /office/lines` keeps its shape; the web needs no change to start.
- The manual path changes in two decided ways (reservation at opening, capture at completion). Routing a sale to
  the dispatcher changes nothing until the plan's go-live gate is passed for a provider.
