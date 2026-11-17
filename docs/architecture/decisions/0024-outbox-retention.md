# 0024 — Published outbox messages are pruned only once their operation is applied

- Status: accepted (owner, 2026-11-17: "a published outbox message 30 days, only one whose operation is applied")
- Spec: `docs/superpowers/specs/2026-11-17-scale-speed-cleanup.md` (decision 5, the owner's answers of the second round)
- Plan: `docs/superpowers/plans/2026-11-17-database-scale.md`, DB.13; audit `docs/reviews/2026-11-17-database-audit.md`, section 9

## Context

`OutboxMessage` grows by one or two rows per send of a provider operation and was never pruned. Its unique key
`(topic, aggregateId, sequence)` is what refuses a second writer of the same verdict (`settledSequence`, ADR 0019 D8):
two transactions that settle the same attempt cannot both insert the message. Deleting a row gives that key back, so
the purge must not be the thing that lets a second verdict through.

## Options

1. **Never prune.** Safe, and the table grows for ever.
2. **Prune every published message past an age.** Simple, but a message of an operation still `unknown`, an exception,
   or a verdict the settlement has not acted on would lose its key while a later verdict may still come.
3. **Prune published messages past an age whose operation is applied** (`appliedAt` set).
4. **Keep the key elsewhere** (a separate table of used sequences, or a "used up to" column on the operation), and
   prune every published message. A schema change for a guarantee the status already gives.

## Decision

Option 3, with 30 days (`PUBLISHED_OUTBOX_RETENTION_DAYS`, `platform/retention.ts`). The delete is
`ProviderOperationsRepository.deleteAppliedOutbox`: a message of the two operation topics, `publishedAt` before the
cut-off, whose operation has `appliedAt` set and is `succeeded` or `failed`; in bounded statements from the worker's
daily purge.

Why that is safe: `appliedAt` is written only on a `succeeded` or `failed` operation (`markApplied`,
`markAppliedCorrected`, `markHandedOver`, `markAbandoned`), and neither state moves again (`canMove`). Every message
is inserted only after a guarded status move out of `requested`, `pending` or `unknown` succeeded in the same
transaction (`record` for a new operation, `settle`, `resolveUnknown`, `recover`, `declareFailed`, the hand-back). So
for an applied operation no path reaches the insert the key protected: a second verdict is refused by the status
guard (409 `DUPLICATE_REQUEST`, or `false` / `null`) before it. A settled message that comes again is acted on by
the settlement, which finds the operation applied (`settlementOf` → `settled`) and does nothing.
`outbox-retention.db.spec.ts` shows each verdict path refused after the purge, with no message written, and that the
database itself would now take the same key again.

## Consequences

- The table is bounded to about 30 days of messages, plus those of operations not applied.
- Messages of an operation that is never applied are never pruned: an exception left open, a verdict the settlement
  cannot act on, an operation without a task. They are few; if they grow, a later slice names them.
- A new path that writes an operation's message must keep the rule "a guarded status move first"; a path that wrote
  one for a `succeeded` or `failed` operation would need this ADR revisited.
