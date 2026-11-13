# 0019 — A provider activation holds the price on a task and is settled by the provider's stored verdict

Date: 2026-11-10. Status: **accepted** (the owner approved the design and ordered slice S.1 the same day, task
05). The design is fixed; it is built slice by slice, and the plan says which slices exist: **S.1 (the schema, read
by nothing yet), S.2 (the reservation of a serial and a number, which changes the manual path) S.3 (the pure
rules, called by nothing yet), S.4 (`capture`, used by manual completion) S.5a (an eSIM code is read
whether stored clear or sealed), S.5c (lists carry no code; the read is recorded) and S.5b (every code is sealed when it is written; a backfill for the stored
ones, run on no real data yet) are built.** Builds on ADR 0004, 0016, 0017, 0018. Spec and plan:
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
  - **an open `sim` or `esim` task** shows the SIM it hands over, never the one it replaces (owner's rule,
    2026-11-12; `TasksService.shownSim`): a SIM change shows the task's new serial, kind and code (no code when
    it carries none), a new eSIM shows no code until it is completed. The line's old code is not read for such a
    task, so one that no longer opens does not close the screen of the task that repairs it. The task's own
    code is never passed over: unreadable, it refuses the detail and the completion
    (`TaskCompletion.handedBack`, before anything is written or charged) unless a readable code is given at
    completion. Every other task with a line, and a replacing task once closed, shows the line's SIM only: a
    code a cancelled or rejected task carried and never put on the line is not shown beside it;
  - **the answer of an activation made at once** does not read the stored value: it answers the code issued in
    memory. After the commit nothing can fail, so a sale is never answered as an error (which could be sent
    again and charged twice), and never answered as a success without its code. **S.5b must keep this:** it
    seals before the transaction and checks there that the sealed value opens to the code, so a sealing fault
    refuses the sale before any money moves.
- Nothing is sealed on write and no stored value changed. The answers keep their shape when the code is readable.

## As built in S.5b (sealing on write, and the backfill)

- A code is sealed by the service before the transaction that stores it, and the sealed value is opened again and
  compared before it is used (`lines/esim-code.ts` `storableEsimCode`). No valid key, or a sealing that does not
  read back: `500 ESIM_CODE_UNSEALABLE`, with nothing written and no money moved. The code is never stored as
  written.
- An activation made at once has its code only after the provider answered, so it checks the key before asking
  the provider; a SIM change seals before asking; a completion seals before the task is claimed.
- A task's sealed code is handed to its line as the same stored value: it is opened to check it, never sealed a
  second time. One that does not open is refused, not handed on and not replaced.
- The repositories that write `Line.esimQr` and `OfficeTask.esimQr` refuse a code that is not sealed
  (`assertStoredSealed`): a guard for paths not yet written.
- Stored codes are sealed by `src/seal-secrets.ts` (`src/seal-esim-codes.ts`): by hand, in batches by primary
  key, one transaction a batch, each write guarded by the value that was read, restartable, with `--dry-run`. It
  never opens or rewrites a sealed value. Until it has reported 0 on a deployment, clear and sealed codes sit
  side by side and both are read (S.5a).
- A deployment must have `SECRETS_KEY` before this code: without it eSIM sales, eSIM SIM changes and eSIM
  completions are refused. Production already refuses to start without it (ADR 0016).

## As built in S.5c (the code leaves the lists; who reads it; the record)

- No list answers an eSIM code. `GET /office/lines` rows have no `esimQr` key; the task list never had one.
- One rule says who is handed a code (`tasks/task-access.ts` `esimCodeReaders`): the line's point of sale, the
  accounts above it on its own path, the branch. Both details apply it. For a line it equals who may read the
  line at all; for a task it is narrower than the task's readers (a submitter that is no longer on the path reads
  the task with no code).
- `line.esim_read` is the activity action `esim_read` on subject `line` (from the line detail) or `task` (from the
  task detail). It is written before the answer leaves, only when a code leaves, and the request fails when it
  cannot be written. It carries the actor, the subject, the address and the time, never the code.
- The detail carries the code whenever an entitled account opens it, so opening a line's page is a recorded read
  even when the QR picture is not opened. A separate "show the code" call would record only deliberate reads;
  the plan did not ask for it and it would change the screens.

## Consequences

- One rule file, two application services, one ledger primitive; about fifteen columns, two partial indexes, two
  small tables (`ProviderDecisionEvent`, `ProviderCredential`) and one trigger; no new holder of money.
- Four routes (decision, approval, provider approval / pause, credential) and their screens; the activation form
  sends a request key.
- The manual path changes in three decided ways: reservation at opening, capture at completion, the eSIM code off
  the lists.
- Nothing is dispatched anywhere until the plan's go-live gate is passed for a provider on a named deployment.

## As built in S.6 (the request key)

- `POST /office/lines` reads `Idempotency-Key` (8 to 120 of `A-Z a-z 0-9 . _ : -`; anything else is `400
  INVALID`; none or empty behaves as before). `OfficeTask.requestKey` is `sha256(submitterId : key)` and
  `requestHash` the SHA-256 of the parsed body's fields. The key itself is never stored.
- The submitter is the acting account (`actor.id`, the account that `OfficeTask.submitterId` names). A key is
  that account's: the same text from another account is another key, so nobody is answered with another's task.
- The key is asked twice. Before every other check (`TasksService.openedBy`), so a repeat is answered as the
  first was even when the number has a line by now or the price moved. And inside T1: the claim keys are locked,
  the key is looked up, the reservation is judged, the task is inserted `ON CONFLICT DO NOTHING`, and when the
  insert was refused the key is looked up once more. The first lookup under the locks answers a repeat that named
  the same serial or number and waited on its lock; the one after the insert answers a repeat that had nothing to
  wait on but the unique index (an eSIM with no serial, each request given another number).
