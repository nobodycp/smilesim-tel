# Foundations for the other business lines — plan

Spec: `docs/superpowers/specs/2026-11-19-business-lines-foundation.md`. Decisions: ADR 0028.
One verified slice at a time; each ticked with its commit hash.

- [x] **F.1 The rules**: ADR 0028 written (one wallet, own tables per line, amounts on the entry whatever the pricing rule, reserved kind words, online additive migrations).
- [x] **F.2 Wallet page by exclusion**: an account's wallet page lists every entry that moved its balance (`addon` was missing); the web names the kind. (b3d7a868)
- [x] **F.3 No sale without margins**: the ledger refuses a sale kind that moves money with no ladder; CHECK `WalletEntry_sale_has_ladder` (`NOT VALID`, validated when no row breaks it). No call site found that loses its ladder today; refunds left as they are. (642a8c48, f72dbf56)
- [x] **F.4 Kind guards**: one spec tying the code's kind lists to the index and CHECK predicates, the web's names and the sums' allow-lists; the reserved words. (0837b1ba)
- [x] **F.5 One provider predicate**: every read of a provider's operations uses `providerId IS NOT NULL`. (369e8aab; stand-in 80a75565)
- [ ] **F.6 Online migration proven**: one `CREATE INDEX CONCURRENTLY` migration through the dev start and the trial server's deployment, with writes running; the operator guide says how. Proven locally (a throwaway database with a writer running, and the test database; b68bc6ac), waits for the trial server. Not yet applied by the dev copy's start.
- [ ] **F.7 Names** (the owner, 2026-11-19: `postpaid` in the API and the backend's names; on screen «الفواتير»), in steps:
  - [x] **F.7a Inventory**: 39 models, 202 routes, 48 pages and the modules classified; the decisions are in the spec (F.7a). Open with the owner: tasks per line or one inbox.
  - [x] **F.7b API routes**: the postpaid routes under `/v1/postpaid/…`, the web's client and the Playwright stand-ins with them; no alias. 56 routes and the company mark (`/pictures/postpaid/companies/:code`); the tasks list (8 routes) waits for the owner's answer on tasks per line. (API e9fdb37b; web and stand-ins 247501c3)
  - [ ] **F.7c Pages and sidebar**: the postpaid pages under `/postpaid/…`, one sidebar heading «الفواتير» holding the line's numbers, companies and packages, providers, provider accounts and operations.
  - [ ] **F.7d Models and tables**: the postpaid models and tables take the prefix (plain `RENAME` migrations).
  - [ ] **F.7e Modules**: the postpaid-only modules named for the line; ADR 0020 amended.
