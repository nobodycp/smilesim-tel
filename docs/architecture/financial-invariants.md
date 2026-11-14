# Financial invariants: what no refactor may change

- **Written:** 2026-11-13, slice R.0 of the plan `2026-11-13-office-retirement` (ADR 0020).
- **Status:** a description of the code at `626f61b` plus R.0. It decides nothing new. Where it and the code
  disagree, the code and its PostgreSQL specs are right and this file is fixed in the same change.
- **Why one file:** these rules are spread over ADR 0004, 0010, 0017, 0018 and 0019 and over comments in four
  folders. A slice that moves files reads this first; **no refactor slice edits the body of a transaction, the
  order of its statements, or the order of its locks.**

Each rule names where it lives and what proves it. "Guard" is a rule of `architecture.spec.ts` or
`architecture-boundaries.spec.ts`; "spec" is a PostgreSQL spec (`*.db.spec.ts`).

## 1. Who writes money

| Rule | Where | Proof |
|---|---|---|
| Only `WalletLedger` writes a wallet's balance or held amount, and only it writes a `WalletEntry`. The ceiling is a setting and is written by `wallets.service.ts`; the seed creates empty wallets. | `wallets/wallet-ledger.ts` | guards `wallet-writes`, `wallet-entry-writes` |
| Money is integer agorot. A balance is never written from a value read earlier: every method locks the wallet row first, then reads, then writes. | `hold`, `release`, `capture`, `move` each start with `SELECT … FOR UPDATE` on the wallet | ADR 0004; `wallet-*.db.spec.ts` |
| `hold` takes money out of what may be spent without moving it; `capture` turns a hold into its charge with no second ceiling check and is refused when the wallet holds less than the task's hold; `release` gives a hold back. | `wallet-ledger.ts` | ADR 0019 D10; `wallet-capture.db.spec.ts` |
| A hold is taken by the task that opens (`tasks.service.ts`) and captured by its completion (`task-completion.ts`), nowhere else. | — | guard `hold-path` |

## 2. Transactions

| Rule | Where | Proof |
|---|---|---|
| One primitive: `UnitOfWork.runTx` (Read Committed). Notices are written through the transaction's client (a rollback takes them back) and published only after the commit, once; a publish that fails is logged and the committed change stands. Since slice R.2 the unit of work holds the notice writer behind the platform's `NoticeWriter` port. | `kernel/unit-of-work.ts`; `shared/ports.db.spec.ts` (commit, rollback, a failed publish after a money move) | guard `transaction-outside-unit-of-work` (5 known sites outside it today, none on the path of a sale, a hold, a capture or a verdict: the trial-accounts seeder of the auth store, saving a provider-statement reconciliation, saving a provider's modes with its packages, the worker's attestation, the eSIM sealing script; each is judged in the plan `2026-11-13-office-retirement`, "R.0 verified") |
| A transaction reads through its own client, never the root one. | every `runTx` body | guard `root-client-in-tx` |
| Writes that belong together are one transaction. | services | guard `multi-write-outside-tx` |
| A status changes only through a guarded write (the expected current status is in the `WHERE`). | `line-state.ts` `moveLineStatus`, `provider-operations.repository.ts` `moveStatus`, task claims | guards `unguarded-status-write`, `operation-writes` |

## 3. Lock order

The code states two chains. Together they are one order; a transaction takes the locks it needs **in this order
and skips the ones it does not need**:

1. **the task** — `lockedTask` (`tasks/task-operation.ts`, `"OfficeTask" … FOR UPDATE`)
2. **the claim keys** (the serial and the number) — `lockClaim` / `lockKey` (`lines/line-state.ts`,
   `pg_advisory_xact_lock`)
3. **the provider operation of the task** — `lockedTaskOperation` (`tasks/task-operation.ts`)
4. **the line** — `lockLine` (`lines/line-state.ts`)
5. **the wallet(s)** — inside each `WalletLedger` method; two wallets in sorted order by user id (`lockWallets`)