- A repeat answers `{ applied: false, taskId }` of the first task with `Idempotent-Replay: true`, in whatever
  state that task is now, for as long as its row exists. It holds nothing, writes no notice and no activity event
  (`ActivityInterceptor` skips an answer marked as a repeat). The same key with another body is `400 INVALID`.
- A request that fails in T1 leaves nothing, so the same key can be sent again.
- **Only a request that opens a task stores a key.** An activation made at once (simulation only: development
  and tests; never in production, D13) opens no task; its repeat is stopped by the Redis guard alone, as before.
  The header is not required on any route yet: "required on the dispatch route" is S.11.
- The Redis guard stays in front and is not relied on. The spec runs without it, with it, with two sessions of
  one account (which it cannot tell apart from two people) and with its store down: always one task, one hold.
- **The guard and the key agree (final audit of S.6).** The guard's general rule refuses a repeat while the
  first is running (`409 DUPLICATE_REQUEST`, spec 2026-11-08-duplicate-writes). Spec item 4 asks for the same
  `taskId` from ten requests at once, so on the activation route (`@AwaitsFirstAnswer()`) a repeat under the same
  key waits for the first answer and is given it; a repeat with another body is `400 INVALID`, before and after.
  When the first failed, a waiting repeat runs in its place. A keyed write is marked as running for 60 s, not
  24 h: a request that died no longer blocks its key, and the database answers for what it wrote. Every other
  route keeps the general rule. Proved over HTTP on real Redis and PostgreSQL, ten at once, with a serial and
  without one, in one session and in two. `409` remains only where an answer cannot be given safely: an
  activation made at once whose kept answer cannot be sealed or no longer opens, and a first request still
  running after 20 s.
- Found while building this: the guard kept every answer in Redis as JSON, so the answer of an activation made
  at once sat there with its eSIM code in the clear (10 s without a key; it would have been 24 h once the web
  sent one). The activation route is now marked `@SecretAnswer(carriesEsimCode)`: an answer that carries a code
  is kept sealed, or not at all where it cannot be sealed, in which case the repeat is refused (`409
  DUPLICATE_REQUEST`) and never run again; the same when the sealed copy no longer opens. An answer with no code
  (a task) is kept as before, so it is replayed with or without a sealing key. Spec
  item 24 (S.5c) did not see this because its test app has no guard; `activation-request-key.db.spec.ts` covers it.
- The web makes one key per activation (`lib/request-key.ts`): the same content sent again carries the same key;
  changed content, or the next activation after an answer, carries a new one. Both activation forms use it.

- **Corrected on 2026-11-12, found while S.9 was verified** (its own commit, `fix(api): a repeat never runs
  on a key it does not hold`): the guard's Redis `claim` is two commands (`SET … NX`, then `GET` when the key
  was taken). When the first request failed and dropped the key between the two, the read found nothing and the
  claim answered "yours" for a key the request did not hold, so every repeat waiting on that key ran at once
  (seen as four runs where one was expected, under load, in `duplicate-guard.answers.spec.ts`). The claim now
  asks for the key again and answers "yours" only for a key it did set. What must not happen twice was always
  the database's to refuse (`OfficeTask.requestKey`), so no task was ever opened twice by it; the guard's own
  promise, one run and the same answer for the others, now holds in that window too
  (`duplicate-guard.store.spec.ts`, which fails on the code before the fix).

## As built in S.7 (the guards of the manual path, and cancel)

- One file holds it: `tasks/task-operation.ts`. It locks the task's operation row (`SELECT … FOR UPDATE`) and
  asks `taskActions`; it decides nothing itself and calls no provider.
- **Complete by hand (T8)** — `TaskCompletion.complete`: task claimed → line → claim keys → **operation** →
  wallet. **Reject** — `TasksService.reject`: task → **operation** → wallet. Both go on only with no operation or
  a `failed` one; otherwise `409 DUPLICATE_REQUEST` and the transaction is rolled back, so the task is still
  `working` with its hold, nothing is in the ledger and no line was made.
- **Cancel (T9, D7)** — `TasksService.cancel`: task → **operation** → wallet. None or `failed`: as before.
  `requested` (also after an attempt that never left): `failed`, `lastError = abandoned`, `appliedAt = now`, by a
  statement guarded on `status = 'requested'`, in the same transaction as the task's close and the release.
  `pending`, `unknown`, succeeded-not-applied, an exception: `409`, nothing changed.
- The dispatcher's `claim`, `settle` and recovery stay single guarded statements on the operation row and take
  no other lock, so they cannot close a cycle with these transactions. A claim that committed first is what the
  cancel reads under its lock (refused); a claim that comes after waits and finds `failed` (null, nothing sent).
- The row lock and the guarded statement cover each other: the spec's race fails only when both are removed.
- No sale records an operation yet (S.11), so no user sees a change. The spec opens real tasks through the
  service and writes each operation state by hand.
- Spec item 8 (T5 against a manual completion) needs T5, which is S.8. What S.7 proves of it is the manual side:
  a completion is refused while the operation is succeeded and not applied.

## As built in S.8 (the settlement)

