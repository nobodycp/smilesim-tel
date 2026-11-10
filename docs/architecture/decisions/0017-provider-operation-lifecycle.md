# 0017 — A provider operation is a stored record with a guarded life, written with an outbox message

Date: 2026-11-10. Status: accepted as a foundation (owner task 02); nothing calls it yet. Spec and plan:
`docs/superpowers/{specs,plans}/2026-11-10-provider-operation-lifecycle.md`.

## Context

Line operations ask the gateway inside the request and keep nothing about the question. That is enough for a
simulation; with a real provider a lost answer cannot be told from a failure, and a retry can run twice.

## Decisions

1. `ProviderOperation` stores each operation under the caller's unique idempotency key with a fingerprint of the
   request. States: `requested → pending → succeeded | failed | unknown`; `unknown → succeeded | failed` only by an
   answer about the request already sent. `pending → requested` only when the request is known not to have left.
2. The operation and an `OutboxMessage` are written in the caller's PostgreSQL transaction (`recordIn(tx, …)`), so
   neither exists without the other and neither survives a rollback.
3. The provider is called between two short guarded writes (`claim`, `settle`), never inside a transaction.
4. The rules are a pure file; the service coordinates; the repository holds Prisma. No new route.

## Alternatives

- **Reuse `OfficeTask`** with new statuses: a task is a person's work and holds money; mixing a machine's
  in-flight state into it would touch every task screen and rule.
- **Redis idempotency (the HTTP guard)**: expires, fails open, and cannot commit with the money.
- **Poll `ProviderOperation` by status instead of an outbox**: works for one consumer; the outbox keeps "what
  must be announced" apart from "what state it is in" and serves other topics later. The owner asked for it.
- **Unique-violation and catch** instead of `ON CONFLICT DO NOTHING`: a violation aborts the whole PostgreSQL
  transaction, which would throw away the caller's own writes.
- **Retry after a timeout**: the provider may have run it. That is the double sale this record exists to prevent.

## Wiring an activation later (no double charge)

1. In the sale's transaction, on the locked line and wallet: hold the price as an open task does today
   (`WalletLedger.hold`), and `recordIn(tx, key, request)` with a key made from the sale (not from the HTTP retry),
   so a repeated request finds the same operation.
2. After commit the dispatcher claims and calls the provider with that key.
3. `succeeded`: one transaction turns the hold into the charge and activates the line, guarded by the operation's
   state so it happens once. `failed`: release the hold, or open the branch task as today.
4. `unknown`: the hold stays, nothing is charged twice or refunded; the status check or the branch decides.

## Consequences

- Two tables that nothing writes until the dispatcher phase. The service has no production caller yet; its
  PostgreSQL spec is its only user.
- A `pending` row left by a dead process has no sweeper yet (next phase).
- `OutboxMessage.publishedAt` is never set yet.
