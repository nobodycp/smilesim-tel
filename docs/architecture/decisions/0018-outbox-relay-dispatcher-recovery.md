# 0018 — Provider operations are sent by a leased relay and a marked, leased attempt; a lost worker ends in `unknown`

Date: 2026-11-10. Status: accepted as infrastructure (owner task 03); off by default and never on in production.
Builds on ADR 0017. Spec and plan: `docs/superpowers/{specs,plans}/2026-11-10-provider-dispatcher.md`.

## Flow

```
sale tx (later)        relay (worker)                 queue            dispatcher (worker)             provider
recordIn ─┬─ ProviderOperation: requested
          └─ OutboxMessage ──lease──▶ publish(jobId = message id) ──▶ job ──▶ claim(id)  ── null ─▶ stop
                              ◀─ accepted ─ stamp publishedAt                  │ attempt n, leaseUntil
                                                                              beginSend ── null ─▶ stop   (also when the lease is over)
                                                                               │ sentAt (committed)
                                                                               └────────── send(key, n) ───────▶
                                                                              settle(id, n, outcome) ◀─ evidence
   confirmed → succeeded · refused → failed · no answer / no evidence → unknown
   never left → requested + new OutboxMessage (same transaction), up to 5 attempts, then failed

recovery (timer): pending and lease over ─┬─ no sentAt → requested + new OutboxMessage
                                          └─ sentAt    → unknown   (a late confirmed/refused may still close it)
```

## Decisions

1. **The relay leases, it does not lock.** A batch is taken in one statement with `FOR UPDATE SKIP LOCKED` and a
   `claimedUntil` 30 s ahead; the publish runs with no transaction open; `publishedAt` is written only after the
   queue accepted the job. Any crash leaves a row that is taken again when the lease ends.
2. **At least once, made harmless.** The message id is the job id; a repeat that gets through ends at `claim`.
3. **The dispatcher holds no rule.** It orders four calls; `outcomeOf` and `afterAttempt` decide, the service
   writes. The provider is called between committed writes.
4. **`not-sent` needs a statement from the adapter** that no connection was opened. A throw, or silence past the
   call timeout, is `no-answer`.
5. **A send mark (`sentAt`) written before the call** makes "nothing left" provable after a crash.
6. **A lease per attempt (`leaseUntil`)** keeps recovery away from a working worker; recovery is decided by lease
   and mark together, not by the row's age.
7. **Recovery never fails and never re-sends an attempt that may have left**: it writes `unknown`.
8. **The provider's own late verdict closes `unknown`** for the same attempt; nothing else does.
9. **One port.** `ProviderGateway` gains `send`; the simulated gateway answers "never left" everywhere.
10. **Off by default.** `PROVIDER_DISPATCH=1` outside production only.

11. **Logs carry codes, not error text** (review of `afb7d1f`). A gateway's or a driver's error may quote the
    request it sent, a header, a reply or a connection string. The dispatcher, the relay, the dispatch timers and
    the relay's Redis listener log `errorCode(error)` (`shared/log.ts`): the error's own `code` when it is a plain
    system, Node, undici or Prisma code, `timeout`, or `unclassified`. A job that fails is rethrown as
    `JobFailure` with that code and no stack, because BullMQ keeps a failed job's reason and stack in Redis.
12. **The lease also binds the worker** (same review). `beginSend` writes the mark only
    `WHERE id AND status = 'pending' AND attempts = n AND sentAt IS NULL AND leaseUntil > now`, in one statement.
    A worker that wakes up after its lease cannot start a send, whether or not recovery has run yet. `leaseRuns`
    (pure) is the one test both sides use: the worker may start exactly while recovery may not act.

## Alternatives

- **Hold a transaction (row lock) across the publish or the provider call**: a slow Redis or provider would hold
  locks and connections; forbidden by the task and by rule 1.7.
- **Mark published before the queue answers**: a crash in between loses the message.
- **BullMQ job retries as the retry mechanism**: the retry would live in Redis only; the outbox row commits with
  the state change. Jobs run once (`attempts: 1`).
- **Treat a timeout as `not-sent` and retry**: the request may be at the provider; that is a double sale.
- **Recovery by `updatedAt` age alone**: cannot tell a slow worker from a dead one, nor sent from unsent.
- **Recovery writes `failed`**: the provider may have run the operation; the customer would be refunded for a
  line that works.
- **Log the error message with secrets masked by pattern**: a mask misses what it was not written for; a code
  cannot leak.
- **Check the lease in the worker before calling `beginSend`**: a check and a write in two steps leave a gap; the
  condition belongs in the write.
- **A second gateway port for dispatch**: two ports to implement and keep in step for every provider.

## Consequences

- Three columns, one new folder (`office/outbox/`), one worker module (`provider-dispatch.ts`).
- A failure is diagnosed from a code and the operation's id, not from the provider's words; an adapter that needs
  more must map its own errors to `OPERATION_ERRORS`.
- `unknown` operations accumulate until a status check or a screen exists (next phase).
- Published outbox rows are never deleted yet.
- The CI `db` job runs a Redis for the queue specs.
