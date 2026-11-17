# 0023 — A sale is priced on the path read before its transaction, confirmed under the wallet lock

Date: 2026-11-17 · Status: accepted (the owner, by name, 2026-11-17: "the sale path takes the account path from the
caller and no longer reads the tree inside the locked transaction"). Builds on ADR 0004 and 0019. Spec:
`docs/superpowers/specs/2026-11-17-scale-speed-cleanup.md`, "The tree out of the wallet lock (DB.9)"; evidence:
`docs/reviews/2026-11-17-database-audit.md` §5 and D.9.

## Context

A sale's wallet entry keeps its price ladder (`WalletLedger.saleLadder`). To build it, the ledger read **every
account** (`AccountTree.accounts(tx)`) inside the transaction, after the seller's wallet was locked, and walked the
seller's path from it. A task's completion did the same up to three more times in the same transaction (the renewal
stamp, the buy price of an older task, the switch quote), and so did an immediate switch for its quote. The read
grows with the number of accounts and holds the wallet row's lock while it runs.

That read gave one property: the ladder was built on the path as it stood after the wallet lock was taken. It did
not lock any account row (Read Committed), so it never promised the path at commit. And it did not tie the ladder
to the price: an immediate sale priced the debit on a path read **before** its transaction, so an account moved in
between was charged on the old path and recorded on the new one.

## Decision

1. **The caller reads the path before its transaction and passes it in.** `Sale.path` for the ledger; `posPath` /
   `known` for `LinePricing` (`resolveBuyPrice`, `stampFor`, `switchQuote`); `Completion.posPath` for a task's
   completion, read by the three callers of `applyClaimed` before their transactions (`TaskCompletion.pathOf`).
2. **Under the lock it is confirmed, not re-read.** `AccountTree.confirmedPath(tx, userId, path)` reads the path's
   accounts by id (`WHERE id IN (path ids)`, one statement, at most one row an account on the path) and requires,
   for every account on it: the row still exists, its parent is the next account on the path (the last one has
   none), and its layer is what it was. These are what a price and a ladder are built on.
3. **A path that is no longer true refuses the sale** with `409 DUPLICATE_REQUEST`, and the transaction rolls back:
   no line, no entry, no balance change. This is the refusal the code already gives when the line changed under
   a request (`lockUnchanged`). The request asked again reads the new path. In the provider's settlement it is a
   technical refusal (not one of `applyErrorOf`'s), so nothing is written and the sweeper tries again.
4. **Without a path** (the ladder of an older sale that a refund rebuilds, a caller that read none, a switched line
   whose point of sale is no longer the task's), the path is read up the parent links by id, one account at a
   time: the accounts on the path and no others. Inside a transaction `LinePricing` never reads the whole tree.

## What is and is not re-checked under the lock

| Changed between the read and the lock | Outcome | Why |
|---|---|---|
| The seller, or an account above it, moved to another parent; an account on the path deleted | refused, 409, nothing written | the price and the ladder would be on a path that no longer exists |
| An account's layer changed | refused, 409 | a layer prices (the layer columns) |
| An account above was frozen (`disabledAt`), or its stops (`deniedOps`) or login changed | the sale goes through, as before DB.9 | none of them prices or credits anything; stops are judged before the transaction (`assertRunnable`), and the whole-tree read never re-judged them either |
| A price (a custom price, a sell price, a package column) changed | the debit is the price quoted before the transaction, as before DB.9; the ladder's price rows are read under the lock by the path's ids, as before | the price charged is the price quoted (rule 1.5); the ladder records the rows as they stand at the write, unchanged by this ADR |

No account row is locked, as before: a move that commits after the confirmation and before the sale's commit is
not seen, exactly as it was not seen by the whole-tree read. Locking the path's rows (`FOR SHARE`) would add locks
to the lock order (ADR 0019) and was not taken.

## Consequences

- No transaction that holds a wallet lock reads the whole account tree. The statements under the lock are as many
  as before (one read of the tree becomes one read of the path's rows): `sales/sale-lock-tree.db.spec.ts` counts
  them (an activation 11, an extension 12) and pins the outcomes of the table above.
- A rare race that used to charge on one path and record another is now refused and asked again.
- Requests other than GET keep reading the tree afresh (no request memo for writes): a sale reads it once already,
  and a write that changes the tree must not answer from a read made before its own write.
