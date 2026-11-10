# 0019 — A provider activation holds the price on a task and is settled by the provider's stored verdict

Date: 2026-11-10. Status: **accepted** (the owner approved the design and ordered slice S.1 the same day, task
05). The design is fixed; it is built slice by slice, and the plan says which slices exist: **S.1 (the schema, read
by nothing yet), S.2 (the reservation of a serial and a number, which changes the manual path) S.3 (the pure
rules, called by nothing yet), S.4 (`capture`, used by manual completion) and S.5a (an eSIM code is read
whether stored clear or sealed; nothing is sealed yet) are built.** Builds on ADR 0004, 0016, 0017, 0018. Spec and plan:
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

## As built in S.2 (migration `20261110200000_open_activation_reservations`)

- The two partial unique indexes exist as designed; Prisma neither sees them as drift nor would drop them.
- The lock order needed one change to existing code: completing a task released the hold (a wallet lock) before
  its handler locked a serial. The keys a completion will take are now locked first, so every transaction goes
  task → line → keys → wallet.
- A task is written before its hold for every action, not only for activations: one order, one transaction.
- Opening an activation also checks live lines, so a card already on a line is refused at the request.
- The migration raises on existing conflicts and changes nothing; a read-only report
  (`npm run reservation-conflicts --workspace api`) lists them before a deploy.
- The migration is a single `DO` block. Prisma Migrate 7.10.1 was measured to keep the first of two plain
  statements when the second fails; one statement is atomic whatever the runner does. It locks the table against
  writes while it checks and builds, with a 30 s lock timeout.
- A serial or a number never appears whole in the migration's message or the report: both end in deploy logs. The
  task ids do.
- The migration file was rewritten after it had been applied on development, test and CI databases only. Deploy
  and status do not compare checksums; `migrate dev` does and asks for a reset. Both versions build the same
  indexes. The plan records the measurements.

## As built in S.3 (pure rules)

- An operation's state for its task is one of eight phases, and the table of D6, the settlement's next step and
  who may decide what are functions of that phase alone (`lines/activation-settlement.rules.ts`).
- The lists the rules use are the lists the database checks; a spec reads the migration and compares them.
- A proposal is approved or refused only by another authorised account; the account that made it answers it in
  neither way (no withdrawal). While it is open no other decision by a person is taken on the operation.
- The provider's own late verdict for the same attempt is recorded whatever proposals are open: settling reads no
  decision event.
- A proposal whose operation has left the state it was made about is stale: it cannot be approved, so it moves
  no money, and can only be refused.
- What a confirmed activation hands back travels with the evidence and is normalised by a rule; storing it is
  S.5 and S.8.

## As built in S.4 (`WalletLedger.capture`)

- `capture` gives a hold back and posts a debit under the wallet's lock. Up to the hold the debit is covered and
  the ceiling is not checked again; beyond the hold only the excess is checked, with the hold still counted as
  held; what the hold has beyond the debit goes back. A hold larger than the wallet's own record of it is a `409`
  that changes nothing.
- It writes the same rows as before (`release`, then the sale), through the posting code `move` uses, so the
  finance screens, the profit ladder and the below-zero notice are unchanged.
- How a completed task is charged is a pure rule (`taskCharge`): a debit fixed at opening and held exactly is
  captured; a switch is **re-quoted** and settled against its hold; a disconnect posts its own refund; a debit with
  no hold is checked against the ceiling as before.
- **A switch's price is the price of the day it is completed** (owner): the days left are fewer the longer the task
  waits. D10's first wording ("only a debit the hold covers whole") was written for fixed prices and is widened
  here; the alternative, fixing the difference at opening, would charge for days already used.
- If the wallet cannot cover the increase, the completion is refused and rolled back: the line and the task do not
  change.
- The same rule holds for a disconnect's refund: it is the refund of the day it is carried out. The code already
  did that; it is now written down as the owner's rule (`docs/project-plan.md` 2026-11-10, rule 1.5) and pinned by
  specs. Every other operation keeps the price fixed when its task opened.

## As built in S.5a (reading eSIM codes stored clear or sealed)

- The code is answered in four places (line list, line detail, task detail, the answer of an activation made at
  once). Reading goes through `lines/esim-code.ts`: `readEsimCode` answers `{ code }` (`null` only for a record
  that has no code) or `{ unreadable }`, and the two are never merged there.
- A value that does not start with the sealed prefix is the code as written and is answered as it is; a sealed one
  is opened. Both can be stored side by side, which is what lets S.5b seal rows in batches.
- A sealed code that cannot be opened (no key, another key, damaged) is logged by record id and reason code,
  never with the stored text, the key or the cipher's error, and the stored value is not touched. Then
  (owner's correction, 2026-11-10):
  - **a row of the line list** answers `null` for that row only (`listedEsimCode`), so one row does not take a
    page down. A list therefore does not tell "no code" from "unreadable";
  - **the detail of a line or of a task** refuses the request with `500 ESIM_CODE_UNREADABLE`
    (`esimCodeOrFail`): it is a fault, not "no code". The body is the catalog message only;
  - **the answer of an activation made at once** does not read the stored value: it answers the code issued in
    memory. After the commit nothing can fail, so a sale is never answered as an error (which could be sent
    again and charged twice), and never answered as a success without its code. **S.5b must keep this:** it
    seals before the transaction and checks there that the sealed value opens to the code, so a sealing fault
    refuses the sale before any money moves.
- Nothing is sealed on write and no stored value changed. The answers keep their shape when the code is readable.

## Consequences

- One rule file, two application services, one ledger primitive; about fifteen columns, two partial indexes, two
  small tables (`ProviderDecisionEvent`, `ProviderCredential`) and one trigger; no new holder of money.
- Four routes (decision, approval, provider approval / pause, credential) and their screens; the activation form
  sends a request key.
- The manual path changes in three decided ways: reservation at opening, capture at completion, the eSIM code off
  the lists.
- Nothing is dispatched anywhere until the plan's go-live gate is passed for a provider on a named deployment.
