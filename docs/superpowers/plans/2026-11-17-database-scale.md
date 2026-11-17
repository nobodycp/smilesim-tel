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
- [x] **DB.11 SQL aggregates** for the overview's counts, sums and trend: line and task statuses grouped; the sales figures wait for DB.12 (their profit needs the rows). (0f4eaeb9; map f3314819)

Then, each with the owner's values or word:

- [x] **DB.8 Capped counts** [CONTRACT]: `total` up to 10,000 with `totalCapped`, `countUpTo` in `platform/paging.ts`; the numbers list and card read the point of sale's login only. (ccdf1fa3, fa431b04)
- [ ] **DB.9 The tree read once a request and kept out of transactions** [LOCK].
- [x] **DB.13 Retention** [UNIQUE for the outbox]: notices 180 days read, 365 unread; ended sessions 30; published outbox messages 30, only of applied operations (ADR 0024); line counts 400; activity 90, batched; `AccessLog` kept. (0b523e8e)
- [x] **DB.14 Request-log indexes**; the route figures from duration counts; the rollup is an open item. (78bb02a9)
- [ ] **DB.15 Settings:** pool, time limits, fill factors.

Last, money, each with its ADR:

- [ ] **DB.5 Provider ledger stored** [MONEY][LOCK].
- [ ] **DB.12 Stored margin an entry** [MONEY].

Not planned: DB.16 (ancestor columns), until production shows the need.