Sources: `provider-decisions.ts` ("task → keys → operation → wallet"); the backend map ("a line is locked before
any wallet; two wallets in sorted order"). The specs that hold it: `activation-settlement.db.spec.ts`,
`provider-decisions.db.spec.ts`, the task-completion and wallet concurrency specs.

Apart from that chain:

- **The provider's row** (`"Provider" … FOR UPDATE`, `provider-dispatch.repository.ts`) is taken by the owner's
  approve / pause / credential writes and by the send gate when an attempt is marked (a worker's attestation
  takes it `FOR SHARE`). Those transactions touch the
  provider and the operation only: no task, line or wallet.
- **The outbox** is claimed with `FOR UPDATE SKIP LOCKED` and a lease (`outbox.repository.ts`): it never waits.

No guard checks the order across files today. It is held by the specs above and by review; R.0 only writes it down.

## 4. A provider operation: fencing and idempotency

| Rule | Where | Proof |
|---|---|---|
| One operation per idempotency key (`ProviderOperation.idempotencyKey` unique); the same key with another request is refused (`requestHash`). One operation per task (`taskId` unique). | `provider-operations.service.ts`, schema | `provider-operations.db.spec.ts` |
| One task per request key (`OfficeTask.requestKey` unique): a sale sent twice opens one task and takes one hold. | `tasks.service.ts` | `activation-settlement.db.spec.ts` |
| Only a `requested` operation may be sent (`maySend`). `pending` and `unknown` may have reached the provider and are never sent again. | `provider-operation.rules.ts` | rules spec; mutation specs of S.11–S.12b.0 |
| An attempt is named by its number, which only grows. A result is accepted only for the attempt the operation is on. `waivedAttempts` reduces the budget spent, never the number. | `attemptAfter`, `spentAttempts`, `moveStatus` guarded on `attempts` | `provider-dispatch.db.spec.ts` |
| An attempt belongs to its worker for its lease (`ATTEMPT_LEASE_MS`); the send mark (`sentAt`) is written under the lease and through the gate's permit; recovery acts only after the lease: unsent → `requested` again, possibly sent → `unknown`. | `beginSend`, `recover` | `operation-dispatcher.db.spec.ts` |
| The request is sent by the adapter that was judged at the mark (the permit), built from the stored credential generation. | `dispatch-gate.ts`, `routing-gateway.ts` | `provider-dispatch.db.spec.ts` |
| An operation is written by `provider-operations.repository.ts` only. One known exception today: `tasks/task-operation.ts` `withdrawOperation` marks a never-sent operation abandoned when its task is cancelled, in the cancel's transaction, under the task's lock and then the operation's. Its place in the transaction is necessary; only the statement's file is to change (R.4). | — | guard `operation-writes` (baseline 1) |
| The duplicate-write guard and the `Idempotency-Key` header are a convenience in front of these: the row locks and the unique keys are the protection. They apply to `/office/*` writes only. | `shared/duplicate-guard.interceptor.ts` | `http-security-contract.spec.ts` |

## 5. Outbox and settlement

| Rule | Where | Proof |
|---|---|---|
| A verdict and the message that has it acted on are one transaction. One message per (topic, operation, sequence): two writers of the same verdict cannot both commit. | `settle`, `resolveUnknown`, `declareFailed`; `settledSequence`; the unique key on `OutboxMessage` | `provider-operations.db.spec.ts`, `outbox-relay.db.spec.ts` |
| An outbox message is written with the operation (`provider-operations.repository.ts`) and stamped published by the relay (`outbox.repository.ts`), nowhere else. | — | guard `outbox-writes` |
| The relay publishes after the commit and stamps after the queue accepted; a message published twice is one job (the message id is the job id). | `outbox-relay.ts`, `queue-publisher.ts` | `outbox-relay.db.spec.ts` |
| The settlement acts on a verdict exactly once: the task is claimed, the operation stamped (`appliedAt`), the serial and the number locked, the line made and the hold captured in one transaction. A repeat finds nothing to do. | `activation-settlement.ts`, `applyAsSettlement`, `task-completion.ts` | `activation-settlement.db.spec.ts` |
| A failed verdict hands the task to the branch once. **The hold stays**: the branch completes the task (capture) or rejects it (release). | `handToBranch` (T6) | same spec |
| The sweeper walks the unsettled and the unknown lists by id, a bounded number of pages a round, and never drops a stuck operation. A technical failure changes no state. | `applyPending` | same spec, "the sweeper is fair" |
| A line is made by the sale (`lines.service.ts`) or by the completion of its task (`task-completion.ts`) only. | — | guard `line-creation` |

## 6. Unknown, and decisions by people

| Rule | Where | Proof |
|---|---|---|
| `unknown` keeps the hold, makes no line, moves no money and is never sent again. The accounts that may decide are told once. | `tellUnknown` (T7) | `activation-settlement.db.spec.ts` |
| It is closed by the provider's own late answer (`settle`), or by people: `confirm-success` (one account) or `declare-failure` (a proposal and another account's approval). A success that could not be applied is closed by `apply-corrected` (one) or `release-after-success` (two). | `provider-decisions.ts`, `decisionStep` | `provider-decisions.db.spec.ts` |
| Who: a branch owner or a branch account with `accounting`, in its own session, never the task's submitter, and never the proposer for the approval. Every step is an event with its evidence; an eSIM code is never in the record. | `activation-settlement.rules.ts` | same spec |
| A verdict is acted on, and a decision recorded, by `activation-settlement.ts` and `provider-decisions.ts` only. | — | guard `verdict-path` |
| `resolveUnknown` is the entry kept for an automatic status inquiry; nothing calls it outside tests until a provider's contract defines its answers. | `provider-operations.service.ts` | spec 2026-11-13-first-provider-adapter-discovery |
| The eSIM activation code is sealed before it is stored and is never logged, queued or put in a notice. | `esim-code.ts`, `secret-box.ts` | `esim-*` specs, `settlement-schema.db.spec.ts` |

## 7. The worker

The worker builds the settlement's graph by hand. It must hold one unit of work, one ledger, one task service,
and give each critical class the same kinds of collaborators the API's modules give it; it runs both queues, the
relay, recovery, the waiting pass and the sweeper. Proof: `worker-wiring.spec.ts`.
