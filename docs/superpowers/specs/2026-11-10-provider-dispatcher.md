# Outbox relay, dispatcher and recovery for provider operations — spec

Owner task 03, 2026-11-10, on `3c8413d`. No real provider, no sale path, no wallet, no route, no web change. The
dispatcher is off unless `PROVIDER_DISPATCH=1` and never runs in production.

## Today

- `ProviderOperation` and `OutboxMessage` exist with guarded states, attempt fencing and a durable retry message
  (ADR 0017). Nothing reads the outbox, nothing claims an operation, and a `pending` row left by a dead process
  stays `pending`.
- `src/worker.ts` is a BullMQ worker process with an empty processor list (`backgroundProcessors`) and one timer
  (activity purge). It builds its own Prisma client; it is not a Nest application.
- `ProviderGateway` has `accept` and `run(request)`, which answers only `ok` or a reason: not enough to tell
  "refused" from "never left" from "no answer".

| Piece | Reused |
|---|---|
| `worker.ts`, its Redis connection and processor list | **Yes**: one more processor and two timers, in the same process |
| `ProviderOperationsService` (`claim`, `settle`, `status`) | **Yes**; grows `beginSend`, `recover`, `expiredPending` |
| `UnitOfWork.runTx` | **Yes**, for every multi-row write |
| `ProviderGateway` | **Yes**: one new method, `send`, on the same port; no second port |
| `shared/log.ts` (`logger`, `reason`) | **Yes**: ids, attempts and outcome kinds only |

## Decisions

1. **Relay** (`office/outbox/`): one statement leases a batch (`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP
   LOCKED) RETURNING`, `OutboxMessage.claimedUntil`, 30 s), then each message is published and, only after the
   queue accepted it, stamped `publishedAt`. No transaction is open during the publish. A relay that dies leaves
   a lease that runs out; nothing is held in memory. Delivery is **at least once**.
2. **Stable identity**: the message id is the BullMQ job id, so a second publish is the same job while the first
   is kept (finished jobs are kept a day). Past that, the dispatcher's `claim` makes a repeat harmless.
3. **Redis away**: the publish fails (5 s limit, the relay's own connection does not queue offline), the message
   stays unpublished and is taken again after its lease. The lease is the retry delay.
4. **Dispatcher** (`providers/operations/operation-dispatcher.ts`): `claim` → `beginSend` → `gateway.send` →
   `settle(id, attempt, outcome)`. `claim` null, or `beginSend` null, means stop without calling the provider.
5. **Evidence, not guesses.** `gateway.send` answers `SendEvidence`; `outcomeOf` (pure) maps it. `not-sent` only
   when the adapter states that no connection was opened. A thrown error, or no answer within `CALL_TIMEOUT_MS`
   (30 s), is `no-answer` → `unknown`.
6. **The send mark.** `beginSend` writes `ProviderOperation.sentAt` for the attempt, guarded by the attempt's
   number, and the provider is called only if that write succeeded. So an attempt with no mark never reached the
   provider: that is what lets recovery tell "never left" from "may have left".
7. **Lease per attempt.** `claim` sets `leaseUntil = now + ATTEMPT_LEASE_MS` (call timeout + 60 s). Recovery
   touches only attempts whose lease is over, so it never competes with a worker inside its lease.
8. **Recovery** (`recoveryOutcome`, pure; `ProviderOperationsService.recover`):
   lease running → nothing; lease over and no mark → back to `requested` with its outbox message (guarded on the
   mark still being empty, so a late worker cannot then send); lease over and marked, or no lease recorded →
   `unknown`. Never `failed`, never re-sent.
9. **A late answer.** If the worker outlives its lease, recovery has already written `unknown`. The worker's
   answer is then accepted **only** when it is the provider's verdict for that same attempt (`confirmed` or
   `refused`): `unknown → succeeded | failed`. A late `no-answer` or `not-sent` changes nothing.
10. **Switch.** `config.ts` `providerDispatchOn()`: `PROVIDER_DISPATCH=1` and not production. The worker binds the
    simulated gateway, whose `send` always answers "never left": even switched on, nothing reaches a provider.

## Guarantees and their limits

- An operation is sent **at most once per attempt**, and a new attempt is made only after proof that the earlier
  one never left. Exactly-once at the provider is not ours to promise:
  - the provider runs the operation and the answer is lost → `unknown`; closed by a status check or a person;
  - a worker stalls **after** the mark and before the call, past its lease → recovery says `unknown` although
    nothing left (safe, but needs a verdict);
  - a provider that does not honour the idempotency key and a person who re-submits an unknown operation by hand.
- A message can be published twice and a job delivered twice; both end at `claim`.
- The clock: leases compare the workers' clocks. A skew larger than the 60 s margin could let recovery act while
  a worker still believes in its lease; the mark and the attempt guard still prevent a double send.

## Non-goals

A real adapter; a provider status check; a screen for unknown operations; any caller of `record`; pruning old
outbox rows; metrics.
