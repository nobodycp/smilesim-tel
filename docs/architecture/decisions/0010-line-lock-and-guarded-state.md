# 0010 — A number is locked and re-checked inside the transaction; no partial unique indexes

Date: 2026-11-10 · Status: accepted · Spec: `docs/superpowers/specs/2026-11-10-backend-hardening.md`, decisions 2, 3, 5

## Context

A line was read and validated before the transaction that changed it, and never looked at again inside. Two
requests for one number (two sessions, a double click, a branch task and an immediate operation) both passed the
check, so a disconnect refunded twice and an extension charged twice for one period. A task left open could be
applied after its line had moved on (a freeze task on a number already disconnected and refunded).

## Decision

- Every transaction that changes a line takes its row first (`lockLine`, `SELECT … FOR UPDATE`). An immediate
  operation then calls `lockUnchanged`: the row under the lock must be the row the request was checked against, or
  the request is refused with `409 DUPLICATE_REQUEST`. A task completion calls `lockedTaskLine`: the line must still
  be in a status its action applies to (`assertTaskFits`), or the task is refused and can only be rejected.
- A status changes only through `moveLineStatus` (`updateMany` with the expected status in the `where`).
- Lock order: task claim → line → wallets (sorted by user id).
- One open task per number and operation is checked in `openTask` under the line's lock. One live number per SIM
  serial is checked under a transaction-level advisory lock on the serial (`assertSimFree`).

## Alternatives

- **Partial unique indexes** (`OfficeTask(lineId, action) WHERE status = 'working'`, `Line(iccid) WHERE status <>
  'disconnected'`). They are the stronger guarantee, but Prisma cannot describe a partial index: `prisma migrate
  diff` would report it as drift and the next `migrate dev` would drop it. The row and advisory locks make the code
  checks race-free without them. Revisit if Prisma gains partial indexes.
- **Serializable transactions.** Every money path would need a retry loop for serialization failures; the row lock
  is local and already how wallets work (ADR 0004).
- **A version column on `Line`** (optimistic). Same refusal as `lockUnchanged`, but every writer must remember to
  bump it; the lock needs no cooperation from other writers.

## Consequences

- `lines/line-concurrency.db.spec.ts` proves it on PostgreSQL (CI `db` job); it fails with the lock removed.
- CHECK constraints on `Line.status`, `OfficeTask.status` and `Wallet.held` are raw SQL in the migration, `NOT
  VALID` so stored rows are left alone. Prisma does not manage CHECK constraints, so they cause no drift.
- A second request that loses the race gets 409 with the "same request is running" message; the web shows it as any
  other refusal.
