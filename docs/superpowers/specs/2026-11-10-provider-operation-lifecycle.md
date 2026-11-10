# A durable life for provider operations — spec

Owner task 02, 2026-11-10, on `df2be49`. Foundation only: no provider is connected, `LinesService` is untouched,
no route, response, price, balance or task changes. Nothing in production code calls the new service yet.

## Today

- A line operation asks `ProviderGateway.run()` inside the request and acts on the answer at once
  (`lines/lines.service.ts` `route()`): applied now, or a branch task. Nothing is stored about the question itself.
  With a real provider, a connection that drops after the request left would look like a failure, and a retry
  could run the operation (and charge the provider) twice.
- What exists and what it can carry:

| Piece | What it is | Reused? |
|---|---|---|
| `UnitOfWork.runTx` | one PostgreSQL transaction, Read Committed | **Yes**: the operation and its outbox message are written with the caller's client |
| `ProviderGateway` | the port a real adapter implements | **Yes**, unchanged; the future dispatcher calls it outside any transaction |
| `DuplicateGuardInterceptor` | Redis, per session, 10 s / 24 h, fails open | No: not durable, and not tied to the database transaction. Its rule (a key belongs to its first request) is kept |
| `OfficeTask` | work a person does, holds money while open | No: its states are a person's (`working`, `done`, …). It stays the manual fallback |
| `ProviderEntry` | payments and settlements with a provider | No: money with the provider, not operations |
| `WalletEntry` / `WalletLedger` | the money | Untouched. Later a sale writes its entries and its operation in one transaction |
| BullMQ worker | no processors | Not in this phase |

## Decisions

1. **Two tables.** `ProviderOperation` (the operation) and `OutboxMessage` (says an operation waits to be sent).
   Migration `20261110160000_provider_operations`, additive.
2. **States** `requested`, `pending`, `succeeded`, `failed`, `unknown`, refused by the database when unknown
   (CHECK). Moves:

   | From | To | When |
   |---|---|---|
   | `requested` | `pending` | a dispatcher claims it for one attempt (counted) |
   | `requested` | `failed` | reserved for giving up before any send |
   | `pending` | `succeeded` | the provider confirmed |
   | `pending` | `failed` | the provider answered and refused; or it never left and the attempts are used up |
   | `pending` | `requested` | it is **known** not to have left (no connection), attempts < 5 |
   | `pending` | `unknown` | it left, or may have, and no answer came |
   | `unknown` | `succeeded` / `failed` | an answer about that same request: the provider's status check, or a person |

   `succeeded` and `failed` are final. A new try after `failed` is a new operation with a new key.
3. **Unknown is never sent again.** Only `requested` may be claimed. An operation left `pending` by a process
   that died is to be treated as unknown by the dispatcher phase, never as failed.
4. **The idempotency key** is the caller's (8–120 safe characters), unique in the database. The same key with the
   same request answers the first operation and writes nothing; with another request it is refused (`400 INVALID`,
   as the HTTP guard does). "Same request" is a SHA-256 over action, provider, package, number, serial and line.
5. **One transaction.** `recordIn(tx, key, request)` writes with the caller's client; `record(key, request)` opens
   its own. The insert is `ON CONFLICT DO NOTHING`, so a lost race waits for the winner and reads its row instead
   of aborting the caller's transaction.
6. **No call inside a transaction.** `claim` commits `pending` first; the provider is called after; `settle`
   writes the answer in a second short write. Both are guarded by the expected state.
7. **Exactly-once is not promised.** We send at least once only while it is known nothing left; beyond that the
   provider's own idempotency (our key sent with every attempt) or its status check decides.
8. **What is stored is safe.** The request's own fields, a provider reference (trimmed, ≤120), and an error
   **code** from a closed list. No credential, no header, no raw provider message.
9. **Layers.** Domain `operations/provider-operation.rules.ts` (pure); application
   `operations/provider-operations.service.ts`; infrastructure `operations/provider-operations.repository.ts`
   (Prisma, outbox). No controller: no route is needed yet.

10. **Attempt fencing** (added after the review of `5020495`). `claim` answers the attempt's number;
    `settle(id, attempt, outcome)` is guarded by id, `pending` and that number. A late answer of an earlier attempt
    is refused and changes nothing.
11. **Durable retry.** `pending → requested` writes, in the same transaction, the outbox message of the next send
    (`OutboxMessage.sequence` = attempts made; unique with topic and aggregate, migration
    `20261110170000_outbox_sequence`). An operation that becomes `unknown` gets no message.

## Non-goals

A real adapter; a dispatcher or worker; the outbox relay and `publishedAt`; sweeping stale `pending` rows; any
screen; linking an operation to a task or a wallet entry; changing `LinesService`.
