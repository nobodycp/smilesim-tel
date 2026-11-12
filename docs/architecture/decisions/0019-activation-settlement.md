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
- **`esim-code-missing` — an amendment to D16 proposed here, pending the owner's approval** (the spec carries
  it as such). A confirmed eSIM activation with no code from the provider and none on the task makes no line: it
  is recorded as an exception, like the other three reasons, and waits for D15's decisions. A new migration
  (`20261112120000_apply_error_esim_code_missing`) replaces the CHECK on `applyError`; S.1's migration is not
  edited. A code that is there and cannot be opened stays a technical fault. The evidence and the way back if the
  amendment is refused are in the spec, under D16.
- **What PostgreSQL logs.** A statement the database refuses is logged with the row that failed. No code path
  sends an unsealed eSIM code to the database (`resultColumns` refuses before any statement; a line's and a
  task's code go through `storableEsimCode`), so that row holds sealed text at most. The CHECK
  `resultEsimCode LIKE 'v1:%'` is the last line of defence, and it is one that writes the refused value to the
  server's log: it must never be the line that is relied on.
- Spec item 8 is closed: a completion, a reject and a cancel by hand raced with T5 change nothing, and T5 applies.

