# 0004 — Atomic wallet balance updates

Date: 2026-11-08 · Status: accepted (owner)

## Context
`OfficeService.move()` reads the wallet, checks the ceiling, then writes `balance: wallet.balance + amount` inside a Read Committed transaction. Two concurrent operations on one wallet can lose an update, and the ceiling check can pass for both.

## Decision
Lock the wallet row for the rest of the transaction (`SELECT … FOR UPDATE`) before reading the balance, and write the new balance with `increment`. The ceiling check and the balance write then see the same, serialised balance.

## Consequences
- Concurrent money operations on the same wallet queue instead of racing; different wallets are unaffected.
- Never compute an absolute balance from a prior unlocked read (recorded in `CLAUDE.md`).
