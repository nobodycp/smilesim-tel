# Activation through a provider: hold at the request, settle on the provider's answer — design spec

Owner task 04, 2026-11-10, on `16e345d`. **Design and audit only.** No code, schema, route or screen changes with
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

**D3. Idempotency key = the sale.** `activate:<taskId>:<n>` (`n` = 1 for the first operation of a task; a later
deliberate retry at the provider is `n + 1`, a new operation). The task id is created in the transaction that holds
the money, so the key exists exactly when the hold does. `ProviderOperation.taskId` links them.

**D4. Reservation.** In the opening transaction: advisory locks on `iccid:<serial>` and `msisdn:<number>`, then
refuse (`409 SIM_TAKEN` / `NUMBER_TAKEN`) when a live line holds them (as today) **or an open activation task
whose operation is in flight** does. In flight = `requested`, `pending`, `unknown`, or `succeeded` not yet applied.

**D5. What each operation state means for the task and the money.**

| Operation | Task | Hold | Who may act | What happens |
|---|---|---|---|---|
| `requested` | `working`, waiting for the provider | held | submitter may cancel **only** through a guarded `requested → failed (abandoned)` in the same transaction as the release; the branch may not complete or reject | nothing has left |
| `pending` | `working`, waiting | held | nobody | the dispatcher is on it |
| `succeeded` | → `done` by the system | captured as the charge | system | one transaction: claim the task, mark the operation applied, create the line, capture the hold as the `activate` entry at the fixed price |
| `succeeded`, cannot be applied (number or serial taken meanwhile) | `working`, flagged for the branch | **held** | branch | never refunded automatically: the provider has activated something; a person decides |
| `failed` | `working`, an ordinary branch task noted `PROVIDER_FAILED_NOTE` | held | branch completes by hand, or rejects (release); submitter may cancel | exactly today's "the provider refused" |
| `unknown` | `working`, frozen | **held** | nobody completes, rejects or cancels; a branch account with the grant gives a verdict | `resolveUnknown` → then the `succeeded` or `failed` row above |

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
(it was made when the hold was taken, and held money cannot be spent by anything else). This closes A2 for the
provider path. Whether manual completion uses it too is the owner's call (O2).

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

## 5. Flow

```
POST /office/lines
  permission → package/SIM rules → price fixed ─┐
                                                ▼
  T1  one transaction ───────────────────────────────────────────────────────────────────────────────
      lockKey(iccid) · lockKey(msisdn) · reservation check (D4)
      WalletLedger.hold(pos, price)            → Wallet.held += price, entry `hold`
      OfficeTask(activate, working, unitPrice, posDelta, held)
      ProviderOperation(requested, key activate:<task>:1, taskId) + OutboxMessage(requested)
  ◀── { applied: false, taskId }

  relay → queue → dispatcher:  T2 claim → T3 send mark → [provider, no transaction] → T4 settle
      T4 writes the verdict (+ result fields) and OutboxMessage(settled)

  settled → activation settlement (worker):
      succeeded  T5  claimTask(working→done) · appliedAt IS NULL → now · assertSimFree · createLine
                     WalletLedger.capture(pos, held, posDelta, sale @ task.unitPrice) · task result · notice
                     └─ cannot apply (NUMBER_TAKEN / SIM_TAKEN): roll back T5; T5′ flags the task for the branch, hold stays
      failed     T6  task note → PROVIDER_FAILED_NOTE · appliedAt → now · notice        (hold stays; branch decides)
      unknown    T7  notice to the branch                                               (hold stays; nothing else)

  branch:  complete / reject (T8, T9) only with no operation or a failed one · verdict on unknown → T5 or T6
```

## 6. Transactions and their limits

| | Contains | Never contains |
|---|---|---|
| T1 open | reservation, hold, task, operation, outbox, notices (queued) | any provider or Redis call |
| T2, T3, T4 | one guarded row write each (ADR 0017, 0018); T4 also the `settled` message | the money |
| T5 apply | task claim, `appliedAt`, line, capture, task result, notices | the provider; another wallet than the point of sale's |
| T6, T7 | task note / notice, `appliedAt` | the wallet |
| T8, T9 manual | today's completion / reject / cancel + the operation lock and check | — |

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
| T5 cannot create the line | `succeeded`, task flagged | branch | held |
| Branch completes by hand while the operation is in flight | refused (D9) | — | unchanged |
| Submitter cancels while `pending` / `unknown` | refused | — | held |
| Ceiling lowered while waiting | — | `capture` does not re-check (D8) | charged as held |
| Point of sale frozen, moved or its package changed while waiting | — | the task carries pos, package and price; the charge is the fixed one | charged as held |
| Same request sent twice | second: `409` on the reservation when it names the serial or number; otherwise a second sale (A3) | O4 | — |

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

## 9. Open for the owner (each has a recommendation)

- **O1. Reservation for manual tasks too** (closes A1 everywhere)? *Recommended: yes*, in the same slice; a second
  manual task on the same card becomes `409` instead of failing at completion.
- **O2. `capture` for manual completion too** (closes A2 everywhere)? *Recommended: yes.*
- **O3. On `failed`: leave the task to the branch** (as today's provider refusal) or release and close at once?
  *Recommended: leave to the branch.*
- **O4. Durable request idempotency**: the web sends an `Idempotency-Key` per form and the task stores it
  uniquely. *Recommended: a later slice with a web change.*
- **O5. Who gives the verdict on `unknown`**: the branch owner and accounts that handle tasks? *Recommended.*
- **O6. A "waiting for the provider" label** on the task list and card. *Recommended with O5's screen.*

## Non-goals

Any operation but activation; a real adapter; the provider status check; reconciling `providerRef` with provider
statements; changing prices, ladders or reports.
