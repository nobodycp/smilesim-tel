# Foundations for the other business lines — plan

Spec: `docs/superpowers/specs/2026-11-19-business-lines-foundation.md`. Decisions: ADR 0028.
One verified slice at a time; each ticked with its commit hash.

- [x] **F.1 The rules**: ADR 0028 written (one wallet, own tables per line, amounts on the entry whatever the pricing rule, reserved kind words, online additive migrations).
- [ ] **F.2 Wallet page by exclusion**: an account's wallet page lists every entry that moved its balance (`addon` is missing today); the web names the kind.
- [ ] **F.3 No sale without margins**: the ledger refuses a sale kind that moves money with no ladder; CHECK `WalletEntry_sale_has_ladder` (`NOT VALID`, validated when no row breaks it).
- [ ] **F.4 Kind guards**: one spec tying the code's kind lists to the index and CHECK predicates, the web's names and the sums' allow-lists; the reserved words.
- [ ] **F.5 One provider predicate**: every read of a provider's operations uses `providerId IS NOT NULL`.
- [ ] **F.6 Online migration proven**: one `CREATE INDEX CONCURRENTLY` migration through the dev start and the trial server's deployment, with writes running; the operator guide says how.
- [ ] **F.7 Names**: bills-only API routes under `/v1/bills/…`, pages under `/bills/…`, the sidebar heading; waits for the owner's answer on the names.
