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
- [ ] **DB.6 Search:** `pg_trgm`, the digits/names split, Arabic-Indic digits.
- [ ] **DB.7 Arabic normalisation** for account search.
- [x] **DB.11 SQL aggregates** for the overview's counts, sums and trend: line and task statuses grouped; the sales figures wait for DB.12 (their profit needs the rows). (0f4eaeb9; map f3314819)

Then, each with the owner's values or word:

- [ ] **DB.8 Capped counts** [CONTRACT].
- [ ] **DB.9 The tree read once a request and kept out of transactions** [LOCK].
- [ ] **DB.13 Retention** [UNIQUE for the outbox].
- [ ] **DB.14 Request-log indexes.**
- [ ] **DB.15 Settings:** pool, time limits, fill factors.

Last, money, each with its ADR:

- [ ] **DB.5 Provider ledger stored** [MONEY][LOCK].
- [ ] **DB.12 Stored margin an entry** [MONEY].

Not planned: DB.16 (ancestor columns), until production shows the need.
