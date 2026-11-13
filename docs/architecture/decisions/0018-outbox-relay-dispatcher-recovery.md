# 0018 — Provider operations are sent by a leased relay and a marked, leased attempt; a lost worker ends in `unknown`

Date: 2026-11-10. Status: accepted as infrastructure (owner task 03). Decision 10 ("off by default, never on in production") is replaced by ADR 0019, D18 (slice S.12a): see the note at the end.
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
    the relay's Redis listener log `errorCode(error)` (`shared/log.ts`): the error's own `code` only when it is one of
    the codes listed by name there (`KNOWN_ERROR_CODES`: sockets and DNS, Node streams and TLS, undici, Prisma),
    `timeout` for a `TimeoutError`, else `unclassified`. A pattern was tried first and dropped: it let through any
    word shaped like a code, such as a key spelled after an `E`. A job that fails is rethrown as
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

## Amended by ADR 0019, D18 (slice S.12a, 2026-11-13)

Decision 10 said `PROVIDER_DISPATCH=1` outside production only, and `config.ts` had `providerDispatchOn()` =
"not production and `PROVIDER_DISPATCH=1`". Both are gone. No environment name decides anything now:

- **Sending** is allowed per provider by four conditions that must all hold (`dispatch-policy.ts`):
  `PROVIDER_DISPATCH=1`, the provider named in `PROVIDER_ADAPTERS`, `PROVIDER_TARGET` stated, and the owner's
  approval for that target, not paused; **and** by an adapter the worker built. The dispatcher asks under the
  provider's row lock, when it takes an attempt and again when it marks it as sent (`dispatch-gate.ts`).
- **The worker's gateway** is `RoutingProviderGateway` over the adapters it built, not the simulated gateway. For
  a provider it holds no adapter for, `send` answers that no connection was opened.
- **Settling** (the relay, the settlements queue, recovery, the sweeper) always runs in the worker, whatever
  `PROVIDER_DISPATCH` says: stopping sending never strands a result. Recovery's timer also looks again at
  operations a closed gate left `requested` (`dispatchWaiting`).
- An attempt that a closed gate refuses is **not counted**: the operation stays `requested` with its attempts as
  they were. An attempt that was taken and then refused at the mark (the pause came between the two) is
  provably unsent and is put back by recovery, as decision 6 already says.

## Amended by the final corrections of S.12a (2026-11-13): the attempt's number and the budget are two things

Decision 6 counted every claimed attempt against `MAX_ATTEMPTS`. That was right while the only way an attempt
ended unsent was a connection that failed or a worker that died. Since D18 an attempt can also end unsent because
the owner closed the provider between the claim and the mark, and five of those would have failed an operation
no provider ever saw.

- `attempts` is the attempt's **number**. It only grows. It fences (an answer is written only for the attempt the
  operation is on) and it is the outbox sequence (one message per send; a `settled` message per verdict). It is
  never reduced and no number is used twice.
- `waivedAttempts` counts the attempts handed back before their send mark while the provider's gate was closed.
  The **budget** is `attempts − waivedAttempts` (`spentAttempts`); `afterAttempt` is given that.
- `beginSend`, refused by the gate, hands the attempt back in the same transaction (`pending → requested`,
  waived, with the next send's message). It replaces the last sentence of the amendment above: nothing waits
  for recovery.
- `recover`, given the worker's gate, waives an unsent attempt found while the gate is closed. An unsent attempt
  found while the gate is open is counted as before (a worker that keeps dying before the mark must not loop for
  ever). Without a gate, `recover` counts every attempt, as before.
- A connection that was tried and did not leave (`left: false` from the adapter) is counted, as before: five of
  those fail the operation.
- The column defaults to 0, so every operation recorded before it keeps the count it had.

## Amended by slice S.12b.0 (2026-11-13): the permit, and the pass over waiting operations

- **The dispatcher sends through a permit.** `OperationDispatcher(operations, gate)` holds no gateway. `claim`
  and `beginSend` ask the gate, which answers a `SendPermit` or null; the permit `beginSend` was given in the
  transaction that wrote the send mark is what the request is sent with. Claim, mark, call, settle are otherwise
  as decided: the call is between two committed writes, and an attempt is fenced by its number.
- **`dispatchWaiting` is replaced by `WaitingPass`**: a walk over `requested` operations by id, in pages, that
  keeps its place between the rounds of recovery's timer (ADR 0019, "S.12b.0"). It replaces "the 100 oldest by
  `updatedAt`", which the operations of one closed provider could fill for ever.
