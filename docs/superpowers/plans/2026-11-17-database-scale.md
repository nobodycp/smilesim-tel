# Database at scale — plan

Spec: `docs/superpowers/specs/2026-11-17-scale-speed-cleanup.md` (decisions 1–8). Evidence, the measured plans and
the case ids (L1, W1, T6…): `docs/reviews/2026-11-17-database-audit.md` section 12, whose slices D.1–D.16 are
DB.1–DB.16 here. One slice = one commit, ticked with its hash. Marks: [MONEY], [LOCK], [UNIQUE], [CONTRACT].

First, no money writes:

- [x] **DB.1 Indexes for the newest-first order** (lines, wallet entries, tasks; the partial sales index). (2ae5a2b8)
- [x] **DB.2 Foreign-key and lookup indexes**; `taskNoteSent` filters the text key its index serves. (d71a7236)
- [x] **DB.3 The cursor's `AND` form** in `platform/paging.ts`, pinned by its spec. (717a5b6f; map be4d64b1)
- [x] **DB.4 The health watch and the provider books** read what they need, once. (dbab787e; map f3314819)
- [x] **DB.10 The branch sends no `posId IN` list.** (aa33c40c; map f3314819)
- [x] **DB.6 Search:** `pg_trgm`, the digits/names split, Arabic-Indic digits. (1eae8df0; map 28d66409)
- [x] **DB.7 Arabic normalisation** for account search. (90f0dec0, c60c0981; map 28d66409)
- [x] **DB.11 SQL aggregates** for the overview's counts, sums and trend: line and task statuses grouped (0f4eaeb9; map f3314819); the sales figures, deferred to DB.12 because their profit needed the rows, are SQL sums of the stored margins since M.4 (5cf2f7b1).

Then, each with the owner's values or word:

- [x] **DB.8 Capped counts** [CONTRACT]: `total` up to 10,000 with `totalCapped`, `countUpTo` in `platform/paging.ts`; the numbers list and card read the point of sale's login only. (ccdf1fa3, fa431b04)
- [x] **DB.9 The tree read once a request and kept out of transactions** [LOCK]: the sale priced on the path read before its transaction, confirmed under the wallet lock by its rows (ADR 0023); writes keep reading the tree afresh. (d1620076)
- [x] **DB.13 Retention** [UNIQUE for the outbox]: notices 180 days read, 365 unread; ended sessions 30; published outbox messages 30, only of applied operations (ADR 0024); line counts 400; activity 90, batched; `AccessLog` kept. (0b523e8e)
- [x] **DB.14 Request-log indexes**; the route figures from duration counts; the rollup is an open item. (78bb02a9)
- [x] **DB.15 Settings:** pool, time limits, fill factors: per-client pools and limits sent on connect (API 20 / 15 s, exports 2 / 90 s, worker 10 / 60 s, purge 2, idle in a transaction 30 s), a cut statement 500 `TOO_SLOW` kept as `57014`; `Wallet` / `Session` fill factors, autovacuum, the three CHECKs validated. (801addc5)

Last, money, each with its ADR:

- [ ] **DB.5 Provider ledger stored** [MONEY][LOCK]. ADR 0025; the slices in the spec's section "Provider ledger stored (DB.5)". Everything is built; open only for P.5, which waits for a measurement on a database at the audit's sizes.
  - [x] **Provider ledger P.1 columns and writers**: `WalletEntry.providerId` and the CHECK `NOT VALID`; every writer of an operation stores its provider and cost in the same INSERT. (9c695ada)
  - [x] **Provider ledger P.2 backfill command** with its proof (`provider-ledger-backfill`); run on the local dev database: 46 entries filled, five providers equal to the agora. (dc13d39a)
  - [x] **Provider ledger P.3 index and VALIDATE** (release 2, after the backfill ran on the deployment): `WalletEntry_provider_createdAt_id`; the CHECK validated when no row breaks it, else a WARNING. (a24980c3)
  - [x] **Provider ledger P.4 reads switched** to the stored columns; the read-time fallback and the backfill command deleted. Closes the audit's finding 1 (§1, [W6]: the provider books loaded every operation entry ever). (6b7846a5)
  - [x] **Provider ledger P.4b backfill at HEAD**: the server deploys main once, so the command lives at HEAD and runs after the deploy; every operation entry takes its line's package's provider (P.2's name matching replaced, ADR 0025 amendment); missing costs by today's writer rule; the CHECK validated; the overview's top providers read the stored provider. Local dev: 4 entries moved from lian to alloha and aren. (6e18950a)
  - [ ] **Provider ledger P.5 closed monthly totals**: only if the grouped sum measures over budget; waits for a measurement on a database at the audit's sizes (none exists now).
  - [x] **Provider ledger P.6 a disconnect lowers the purchases** (the unused days less the 0.5 ₪ fee): the entry stores used + fee − the open periods' cost; the stored disconnects corrected by the P.4b command (local dev: 4, sky 63288 → 49288). (a94de7a9)
  - [x] **Provider ledger P.7 done at the provider, given back to the customer**: a purchase, a loss of the branch, with a visible mark; with it, an activation or renewal sold at 0 (`WalletEntry.providerLoss` `given_back` / `priced_zero`, `branchMargin` = − cost; badge, filter and counts for the branch only; the backfill's P.7 pass — local dev: none to mark). (6625e3e6 spec, a0417b1a, f7cb1ed7, 51aa0e0e, bbbc6bbb)
  - [x] **Provider ledger P.8 branch losses in the profit figures** (owner, 2026-11-17: losses show on the home and are subtracted from the profit): the branch's profit on the home, the profit report and the finance summary is net of the marked operations; `sales.losses`, the report's `losses` / `lossAmount`; the home's profit tile and the report show them, for the branch only; partial index `WalletEntry_loss_createdAt`. Spec section "Branch losses in the profit figures (DB.5 P.8)". (305c03a7 spec, 52710a4d, 84e2e738, f51c80d0)
- [ ] **DB.12 Stored margin an entry** [MONEY]. ADR 0026 and its amendment; the slices in the spec's section "Stored margin an entry (DB.12)".
  - [x] **Stored margin M.1 columns and writer**: the chain by layer and four margins on each sale and refund entry, written by `post()` in its INSERT from the ladder; a refund copies its sale's ids; the CHECK `NOT VALID`; lock counts unchanged. (32b59071)
  - [x] **Stored margin M.2 backfill command** at HEAD (`stored-margins-backfill`, run before `provider-ledger-backfill`): kept ladders projected, old sales built once on the path of their time, old refunds from their sale, the invariant in Node, the CHECK validated. Local dev: 27 entries (9 kept, 18 built), none left without. (78038686)
  - [x] **Stored margin M.3 indexes and VALIDATE**: three partial chain indexes with margin, amount and kind included; the CHECK validated when no row breaks it. (51a17a27)
  - [x] **Stored margin M.4 reads switched**: overview, previous period, profit report and CSV, providers report, finance summary, finance list margins and shares as SQL sums by the chain at the time; caps and `capped` removed (API and web); the read-time rebuild deleted. Old vs new on local dev: 64 figures, five accounts, equal. (5cf2f7b1)
  - [ ] **Stored margin M.5 closed-day summary**: only if "all time" measures over the one-second budget; waits for a measurement on a database at the audit's sizes (none exists; 27 local rows prove the indexes serve the sums, not their speed).

Not planned: DB.16 (ancestor columns), until production shows the need.
