# Open items

What the removed plans still described (2026-11-10), after the owner's answers of the same day. The plans
themselves were removed because the code had passed them: every task was checked against the code and found done
or replaced by a later design. They stay in git history.

## Waiting for an owner decision (`docs/project-plan.md` «مفتوح»)

- [ ] **Activation through a provider: the owner's word for each slice after S.1**
  (plan `2026-11-10-activation-settlement.md`, ADR 0019 accepted). S.1–S.4, S.5a and S.5b are built (the backfill `npm run seal-secrets --workspace api` has been run on no deployment yet); S.5c is built (web `3a2a3c1`, API `36b9f92`, both pushed, not deployed: the API must go out together with that web); S.6 (the request key, API and web) is built and pushed (`a370f6f`); S.7 (guards on the manual path, and cancel) is built and pushed (`28a56fd`); S.8 (settlement) is built and pushed (`40a48f7`); S.9 (decisions by people: two routes, two accounts for the decisions that let money go back) is built and committed locally, not pushed; S.9 is pushed (`58d6207`); S.10 (the screens: the operation on the ticket, the decision form, the second approval and its queue, with the reads they need) is built and committed locally, not pushed; S.10 is pushed (`ecbca17`); S.11 (opening: the task, its hold, the provider operation and its outbox message in one transaction, the request key required on that route, and `dispatches` a constant `false` so that no sale takes it) is built and committed locally, not pushed; S.11 is pushed (`27029d1`); S.12a (the switch, D18: four conditions, the owner's approval per target, the pause, the sealed credential, the worker's attestation; still no adapter, so nothing can be sent) is built and committed locally, not pushed, and so are its final corrections (ADR 0019 "Final corrections of S.12a": waived attempts, the deployment's name `DEPLOYMENT_ID`, the credential's generation, the manifest apart from the worker's registry; two migrations), pushed (`9f29f36`); S.12b.0 (hardening before the first adapter: the send permit, the fair pass over waiting operations, one attestation a worker by the database's clock, `SECRETS_KEY` required of a production worker; one migration, 14 pending on the server in all; **`SECRETS_KEY` must be set on the worker before this code is deployed**) and its final audit (the settlement's sweeper made fair in the same way; how the worker gets its key on a Coolify deployment of three Dockerfile applications) are built; S.12b (the first adapter, its own spec and review) is next and is not started. Decided by the owner on 2026-11-12: a refused correction stays on the activity record only (no fifth decision event type), and a decision's entry and notice name the task's submitter with «النظام» as the handler (D12), never the account that decided. D16 was amended in S.8 with the owner's approval (2026-11-12): `esim-code-missing`, no eSIM line without its activation code.
  **Backup and restore to Cloudflare R2** (`scripts/backup/`, `docs/operations/backup-and-restore.md`, Arabic handover
  guides in `docs/handover/`) is ready in code and not enabled in operation (owner, 2026-11-12): tried on synthetic
  data against a local S3 stand-in, never on R2 itself, switched on later per client. It is not a prerequisite
  for slices S.5c–S.12. S.4 left two
  points for the owner's separate review: a plain activation stores no provider cost on its entry, and a renewal
  task no `unitPrice`. (A switch is re-quoted at completion on purpose and is now settled against its hold.) Before deploying S.2 anywhere: `npm run reservation-conflicts --workspace api`.
- [ ] **Branch direct-sale price floor** when two main agents' prices differ (the 40 / 25 / 30 example,
  project-plan 2026-10-24). Today `floorFor` (`rules/user-terms.ts`) takes the floor from the account's own parent
  path; nothing chooses between the three options.
- [ ] **Disconnect grace days.** Mentioned in the explanation, never agreed, not in the code.
  (`Package.suspendAfterDays` is a different rule.)
- [ ] **Switch to a hidden package.** The old companies-and-packages plan said a package that is not for sale
  stays a valid switch target when it is on the switch list; the code refuses it with `PACKAGE_HIDDEN`
  (`rules/user-terms.ts` `visibleTo`, used in `lines/lines.service.ts`). Keep the code's rule or the plan's.

## In work

- [ ] **Notice before a subscription ends**, built so an SMS can follow later:
  `docs/superpowers/{specs,plans}/2026-11-10-expiry-notice.md` (waits for the owner's word on its three
  decisions).

## Future features (owner, 2026-11-10: after the current work; each needs its own spec)

- [ ] **Refresh link for a number.** The refresh operation exists; the link carries many rules of its own and is
  postponed.
- [ ] **Message management; WhatsApp and email notices.**

## After the business logic: the security and whole-system pass (owner, 2026-11-16)

The owner's order of work: first every feature the client asked for, then one full check of the system. Not to be
started, piece by piece, before that; each part gets its own spec then.