- **T4** — `ProviderOperationsService.settle` (and `resolveUnknown`, and recovery's move to `unknown`): the
  verdict, what the provider handed back and one `provider-operation.settled` message are one transaction; no
  line, no money, no task. The eSIM code is sealed before the transaction; a code that cannot be sealed refuses
  the write (the attempt then ends as `unknown` through recovery, the money held), never stored in the clear and
  never dropped. A message's sequence is `attempt × 2`, `+ 1` for the late verdict that closes an `unknown`, so
  every verdict has its own and none is written twice. A recorded verdict and its result never change.
- **T5** — `lines/activation-settlement.ts` `apply`: task claimed (`working → done`) → the claim keys (the
  provider's number and serial where it chose them, the task's otherwise: `settlementClaim`) → the operation
  locked and `appliedAt` stamped by compare-and-set (`succeeded`, not applied, no exception, the very result that
  was read) → `TaskCompletion.applyClaimed`, the one function the branch's completion by hand also runs: the
  line, `WalletLedger.capture` at the task's fixed price, the ledger entry, the task's result → the notice.
  The provider's eSIM code is opened, rendered as the QR picture a line carries, and sealed, before the
  transaction.
- **D9, as tested:** each of the three guards is met with the other two out of the way (the task closed with
  the operation unapplied; `appliedAt` set with the task open and the number free; the number or serial on a
  line with task and operation untouched). Taking any one out fails a spec.
- **T5′** — a business refusal (`applyErrorOf`: `409 SIM_TAKEN`, `409 NUMBER_TAKEN`, `404 NOT_FOUND`, nothing
  else) rolls T5 back; then `applyError` and `applyFailedAt` are written, once, on an operation that is still
  succeeded, unapplied and without an exception. Every other failure is technical: nothing is written, the error
  is thrown, the job fails with a code and the sweeper meets the operation again. A wallet that no longer holds
  the task's hold is such a fault (`capture` refuses loudly), never an exception.
- **T6** — a failed verdict: under the task's and the operation's locks, `appliedAt` is stamped once, an open
  task's note becomes `PROVIDER_FAILED_NOTE` and the handlers are told; a task its submitter cancelled meanwhile
  gets the stamp only. The hold stays; nothing is refunded.
- **T7** — an unknown answer: the accounts that may decide are told, once per task (the notice itself is the
  mark, read under the operation's lock: there is no column for it). Nothing else is written.
- **The sweeper** (`applyPending`, every 60 s in the worker): operations of tasks that are succeeded with neither
  `appliedAt` nor `applyError`, or failed with no `appliedAt`. An exception and an unknown are not on its list.
- **Queues:** `provider-operations` sends, `provider-settlements` acts on verdicts. Both messages carry the
  operation's id only. The dispatch stays off unless `PROVIDER_DISPATCH=1` and never runs in production; no
  sale records an operation yet (S.11), so nothing changes for users.
- **Notices follow D12** (corrected in the final review of S.8). No notice kind was added (S.8 changes nothing
  visible): success is `task.done` to the task's chain; a failure is `task.opened` to the handlers; an unknown
  answer and an exception are `task.note` with fixed words (`stored-text.ts`) to the branch owner and the holders
  of the `accounting` grant (`mayDecide`), and to nobody else. Each names the **submitter as the actor**
  (`actorId`, `actorName`) and **«النظام» as the handler** (`handlerName`), as the ledger entry does.
  `NoticeService.write` leaves the actor out of a notice's audience; the settlement's notices alone pass
  `tellActor`, because the submitter did not do what the notice says, so a point of sale that submitted its own
  activation is told that it is done. Every other notice keeps the rule, and the option adds nobody to an audience.
- **An unknown answer is announced even when its message is lost.** The sweeper also goes over the operations
  of tasks whose answer is unknown (newest first) and announces each once; the notice itself is the mark.
- **`esim-code-missing` — an amendment to D16, approved by the owner on 2026-11-12** (the spec carries it under
  D16). A confirmed eSIM activation with no code from the provider and none on the task makes no line: it is
  recorded as an exception, like the other three reasons, and waits for D15's decisions (apply corrected by one
  authorised account, which must supply the code; release after success by two). It applies to an eSIM only. A
  new migration (`20261112120000_apply_error_esim_code_missing`) replaces the CHECK on `applyError`; S.1's
  migration is not edited. A code that is there and cannot be opened stays a technical fault, retried.
- **What PostgreSQL logs.** A statement the database refuses is logged with the row that failed. No code path
  sends an unsealed eSIM code to the database (`resultColumns` refuses before any statement; a line's and a
  task's code go through `storableEsimCode`), so that row holds sealed text at most. The CHECK
  `resultEsimCode LIKE 'v1:%'` is the last line of defence, and it is one that writes the refused value to the
  server's log: it must never be the line that is relied on.
- Spec item 8 is closed: a completion, a reject and a cancel by hand raced with T5 change nothing, and T5 applies.

## As built in S.9 (decisions by people)

`lines/provider-decisions.ts` (`ProviderDecisions`), served by `POST /office/tasks/:id/provider-decision` and
`POST /office/tasks/:id/provider-decision/approval`. D15 and D16 stand as written; nothing in them changed.

- **The rules decide, twice.** Who may act, on what, with which evidence and what the step is are
  `decisionStep`'s (S.3). The service asks it once before any lock, so a refusal costs nothing, and once more
  under the operation's row lock (`lockedTaskOperation`, `FOR UPDATE`) on the events as they stand there: that
  answer is the one acted on. The route's own gate (`refuseEntered`, `requireGrant(accounting)`) runs before
  anything is read, so an account that may not decide learns nothing about a task. One rule was added:
  `released` — once a release was approved, no further decision is taken on that operation.
- **T10, one account** (*confirm success*, *apply corrected*): task claimed (`working → done`) → the claim keys
  → the operation locked, the rules asked, the event written → `unknown → succeeded` with the reference and what
  the person says the provider handed back (the eSIM code sealed), or for a correction the stamp alone → `appliedAt`
  stamped by compare-and-set → `TaskCompletion.applyClaimed`, the code the settlement and the branch's
  completion run → `task.done`. One transaction: a fault anywhere leaves no event, no move, no line and the hold
  as it was.
- **Three people, three records (D12 as written; corrected in the final review of S.9, owner's decision of
  2026-11-12).** A first version wrote the entry and the notice in the name of the account that decided; that
  moved the sale to it and is removed.
  - *Whose sale it is:* the task's **submitter**. The wallet entries (the release of the hold, the debit) and
    `task.done` name the submitter as the actor, exactly as the settlement of a provider's verdict does, through
    the same function (`applyAsSettlement` in `activation-settlement.ts`; `submitterOf`). The task's assignee
    stays empty: nobody took it.
  - *Who handled it:* **«النظام»**, the handler named on the notice. The submitter is told too (`tellActor`).
  - *Who decided:* the account that confirmed or corrected, named in `ProviderDecisionEvent` (id and login, for
    good) and on the activity record (`provider_decision`), and in no entry, notice or task column.
  The exception a confirmation may end in is announced the same way (from «النظام», in the submitter's name, to
  every account that may decide). An approved release is a rejection by a person and keeps naming the account
  that approved it, as a reject by hand does; it posts no sale.
- **What is put on the line:** what the person gave, else what the provider handed back, else what the task
  named. A person who says the provider activated a line names the number: when none is known the answer is
  `400 DECISION_NUMBER_REQUIRED`, and none is made up (the settlement's `freshNumber` is not used here). A serial
  given is held to the company's SIM rules. An eSIM needs its code from one of the three: else
  `400 ESIM_CODE_REQUIRED` and nothing is written, which is how *apply corrected* on `esim-code-missing` "must
  be given the code". A code that is given must have the form of one (`isActivationCode`:
  `LPA:1$<address>$<matching id>`, printable, no spaces): anything else is the same refusal, before it is sealed. The code is rendered and sealed before the transaction (`storableEsimCode`); the decision
  event has no column for it and carries `suppliedEsimCode` only; no notice, activity row or log line carries it.
  On *apply corrected* the operation's own result columns are not rewritten: they stay what the provider
  reported, and `applyError` stays as the record of why it could not be applied; the corrected number and serial
  are on the line and on the task.
- **A confirmation whose line cannot be made** (the number or the serial was taken meanwhile, the package or the
  point of sale is gone): the first transaction rolls back whole, and a second one writes the event,
  `unknown → succeeded` with the result, and `applyError` + `applyFailedAt` (D16), and tells the other accounts
  that may decide. The confirmation is true whatever became of the line, so it is on record; the task stays
  `working` with its hold, and *apply corrected* or the approved release closes it. The route answers
  `{ ok, outcome: 'exception', reason }`.
- **A correction that does not fit** (the corrected number or serial is taken too) is refused with what was
  taken (`409 NUMBER_TAKEN`, `409 SIM_TAKEN`), and everything rolls back: the exception, the hold and the record
  are as they were. No decision event is written for it, because nothing was decided that took effect and the
  closed list of event types (`proposed`, `approved`, `refused`, `applied`) has none for an attempt; the attempt
  is on the activity record (`provider_decision`, `fail`, the code), which is purged after its retention. That
  row holds the action, the task's id and the refusal's code, and nothing that was sent (no number, serial, note,
  reference or code). **Owner's decision, 2026-11-12:** this stands; no fifth event type is added and D15 is not
  changed.
- **T10, a proposal** (*declare failure*, *release after success*): the event, under the operation's lock, and
  nothing else: no notice, no change to the operation, the task or the hold. The unique `(operationId, sequence)`
  is the second barrier: a writer that lost the row inserts nothing and is refused.
- **T11, the answer of another account:** the task's row, then the operation's, then the rules. A refusal writes
  its event and nothing else. An approval of a declared failure writes `unknown → failed` (guarded on the
  attempt) and the `provider-operation.settled` message; the error stays what made the operation unknown, and
  that people declared it failed is what the events say. From that commit `taskActions` opens the task to the
  branch; its note and the handlers' notice are the settlement's (T6), as for any operation the provider did not
  run. The hold stays. An approval of a release rejects the task (`TasksService.rejectByDecision`, with the fixed
  reason `PROVIDER_RELEASED_NOTE`) and gives the hold back, once; the operation is not written at all: it keeps
  `succeeded`, the provider's reference and result, and its exception. Nothing is sent again by either.
- **The record.** Rows are written through `ProviderOperationsService.recordDecision` only; nothing in the
  product updates or deletes one, and the database refuses both and a truncate. The worker's purge is
  `purgeActivity`, which names `ActivityEvent` alone. The table's owner can switch its triggers off (the spec's
  own clean-up does, in one transaction): the protection is against the application and its bugs, not against a
  database administrator.
- **Proved by mutation** (each made `provider-decisions.db.spec.ts` fail and was reverted): the operation's row
  read without its lock; the rules not asked again under the lock; the proposer allowed to answer; an approved
  release not final; a proposal that also moves the operation; the task's claim not checked; a release that does
  not check the task is open.
- Spec items 19 to 22 are closed. Not built here: any read of open proposals for a queue, and the screens (S.10).

## As built in S.10 (the screens)

Spec: `docs/superpowers/specs/2026-11-12-provider-operation-screens.md`. No rule of the settlement or of the
decisions changed; the screens show what the API decides.

- **The API says what may be done; the screen only shows it.** `TasksService.list` and `.detail` read the task's
  operation through the task's own relation (`status`, `appliedAt`, `applyError` and nothing else) and answer its
  phase (`shownPhase`), what became of the hold (`holdOf`, from the task), and `canTake` / `canWork` /
  `canCancel` as `taskActions` allows (D6). Before S.10 those three flags ignored the operation: the routes
  refused, but the buttons were shown. The reason of an exception is answered to branch accounts only.
- **What an account may decide is asked of the rules, not written twice.** `decisionChoices` runs `decisionStep`
  for each decision and for approve and refuse, with evidence that is complete, and answers which of them this
  account may take now and, when none, whether the reason is the account (`own-task`, `own-proposal`, an entered
  session, no grant). `ProviderDecisions.view` and `.waiting` answer that, so the form and the queue offer what
  the two write routes accept. The routes ask the rules again with what was really sent.
- **Who reads the decisions.** The two new reads have the gate of a decision (`refuseEntered`, then
  `requireGrant(accounting)`), before anything is read: the evidence and the notes of a decision are read by the
  accounts that could have written them. Every reader of a task still reads its phase and its hold. A read writes
  nothing (no activity event, no notice).
- **No read carries an eSIM code.** The record has no column for one; the queue's query does not select the
  operation's result; the decision view reads the result only to say whether the form must ask for a number or a
  code. The code a person types lives in the dialog's own state, which is unmounted when it closes: it is never in
  the address, in storage, in the query cache or in the console. The ticket's own read stays `fresh` (not kept
  once the page closes), and so are the decision view and the queue.
