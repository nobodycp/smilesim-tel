# Activation through a provider: hold at the request, settle on the provider's answer — design spec

Owner task 04, 2026-11-10, on `16e345d`; revised the same day with the owner's answers to O1–O6 and three
requirements (section 9). The direction is agreed (the task carries the money, the operation carries the provider's
verdict, one settlement); the document waits for the owner's full review before any slice starts.
**Design and audit only.** No code, schema, route or screen changes with
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
  no `Idempotency-Key`. Two identical requests more than 10 s apart are two sales. Today the unique number stops
  the second only when the number was requested.
- **A4. The provider's answer has nowhere to carry what an activation returns** (the number the provider assigned,
  an eSIM's serial and activation code): `SendEvidence.confirmed` holds a reference only.
- **A5. A task stores its submitter, not the operator** of an entered session; an entry written at settlement can
  name only the submitter.

## 4. Decisions

**D1. The activation task is the carrier of the money.** A provider activation opens the same `OfficeTask` as
today (hold, fixed price, number, serial) and records a `ProviderOperation` **in the same transaction**. The
provider's answer then *completes* that task through the existing completion handler, or leaves it to the branch.
There is one hold, one charge path and one place that creates the line, for both the manual and the provider
route.

**D2. The answer to the caller does not change:** `{ applied: false, taskId }`, as for any deferred activation.
No new route and no web change are needed to start.

**D3. A sale is protected against repetition at three levels**, each for a different repeat:

| Level | Stops | Key | Enforced by |
|---|---|---|---|
| The HTTP request (D14) | the same form sent twice (double click, retry, a tab reopened) from creating two tasks | the web's `Idempotency-Key`, stored as `OfficeTask.requestKey` | a unique index; lasts as long as the task row |
| The thing sold (D4) | two different requests for one serial or one number | the serial, the number | partial unique indexes on open activation tasks |
| The provider call | one task from reaching the provider twice | `activate:<taskId>:<n>` on `ProviderOperation` | the unique `idempotencyKey` (ADR 0017) |

The operation key is derived from the sale, not from the request: the task id is created in the transaction that
holds the money, so the key exists exactly when the hold does (`n` = 1; a later deliberate retry at the provider
is `n + 1`, a new operation). `ProviderOperation.taskId` links them. The request key alone would not do (a browser
retry may carry a new one), and the operation key alone would not either (two requests make two tasks): hence both.

**D4. Reservation, enforced by the database.** An open activation task **is** the reservation of its serial and
its number, for manual and provider tasks alike (O1):

```sql
CREATE UNIQUE INDEX "OfficeTask_open_activation_iccid"  ON "OfficeTask"("iccid")
  WHERE "action" = 'activate' AND "status" = 'working' AND "iccid"  IS NOT NULL;
CREATE UNIQUE INDEX "OfficeTask_open_activation_msisdn" ON "OfficeTask"("msisdn")
  WHERE "action" = 'activate' AND "status" = 'working' AND "msisdn" IS NOT NULL;
```

