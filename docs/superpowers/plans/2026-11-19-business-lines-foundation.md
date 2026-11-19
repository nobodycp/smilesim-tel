# Foundations for the other business lines — plan

Spec: `docs/superpowers/specs/2026-11-19-business-lines-foundation.md`. Decisions: ADR 0028.
One verified slice at a time; each ticked with its commit hash.

- [x] **F.1 The rules**: ADR 0028 written (one wallet, own tables per line, amounts on the entry whatever the pricing rule, reserved kind words, online additive migrations).
- [ ] **F.2 Wallet page by exclusion**: an account's wallet page lists every entry that moved its balance (`addon` is missing today); the web names the kind.
- [ ] **F.3 No sale without margins**: the ledger refuses a sale kind that moves money with no ladder; CHECK `WalletEntry_sale_has_ladder` (`NOT VALID`, validated when no row breaks it).
- [ ] **F.4 Kind guards**: one spec tying the code's kind lists to the index and CHECK predicates, the web's names and the sums' allow-lists; the reserved words.
- [ ] **F.5 One provider predicate**: every read of a provider's operations uses `providerId IS NOT NULL`.
- [ ] **F.6 Online migration proven**: one `CREATE INDEX CONCURRENTLY` migration through the dev start and the trial server's deployment, with writes running; the operator guide says how.
- [ ] **F.7 Names** (the owner, 2026-11-19: `postpaid` in the API and the backend's names; on screen «الفواتير»), in steps:
  - [ ] **F.7a Inventory**: every route, module and Prisma model classified shared or postpaid; the mixed ones decided; written into the spec.
  - [ ] **F.7b API routes**: the postpaid routes under `/v1/postpaid/…`, the web's client and the Playwright stand-ins with them; no alias.
  - [ ] **F.7c Pages and sidebar**: the postpaid pages under `/postpaid/…`, one sidebar heading «الفواتير» holding the line's numbers, companies and packages, providers, provider accounts and operations.
  - [ ] **F.7d Models and tables**: the postpaid models and tables take the prefix (plain `RENAME` migrations).
  - [ ] **F.7e Modules**: the postpaid-only modules named for the line; ADR 0020 amended.