- **After a write** the task, the decision view and the queue are asked again. A refusal that means the screen is
  stale (`DECISION_NOT_APPLICABLE`, `DECISION_PROPOSAL_OPEN`, `DECISION_NO_PROPOSAL`) closes the form, says so,
  and asks again; any other refusal, and a lost connection, stay in the form with what was typed, and nothing is
  sent again by itself. A button is disabled while its request runs.
- **Three people on screen (D12).** The ticket shows the submitter as before; the record names the account that
  decided; the entry and the notice of a decided activation are the submitter's, from «النظام» (S.9).
- **The queue is a paged list** (final review of S.10). `GET /office/provider-decisions` answers the list contract
  with `?cursor=` and `?waiting=approval|decision`, fifty rows a page, ordered by the operation's `createdAt` and
  id, newest first: a key that never changes, so paging neither repeats nor skips a row that is still waiting.
  "Has an open proposal" is said in SQL the way `openProposal` says it from the events (the step with the highest
  sequence is `proposed`); the page of ids and the two counts are raw queries in the operations repository, the
  rows a second read by id. `totals` are counted over the whole queue on every request. A first version read the
  oldest 200 and stopped, which would have hidden a new proposal behind 200 older operations.
- **What an account that may not decide is told** is pinned over HTTP: a point of sale, a branch account without
  the grant and an entered session get the task's `operation { phase, reason, decisions: false }` and `hold`, and
  from the two decision reads `403` with no body but the code. No evidence, note, reference, proposer or step of a
  decision is in any answer they can get; another point of sale does not read the task at all.