- **Two active reservations of one item cannot exist**: the second insert is refused by PostgreSQL whatever the
  code does, and answers `409 SIM_TAKEN` / `NUMBER_TAKEN`. (The insert is `ON CONFLICT DO NOTHING` followed by a
  read, as for operations, so the caller's transaction is not aborted.)
- **Release is the task leaving `working`**, in the same guarded write that closes it: `done` (the line now owns
  the number through `Line.msisdn` unique, and the serial through `assertSimFree`), `rejected`, `cancelled`. There
  is no second row to delete and so nothing to forget; a task that is frozen (`unknown`, or succeeded but not
  applied) stays `working`, so its reservation stays.
- **Against an existing line** (a different table): the opening transaction takes the advisory locks
  `iccid:<serial>` and `msisdn:<number>` and checks live lines, and line creation takes the same locks and checks
  open activation tasks. `Line.msisdn` is unique in the database already; a serial among live lines is the existing
  advisory-lock rule (`assertSimFree`), not a constraint. Making that a constraint too means a claims table written
  by every line status change; it is listed in the ADR as the next step if wanted, not part of this design.
- **The migration** first lists open activation tasks that already share a serial or a number and stops if there
  are any: they are resolved by the branch (reject one) before the indexes are created.
- Prisma cannot express a partial index; like the CHECK constraints it lives in the migration and is pinned by a
  PostgreSQL spec.

**D5. What each operation state means for the task and the money.**

| Operation | Task | Hold | Who may act | What happens |
|---|---|---|---|---|
| `requested` | `working`, waiting for the provider | held | submitter may cancel **only** through a guarded `requested → failed (abandoned)` in the same transaction as the release; the branch may not complete or reject | nothing has left |
| `pending` | `working`, waiting | held | nobody | the dispatcher is on it |
| `succeeded` | → `done` by the system | captured as the charge | system | one transaction: claim the task, mark the operation applied, create the line, capture the hold as the `activate` entry at the fixed price |
| `succeeded`, cannot be applied | `working`, **exception** (D16) | **held** | an authorised account only, through the exception use case | the verdict is kept, nothing is re-sent, nothing is refunded automatically |
| `failed` | `working`, an ordinary branch task noted `PROVIDER_FAILED_NOTE` | held | branch completes by hand, or rejects (release); submitter may cancel | exactly today's "the provider refused" |
| `unknown` | `working`, frozen | **held** | nobody completes, rejects or cancels; an authorised account gives a documented verdict (D15) | `resolveUnknown` → then the `succeeded` or `failed` row above |

**D6. The verdict is stored before the money moves, in a separate transaction.** `settle` only records what the
provider said. Applying it (D5) is its own transaction, started by an outbox message
(`provider-operation.settled`) and re-tried by a sweeper for any `succeeded` operation not yet applied
(`ProviderOperation.appliedAt`). If the application were inside `settle`, a `NUMBER_TAKEN` would roll the verdict
back and a confirmed activation would later look `unknown`.

**D7. Exactly one charge, exactly one line.** Three independent guards, any one of which is enough:
the task claim (`working → done`, guarded), `appliedAt` written by compare-and-set (`IS NULL`), and the unique
number / serial lock. A repeated message, two workers, and a person clicking "complete" at the same moment all
end at the first guard.

**D8. The hold is captured, not released-then-debited.** New ledger primitive `capture(tx, userId, held, amount,
…)`: under the wallet lock, `held −= held`, `balance += amount` and the sale entry, **without** the ceiling check
(it was made when the hold was taken, and held money cannot be spent by anything else). Used by the provider
settlement **and** by manual completion (O2), which closes A2 on both routes. It moves money once because it runs
only inside the transaction that claimed the task (`working → done`, guarded): a second capture has no task to
claim. It refuses, rather than clamps, when `Wallet.held` is smaller than the task's hold: that would mean a hold
was released twice, and the transaction must fail loudly.

**D9. Manual completion, reject and cancel read the operation under a lock.** After claiming the task and before
any wallet: `SELECT … FOR UPDATE` on the task's operation; proceed only when there is none or it is `failed`.
Lock order: task → line → operation → wallet.

**D10. What the provider hands back** travels in the evidence and is stored on the operation in three typed
columns (`resultMsisdn`, `resultIccid`, `resultEsimCode`), never as free JSON; the application copies them to the
line exactly as the branch's hand-back does today.

**D11. Who is named.** Entries and notices written at settlement name the task's submitter as the actor and
«النظام» as the handler. The request itself is still recorded by `@Activity('activate')`.

**D12. Which activations take this route.** `route()` gains a third answer, `dispatch`, when the package runs the
operation automatically **and** the gateway says it dispatches for that provider (`gateway.dispatches(code)`,
false everywhere until an adapter exists). Simulation (development, tests) keeps answering inside the request;
"not connected" keeps opening a plain branch task. So nothing changes for any activation until a provider is
switched on.

**D13. Layers.**

| Rule | Owner (layer) |
|---|---|
| Operation states, moves, attempts, evidence, recovery | `providers/operations/provider-operation.rules.ts` (domain) |
| What an operation's state allows on its task (D5), the key (D3) | new `lines/activation-settlement.rules.ts` (domain, pure) |
| Price, visibility, SIM rules, ceiling | existing rule files (domain) |
| Opening: permission → rules → hold + task + operation in one transaction | `LinesService.activate` + `TasksService.openTask` (application) |
| Applying a verdict | new `lines/activation-settlement.ts` (application), reusing `TaskCompletion`'s handler |
| Hold, capture, release, move | `WalletLedger` (the only wallet writer) |
| SQL, locks, compare-and-set | repositories and `UnitOfWork.runTx` (infrastructure) |
| Queue consumption, timers | `provider-dispatch.ts`, `worker.ts` (infrastructure; no rule) |
| HTTP | controllers: parse and call, nothing else |

**D14. A durable request key (O4), before any provider is switched on.** The web creates one key per activation
form (a UUID made when the form opens, kept until it succeeds or is reset) and sends it as `Idempotency-Key`.
`OfficeTask.requestKey` stores `sha256(submitterId : key)` with `requestHash` (the fingerprint of the parsed body);
`requestKey` is unique. In T1 the task is inserted `ON CONFLICT DO NOTHING`:

- no conflict → the sale goes on;
- conflict, same `requestHash` → the first task is answered again (`{ applied: false, taskId }`), nothing is
  held or recorded a second time;
- conflict, another `requestHash` → `400 INVALID` (a key belongs to its first request, as in the HTTP guard).

The Redis guard stays in front as today (it answers a fast double click without touching the database). On the
dispatch route the header is **required** (`400` without it); on the manual and simulated routes it is honoured
when present, so the web can start sending it before anything else changes. A sale that is applied inside the
request (simulation) opens no task and keeps only the Redis guard.

**D15. The verdict on an unknown operation (O5) is an authorised, documented, auditable decision.**

- **Who:** the branch owner, or a branch staff account holding the `accounting` grant. Never the task's submitter,
  never a layer below the branch, never an entered session (`session.kind` must be `account`, as for `/auth`
  writes). Stated in `office/policy.ts` and pinned in `permissions.http.spec.ts`.
- **What must be given:** the verdict (`succeeded` / `failed`); the kind of evidence, from a closed list (the
  provider's portal, the provider's statement, the provider's written answer, a test on the line); the provider's
  reference (required for `succeeded`); a note of at least 20 characters. For `succeeded`, also what an activation
  hands back (the number, an eSIM's serial and code) when the provider chose them.
- **What is kept:** an immutable row `ProviderVerdict` (operation, verdict, evidence kind, reference, note, account,
  operator, time), written in the same transaction as `unknown → succeeded | failed`; an `ActivityEvent`
  (`task.provider_verdict`); a line in the task's log. A verdict cannot be edited or given twice (the guarded move
  from `unknown` happens once).
- **Then** the ordinary path: `succeeded` → T5 (line, capture), `failed` → T6 (the task is the branch's).

**D16. The provider succeeded and the line cannot be created: an exception, not a failure.** T5 rolls back on a
business refusal (the number or the serial was taken meanwhile, the package or the point of sale no longer
exists). Then, in its own transaction (T5′):

- the operation keeps `succeeded` and its result fields; `ProviderOperation.applyError` gets a code from a closed
  list (`number-taken`, `sim-taken`, `target-missing`) and `applyFailedAt` the time; `appliedAt` stays empty;
- the task stays `working` with its hold and its reservation; the owner and the task handlers get a notice
  (`task.provider_exception`); the list shows it as an exception (O6);
- the sweeper stops retrying an operation that has an `applyError` (a business refusal does not heal by itself);
  a technical error (database away) leaves no `applyError` and is retried;
- the operation is terminal, so the dispatcher can never send it again, and no path releases the hold.

It is closed only by an authorised account (as D15), with a note, in one of two ways: **apply with corrected
data** (the number or serial the provider really activated; then T5 runs with them: line, capture), or **a
documented release** (the provider reversed the activation: the evidence of D15 is required, the hold is released,
the task is rejected with the reason). Both write `ProviderVerdict`-style rows and activity events. There is no
automatic refund in any state.

**D17. Nothing automatic runs before the people can see and decide (O5, O6).** The waiting label, the exception
view and the verdict screen exist and are tested before `gateway.dispatches(code)` answers true for any provider
on any environment where money is real. The plan's go-live gate lists them.

## 5. Flow

```
POST /office/lines
  permission → package/SIM rules → price fixed ─┐
                                                ▼
  T1  one transaction ───────────────────────────────────────────────────────────────────────────────
      request key (D14): INSERT … ON CONFLICT DO NOTHING → a repeat answers the first task and stops here
      lockKey(iccid) · lockKey(msisdn) · live-line check · the partial unique indexes reserve both (D4)
      WalletLedger.hold(pos, price)            → Wallet.held += price, entry `hold`
      OfficeTask(activate, working, unitPrice, posDelta, held)
      ProviderOperation(requested, key activate:<task>:1, taskId) + OutboxMessage(requested)
  ◀── { applied: false, taskId }

  relay → queue → dispatcher:  T2 claim → T3 send mark → [provider, no transaction] → T4 settle
      T4 writes the verdict (+ result fields) and OutboxMessage(settled)

  settled → activation settlement (worker):
      succeeded  T5  claimTask(working→done) · appliedAt IS NULL → now · assertSimFree · createLine
                     WalletLedger.capture(pos, held, posDelta, sale @ task.unitPrice) · task result · notice
                     └─ cannot apply: roll back T5; T5′ records applyError, keeps the verdict, the hold and the
                        reservation, notifies; no re-send, no refund (D16)
      failed     T6  task note → PROVIDER_FAILED_NOTE · appliedAt → now · notice        (hold stays; branch decides)
      unknown    T7  notice to the branch                                               (hold stays; nothing else)

  branch:  complete / reject (T8, T9) only with no operation or a failed one
  authorised account:  documented verdict on unknown (D15) → T5 or T6 · exception (D16) → apply corrected, or documented release
```

## 6. Transactions and their limits

| | Contains | Never contains |
|---|---|---|
| T1 open | reservation, hold, task, operation, outbox, notices (queued) | any provider or Redis call |
| T2, T3, T4 | one guarded row write each (ADR 0017, 0018); T4 also the `settled` message | the money |
| T5 apply | task claim, `appliedAt`, line, capture, task result, notices | the provider; another wallet than the point of sale's |
| T6, T7 | task note / notice, `appliedAt` | the wallet |
| T8, T9 manual | today's completion / reject / cancel + the operation lock and check | — |
| T5′ exception | `applyError`, `applyFailedAt`, notice | the wallet, the line, the task's status |
| T10 verdict / exception closing | `ProviderVerdict`, the guarded operation move or the apply/release, the activity event | the provider |

Read Committed throughout; every decision re-reads under its lock (rule 2.2).

## 7. Failures and recovery

| Failure | State left | Recovery | Money |
|---|---|---|---|
| Request fails in T1 | nothing | the caller retries | none |
| API dies after T1 | task + hold + `requested` + message | relay publishes | held |
| Relay / Redis down | message unpublished | lease runs out, taken again | held |
| Worker dies after claim, before the mark | `pending`, unmarked | recovery → `requested` + new message | held |
| Worker dies after the mark | `pending`, marked | recovery → `unknown` | **held**, frozen |
| Provider answers, T4 fails | `pending`, marked | recovery → `unknown`; the provider's status check or the branch | held |
| Provider confirms, answer lost | `unknown` | verdict | held until the verdict |
| T4 done, `settled` message lost or its job fails | `succeeded`, `appliedAt` null | sweeper applies | held, then captured once |
| T5 runs twice (two workers, repeat message) | — | second finds the task `done` / `appliedAt` set | charged once |
| T5 cannot create the line | `succeeded` + `applyError`, task `working` | an authorised account (D16) | **held** until that decision |
| Branch completes by hand while the operation is in flight | refused (D9) | — | unchanged |
| Submitter cancels while `pending` / `unknown` | refused | — | held |
| Ceiling lowered while waiting | — | `capture` does not re-check (D8) | charged as held |
| Point of sale frozen, moved or its package changed while waiting | — | the task carries pos, package and price; the charge is the fixed one | charged as held |
| Same request sent twice (same key) | the first task is answered again | — | held once |
| Same sale sent with a new key | `409` from the reservation index when it names the serial or the number (always, on the dispatch route: an activation there has a number, requested or generated at T1) | — | held once |
| Verdict given twice, or by two accounts at once | the second finds the operation no longer `unknown` | — | applied once |
| Exception closed twice | the second finds the task no longer `working` | — | once |

## 8. PostgreSQL specs to write (with the scripted gateway)

1. T1 is atomic: a failure after the hold leaves no hold, task, operation or message.
2. T1 refuses a second activation of the same serial, and of the same requested number, while the first is in
   flight; allows it after `failed` + reject.
3. Two T1 at once on one serial: one task, one hold.
4. Succeeded → exactly one line, one `activate` entry at `unitPrice`, `held` back to its value before, balance
   down by `posDelta`, task `done`.
5. T5 from several workers and from a repeated message at once: one line, one entry.
6. T5 against a manual "complete" at the same instant: one of them, never both.
7. Failed → the task is completable and rejectable by the branch; reject releases the hold once.
8. Unknown → complete, reject and cancel are refused; the hold is untouched across recovery sweeps.
9. Unknown → verdict succeeded → as 4; verdict failed → as 7.
10. Cancel while `requested`: operation `failed (abandoned)`, hold released, and the dispatcher's later claim is
    null; cancel while `pending`: refused.
11. `capture` with the ceiling lowered after the hold: succeeds; a plain debit of the same amount would not.
12. Succeeded but the number was taken meanwhile: no line, no entry, hold kept, task flagged, operation not
    re-sent.
13. The sweeper applies a `succeeded` operation whose message was never delivered.
14. A late provider verdict on an `unknown` attempt applies once.
15. Wallet invariants after a mixed run of all of the above: `held` equals the sum of open tasks' holds; the sum
    of entries equals the balance change.
16. Money untouched on the paths that must not move it: `requested`, `pending`, `unknown`, `failed`.
17. The database itself refuses a second open activation task with the same serial, and with the same number
    (a raw insert, bypassing the service); a rejected, cancelled or done task frees both.
18. Ten requests at once for one serial: one task, one hold, nine `409`.
19. The same `Idempotency-Key` and body, twice and ten at once: one task, one hold, one operation, the same
    `taskId` answered; the same key with another body: `400`; no key on the dispatch route: `400`.
20. A different key for the same serial: `409` from the reservation, nothing held.
21. Exception: succeeded but the number was taken → operation still `succeeded` with its result, `applyError`
    set, hold and reservation kept, the dispatcher's `claim` null, the sweeper leaves it; no entry of any kind.
22. Exception closed by "apply corrected": one line, one capture; by "documented release": hold released once,
    task rejected, verdict row and activity event written; either of them twice: refused.
23. Verdict: refused for the submitter, a lower layer, an entered session and an account without the grant;
    refused without a reference on `succeeded` or with a short note; accepted once, with its `ProviderVerdict` row
    and activity event in the same transaction as the move.
24. `capture`: refused when `held` is smaller than the amount; manual completion through `capture` charges once
    under two concurrent completions.

## 9. The owner's decisions (2026-11-10)

| | Decision | Where it is designed |
|---|---|---|
| O1 Reserve the serial and the number | **Yes**, for manual and provider tasks, atomically | D4 |
| O2 `capture` | **Yes**, on both routes, with no double charge | D8 |
| O3 A provider failure | **The task stays with the branch and the hold stays**, as today | D5 |
| O4 HTTP idempotency | **Changed: before a real provider is switched on**, not after | D14, plan gate |
| O5 Deciding an `unknown` | **Conditional: an authorised account only, on documented evidence, auditable** | D15 |
| O6 The waiting state | **Yes, ready before automatic processing is enabled** | D17, plan gate |

Three requirements written into the design:

1. **Repeated sale**: protection at the request and at the provider call, not one of them (D3, D14).
2. **Provider succeeded, line not created**: the verdict and the hold are kept and an exception is opened; no
   re-send, no automatic refund (D16).
3. **Reservation**: the database refuses two active reservations of one item, and release is one defined event
   (D4).

Still to confirm when the owner reviews this document: the grant that authorises a verdict (`accounting` on the
branch, proposed in D15), the minimum note length, and whether a verdict should need a second account.

## Non-goals

Any operation but activation; a real adapter; the provider status check; reconciling `providerRef` with provider
statements; changing prices, ladders or reports.
