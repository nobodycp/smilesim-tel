# Activation through a provider: hold at the request, settle on the provider's answer — design spec

Owner task 04, 2026-11-10, on `16e345d`. Revised twice the same day: with the owner's answers to O1–O6, then
with the final review (one operation per task, cancellation, how a provider is switched on, eSIM data, the second
approval, lock order). Section 10 lists what the review changed and what still conflicts with text elsewhere.
The direction is agreed: the task carries the money, the operation carries the provider's verdict, one settlement.
The design is accepted (ADR 0019). **Slices S.1 (the schema) and S.2 (the reservation, D5) are built**;
everything else here is still design, and the plan says which slices exist. A1 of the audit is closed by S.2. No code, schema, route or screen changes with
this document. It says how `ProviderOperation` and the dispatcher (ADR 0017, 0018) join the activation's money,
and what must be true before any of it is switched on.

## 1. The activation today (read from the code)

`POST /office/lines` → `LinesController.activate` (duplicate guard, `ActivityInterceptor`, `ActorInterceptor`) →
`LinesService.activate(actor, body)`:

1. `parseInput(ActivateBody)`; `gateway.accept(outcome)`.
2. **Who:** the point of sale must be visible to the actor, and a point of sale activates only for itself
   (`line-ops.ts` `canActivateFor`) → `403 FORBIDDEN`.
3. **What:** the package is sellable (company, provider, renewal targets), visible on the point of sale's path
   (`PACKAGE_HIDDEN`), not stopped for it (`assertRunnable`, `deniedOpsFor`), and the SIM fits the company and the
   package (`checkedSim`: `ESIM_UNSUPPORTED`, `ESIM_PACKAGE_OFF`, serial rules).