## As built in S.11 (opening)

- **The route (D13).** `ProviderGateway.dispatches(providerCode)` is asked in one place, `LinesService.activate`,
  after the checks every activation passes (who sells, the package, the SIM, the price) and before the gateway is
  asked to run anything: `runsNow(pkg, 'activate') && gateway.dispatches(provider.code)`. The simulation's hint
  (`outcome`) is not read for it. A package run by hand, a provider the gateway does not take, the simulation and
  "not connected" behave as before.
- **Off, as a constant.** The application binds `SimulatedProviderGateway` and nothing else, and its `dispatches`
  is `return false`. It is not a setting: `PROVIDER_DISPATCH=1`, `NODE_ENV`, `PROVIDER_SIMULATION`, a provider row,
  nothing deployed today changes it. S.12a replaces the constant with D18's four conditions, established in the
  worker. `provider-dispatch-off.spec.ts` reads the shipped source and pins: one gateway implementation; the
  constant; one caller; the worker's dispatcher built over the same gateway, whose `send` opens no connection;
  `PROVIDER_DISPATCH` read by `config.ts` and `worker.ts` only; no code that reads `ProviderCredential`; no
  outgoing connection under the providers domain; no adapter but the catalog's two.
- **T1 without a second copy of anything.** `TasksService.openTask` already was the transaction that locks the
  claim keys, answers a repeated key, judges the reservation, inserts the task, takes the hold and writes the
  notices (S.2, S.6). It gained `alongside(tx, task)`, a step the caller supplies that runs inside that
  transaction after the task's row exists and before the wallet. For a dispatched activation it is
  `recordIn(tx, operationKey(task.id), request, { taskId })`: the existing recorder, which writes the operation and
  its outbox message, now also the task's id. A repeated request returns before it, so no second operation, hold,
  message or notice is written; a failure of any statement rolls the whole opening back.
- **The key is required on this route (D14).** Without one: `400 REQUEST_KEY_REQUIRED`, before anything is
  written. The stored key is the database's (`OfficeTask.requestKey`), so a repeat is answered with the first task
  when the duplicate guard's store is down, and for as long as the task exists.
- **Nothing is sent by the opening.** It writes rows. A message is published by the worker's relay, which runs
  only where `providerDispatchOn()` says so (never on a production-grade deployment), and what it leads to is the
  dispatcher over the simulated gateway, which answers `left: false`: the operation is put back and fails after
  its attempts with the hold kept. None of that is reachable today, because nothing records an operation.
- Spec items 1, 4 and 28 are closed.
- **Nobody is told a dispatched task "opened"** (final audit of S.11). `task.opened` goes to the branch's
  handlers and means "there is a task to take"; for a task the provider has, that is untrue, and D6 lets them do
  nothing with it. `openTask` takes `announce: false` and writes no notice for it; the dispatched activation is
  its only user. A manual task is announced as before. The branch's handlers hear of a dispatched task when it
  becomes theirs (T6 writes `task.opened` from «النظام», once); the accounts that decide hear of it when it needs
  them (T7, T5′, once each). A repeated request writes nothing, as before. So T1's writes are the task, the
  operation, its outbox message and the hold, and no notice: the last write is the hold's ledger entry.
