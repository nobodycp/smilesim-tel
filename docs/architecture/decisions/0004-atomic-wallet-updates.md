# 0004 — Atomic wallet balance updates

Date: 2026-11-08 · Status: accepted (owner)

## Context
`OfficeService.move()` reads the wallet, checks the ceiling, then writes `balance: wallet.balance + amount` inside a Read Committed transaction. Two concurrent operations on one wallet can lose an update, and the ceiling check can pass for both.

## Decision
`move()` locks the wallet row for the rest of the transaction (`SELECT … FOR UPDATE`) before reading the balance. The ceiling check and the balance write then work on a balance no other transaction can change until this one commits, so the absolute write is safe.

Proof: `wallet-concurrency.db.spec.ts` (runs only with `TEST_DATABASE_URL`). Before the lock, 10 concurrent debits of 50 from 1000 left 950 (9 lost) and 15 debits of 100 all passed a 0 ceiling; after it, 500 and exactly 10.

## Consequences
- In-memory spec stores stub `$queryRaw`.
- Concurrent money operations on the same wallet queue instead of racing; different wallets are unaffected.
- Never compute an absolute balance from a prior unlocked read (recorded in `CLAUDE.md`).