4. **Price, fixed now:** `unit = LinePricing.resolveBuyPrice(pos, pkg, 'subscription')` (custom price, else the
   parent's sell price, else the layer column) and `posDelta = -(unit + eSIM fee)`.
5. **Number:** the requested one, or a fresh one; a requested number that a line already has is `409 NUMBER_TAKEN`
   (checked before the transaction; the unique index is the real guard).
6. `route()`: a package run by hand, or a gateway that reaches no provider → a **branch task**; a gateway that
   answers `ok` → **applied now**; a gateway that refuses → a branch task noted `PROVIDER_FAILED_NOTE`.
7. **Applied now** — one `runTx`: `assertSimFree` (advisory lock on the serial) → `createLine` (active, terms
   stamped with today's renewal price) → `WalletLedger.move(pos, posDelta, 'activate', sale)`: wallet locked,
   spendable = balance − held, ceiling checked, entry with `packagePrice`, `providerCost`, `esimPrice`, period and
   the price ladder. No hold is involved. Answer `{ applied: true, debited, line }`.
8. **Branch task** — `TasksService.openTask`, one `runTx`: `WalletLedger.hold` (wallet locked, ceiling checked on
   balance − held, `Wallet.held += amount`, a `hold` entry) → `OfficeTask` `working` with `posDelta`, `held`,
   `unitPrice`, number, serial, eSIM flag → notices. Answer `{ applied: false, taskId }`.
9. **The branch finishes the task** — `TaskCompletion.complete`, one `runTx`: `claimTask` (guarded
   `working → done`, so one of two handlers wins) → `ledger.release(held)` → handler `activate`: `assertSimFree`,
   `createLine` → `ledger.move(posDelta, 'activate', sale)` with `packagePrice = task.unitPrice` → task result →
   notice. **Reject** (branch) and **cancel** (submitter): guarded status change + `ledger.release`.

`ProviderEntry` holds payments and settlements with a provider and is not written by an activation; what an
activation costs us is `WalletEntry.providerCost`. `UnitOfWork.runTx` is one Read Committed transaction; notices
are published after commit.

## 2. Rules that stay exactly as they are

| Rule | Where it lives |
|---|---|
| Who may activate for whom | `lines/line-ops.ts` `canActivateFor`, `office/policy.ts` |
| Package visibility, stops, run modes, SIM rules | `rules/user-terms.ts`, `rules/run-modes.ts`, `rules/sim-rules.ts` |
| The price a point of sale pays, and that the price charged is the price fixed at the request (1.5) | `lines/line-pricing.ts`, `OfficeTask.unitPrice` / `posDelta` |
| Spendable money is balance − held, within the ceiling; the branch has no ceiling | `rules/prices.ts` `withinCeiling`, `WalletLedger` |
| A wallet row is written only by the ledger; line before wallet; wallets in sorted order (1.2, 1.4) | `wallets/wallet-ledger.ts` |
| One number per line, one live line per SIM serial | unique `Line.msisdn`, `line-state.ts` `assertSimFree` |
| A task is finished once (guarded claim), and its hold is released when it closes | `lines/task-completion.ts`, `tasks/tasks.service.ts` |
| A lower layer never sees provider code, cost or run mode (3.4) | response shaping, `response-shape.spec.ts` |
| The manual branch path: open, take, complete by hand, reject, cancel | `tasks/`, `lines/task-completion.ts` |

## 3. Found during the audit (not changed here)

- **A1. Nothing reserves a number or a serial while an activation task is open.** Two open tasks can carry the
  same SIM serial or requested number; the second completion fails (`SIM_TAKEN` / `NUMBER_TAKEN`) and that task can
  only be rejected. Harmless by hand; with a provider it would mean two real activations of one card.
- **A2. A lowered ceiling can block a completion.** Completion releases the hold and then debits with the ceiling
  check. If the parent lowered the ceiling after the task opened, the debit is refused although the money was
  held. By hand the branch sees the error; after a provider has activated the line, the charge must not fail.
- **A3. No durable request idempotency.** The duplicate guard is Redis, 10 s / 24 h, and fails open; the web sends
  no `Idempotency-Key`. Two identical requests more than 10 s apart are two sales.
- **A4. The provider's answer has nowhere to carry what an activation returns** (the number the provider assigned,
  an eSIM's serial and activation code): `SendEvidence.confirmed` holds a reference only.
- **A5. A task stores its submitter, not the operator** of an entered session.
- **A6. eSIM activation codes are stored in clear and widely read.** `Line.esimQr` and `OfficeTask.esimQr` hold the
  QR picture as written; `LineReads.list` returns it on **every row of the line list**, `LineReads.detail` and
  `TasksService` detail return it to any account that can see the line or the task.
- **A7. The activity log is not permanent.** The worker deletes `ActivityEvent` rows older than the retention
  window every day, so a decision that must stay auditable cannot live there alone.
- **A8. The worker does not run the production settings check** (`assertProductionConfig` is called by `main.ts`
  only), and `providerDispatchOn()` is "not production", which would make a staging copy declare itself
  non-production in order to dispatch.

## 4. Decisions

**D1. The activation task is the carrier of the money.** A provider activation opens the same `OfficeTask` as
today (hold, fixed price, number, serial) and records a `ProviderOperation` **in the same transaction**. The
provider's answer then *completes* that task through the existing completion handler, or leaves it to the branch.
There is one hold, one charge path and one place that creates the line, for both the manual and the provider
route.

**D2. The answer to the caller does not change:** `{ applied: false, taskId }`, as for any deferred activation.

**D3. One task, one operation.** `ProviderOperation.taskId` is a foreign key with a **unique** index: a task has
at most one operation, for ever, and the database refuses a second. The idempotency key is `activate:<taskId>`.

- **A retry is an attempt of that operation**, never a new operation: `pending → requested` when the request is
  known not to have left, up to `MAX_ATTEMPTS`, each under the same key (ADR 0017, 0018).
- **`failed` is final for the task's provider route.** The task is then the branch's (D5); it is never sent to the
  provider again. A new try at the provider is a new sale: reject this task, submit again.
- So there are no parallel operations for one task, and "which operation is the task's" is never a question.

**D4. A sale is protected against repetition at three levels**, each for a different repeat:

| Level | Stops | Key | Enforced by |
|---|---|---|---|
| The HTTP request (D14) | the same form sent twice from creating two tasks | the web's `Idempotency-Key`, stored as `OfficeTask.requestKey` | a unique index, for as long as the task row exists |
| The thing sold (D5) | two different requests for one serial or one number | the serial, the number | partial unique indexes on open activation tasks |
| The provider call (D3) | one task from reaching the provider twice | `activate:<taskId>` | unique `ProviderOperation.idempotencyKey` and unique `taskId` |

**D5. Reservation, enforced by the database.** An open activation task **is** the reservation of its serial and
its number, for manual and provider tasks alike (O1):

```sql
CREATE UNIQUE INDEX "OfficeTask_open_activation_iccid"  ON "OfficeTask"("iccid")
  WHERE "action" = 'activate' AND "status" = 'working' AND "iccid"  IS NOT NULL;
CREATE UNIQUE INDEX "OfficeTask_open_activation_msisdn" ON "OfficeTask"("msisdn")
  WHERE "action" = 'activate' AND "status" = 'working' AND "msisdn" IS NOT NULL;
```

- Two active reservations of one item cannot exist: the second insert is refused by PostgreSQL whatever the code
  does (`409 SIM_TAKEN` / `NUMBER_TAKEN`; the insert is `ON CONFLICT DO NOTHING` followed by a read, so the
  caller's transaction is not aborted).
- **Release is the task leaving `working`**, in the guarded write that closes it: `done` (the line now owns the
  number through unique `Line.msisdn`, and the serial through `assertSimFree`), `rejected`, `cancelled`. A frozen
  task (operation in flight, `unknown`, or an exception) stays `working`, so its reservation stays.
- Against an existing **line** (another table): the opening transaction takes the advisory locks `iccid:<serial>`
  and `msisdn:<number>` and checks live lines; line creation takes the same locks and checks open activation
  tasks. `Line.msisdn` is unique in the database; a serial among live lines stays the advisory-lock rule.
- The migration first lists open activation tasks that already share a serial or a number and stops if any
  exist. Prisma cannot express a partial index; like the CHECK constraints it lives in the migration and is pinned
  by a PostgreSQL spec.

**D6. What each operation state means for the task and the money.**

| Operation | Task | Hold | Complete by hand | Reject (branch) | Cancel (submitter) | What the system does |
|---|---|---|---|---|---|---|
| none (manual task) | `working` | held | yes | yes | yes | — |
| `requested` | `working`, waiting | held | no | no | **yes, atomically (D7)** | relay and dispatcher will take it |
| `pending` | `working`, waiting | held | no | no | **no** | the dispatcher is on it |
| `unknown` | `working`, frozen | **held** | no | no | **no** | waits for the provider's late verdict or a decision (D15) |
| `succeeded`, not applied yet | `working` | held | no | no | no | T5 applies it |
| `succeeded`, applied | `done` | captured | — | — | — | — |
| `succeeded`, exception (D16) | `working`, exception | **held** | no | no | no | waits for a decision (D15) |
| `failed` | `working`, ordinary branch task noted `PROVIDER_FAILED_NOTE` | held | yes | yes (release) | yes (release) | nothing more; never re-sent |

"In flight" = `requested`, `pending`, `unknown`, or `succeeded` not applied. The table is one pure function
(`taskActions(operation)`); the services ask it and nothing else decides.

**D7. Cancelling a requested operation is one transaction.** The submitter's cancel, when the task has an
operation:

```
BEGIN
  cancelTask: UPDATE OfficeTask SET status='cancelled' WHERE id AND status='working'          -- 0 rows → 400
  SELECT … FROM ProviderOperation WHERE taskId = … FOR UPDATE
  ├─ failed            → go on
  ├─ requested         → UPDATE … SET status='failed', lastError='abandoned', appliedAt=now()
  │                       WHERE id AND status='requested'                                      -- 0 rows → 409, rollback
  └─ anything else     → 409 DUPLICATE_REQUEST, rollback (the task stays working, the hold stays)
  WalletLedger.release(pos, task.held)
COMMIT
```

The dispatcher's `claim` is a compare-and-set on the same row: whichever of the two commits first wins, and the
other finds the row changed. If the claim won, the operation is `pending` and the cancel is refused; if the cancel
won, `claim` answers null and nothing is sent. `appliedAt` is stamped so the settlement sweeper has nothing to do
for it. `requested` after an attempt that never left (attempts ≥ 1) is cancellable the same way: nothing is at the
provider. The same guard, without the `requested` branch, protects **reject** and **complete by hand**: they go on
only with no operation or a `failed` one.

**D8. The verdict is stored before the money moves, in a separate transaction.** `settle` only records what the
provider said. Applying it is its own transaction, started by an outbox message (`provider-operation.settled`) and
re-tried by a sweeper for any `succeeded` operation with neither `appliedAt` nor `applyError`.

**D9. Exactly one charge, exactly one line.** Three independent guards, any one of which is enough: the task
claim (`working → done`, guarded), `appliedAt` written by compare-and-set (`IS NULL`), and the unique number with
the serial lock.

**D10. The hold is captured, not released-then-debited** (O2, both routes). `WalletLedger.capture(tx, userId,
held, amount, kind, sale)`: under the wallet lock, `held −= held`, `balance += amount`, and the sale entry,
**without** the ceiling check (it was made when the hold was taken, and held money cannot be spent by anything
else). It runs only inside the transaction that claimed the task, so it cannot run twice; it **refuses** when
`Wallet.held` is smaller than the task's hold (a hold released twice must fail loudly, not be clamped).

**D11. What the provider hands back** travels in the evidence and is stored on the operation in typed columns:
`resultMsisdn`, `resultIccid`, and `resultEsimCode` (**sealed**, D17). The application copies them to the line as
the branch's hand-back does today.

**D12. Who is named.** Entries and notices written at settlement name the task's submitter as the actor and
«النظام» as the handler. The request itself is recorded by `@Activity('activate')`.

**D13. Which activations take this route.** `route()` answers `dispatch` when the package runs the operation
automatically **and** `gateway.dispatches(providerCode)` is true. That is true only when every condition of D18
holds; it is false everywhere today. Simulation (development, tests) keeps answering inside the request; "not
connected" keeps opening a plain branch task.

**D14. A durable request key (O4), before any provider is switched on.** The web creates one key per activation
form and sends it as `Idempotency-Key`. `OfficeTask.requestKey` stores `sha256(submitterId : key)`, unique, with
`requestHash` (the fingerprint of the parsed body). The task is inserted `ON CONFLICT DO NOTHING`:
no conflict → the sale goes on; conflict with the same `requestHash` → the first task is answered again and
nothing is held or recorded; conflict with another `requestHash` → `400 INVALID`. The Redis guard stays in front.
On the dispatch route the header is **required**; on the manual route it is honoured when present.

**D15. Decisions by people on a provider operation (O5, final).**

| Decision | When | Effect | Approval |
|---|---|---|---|
| **Confirm success** | `unknown` | `unknown → succeeded`, then T5 (line, capture) | one authorised account |
| **Declare failure** | `unknown` | `unknown → failed`; the task becomes the branch's | **a second, independent authorised account** |
| **Apply with corrected data** | exception (D16) | T5 with the number / serial the provider really activated | one authorised account |
| **Release after provider success** | exception (D16) | hold released, task rejected | **a second, independent authorised account** |

- **Authorised:** the branch owner, or a branch staff account holding the `accounting` grant. Stated in
  `office/policy.ts`, pinned in `permissions.http.spec.ts`.
- **A real account session only:** `session.kind === 'account'`; an entered (impersonation) session is refused for
  proposing and for approving (`refuseEntered`), so the account named is the person who acted.
- **Evidence, always:** the kind of evidence from a closed list (the provider's portal, the provider's statement,
  the provider's written answer, a test on the line); a note of **at least 20 characters**; the provider's
  reference (required to confirm success). The two decisions in favour of the customer's line (confirm, apply
  corrected) also need what the activation hands back when the provider chose it.
- **Second approval:** the two decisions that let money go back (declare failure, release) are first only a
  **proposal**. Nothing changes until another authorised account approves it. The approver's account id must
  differ from the proposer's (**no account approves its own decision**) and from the task's submitter. The
  approver may refuse; the proposal is then closed and a new one may be made. **Without the approval the operation
  stays as it is**: `unknown`, or the exception, with its hold and its reservation, for as long as it takes.
  A branch with a single authorised account therefore cannot declare a failure: it needs a second accounting
  account, by design.
- **Atomic:** the approval, the guarded move it causes (`unknown → failed`, or the release and the task's
  rejection) and its audit row are one transaction; the single-account decisions likewise.
- **The record is permanent and cannot be changed.** Table `ProviderDecisionEvent`, append-only:
  `(operationId, sequence)` unique; `type` (`proposed`, `approved`, `refused`, `applied`); the decision; evidence
  kind, reference, note; account id; time. No column is ever updated and no row deleted: a database trigger
  refuses `UPDATE` and `DELETE` on the table, and the worker's activity purge does not touch it (A7). The current
  state of a decision is its last event; a new event is inserted under the operation's row lock, so two accounts
  acting at once produce one next step. An `ActivityEvent` is written too, for the audit screen, but it is not the
  record.
- **The provider's own answer is not a human decision.** A late verdict from the same attempt (ADR 0018), and
  later the provider's status check, close an `unknown` operation without anyone's approval.

**D16. The provider succeeded and the line cannot be created: an exception, not a failure.** T5 rolls back on a
business refusal (the number or the serial was taken meanwhile, the package or the point of sale no longer
exists). Then, in its own transaction (T5′): the operation keeps `succeeded` and its result; `applyError` gets a
code from a closed list (`number-taken`, `sim-taken`, `target-missing`) and `applyFailedAt` the time; the task
stays `working` with its hold and its reservation; the authorised accounts are notified. The sweeper leaves an
operation that has an `applyError` alone; a technical error leaves none and is retried. The operation is
terminal, so it is never sent again, and no path releases the hold except the approved release of D15.

**D17. eSIM activation data is protected at rest, in transit inside the system, and on read.**

- **Sealed at rest** with `shared/secret-box.ts` (AES-256-GCM, `SECRETS_KEY`): `ProviderOperation.resultEsimCode`
  from the first day, and, closing A6, `Line.esimQr` and `OfficeTask.esimQr` (the existing values by the
  `seal-secrets` backfill). The repository seals on write and opens on read; no service sees the sealed form.
- **Never logged, queued or announced.** The dispatcher logs kinds and codes only (ADR 0018, decision 11); outbox
  and queue payloads carry the operation id only; notices, activity events and decision events never carry the
  code. `ProviderDecisionEvent` stores that a code was supplied, not the code. A spec captures the process output
  and the Redis job for an activation that returns a code and finds none of it.
- **Read by those who must hand it over, and only when they open it.** Lists never carry it (`GET /office/lines`,
  the task list). It is returned by the line's and the task's detail only to: the line's point of sale, an account
  above it on its own path, and the branch; each read is an audited event (`line.esim_read`). A lower layer never
  receives another point of sale's code (rule 3.4). `response-shape.spec.ts` pins who gets the field.
- A provider's credential is a different secret with its own rule (D18).

**D18. How a provider is switched on.** No environment name relaxes anything.

- **Staging is production-grade.** A staging deployment runs `NODE_ENV=production` and passes
  `assertProductionConfig` like production: secure cookies, sealed secrets, no trial accounts, no simulation. The
  advice in ADR 0016 to give a trial server `NODE_ENV=staging` is withdrawn (section 10).
- **The worker is checked too.** `worker.ts` runs the production settings check before it opens anything, with
  the worker's own list (`REDIS_URL`, `DATABASE_URL`, `SECRETS_KEY`, and the dispatch settings below).
- **The dispatcher stays off until four things are true, each explicit and each independent:**
  1. the deployment says so: `PROVIDER_DISPATCH=1` on the worker;
  2. the deployment names the adapters it may load: `PROVIDER_ADAPTERS=<code,…>`; an adapter not named is not
     constructed, whatever the database says;
  3. the deployment states its target: `PROVIDER_TARGET=sandbox` or `live`. It is a restriction, never a
     relaxation: an adapter's endpoints are constants in its code, one set per target, and a `sandbox` deployment
     cannot build a `live` client. A staging deployment is `sandbox`; only a deployment the owner calls production
     is `live`;
  4. the owner approved that provider on that deployment: `Provider.dispatchApprovedAt` / `dispatchApprovedBy`,
     set through an audited branch-owner route (a real account session), and revocable (`dispatchPausedAt`).
  `providerDispatchOn()` loses its "not production" test: the four conditions replace it. In production the check
  refuses `PROVIDER_DISPATCH=1` without `PROVIDER_ADAPTERS` and `PROVIDER_TARGET`.
- **Only the worker can reach a provider.** Adapters are bound to `PROVIDER_GATEWAY` in the worker
  (`provider-dispatch.ts`), behind one routing gateway that picks the adapter by provider code. The API process
  binds no adapter: for it `send` does not exist as a path, and `dispatches(code)` reads conditions 1–4 from the
  shared settings and the database. A request therefore never calls a provider.
- **Credentials** are entered by the branch owner through a write-only route, sealed with `SECRETS_KEY`
  (`ProviderCredential`: provider, target, sealed value), opened only in the worker when an adapter is built,
  never returned by any route and never logged. Sandbox and live credentials are separate rows.
- **Pausing** a provider (`dispatchPausedAt`): new sales take the manual route at once; operations already
  `requested` are not claimed while paused and their submitters may cancel them (D7); `pending` and `unknown`
  finish as usual.
- **Staging proves the flow; it does not enable production.** Approval, credentials and adapter list are per
  deployment. Passing staging changes nothing on production: there the four conditions are set again, by name,
  after the go-live gate.

**D19. Layers.**

| Rule | Owner (layer) |
|---|---|
| Operation states, moves, attempts, evidence, recovery | `providers/operations/provider-operation.rules.ts` (domain) |
| What an operation's state allows on its task (D6), the key (D3), who may decide and approve (D15) | new `lines/activation-settlement.rules.ts` (domain, pure) |
| Price, visibility, SIM rules, ceiling | existing rule files (domain) |
| Opening: permission → rules → task + hold + operation in one transaction | `LinesService.activate` + `TasksService.openTask` (application) |
| Applying a verdict, the exception, decisions | new `lines/activation-settlement.ts` and `lines/provider-decisions.ts` (application), reusing `TaskCompletion`'s handler |
| Hold, capture, release, move | `WalletLedger` (the only wallet writer) |
| SQL, locks, compare-and-set, sealing | repositories, `UnitOfWork.runTx`, `secret-box` (infrastructure) |
| Adapters, queue consumption, timers | the worker (infrastructure; no rule) |
| HTTP | controllers: parse and call, nothing else |

## 5. Flow

```
POST /office/lines   (Idempotency-Key)
  permission → package/SIM rules → price fixed ─┐
                                                ▼
  T1  one transaction ───────────────────────────────────────────────────────────────────────────────
      lockKey(iccid) · lockKey(msisdn) · live-line check
      INSERT OfficeTask … ON CONFLICT DO NOTHING     → same request key: answer the first task, stop
                                                     → serial / number reserved by another task: 409, stop
      WalletLedger.hold(pos, price)                  → Wallet.held += price, entry `hold`
      ProviderOperation(requested, key activate:<task>, taskId unique) + OutboxMessage(requested)
  ◀── { applied: false, taskId }

  relay → queue → dispatcher (worker only):  T2 claim → T3 send mark → [provider, no transaction] → T4 settle
      T4 writes the verdict, the result fields (eSIM code sealed) and OutboxMessage(settled)

  settled → activation settlement (worker):
      succeeded  T5  claimTask(working→done) · lockKey(iccid) · lockKey(msisdn) · appliedAt IS NULL → now
                     assertSimFree · createLine · WalletLedger.capture(pos, held, posDelta, sale @ unitPrice)
                     task result · notice
                     └─ business refusal: roll back; T5′ applyError, verdict + hold + reservation kept, notice
      failed     T6  task note → PROVIDER_FAILED_NOTE · appliedAt → now · notice     (hold stays; the branch decides)
      unknown    T7  notice to the authorised accounts                               (hold stays; nothing else)

  submitter:  cancel while requested → T9 (operation → failed/abandoned + release, one transaction)
  branch:     complete / reject (T8) only with no operation or a failed one
  authorised: confirm success · apply corrected            → T10, one account
              declare failure · release after success      → T10 proposal, T11 approval by another account
```

## 6. Transactions, their limits, and lock order

**One lock order everywhere: task row → line row → advisory keys (serial, then number) → operation row → wallet
rows (sorted by user id).** A transaction takes only the locks it needs, always in that order. T1 takes the
advisory keys before it inserts the task because the task row does not exist yet and nothing can wait on it.

| | Locks, in order | Writes | Never contains |
|---|---|---|---|
| T1 open | keys → (new task) → (new operation) → wallet | task, hold, operation, outbox, notices (queued) | a provider or Redis call |
| T2 claim, T3 mark | operation (one guarded statement each) | the attempt, the lease, the send mark | money |
| T4 settle | operation | the verdict, result fields, `settled` or retry message | money, the task |
| recovery | operation | `requested` + message, or `unknown` | money, the task |
| T5 apply | task → keys → operation → wallet | task `done`, `appliedAt`, line, capture, task result, notices | the provider |
| T5′ exception | operation | `applyError`, `applyFailedAt`, notice | the wallet, the line, the task's status |
| T6 failed, T7 unknown | task → operation | task note / notice, `appliedAt` | the wallet |
| T8 complete by hand, reject | task → line → keys → operation (read, locked) → wallet | today's writes, with `capture` on completion | — |
| T9 cancel | task → operation → wallet | task `cancelled`, operation `failed (abandoned)` when it was `requested`, release | the provider |
| T10 decision by one account | task → keys → operation → wallet | `ProviderDecisionEvent`(s), the guarded move, then T5's writes | the provider |
| T10 proposal | operation | `ProviderDecisionEvent(proposed)` | everything else |
| T11 approval | task → operation → wallet | `ProviderDecisionEvent(approved)`, `unknown → failed` or the release and rejection | the provider |

Read Committed throughout; every decision re-reads under its lock (rule 2.2). The dispatcher and recovery touch
the operation row only, with single guarded statements, so they cannot be part of a cycle. A PostgreSQL spec runs
all of T1–T11 against each other and requires that none is ever aborted as a deadlock (`40P01`).

## 7. Failures and recovery

| Failure | State left | Recovery | Money |
|---|---|---|---|
| Request fails in T1 | nothing | the caller retries with the same key | none |
| Same request again (same key) | — | the first task is answered | held once |
| Same sale with a new key | `409` from the reservation index | — | held once |
| API dies after T1 | task + hold + `requested` + message | relay publishes | held |
| Relay / Redis down | message unpublished | lease runs out, taken again | held |
| Worker dies after claim, before the mark | `pending`, unmarked | recovery → `requested` + new message (same operation, next attempt) | held |
| Worker dies after the mark | `pending`, marked | recovery → `unknown` | **held**, frozen |
| Provider answers, T4 fails | `pending`, marked | recovery → `unknown`; the provider's late verdict or a decision | held |
| Provider confirms, answer lost | `unknown` | confirm success (one account) | held until then |
| T4 done, `settled` message lost | `succeeded`, not applied | sweeper applies | held, then captured once |
| T5 runs twice | — | second finds the task `done` / `appliedAt` set | charged once |
| T5 cannot create the line | `succeeded` + `applyError`, task `working` | apply corrected (one account) or approved release (two) | **held** until then |
| Branch completes or rejects while in flight | refused (D6) | — | unchanged |
| Submitter cancels while `requested` | operation `failed (abandoned)`, task `cancelled` | — | released once |
| Submitter cancels while `pending` / `unknown` | refused | — | held |
| Cancel and claim at the same instant | one of them | — | released, or held and sent: never both |
| A failure is proposed and nobody approves | `unknown`, proposal open | stays until approved or refused | **held** |
| Proposer tries to approve their own proposal | refused | another account | held |
| Two accounts act on one operation at once | the next event is written once | — | applied once |
| Provider paused with operations `requested` | not claimed | resume, or the submitters cancel | held / released |
| Ceiling lowered while waiting | — | `capture` does not re-check | charged as held |
| `SECRETS_KEY` missing on the worker | the worker does not start | set it | unchanged |

## 8. PostgreSQL specs to write (with the scripted gateway)

Opening and repetition
1. T1 is atomic: a failure after the hold leaves no hold, task, operation or message.
2. The database itself refuses a second open activation task with the same serial, and with the same number (a
   raw insert); a rejected, cancelled or done task frees both.
3. Ten requests at once for one serial: one task, one hold, nine `409`.
4. The same `Idempotency-Key` and body, twice and ten at once: one task, one hold, one operation, the same
   `taskId`; the same key with another body: `400`; no key on the dispatch route: `400`.
5. **One operation per task:** a second `ProviderOperation` with the same `taskId` is refused by the database; an
   attempt that never left is retried on the same row (attempts 2, same key), never a new row.

Settlement
6. Succeeded → one line, one `activate` entry at `unitPrice`, `held` back to its earlier value, balance down by
   `posDelta`, task `done`.
7. T5 from several workers and a repeated message at once: one line, one entry.
8. T5 against a manual "complete" at the same instant: one of them.
9. Failed → the task is completable and rejectable by the branch; reject releases the hold once; the dispatcher
   never claims it again.
10. Unknown → complete, reject and cancel are refused; the hold is untouched across recovery sweeps.
11. The sweeper applies a `succeeded` operation whose message was never delivered, and leaves one with an
    `applyError` alone.
12. A late provider verdict on an `unknown` attempt applies once, with no human decision.
13. Exception: succeeded but the number was taken → still `succeeded` with its result, `applyError` set, hold and
    reservation kept, `claim` null, no entry of any kind.

Cancel
14. Cancel while `requested`: operation `failed (abandoned)` with `appliedAt`, task `cancelled`, hold released
    once, a later `claim` null.
15. Cancel while `pending`, `unknown`, succeeded-not-applied, exception: `409`, nothing changed.
16. Cancel and `claim` raced 50 times: every round ends either cancelled-and-released with no send, or pending
    with the hold; never a send after a release.

Ledger
17. `capture` with the ceiling lowered after the hold succeeds; a plain debit of the same amount would not.
18. `capture` refuses when `held` is smaller than the amount; manual completion through `capture` charges once
    under two concurrent completions.

Decisions
19. Confirm success: refused for the submitter, a lower layer, an entered session, an account without the grant,
    a note under 20 characters, no reference; accepted once by one account, with its events and the move in one
    transaction.
20. Declare failure: the proposal changes nothing (operation `unknown`, hold held); approval by the proposer is
    refused; by the submitter refused; by an entered session refused; by a second authorised account → `failed`,
    and the task becomes the branch's. Refusal closes the proposal and leaves `unknown`.
21. Release after success: as 20, ending in the hold released once and the task rejected; apply corrected: one
    account, one line, one capture. Either of them twice: refused.
22. `ProviderDecisionEvent`: an `UPDATE` and a `DELETE` are refused by the database; two accounts proposing at
    once produce one open proposal; the worker's activity purge leaves the table untouched.

eSIM data
23. `resultEsimCode`, `Line.esimQr` and `OfficeTask.esimQr` hold sealed text in the database; the detail read
    returns the code to the line's point of sale, its ancestors and the branch, not to a sibling; the lists never
    carry it; each read writes its event.
24. An activation that returns an eSIM code: the captured process output, the outbox rows, the Redis job and the
    notices contain no part of it.

Switching on
25. `dispatches(code)` is false unless all four conditions hold, each one removed in turn; a paused provider's
    `requested` operation is not claimed.
26. The worker refuses to start in production with `PROVIDER_DISPATCH=1` and no `PROVIDER_ADAPTERS` or
    `PROVIDER_TARGET`, or without `SECRETS_KEY`; a `sandbox` deployment cannot construct a `live` adapter.

Whole
27. Wallet invariants after a mixed run: `held` equals the sum of open tasks' holds; the sum of entries equals
    the balance change.
28. T1–T11, the dispatcher and recovery run against each other: no transaction is aborted as a deadlock.
29. Money untouched on every path that must not move it: `requested`, `pending`, `unknown`, `failed`, an open
    proposal, an exception.

## 9. The owner's decisions (2026-11-10)

| | Decision | Where |
|---|---|---|
| O1 Reserve the serial and the number | Yes, both routes, atomically, by the database | D5 |
| O2 `capture` | Yes, both routes | D10 |
| O3 A provider failure | The task stays with the branch and the hold stays | D6 |
| O4 HTTP idempotency | Before a real provider is switched on | D14, plan gate |
| O5 Decisions on `unknown` and on exceptions | **Final**: owner or `accounting`; a real account session; evidence and a note of 20 characters; a second independent account for declaring failure and for releasing after success; one account to confirm success; a permanent record | D15 |
| O6 The waiting state | Ready before automatic processing is enabled | plan gate |
| Final review 1 | One operation per task; retries are attempts | D3 |
| Final review 2 | Cancel while `requested`, atomically; not while `pending` or `unknown` | D6, D7 |
| Final review 3 | No environment name bypasses a check; four explicit conditions; adapters in the worker only; staging separate from production | D18 |
| Final review 4 | eSIM codes sealed, never logged, read by the entitled accounts only | D17 |
| Final review 6 | One lock order, per-transaction limits, specs per slice | section 6, section 8, the plan |

## 10. What the final review changed, and conflicts that remain

Changed in this document:

- The key was `activate:<taskId>:<n>` with a new operation per retry; it is `activate:<taskId>` with a unique
  `taskId`. A failed operation is never retried at the provider for the same task.
- The plan's guard slice said "refuse unless there is no operation or a failed one" for cancel, against the state
  table; cancel now has its own atomic rule (D7) and the table (D6) is the single statement of it.
- T1 held the money before inserting the task; the task is inserted first, so a repeated request or a taken
  serial stops before any hold.
- `ProviderVerdict` (one row per verdict) became `ProviderDecisionEvent` (append-only, with proposals and
  approvals).
- The first adapter was to run on staging with `NODE_ENV=staging`; D18 replaces that.

Conflicts with text and code outside this document, to be settled in the slice named:

1. **ADR 0016 and `plans/2026-11-10-production-config-and-simulation.md`** say a trial server may set
   `NODE_ENV=staging` to keep the simulation. D18 withdraws that for any deployment that will dispatch. Those two
   documents are corrected in S.12a. A staging copy that only demonstrates screens with simulated answers is then
   a development copy, not a staging of the provider flow.
2. **`config.ts` `providerDispatchOn()`** is "not production and `PROVIDER_DISPATCH=1`", and `worker.ts` warns that
   the dispatcher never runs in production (ADR 0018, decision 10). D18 changes the rule; code and ADR 0018 are
   updated in S.12a. Until then the dispatcher cannot run on a production-grade deployment at all, which is safe.
3. **`worker.ts` does not run `assertProductionConfig`** (A8); S.12a.
4. **`Line.esimQr` is returned by the line list** (A6); S.5 removes it from lists and restricts the detail, which
   is a response-shape change the web must follow (the web spec of S.10 covers the screens that read it).
5. **`provider-operation.rules.ts` allows `requested → failed`** but no service method performs it; D7 is its
   first user (S.7).
6. **ADR 0017's "a new try after `failed` is a new operation with a new key"** stays true in general; for an
   activation task D3 adds that there is no new operation for the same task.

Open for the owner: none of O1–O6. Three consequences to accept knowingly: a branch with one authorised account
cannot declare a failure or release after success (D15); a failed operation means a new sale, not a retry (D3);
the line list stops carrying the eSIM code (D17).

## Non-goals

Any operation but activation; a real adapter (its own spec, S.12b); the provider status check; reconciling
`providerRef` with provider statements; changing prices, ladders or reports.