- [ ] **Rate limits almost everywhere.** Today (`rate-limit.middleware.ts`): a signed-in session has 600 requests
  and 60 writes a minute, and the three sign-in routes 30 attempts a minute an address. A request with no session
  has no limit on any other route. Known consequence, left on purpose until this pass: every refused write is
  recorded with the caller's address (`ActivityEvent`), an anonymous one included, so a caller with no session can
  add rows to the log as fast as it sends (purged after 90 days).
- [ ] **A lock on the account under attack.** Today (`auth/validators.ts`): ten failed sign-ins for one login name
  inside 15 minutes refuse the next ones with `RATE_LIMITED` until the window ends; nothing is stored on the
  account, nobody is told, and the owner cannot see or lift it. Wanted: a timed lock of the account when a
  cracking attempt is under way, by its own design (how long, what the account's owner and the branch see, who may
  unlock, what a locked account's open sessions do).
- [ ] **The server log prints a crash as it is.** `platform/api-exception.filter.ts` writes a 5xx's raw message and
  stack to the process log (`logger.error(error.stack ?? error.message)`). An error's message can carry a value of
  the request (seen in the M.4 crash spec of the system monitor, 2026-11-17: a secret sent in a body appeared in
  the test's log output). The stored `RequestError` row is filtered (`errorReport`); the process log is not. To
  decide in this pass: filter that line the same way, at the cost of less to read when debugging.
- [ ] **The full check of the system** after the client's features: security, limits, and whatever the business
  logic left open.

## Open: an intermittent test failure, cause not settled (recorded 2026-11-13)

- In one full local run of `npm run test:api` (all spec files in parallel on one PostgreSQL database), one request
  of `lines/esim-code-access.db.spec.ts` answered `500`. It passed alone and in every later full run, locally and
  on CI. The spec captures the process output, so the error's text was not kept. **The cause is not known**, and
  it is not attributed to the machine's load. Two mechanisms the code makes possible, neither proved to be the one:
  1. *Another spec file's rows.* A branch-layer list (`linesPage`, `tasks`) reads every account's rows; Prisma
     reads a relation in a second statement, and a row another spec file deleted between the two makes the
     relation null where the type says it is not. Spec files share the database and clean up after themselves.
  2. *A transaction's limits.* `UnitOfWork.runTx` uses Prisma's defaults (2 s to start, 5 s to finish). A later
     loaded run did fail elsewhere with "A query cannot be executed on an expired transaction … 5000 ms".
  To settle it: have the spec keep the first error line it captures when a status is not the expected one, and
  run the suite repeatedly. Not done here: it is outside slice S.12a and blocks neither it nor CI.
- **Seen 2026-11-14 (slice R.1); what failed is known, why it was slow is not proved:** in one full local run,
  `provider-dispatch.db.spec.ts` › "messages delivered again … by workers at once" got about ten rejected
  settlements, each `JobFailure: provider-operation job failed: P2028`. P2028 is Prisma's "a transaction could not
  be started in time": the test fires thirty settlements of three operations at once, they queue on the same task
  and operation rows, and a transaction that waits longer than `runTx`'s default 2 s to start is refused. The file
  took 156.8 s in that run against 24.7 s alone; it passed alone three times and in the next full run (132 files,
  1722 tests). So mechanism 2 above happens: Prisma's own code says a start limit was passed. Why the transactions
  waited that long in that run is **not proved**: the machine's load was not recorded during it, and the other
  spec files running beside it on the same database (their rows, their locks) are as likely. What it is in
  production: a settlement refused this way
  is a failed job that changed nothing, and the sweeper applies the verdict on its next round; what it is in the
  suite: a concurrency test whose result depends on the machine's speed. Not changed in R.1 (a rename with no
  run-time effect); a fix would be its own decision (a longer `maxWait` for `runTx`, or fewer settlements at once
  in the test), taken only after the failure is understood. If it fails on CI: read the Prisma message, the
  file's time and which rows were locked before changing anything.
- **Seen 2026-11-14 (corrections to slice R.2), cause not settled:** one full local run (137 files) failed three
  tests, each in a file that ran 4 to 10 times slower than alone: `actor.interceptor.spec.ts` "answers 401 …" passed
  its 5 s test limit (22.9 s for the file, 2.1 s alone); `provider-decisions.db.spec.ts` "pages through more than two
  hundred waiting operations" read 238 waiting decisions where its two reads agreed on 237 (83 s, 18.7 s alone);
  `provider-dispatch.db.spec.ts` "the pass over waiting operations is fair" sent `[100, 49, 1]` over three rounds
  where it expects `[100, 50, 0]` (163 s, 23 s alone): one operation of its own waited one round longer, and the
  log kept no line saying why. All three passed alone, with the machine's load at 19, and the next full run passed
  (137 files, 1757 tests). None of them runs the code that change touched (the CSV writer, closing the notice
  writer, the timers' stop). Not attributed to load. To settle: keep the pass's warning in that spec's captured
  output, and repeat the full suite.
- **Seen 2026-11-14 (slice R.2.1), cause not settled:** one full local Playwright run (241 tests, after a green
  full `test:api` of 138 files and 1763 tests) failed `tools-pages.spec.ts` › "the list menu and the line card come
  from the same rules": the line card page `/numbers/[id]` showed the shell with an empty `main`, `.line-number`
  never appeared, and the test passed its 30 s limit (37.6 s). The file passed alone right after (18 tests, that
  test in 6.0 s). R.2.1 changes no web file (only the worker's stop). Not attributed to load or to the dev
  server's first compile of the page: neither was recorded. To settle: keep the trace (`test-results/…/trace.zip`)
  of the next failure and read which request the page was waiting on.
- **Seen 2026-11-14 (slice R.8), cause not settled:** in one full local run (138 files, load 3.3 before and 10.6
  after) `platform/ports.db.spec.ts` failed all ten tests: its `beforeAll` (a new Prisma client and six inserts, no
  Nest) passed Jest's 5 s hook limit. It passed alone right after (10/10). R.8 changed no file it runs (the unit of
  work, the notice writer, the activity recorder). Not attributed to load: the database's locks and connections
  were not recorded during the run. To settle: log the time of each insert in that hook on the next failure.
  **Seen again in the R.9 full run** (ten tests, hook timeouts, the file 41.4 s; load 2.6 before, 8.7 after). Not
  reproduced beside the heavy database specs (seven files, 39 tests green). It began after R.8, which moved many
  files: Jest orders files by the durations it cached under their old paths, so the order of the run changed;
  whether that is the cause is not proved.
- **Seen 2026-11-16 (slice R.12), cause not settled:** in a local batch of 42 spec files,
  `provider-dispatch.db.spec.ts` › "forty rounds of a pause against a dispatch, at once: the request went before the
  pause was committed, or it never went" failed once (the file 185.6 s; 35.5 s alone). The assertion's text was not
  kept. The file passed alone and the same batch passed whole on the next run (936 tests). R.12 changes import paths
  only. To settle: keep the full output of the next failure and read which of the two outcomes the round broke.
- **Settled 2026-11-16: "forty rounds of a pause against a dispatch" (`provider-dispatch.db.spec.ts`).** A third
  failure, in a batch of 80 files with its output kept, gave the text: `expect(operationId).not.toBe('')` at the
  start of a round, the file at 264 s. `sell()` answers an empty operation id when the sale took the manual route.
  The spec's worker has no timer and attested once; an attestation lasts `READY_TTL_MS` (60 s); alone the forty
  rounds fit in it (the file runs in 35 s), beside other files they do not, and a sale made after it ran out is not
  dispatched. The test now attests each round, as the thirty-rounds test beside it already did, and its assertion
  names the round and the route. Not a product defect: a worker in production attests every 20 s.
- **Also removed that day, a second way one file changed another's rows:** `operation-dispatcher.db.spec.ts` ran
  `recoverExpired` over every expired attempt in the shared database, with no gate; `provider-dispatch.db.spec.ts`
  claims attempts in the past on purpose. The dispatcher spec now recovers its own provider's attempts only, and the
  pass itself is tested on a stand-in. Whether this ever caused a failure is not known ("the pass is fair",
  `[100, 49, 1]`, is still unexplained). `UnitOfWork` now states its limits (10 s to start, 15 s to run), so
  mechanism 2 of the first note (`P2028` after 2 s of waiting) needs five times the wait to happen.
- **Seen 2026-11-16, cause not settled:** one run of the 19 spec files of `modules/auth` failed 15 tests in 7
  files: 14 passed Jest's 5 s limit and one TOTP code had left its window before the slow sign-in that used it;
  the files took 61 to 119 s. The load was 34 right after the run and was not measured before it. The same run
  again, with the load measured (17 before, 22 during, 27 after): 172 passed in 66 s. Not attributed to load: the
  first run's load was not recorded. No limit was raised.
- Related, also open: some spec files run a pass over every operation in the shared database
  (`settlement.applyPending`, `recoverExpired`), which can act on another file's rows. `provider-dispatch.db.spec.ts`
  no longer does, and judges a settlement by the row.

- **S.12b is blocked on provider documents (2026-11-13).** Discovery
  (`docs/superpowers/specs/2026-11-13-first-provider-adapter-discovery.md`): none of the provider codes (`sky`,
  `lian`, `aren`, `quickline`, `alloha`, `neod`, `tokman`) has an API document in the repository. Needed from the
  owner: one provider's document, sandbox access, and answers to P1–P14 of the spec. People's decisions on an unknown
  operation exist (S.9); only the automatic status inquiry is missing, and it waits for the provider's contract.

## Settled on 2026-11-10

- «سكاي» is both a provider and a network (a company) of the same name: the seed is right as it is.
- `PUT /branding` from an entered session: covered by `branding.http.spec.ts`.
- `session-and-secret-storage` T.3, T.5 and S.7: done (see that plan).
