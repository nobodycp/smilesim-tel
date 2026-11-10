# 0019 — A provider activation holds the price on a task and is settled by the provider's stored verdict

Date: 2026-11-10. Status: **accepted** (the owner approved the design and ordered slice S.1 the same day, task
05). The design is fixed; it is built slice by slice, and the plan says which slices exist: **S.1 (the schema) is
built, nothing reads it yet, and no behaviour has changed.** Builds on ADR 0004, 0016, 0017, 0018. Spec and plan:
`docs/superpowers/{specs,plans}/2026-11-10-activation-settlement.md`.

## Context

An activation today either runs inside the request (line and debit in one transaction, no hold) or opens a branch
task that holds the price and is finished by a person. With a real provider the answer comes later and may never
come; the money must be safe in every state of the operation.

## Decisions

1. **The activation task carries the money.** The provider route opens the same `OfficeTask` (hold, fixed price)
   and records the `ProviderOperation` in the same transaction.
2. **One task, one operation.** `ProviderOperation.taskId` is unique and the key is `activate:<taskId>`. A retry is
   an attempt of that operation; a failed operation is never sent again for that task.
3. **A repeat is stopped at three levels**: the request (`OfficeTask.requestKey`, unique), the thing sold (serial
   and number), the provider call (the operation's key and its unique task).
4. **The database reserves the serial and the number**: partial unique indexes on open activation tasks, on both
   routes; the reservation ends when the task leaves `working`, in the write that closes it.
5. **The verdict is stored first; the money moves in a second transaction** driven by an outbox message and a
   sweeper.
6. **Success completes the task through the existing completion handler**: one line, one charge.
7. **Failure leaves an ordinary branch task** with its hold.
8. **In flight, the task is frozen**, with one exception: the submitter may cancel while the operation is
   `requested`, in one transaction that moves the operation to `failed (abandoned)` and releases the hold. Not
   while `pending` or `unknown`.
9. **A succeeded operation that cannot be applied is an exception**: verdict, hold and reservation are kept,
   nothing is re-sent, nothing is refunded automatically.
10. **Decisions by people are authorised, evidenced and recorded.** The branch owner or an `accounting` account, in
    a real account session; evidence and a note of at least 20 characters. Confirming success, and applying
    corrected data, take one account. Declaring an unknown operation failed, and releasing a hold after the
    provider succeeded, take a **second, independent** account; nobody approves their own decision; without the
    approval the operation stays as it is. The record (`ProviderDecisionEvent`) is append-only, protected by a
    database trigger, and outside the activity purge.
11. **The hold is captured** (`WalletLedger.capture`), on both routes.
12. **eSIM activation codes are sealed at rest, never logged or queued, absent from lists, and read only by the
    line's point of sale, its ancestors and the branch**, each read recorded.
13. **No environment name relaxes a check.** Staging is a production-grade deployment. The dispatcher runs only
    when the deployment switches it on, names its adapters, states its target (`sandbox` cannot build a `live`
    client), and the owner has approved the provider there. Adapters and credentials exist in the worker only;
    credentials are sealed. Staging passing enables nothing on production.
14. **One lock order**: task → line → advisory keys → operation → wallets.
15. **People first**: the waiting label, the exception view, the decision form and the approval queue exist before
    anything is dispatched to a live provider.

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
- **A new operation per retry (`activate:<taskId>:<n>`)**, the first draft: parallel or successive operations for
  one task make "which one settles the task" a question with a wrong answer available. Attempts already express a
  retry.
- **`NODE_ENV=staging` so a trial server can dispatch** (and the earlier advice in ADR 0016): it switches off the
  very checks a server that calls a provider needs most.
- **A single flag for dispatch**: one mistaken variable would send sales to a provider. Four conditions of
  different kinds (deployment, adapter list, target, the owner's approval) do not fail together.
- **Adapters in the API process**: a request could then reach a provider, and every API replica would hold the
  credentials.
- **One account decides everything**: the two decisions that let money go back are the ones a single mistaken or
  dishonest account could use; the two that keep the sale need only evidence.
- **Keep the decision record in the activity log**: it is purged after its retention window.
- **Leave the eSIM code readable in lists because it is today**: a list is read far more widely and far more often
  than a code is needed.
- **The HTTP `Idempotency-Key` as the provider key.** It names a request, not a sale; a browser retry would get a
  new key and a second activation.

## Risks

- `unknown` operations and exceptions hold money until someone decides; a declared failure or a release waits for
  a second account. A branch with one authorised account can confirm a success but cannot give money back.
- After `failed` the task is manual; trying the provider again is a new sale, entered again by the seller.
- A decision is only as good as its evidence: the record makes it auditable, not correct.
- A serial among live lines stays an advisory-lock rule, not a constraint.
- The reservation indexes and `capture` change the manual path; existing duplicate open tasks must be resolved
  before the migration.
- Removing the eSIM code from the line list is a response change the web must follow.
- Sealing depends on `SECRETS_KEY`; losing it loses the codes (they can be issued again by the provider, not
  recovered).
- The submitter, not the operator of an entered session, is named on settlement entries (audit A5).
- `providerCost` on the entry is the package's cost when the line is created, not what the provider billed.
- ADR 0016, ADR 0018 and the code still describe the old dispatch switch until slice S.12a (spec section 10).

## As built in S.1 (migration `20261110190000_activation_settlement_schema`)

- The approval names its account as `Provider.dispatchApprovedByLoginName` (rule 4.9), not `dispatchApprovedBy`.
- `ProviderDecisionEvent` keeps the account as `accountId` and `accountLoginName` with **no foreign key to `User`**:
  a foreign key's `SET NULL` would be an update the trigger refuses, and `RESTRICT` would stop an account from ever
  being removed. Its foreign key to the operation is `RESTRICT`, so an operation with a decision cannot be deleted.
- The trigger also refuses `TRUNCATE`.
- The database, not only the code, refuses: an eSIM code or a credential that is not sealed (`v1:`…); an unknown
  `applyError`, event type, decision or evidence kind; a proposal or an applied decision without evidence and a
  note of 20 characters; a confirmed success without a reference; an approval to dispatch without its account.

## Consequences

- One rule file, two application services, one ledger primitive; about fifteen columns, two partial indexes, two
  small tables (`ProviderDecisionEvent`, `ProviderCredential`) and one trigger; no new holder of money.
- Four routes (decision, approval, provider approval / pause, credential) and their screens; the activation form
  sends a request key.
- The manual path changes in three decided ways: reservation at opening, capture at completion, the eSIM code off
  the lists.
- Nothing is dispatched anywhere until the plan's go-live gate is passed for a provider on a named deployment.
