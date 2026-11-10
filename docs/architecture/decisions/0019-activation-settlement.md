# 0019 — A provider activation holds the price on a task and is settled by the provider's stored verdict

Date: 2026-11-10. Status: **proposed** (owner task 04, design only; nothing is implemented). Builds on ADR 0004,
0017, 0018. Spec and plan: `docs/superpowers/{specs,plans}/2026-11-10-activation-settlement.md`.

## Context

An activation today either runs inside the request (line and debit in one transaction, no hold) or opens a branch
task that holds the price and is finished by a person. With a real provider the answer comes later and may never
come; the money must be safe in every state of the operation.

## Decisions

1. **The activation task carries the money.** The provider route opens the same `OfficeTask` (hold, fixed price)
   and records the `ProviderOperation` in the same transaction. The key is `activate:<taskId>:<n>`.
2. **The verdict is stored first; the money moves in a second transaction** driven by an outbox message and a
   sweeper (`appliedAt`).
3. **Success completes the task through the existing completion handler**; one line, one charge, guarded by the
   task claim, `appliedAt` and the unique number.
4. **Failure leaves an ordinary branch task** with its hold; the manual path is untouched.
5. **Unknown freezes the task**: no completion, rejection or cancellation, and the hold stays until a verdict.
6. **A succeeded operation that cannot be applied is never refunded automatically.**
7. **The hold is captured** (`WalletLedger.capture`), not released and debited again.
8. **Serial and number are reserved** while an activation is in flight.
9. **The route is chosen per provider** (`gateway.dispatches(code)`); simulation and "not connected" are unchanged.

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
- **The HTTP `Idempotency-Key` as the provider key.** It names a request, not a sale; a browser retry would get a
  new key and a second activation.

## Risks

- `unknown` operations hold money until someone gives a verdict: the branch needs the screen (S.7) before any
  provider goes live, and the provider status check should follow.
- A task flagged "provider succeeded, not applied" needs a person and a written procedure.
- The submitter, not the operator of an entered session, is named on settlement entries (audit A5).
- Request-level duplicates more than 10 s apart are still two sales when no serial or number is named (audit A3)
  until the web sends a key (O4).
- `providerCost` on the entry is the package's cost when the line is created, not what the provider billed;
  matching by `providerRef` is a later reconciliation step.
- Clock skew between workers affects recovery timing, not the money (ADR 0018).

## Consequences

- One new rule file, one new application service, one ledger primitive, five columns; no new holder of money.
- The answer of `POST /office/lines` keeps its shape; the web needs no change to start.
- Until the plan's S.6 is switched on for a provider, no sale changes.