- **The audit of `alongside`.** One definition (`TasksService.openTask`), one call (`input.alongside?.(tx, created)`,
  inside the transaction, with the transaction's client), one user (`LinesService.openForDispatch`), whose step is
  `recordIn(tx, …)` and nothing else: no client of its own, no second transaction, no gateway. It runs after the
  task's insert, so an operation cannot exist without its task (and `taskId` is a foreign key); it runs in the
  same transaction as the insert, so a task cannot be committed without it; it runs after the repeat's early
  return, so a repeated request never reaches it (the specs count its calls: one for a request and any number of
  repeats, at once or in turn). Locks: claim keys → the new task's row → the new operation's row → the wallet,
  which is section 6's order. The only thing done after the commit is publishing the written notices to open
  sessions, and there are none. The manual route, the simulation and "not connected" pass no step and are
  unchanged.
- **What S.12a must change in `provider-dispatch-off.spec.ts`** is written at the top of that file: the constant
  becomes D18's four conditions, each alone and every three of them still answering false; the API process keeps
  no adapter and no credential; the checks on the binding, on `testing/` and on the single caller stay.

## As built in S.12a (the switch, no adapter)

One new migration, `20261113100000_provider_dispatch_target_and_readiness` (three nullable columns on `Provider`,
four CHECKs; no historical migration edited). Why it was needed: D18 kept the approval per deployment, and a
deployment's target is a setting, so an approval with no target on record would have stood after `sandbox`
became `live`; and the API could not know what the worker holds without the worker saying so in the database.

- **Three questions, kept apart** (`providers/dispatch/dispatch-policy.ts`, pure):
  1. *the policy* — `eligibility(settings, provider)`: the four conditions, all of them. `PROVIDER_DISPATCH` is
     exactly `1`; the provider's code is in `PROVIDER_ADAPTERS`; `PROVIDER_TARGET` is `sandbox` or `live`; the
     owner approved the provider **for that target** and has not paused it. Settings that do not hold together
     refuse everything. No environment name is read.
  2. *the adapter* — `buildAdapters` in the worker: only for a provider named, only for the deployment's target,
     only with a credential for that target that opens, and only when the build has an adapter for it. **This
     build has none** (`ADAPTER_FACTORIES` is an empty frozen object), so nothing is built whatever is set.
  3. *the send* — `maySend` = the policy and an adapter this worker built.
- **How the API and the worker agree.** They are two processes with their own environments. The API opens the
  dispatch route (`mayOpenDispatch`) only when the four conditions hold **by its own settings** and the provider's
  row carries the worker's **attestation**: `dispatchReadyAt` within `READY_TTL_MS` (60 s) and
  `dispatchReadyTarget` equal to the API's own target. The worker writes it every 20 s, only for adapters it
  built, and withdraws it when it stops (`startReadiness`). So: the API on and the worker off, the two on
  different targets, the worker without the adapter or the credential, the worker stopped: each ends in the
  manual route. The worker, for its part, sends by its own settings and its own adapter only; an operation the
  API recorded while they agreed is not sent by a worker that no longer does. Every disagreement fails closed.
- **The atomic line of a pause** (`dispatch-gate.ts`). `claim` and `beginSend` each run in a transaction that
  first reads the provider's row `FOR SHARE` and asks `maySend`; approve, pause and resume are `UPDATE`s of that
  row (`FOR UPDATE` first). The two never overlap. A pause committed before the claim: no attempt is taken, none
  is counted. Between the claim and the mark: the attempt is not marked, so the provider is not called, and
  recovery puts it back as provably unsent. After the mark: that one attempt had leave to go and ends as any
  attempt does; a pause recalls nothing that left, and nothing after it is taken. A pause releases no hold.
- **Settling is never switched off.** The worker always runs the relay, the settlements queue, recovery and the
  sweeper; only sending goes through the gate. A paused provider's pending and unknown operations finish as
  usual, and `dispatchWaiting` (on recovery's timer) sends what waited once the provider is resumed.
- **The owner's switch**: `GET /office/providers/:code/dispatch` and `POST …/dispatch/approve`, `…/pause`,
  `…/resume`, `PUT …/dispatch/credential`. `requireOwner`: the branch owner in a session of its own; an employee
  with every grant, a lower layer and an entered session are refused. An approval is the last condition, never
  the first: refused unless the deployment is set up for the provider and holds a credential for its target; it
  records the target. A resume judges the same again and needs the approval on record to be for this target.
  Each change writes its own activity action with the provider's code and nothing of what was sent.
- **Credentials.** `ProviderCredential`, one row per provider and target, written by one `upsert` (a reader never
  finds half a replacement), sealed with `SECRETS_KEY`; a deployment stores one for its own target only. The API
  has no statement that selects `sealedValue` and no code that opens one; the worker's `readCredentials` is the
  only reader, and a credential that is missing, empty or does not open builds no adapter. No route answers it.
- **Start-up checks**: ADR 0016's amendment. A production process (API or worker) does not start with dispatch
  settings that cannot be carried out, which today includes naming any provider at all, since the build has no
  adapter.
- **Specs.** `provider-dispatch-switch.spec.ts` replaces `provider-dispatch-off.spec.ts`: the sixteen
  combinations of the four conditions, each alone and every three; the adapter as a separate question; the two
  processes set up differently; the start-up checks; and what ships (one gateway bound by class, nothing imports
  `testing/`, only the worker's two files build adapters or read a credential, nothing sends ungated, the worker
  checks before it opens). `providers/dispatch/provider-dispatch.db.spec.ts`: the same over HTTP on PostgreSQL in
  a production-grade process, with the races decided by the row lock. Items 25 and 26 are closed.
- **For S.12b:** the first entry of `ADAPTER_FACTORIES`, in the worker's side only. The spec that pins the empty
  list and the one that pins "no outgoing connection under the providers domain" change with it, on purpose.

## Final corrections of S.12a (2026-11-13)

A review of S.12a as built found five things that were safe by accident or not safe enough. Two migrations, each
on its own: `20261113110000_provider_operation_waived_attempts` and
`20261113120000_provider_dispatch_deployment_and_generation`. No historical migration is edited. Still no adapter.

- **A closed gate does not use the budget of attempts** (ADR 0018, amended). An attempt that was taken and then
  refused at the mark (the owner paused the provider, withdrew its approval or replaced its credential between
  the two) is handed back **in the transaction that refused it**: `pending → requested`, with the message of its
  next send. So the operation is at once what D7 lets its submitter cancel; nothing waits for a lease to end. The
  attempt keeps its number and is counted in `ProviderOperation.waivedAttempts`; the budget is
  `attempts − waivedAttempts` (`spentAttempts`). Recovery, given the worker's gate, waives an unsent attempt it
  finds while the gate is closed in the same way, so no operation is failed for its attempts while its provider
  is closed. `attempts` is never reduced: it still fences an old answer from a later attempt and still orders
  the outbox messages, and a hand-back writes the message of the next send under a sequence no earlier one used.
- **"This deployment" is a name** (D18, condition 4). `sandbox` and `live` say which of the provider's systems
  is called; two deployments can call the same one. `DEPLOYMENT_ID` names the deployment (3 to 63 lower-case
  letters, digits or `-`; required with `PROVIDER_DISPATCH=1`, by the settings and by both start-up checks). The
  approval records it (`Provider.dispatchApprovedDeployment`) and so does the worker's attestation
  (`dispatchReadyDeployment`); each is read back against the reader's own name. A deployment that shares the
  database, or a database restored from another deployment's backup, is opened by neither. A provider has one
  approval: giving it on one deployment takes it from another. The database refuses an approval or an
  attestation that names no deployment.
  *Why a name and not "one database per deployment" as the only guarantee.* Separate databases remain the rule
  of every deployment (sessions, money and accounts already depend on it) and nothing here relaxes it. But a rule
  about infrastructure cannot be tested by the application, and it does not cover the case that does happen: a
  staging database restored from a backup of another deployment carries that deployment's approvals with it. A
  name on the row is checked in the policy, under the lock, and in the database's own constraints.
  *What it does not do.* Two deployments given the same name are one deployment as far as the application can
  tell. The name is an operator's setting, like the target.
- **A credential has a generation, and writing it closes the provider.** `ProviderCredential.generation` is
  raised by every write. `saveCredential` is one transaction under the provider's row lock (the lock the worker's
  gate reads under): the new sealed value and its generation, **the owner's approval withdrawn**, **the worker's
  attestation withdrawn**. A pause, if there is one, stays. Sending again needs `approve`; a `resume` is
  refused. From that commit no attempt is taken or marked, by any worker.
- **No adapter outlives its credential.** An adapter remembers the generation of the credential it was built
  with. The gate (`maySend`) requires it to equal the stored generation, read after the row lock is held; the
  worker's attestation is written under the row lock and only for the stored generation, and never over a
  provider approved for another deployment. So a worker that still holds a replaced credential can neither send
  nor bring back the attestation that the replacement withdrew, nor write over a newer worker's, even after the
  owner approved again. On its readiness round (every `READY_EVERY_MS`) a worker compares the stored generations
  with what it built from and, when they differ, builds **every** adapter again from what is stored and drops
  the old set. The API also requires the attested generation to be the stored one (`workerReady`).
  An attempt that was already marked finishes as any attempt does, with the adapter it was handed to; nothing is
  recalled, and no hold is released by a replacement.
- **The manifest, the registry and the attestation are three things.** `dispatch/adapter-manifest.ts` is the
  list of provider codes the build supports: names only, shared by the API and the worker, read by both start-up
  checks. `dispatch/provider-adapters.ts` is the registry of the code that reaches each provider: the worker's
  only. The worker's attestation in the database is what a running worker actually built. The API loads the
  first and reads the third; `provider-dispatch-switch.spec.ts` walks the API's import graph from `main.ts` and
  finds neither the registry, the routing gateway, the deployment's gate nor the worker's wiring in it. Adding
  the first adapter (S.12b) adds a factory to the registry and its code to the manifest (a spec keeps the two
  equal) and moves nothing into the API. The API needs no provider credential to start. Refusing to start a
  production process that names a provider the build does not support is kept: it reads the manifest.
- **The attestation's life.** Written every 20 s, believed for 60 s, for this deployment, this target and the
  stored generation only. A worker that stops withdraws it. A worker that is killed leaves its last one behind:
  for at most 60 s the API may still open the dispatch route. A sale opened then is recorded with its hold and
  waits `requested`: nobody sends it until a worker is back, and its submitter may cancel it (D7). After that
  every sale takes the manual route. An attestation never lets a request leave: the gate is asked again at the
  claim and at the mark.
- **More than one worker in a deployment (accepted for S.12a, to be reviewed before S.12b).** The attestation
  is the deployment's, not a worker's: a worker that stops withdraws it though another worker of the deployment
  is alive. That one writes it again on its next round (at most 20 s), and until then the API opens no dispatch
  route. It is fail closed and lets nothing leave: a send is decided by the gate at the claim and at the mark,
  never by the attestation. A worker that holds a replaced credential, or belongs to another deployment, cannot
  write one at any time. An attestation per worker, and the four other review conditions the final verification
  found, are listed in the plan's go-live gate (item 9) and must be decided before the first adapter runs.
- **Settling is untouched** by a pause, a withdrawn approval or a new credential: verdicts, an unknown answer and
  its late verdict, exceptions, recovery and the sweeper run as before.
- **Specs.** `provider-dispatch.db.spec.ts` (PostgreSQL, HTTP, production-grade): five pauses then one send; the
  budget with waived attempts between counted ones; recovery while open and while closed; fencing after a
  hand-back; a replacement while an operation is requested, pending before its mark, pending after it, during
  the provider's call, with two workers at once, and across a worker's stop and start; a replacement and each of
  the owner's writes against the row lock; thirty rounds of a replacement against a dispatch; two deployments on
  one database; a restored database; the attestation's minute. `provider-dispatch-switch.spec.ts`: the
  deployment's name in the settings and in every comparison, the generation in `maySend` and `workerReady`, and
  the import graph. `settlement-schema.db.spec.ts`: the new constraints. The file runs no pass over "every
  operation" of the database, which other spec files share.

## S.12b.0: hardening before the first adapter (2026-11-13)

The final verification of S.12a left five things to settle before an adapter may run. They are built here, with
no adapter: `ADAPTER_FACTORIES` and the manifest are still empty. One migration,
`20261113130000_provider_worker_attestations`; no historical migration is edited.

- **The request is sent by the adapter that was judged.** Before, the gate compared the generation the worker
  held with the stored one, the mark was written, and only then did the gateway look the adapter up: a rebuild
  between the two sent a marked request with a credential nobody had judged for it. Now `SendGate.permits`
  answers a **permit** (`SendPermit`) or null. `DeploymentSendGate` reads what the worker holds for the provider
  once, as one object (`RoutingProviderGateway.sender`: the adapter with the generation it was built from),
  judges that generation under the provider's row lock, and answers that same object. `beginSend` answers the
  permit it was given **in the transaction that wrote the mark**, and `OperationDispatcher` sends through it: it
  holds no gateway, so it has no other way to a provider. The permit is a reference in the worker's memory for
  one attempt: it is not stored, queued or logged, and exposes no credential. The row lock ends with the mark's
  transaction; the provider is called after it. A request marked before a credential was replaced goes with the
  credential it was marked under and is treated as any attempt that left (`sentAt` is written); nothing after it
  is taken until the owner approves again. Fencing and the outbox are untouched.
- **The pass over waiting operations is fair** (`WaitingPass`). It reads `requested` operations **by id**, a page
  (100) at a time, at most 20 pages a round and **at most 100 operations sent a round** (so recovery, on the same
  timer, is not kept behind a long run of calls), and remembers the last id it looked at: a round that stops before
  the end continues there, one that reaches the end starts again from the beginning. The id never changes, so a
  walk meets every operation that stays waiting once and none twice. Each operation still goes through `handle`,
  so the gate is asked at every claim and every mark: a closed provider's operation is looked at and left,
  uncounted. One that starts waiting behind the walk is met on the next; one that is taken or cancelled meanwhile
  is no longer in the list. One whose handling fails is logged by a code and passed; a worker that is stopping
  takes no further operation. Index `ProviderOperation(status, id)`.
- **One attestation a worker** (`ProviderWorkerAttestation`: provider, worker id, deployment, target, generation,
  `attestedAt`). A worker process makes an id when it starts and writes its own row for each adapter it holds,
  under the provider's row lock (shared) and only for the stored generation; with any other generation it
  removes its row instead. Stopping removes its own rows and nobody else's. A worker that is killed leaves a row
  that is believed for `READY_TTL_MS` and no longer; any worker's round clears rows ten times that old. Writing
  the credential removes every row of the provider in the same transaction as the approval. A pause closes the
  provider at once by the policy, rows or no rows. The API's `workerReady` is: some row of this deployment, this
  target and the stored generation, fresh. The four `Provider.dispatchReady…` columns are dropped. As before, an
  attestation only opens the dispatch route for new sales; a send is decided by the gate.
- **One clock.** `attestedAt` is written by PostgreSQL (`now()`), and its age is computed by PostgreSQL in the
  read (`clock_timestamp() - "attestedAt"`, answered as milliseconds). The policy reads no clock at all. The
  column is a point in time (`timestamptz`), so the session's time zone plays no part. A process whose clock is
  ahead or behind neither shortens nor stretches the minute.
- **A production worker needs `SECRETS_KEY` always** (`workerConfigProblems`), the same as the API's. It settles
  eSIM activations, and the code a provider handed back is stored sealed. With a key that does not open it (the
  check at start can only tell that a key is there and well formed), the settlement of that operation fails by a
  code and writes nothing: no line, no capture, no release, no exception; the hold stays and the sweeper meets it
  again. Other operations are settled meanwhile. `docker-compose.yml` hands the worker the same `SECRETS_KEY` as
  the API.
- **The settlement's sweeper is fair too** (final audit of S.12b.0; no migration). `applyPending` read the 100
  oldest unsettled operations by the time of their last write. An operation it cannot act on for a technical
  reason is not written, so it stayed first: a hundred of them (results a worker with the wrong key cannot open)
  hid every verdict behind them, for ever. Now it walks its two lists **by id, a page (100) at a time, at most
  five pages of each a round, each from where its last round stopped**: the verdicts to apply or hand over, and
  the unknown answers to announce. Each list has its own place and its own bound, so neither holds the other
  back. One that fails is logged by a code, left exactly as it is (no status, no stamp, no release) and passed;
  it is met again on every later walk. Nothing about applying changes: `apply` and its guards are as they were,
  so a second round, another worker and the message's own delivery still find nothing to do.
- **Stopping a worker.** An orderly stop (SIGTERM) closes the queue workers and waits for the job in hand: the
  request at the provider is finished and its verdict written, and no other job is taken; the two passes take
  no further operation. A worker that is killed leaves a marked attempt to recovery, which makes it unknown and
  never sends it again. Tested; the shutdown itself is unchanged.
- **How the deployment gets the worker's key.** The deployment of today is three Dockerfile applications in
  Coolify, each with its own environment: `docker-compose.yml` is not what runs there, so the line that hands the
  worker `SECRETS_KEY` in it reaches nothing. The key is set on the worker application itself, the same value as
  the API's, before this code is deployed (the upgrade plan, 4.1 and step P3).
- **Specs** (`provider-dispatch.db.spec.ts`, PostgreSQL, production-grade): the mark, then a new credential and
  a rebuild, then the call; a rebuild in the middle of many attempts; 150 operations of a paused provider and 10
  of an open one, in one round and with small pages; changes during a walk; a process clock ten minutes ahead
  and behind; two workers, one stopping and one killed; a new credential and a pause against every worker's
  row; an eSIM result arriving while sending is off, with no key, a malformed key, another key and the right
  key; messages delivered again to two workers' dispatchers and settlements. `provider-dispatch-switch.spec.ts`:
  the worker's check, the rows in `workerReady`, and that the dispatcher holds no gateway.
