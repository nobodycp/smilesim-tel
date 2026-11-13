# Activation through a provider — plan

Spec: `docs/superpowers/specs/2026-11-10-activation-settlement.md` (decisions D1–D19, transactions T1–T11, specs
1–29). ADR 0019 (accepted). **S.1–S.4, S.5a, S.5b and S.5c (web and API) are built; each later slice starts on the owner's word.** Paths under `apps/api/`
unless said. Operations beside this plan, not part of it and not a prerequisite for any slice from S.5c to S.12:
backup and restore to Cloudflare R2 is ready in code and not enabled in operation (`docs/operations/backup-and-restore.md`). Each slice is one commit, leaves every existing spec green on CI (including the PostgreSQL and Redis
job), and changes nothing a user can see unless it says **Visible**.

Every slice that writes follows the spec's lock order: task → line → advisory keys (serial, number) → operation →
wallets (sorted). A slice's review checks that order in the code it adds.

## Slices

- [x] **S.0 Decisions.** O1–O6 and the final review; spec sections 9 and 10.

- [x] **S.1 Schema (additive, nothing reads it).** Migration `20261110190000_activation_settlement_schema`.
  `ProviderOperation`: `taskId` (FK `RESTRICT`, **unique**), `appliedAt`, `applyError`, `applyFailedAt`,
  `resultMsisdn`, `resultIccid`, `resultEsimCode` (sealed or refused). `OfficeTask`: `requestKey` (unique),
  `requestHash`. `Provider`: `dispatchApprovedAt`, `dispatchApprovedByLoginName`, `dispatchPausedAt`. New
  `ProviderDecisionEvent` (unique `(operationId, sequence)`; CHECKs on type, decision, evidence, note, reference;
  triggers refusing `UPDATE`, `DELETE` and `TRUNCATE`) and `ProviderCredential` (unique `(providerId, target)`;
  sealed or refused).
  *Transactions:* none. *Specs:* `providers/operations/settlement-schema.db.spec.ts` (spec items 5 and 22, and the
  constraints). *Verified by hand on a fresh database:* the 55 earlier migrations, rows in nine tables, then this
  migration: every existing column of every row identical, the new columns empty. `prisma migrate diff` empty.
  Item 22's last part is closed in S.9: the purge is `purgeActivity` (`activity/activity-log.ts`), which names
  `ActivityEvent` only, and `provider-decisions.db.spec.ts` runs it over decision events.

- [x] **S.2 Reservation in the database (O1). Visible.** Migration `20261110200000_open_activation_reservations`.
  - **Rules** (`lines/reservation.rules.ts`, pure): what a claim locks and in which order (`claimKeys`), who
    reserves (`reserves`), the refusal (`refusalOf`), what a completion takes (`completionClaim`).
  - **Under the locks** (`lines/line-state.ts`): `lockClaim`, `assertClaimFree` (a serial on a live line or
    reserved by an open activation task; a number on any line or reserved by one); `assertSimFree` is now that
    check for a serial.
  - **Opening** (`tasks/tasks.service.ts` `openTask`, `tasks.repository.ts` `insertTask`): for an activation, keys
    → check → the task inserted `ON CONFLICT DO NOTHING` → the hold. For every task the row is now written before
    the hold, in the same transaction.
  - **Other writers**: direct activation and number change (`lines/lines.service.ts`), completion
    (`lines/task-completion.ts`: the keys a handler needs are locked before the hold is released, so the order is
    task → line → keys → wallet; an activation with no number is given one there), `LinePricing.freshMsisdn`
    (skips a reserved number).
  - **Before a deploy**: `npm run reservation-conflicts --workspace api` (read-only; exit 0 none, 1 conflicts,
    2 the report could not be made). It names the tasks by id and shows a serial or a number by its last four
    characters; a failure is a code, never the driver's message.
  - **The migration is one statement** (a single `DO` block: lock, check, both indexes), so it is atomic by
    PostgreSQL's rule and not by the runner's. Measured on Prisma Migrate 7.10.1, through `prisma migrate deploy`
    on throwaway databases: two plain `CREATE INDEX` statements kept the first index when the second failed; the
    first version of this file (a `DO` check followed by two plain statements) was rolled back as a whole, which
    Prisma does not promise; the single block leaves nothing in either case. It takes
    `LOCK TABLE "OfficeTask" IN SHARE ROW EXCLUSIVE MODE` for its duration (no task can open between the check
    and the indexes; reads go on) with a 30 s `lock_timeout`: a timeout fails the migration with nothing changed.
    Its message, which lands in deploy logs, shows the last four characters of a serial or a number.
  - **The file was changed after it had been applied** on the local development and test databases and on CI's
    throwaway ones (never on staging or production). Measured on a throwaway database: `prisma migrate deploy`
    and `prisma migrate status` do not compare an applied migration's checksum (both answer "up to date", and a
    later migration applies); only `prisma migrate dev` does, and it stops asking for a reset without doing one.
    The two versions create the same two indexes (`pg_get_indexdef` identical), so a database that ran the first
    version is in the same state as one that runs the second. No `_prisma_migrations` row was touched and no
    `migrate resolve` was run on any existing database. The project applies migrations with `migrate deploy`
    (`scripts/dev-local.sh`, the image's start command, CI); someone who runs `migrate dev` on a database that has
    the first version will be told to reset it.
  - **If a deploy does stop on conflicts** (exercised on a throwaway database): the tasks and wallets are
    untouched and no index exists; `prisma migrate deploy` reports `P3018` and from then on `P3009` until the
    failed attempt is cleared. After the branch has closed the extra tasks:
    `npx prisma migrate resolve --rolled-back 20261110200000_open_activation_reservations`, then deploy again.
    `resolve` only marks the failed attempt in `_prisma_migrations`; it is safe here because the failed attempt
    changed nothing.
  - *Transactions:* T1 (without the operation), T8. *Specs:* `lines/activation-reservation.db.spec.ts` (spec items
    1–3 and the rest of the owner's list for this slice), `lines/reservation.rules.spec.ts`.
  - **Visible, on the manual path:** a second activation for a card or a number that an open activation task
    holds is refused when it is opened (`409 SIM_TAKEN` / `NUMBER_TAKEN`) instead of failing when the branch
    completes it; an activation for a card that a live line holds is refused when it is opened, not at completion;
    a SIM swap, an eSIM issue or a number change onto a reserved card or number is refused.
  - **Not reserved (unchanged):** a SIM-swap, eSIM or rename task names what it will take and takes it at
    completion; a serial among live lines stays the advisory-lock rule.

- [x] **S.3 Rules (pure).** No Nest, no Prisma, no HTTP; nothing calls them yet.
  - `src/modules/office/lines/activation-settlement.rules.ts`: `phaseOf` (none, requested, pending, unknown,
    unapplied, exception, applied, failed), `operationKey(taskId)` (`activate:<taskId>`), `taskActions(operation)`
    (the table of D6; cancel is `allowed`, `abandons-operation` or `refused`), `inFlight`, `settlementOf`
    (`none`, `wait`, `apply`, `hand-to-branch`, `await-decision`, `settled`), `sweepable`, and
    `decisionStep(events, actor, request)` with `needsSecondAccount`, `openProposal` and the closed lists the
    database also holds (`DECISIONS`, `EVIDENCE_KINDS`, `DECISION_EVENT_TYPES`, `APPLY_ERRORS`,
    `MIN_DECISION_NOTE`).
  - `providers/operations/provider-operation.rules.ts`: a `confirmed` evidence, outcome and verdict may carry an
    `ActivationResult` (number, serial, eSIM code); `afterAttempt` answers it as a `StoredResult` through
    `storedResult` (digits only, trimmed, bounded; a bad part is dropped, never cut). **It is not written
    anywhere yet**: S.5 seals the code and S.8 stores the result.
  - *Specs:* `lines/activation-settlement.rules.spec.ts` (every row of D6, every rule of D15, and that the lists
    equal the migration's CHECK lists), `provider-operation.rules.spec.ts`.
  - **As D15 says, with nothing added** (corrected after the owner's review: a first version let the proposer
    withdraw their own proposal; that is removed): a proposal is answered only by **another** authorised account,
    which approves or refuses it; the account that made it does neither. An open proposal blocks every other
    decision *by a person* on the operation, until it is refused.
  - **The provider's own answer is never held back by a proposal.** `ProviderOperationsService.settle` reads no
    decision event; `settlement-schema.db.spec.ts` shows a late `confirmed` or `refused` for the same attempt
    recorded while a failure proposal is open (ADR 0018).
  - **A stale proposal cannot be approved.** Once the operation has left the state the proposal was made about,
    an approval is `not-applicable`, so it moves no money; another account can only refuse it, which has no
    effect. The unit spec checks every proposal against every state.
  - What an activation "hands back when the provider chose it" is checked by the service of S.9, which knows the
    provider; the rule checks the evidence kind, the note and the reference.
  - Also in this commit: the report's PostgreSQL test moved to `src/reservation-conflicts.db.spec.ts`, so the CI
    job that has a database runs it.

- [x] **S.4 Ledger `capture` (O2). Visible.**
  - `wallets/wallet-ledger.ts` `capture(tx, userId, held, amount, actorId, kind, note, sale)`: locks the wallet,
    refuses (`409`, nothing changed) when it holds less than `held`, gives the hold back and posts the debit, with
    **no** ceiling check. Only for a debit the hold covers whole. `move` and `capture` end in one private `post`,
    so the balance, the below-zero notice, the entry and its price ladder are written by the same code; `capture`
    writes the `release` entry and then the sale entry, the rows a release and a debit wrote before.
  - `lines/task-charge.rules.ts` (pure) `taskCharge(task)`: `capture` for a debit fixed at opening that the task
    holds exactly (activation, extension, charge, reactivation, eSIM request, add-on); `own` for a disconnect and a
    switch (see below; a switch became `requote`), which post an amount worked out at completion; `none`; `debit` for a debit with no hold of that size
    (a task opened before holds existed), released and debited with the ceiling check as before.
  - `lines/task-completion.ts`: the hold is no longer released before the handler when it will be captured; the
    capture runs after the handler, so the order is task → line → keys → wallet.
  - *Transactions:* T8. *Specs:* `wallets/wallet-capture.db.spec.ts` (spec items 17 and 18, a failed line
    creation, the same ledger rows as before, mixed operations, no deadlock), `lines/task-charge.rules.spec.ts`.
  - **Visible:** a ceiling lowered after a task opened no longer blocks its completion.
  - **A package switch is re-quoted at completion, on purpose** (owner, 2026-11-10: the value of the days left
    changes while the task waits, and a task may wait a week; fixing the difference at opening was considered and
    withdrawn the same day). What changed is how that amount of the day meets the hold taken at opening, in the
    same transaction:
    - `taskCharge` answers `requote` for a switch; its hold is kept for the handler, which settles through
      `requotedSettlement(held, amount)`.
    - **Owed today, up to the hold:** captured, no ceiling check; what the hold has beyond it goes back.
    - **Owed today, more than the hold:** only the increase is checked, against what the wallet can spend with
      this task's hold still counted as held (`rules/prices.ts` `uncoveredDebit`). If it does not fit:
      `400 BALANCE_CEILING`, and the completion rolls back whole, so the line stays on its package and the task
      stays open with its hold.
    - **Nothing owed, or money back:** the hold is given back whole; a credit is posted as before; no capture.
    - `capture` therefore takes a hold and a debit of any two sizes (a hold of 0 is a plain checked debit).
    - **The rule covers a disconnect too** (owner, adopted 2026-11-10; `docs/project-plan.md` of that date,
      rule 1.5 of `backend-engineering.mdc`): its refund is the refund of the day it is carried out. The code
      already worked that way (the refund is worked out in the completion's transaction, it is a credit, the task
      holds nothing), so nothing changed there; the specs now pin it: tasks completed 0, 3, 12 and 25 days late
      refund 2,850, 2,550, 1,650 and 350, the same as a disconnect applied at once on that day, once, and rolled
      back whole on a failure. A switch delayed the same way charges 2,900, 2,600, 1,700 and 400.
    - Operations with a fixed price are untouched: a renewal task completed twenty days late, after its price
      changed, still charges the price it opened at.
    - Provider cost, the price ladder and the amount itself are computed exactly as before; a spec compares a
      switch completed from a task with one applied at once on the same day, field by field.
    - *Specs:* `lines/execution-date-settlement.db.spec.ts`, `wallets/wallet-capture.db.spec.ts`,
      `lines/task-charge.rules.spec.ts`.
  - **Found while reading the completion paths, not changed here** (the owner reviews them separately):
    1. **A plain (non-eSIM) activation stores no `providerCost` on its wallet entry** (`rules/prices.ts`
       `activationProviderCost` answers a cost only for an eSIM), on the direct route and on the task route. The
       provider reports then price it from today's package, against rule 1.6.
    2. A renewal task (extend, charge, reactivate) stores no `unitPrice`; its charge is its `posDelta`, which is
       fixed at opening, so the amount is right; only the column is empty.

- [ ] **S.5 eSIM data (D17). Visible. Three steps, each its own commit and deploy, in this order; a step is not
  deployed before the one above it is live everywhere.**

  **The inventory (made 2026-11-10, before S.5a).** Where an eSIM code is read, and from which answer:

  | Consumer | Reads | From |
  |---|---|---|
  | `apps/web/features/lines/screens/numbers-screen.tsx` (the line list: `SimBadge`, `EsimDialog`) | `LineRow.esimQr` | **`GET /office/lines` rows** |
  | `apps/web/features/lines/screens/line-card-screen.tsx` (`EsimDialog`, the QR button) | `line.esimQr` | `GET /office/lines/:id` |
  | `apps/web/features/tasks/screens/task-ticket-screen.tsx` (`EsimMark`, `EsimDialog`) | `TaskDetail.esimQr` | `GET /office/tasks/:id` |
  | `apps/web/components/activation-result.tsx` (`QrTile`) | `IssuedLine.esimQr` | the answer of `POST /office/lines` when the line is made at once |
  | `apps/web/components/esim-qr.tsx` | whatever the screen hands it | — |
  | `apps/web/lib/api-types.ts` | `LineRow`, `IssuedLine`, `TaskDetail` | the three types above |

  The task **list** does not carry the code. On the API the code is answered in four places: `LineReads.list`,
  `LineReads.detail`, `TasksService.detail` (the line's code once the task has a line, else the task's own) and
  `LinesService.activate`'s answer. It is written by `createLine`, `setLineSim` and `openTask` (a SIM-swap task
  carries the QR it was given). `TaskCompletion` copies a task's stored code onto the line without reading it.
  `ProviderOperation.resultEsimCode` has no reader and no writer yet.
  **For S.5c this means one screen, the line list, takes the code from a list row**; it is the one that must move
  to the detail before the API stops sending the code in lists.

  - [x] **S.5a Read both, write as before (no visible change).**
    `shared/secret-box.ts` `tryOpen` (never throws: the value, or `no-key` / `unreadable`; `open` now also refuses
    a sealed value that is not exactly the three parts `seal` writes); `lines/esim-code.ts` `readEsimCode`
    (`{ code }`, `null` only when the record has none, or `{ unreadable }`). A code stored as written is
    answered as it is; a sealed one is opened. A sealed one that cannot be opened is logged once with the record
    and a reason code, never the stored text, the key or the cipher's error, and then (owner's correction):
    the **line list** answers `null` for that row only (`listedEsimCode`); the **line detail and the task
    detail** refuse with `500 ESIM_CODE_UNREADABLE` (`esimCodeOrFail`), never "no code"; the **answer of an
    activation made at once** carries the code issued in memory and never reads the stored value back, so
    nothing fails after the money is taken. Reading writes nothing. Writes are unchanged and still clear;
    `TaskCompletion` still copies the stored value as it is, so a sealed value stays sealed when it moves from a
    task to its line. `ProviderOperation.resultEsimCode` gets its reader with the code that stores it (S.8).
    *Specs:* `lines/esim-code-read.db.spec.ts` (clear, sealed, damaged, no key, another key, through the list, the
    two details and a task on a line; null against refusal; an activation at once whose stored code does not
    open: answered with its code, charged once; stored values unchanged; nothing of a code in the output or in
    the refusal), `shared/secret-box.spec.ts` (everything sealed opens, authenticator secrets included). Answer
    shapes are unchanged for readable codes (`response-shape.spec.ts`, `routes.http.spec.ts`).
    **Open replacing tasks (owner's rule, 2026-11-12):** an open `sim` or `esim` task on a line shows the SIM it
    hands over, never the one it replaces (`TasksService.shownSim`): a SIM change answers the task's own serial,
    kind and code (`null` when it carries none), a new eSIM answers no code. The line's old code is not read, so
    an unreadable one does not close the task; the permission checks are untouched. The task's own code is read
    with `esimCodeOrFail`, in the detail and again in `TaskCompletion.handedBack` before anything is written or
    charged, so a new code that does not open is refused; a code given at completion takes its place. Every
    other task with a line, and a closed replacing task, answers the line's SIM only (a code a cancelled or
    rejected task carried is not shown beside the line's); a task with no line answers its own.
    **For S.5b:** seal before the transaction and check that the sealed value opens to the code, so a sealing
    fault refuses the sale before any money moves.
  - [x] **S.5b Seal on write, then backfill (built; the backfill has been run on no real data).**
    **Where a code is written (inventory, before the change).** Three repository writes, six callers:
    | Stored by | Reached from | The code comes from |
    |---|---|---|
    | `LinesRepository.createLine` | `LinesService.activate` (made at once) | issued here (`renderEsimQr`) after the provider's answer |
    | `LinesRepository.createLine` | `TaskCompletion.activate` | the handler's attachment at completion, else the task's stored code |
    | `LinesRepository.setLineSim` | `LinesService.swapSim` (made at once) | the request (`readQr`) |
    | `LinesRepository.setLineSim` | `TaskCompletion.swapSim` | the handler's attachment, else the task's stored code |
    | `LinesRepository.setLineSim` | `TaskCompletion.issueEsim` | the handler's attachment (required) |
    | `TasksRepository.insertTask` | `TasksService.openTask` from `LinesService.swapSim` (waits for the branch) | the request |
    Nothing else writes `Line.esimQr` or `OfficeTask.esimQr`; `ProviderOperation.resultEsimCode` still has no
    writer (S.8) and its CHECK already refuses a value that is not sealed.
    **As built.** `lines/esim-code.ts` `storableEsimCode`: seals a code and opens the sealed value again, and
    answers it only when it reads back as the code; a value that is already sealed (a task's code handed to its
    line) is kept as it is when it opens and refused (`ESIM_CODE_UNREADABLE`) when it does not; with no valid
    `SECRETS_KEY`, or a sealing that does not read back, the request is refused with `500 ESIM_CODE_UNSEALABLE`.
    It is called by the services **before the transaction**: `swapSim` before the provider is asked,
    `TaskCompletion.handedBack` before the task is claimed, `activate` after the code is issued and before the
    line and the charge; `activate` also checks the key **before the provider is asked**
    (`assertCanSealEsimCode`), since its code exists only after the answer. The three repository writes call
    `assertStoredSealed` and throw on a code that is not sealed, so a path that forgets to seal rolls its
    transaction back instead of storing the code as written. The answer of an activation made at once is still
    the code issued in memory. Answers and screens are unchanged; `scripts/dev-local.sh` gives the local copy a
    key of its own, because without one an eSIM is now refused.
    *Specs (PostgreSQL):* `lines/esim-code-write.db.spec.ts` (each of the paths above; a sealed task code
    handed on byte for byte; a clear one sealed at completion; no key, a short key, a key that is not one, and a
    sealing that fails in three ways: nothing stored, no line, no charge, no hold; an unsealed code at the
    repository rolls back; old and new codes read side by side; nothing of a code in the output).
    **The backfill.** `src/seal-secrets.ts` (the command, with `--dry-run`) and `src/seal-esim-codes.ts`: `src/seal-secrets.ts` gains the
    two columns:
    - **safe:** it seals only values that are not sealed already (`isSealed`), never opens or rewrites one that
      is, and refuses to start without a valid `SECRETS_KEY`;
    - **restartable:** it works in batches by primary key, each batch its own transaction with a guarded write
      (`WHERE id = … AND "esimQr" = <the clear value read>`), so a row changed meanwhile is skipped and picked up
      on the next run; stopping it at any point leaves a mix that S.5a already reads; running it again does only
      what is left and reports how many it sealed and how many it skipped;
    - **checked:** it ends by counting clear values left (0 expected) and a `--dry-run` prints the counts and
      changes nothing.
    It is run by the owner on each deployment (as for authenticator secrets), never at boot. Only after it
    reports 0 may a later slice add a CHECK that `esimQr` is sealed. The writes are raw, so nothing but the code
    changes (a task's `updatedAt` stays). Exit code 0 done, 1 codes still clear (run it again), 2 could not run.
    `--dry-run` counts the eSIM codes and changes nothing (it does not count authenticator secrets).
    **Order on a deployment:** set `SECRETS_KEY` (already required in production) → deploy this code →
    `npm run seal-secrets --workspace api -- --dry-run` → `npm run seal-secrets --workspace api` → again until it
    reports 0.
    *Specs (PostgreSQL):* `src/seal-esim-codes.db.spec.ts`: a run seals every clear value and leaves sealed ones
    (one of them unreadable) byte-identical; a second run changes nothing; a run interrupted half-way and run
    again ends the same; a row updated during the run is not overwritten and is sealed by the next run; a dry
    run writes nothing; without a valid `SECRETS_KEY` it stops before reading; its lines carry counts only.
    `src/seal-esim-codes-all.db.spec.ts` runs it with no `posId`, as the command does, in a database of its own
    (`<test database>_seal`, kept between runs: creating and dropping one each run stalled the other PostgreSQL
    specs): three points of sale, clear, sealed, damaged and empty codes, open and closed tasks; every column
    but the code, and every other table, unchanged; two runs at once; the command itself with `--dry-run` and
    without.
    **Closing review:** `LinesRepository.recordTaskResult` and `line-state.ts` `moveLineStatus` take any column
    of a task or a line; neither writes a code today, and both now call `assertStoredSealed` too.
  - **S.5c The response (the only step users can see), web first.**
    1. **Web, deployed first (built; the API step is not started):** every screen reads the code from a
       **detail** response (or asks for the detail when it needs the code). This works against the API as it is
       today, because the detail already carries the field.
       *As built.* The numbers list (`features/lines/screens/numbers-screen.tsx`) was the only screen that read
       `esimQr` from a list row. It now shows SIM / eSIM from the row's `esim` alone; pressing the eSIM badge
       asks `GET /office/lines/:id` for that line, and the dialog opens only on an answer for that same line
       that carries a code. No code: a note, no empty dialog. A refusal: its message. Another line chosen
       meanwhile, or the dialog closed: the late answer is dropped. The code is held in the screen's own state
       only, never in the shared query cache, the address or storage, and is dropped when the dialog closes.
       The line page and the task page ask with `fresh`, so their answers leave the shared cache when the page
       closes. `LineDetail` is the type a screen reads the code from; `LineRow.esimQr` stays declared as the API
       answers it, and becomes optional with the API step (the guard `response-shape.spec.ts` ties the two).
       | Reads the code | From |
       |---|---|
       | numbers list (`numbers-screen.tsx`) | `GET /office/lines/:id`, on demand |
       | line page (`line-card-screen.tsx`, `line-details.tsx`) | `GET /office/lines/:id` |
       | task page (`task-ticket-screen.tsx`) | `GET /office/tasks/:id` |
       | activation result (`components/activation-result.tsx`) | the answer of `POST /office/lines` |
       The other users of `GET /office/lines` (the user page's numbers, a package's numbers, the numbers
       report, the shell search) never read the code.
       *Specs:* e2e `tests/numbers-esim-code.spec.ts`, served list rows **without** `esimQr`.
    2. **API, deployed after the web is live (built; not deployed):** `esimQr` leaves `GET /office/lines` rows
       (the task list never carried it); the line and task detail return it only to the line's point of sale,
       its ancestors and the branch, and record the read.
       *As built.* `LineReads.list` answers no `esimQr` key and no longer opens a stored code
       (`listedEsimCode` is gone). `tasks/task-access.ts` `esimCodeReaders(posId, accounts)` is the one rule of
       who is handed a code: the point of sale, the accounts above it on its own path, the branch. The line
       detail applies it (today everyone who can read a line's detail is one of them); the task detail applies
       it too, where it is narrower than who reads the task: an account that only opened the task and is no
       longer above the point of sale reads the task with `esimQr: null`, and the code is not opened for it.
       **The record (`line.esim_read`):** the activity action `esim_read`, written by the two controllers
       through `ActivityRecorder.recordOfficeOrFail` **before** the answer leaves and only when the answer
       carries a code: subject `line` + the line (stored as its number) from the line detail, `task` + the task
       id from the task detail; the actor, the address and the time as every activity event has them; never the
       code. If the event cannot be written the request answers 500 and no code. A detail with no code, a
       refusal and a list write none. `LineRow.esimQr` leaves the web's type; `LineDetail` keeps it.
       *Specs:* `lines/esim-code-access.db.spec.ts` (items 23 and 24, over HTTP on PostgreSQL),
       `response-shape.spec.ts`, `office-routes.ts` (the two reads write an event only with a code).
       **Before it is deployed:** every browser must be on the web of step 1. A web older than that reads the
       code from the list row and would show every eSIM as having none. The services change together, in the
       window of `docs/operations/2026-11-12-coolify-upgrade-preparation.md`, where everyone signs in again.
    3. **Never the other way round:** an API without the field under a web that still reads it from the list
       would show lines without their eSIM code. If the web step is reverted, the API step is reverted first.
    *Specs:* 23 (who receives the field, lists never, each read recorded) and 24 (no part of a code in the
    output, the outbox, the queue or the notices).

  *Transactions:* none new. *Roll-back:* S.5c API → S.5c web → S.5b (values stay sealed and readable by S.5a) →
  S.5a only once no sealed value exists.

- [x] **S.6 Request key (O4): API, then web.** Built 2026-11-12 (commit: see `git log --grep 'slice S.6'`).
  API: `Idempotency-Key` honoured by `POST /office/lines` when it opens a task (`requestKey`, `requestHash`, the
  replayed answer). Web (its own web spec first): the activation form creates and sends the key.
  *Transactions:* T1. *Specs:* 4 (without "required").
  As built: ADR 0019 "As built in S.6". Specs: `lines/activation-request-key.db.spec.ts` (item 4 over HTTP, with
  and without the Redis guard), `lines/activation-settlement.rules.spec.ts` (the key and the fingerprint), web
  `tests/activation-request-key.spec.ts`. Final audit: on this route a repeat under the same key waits for the first
  answer instead of `409` (`shared/duplicate-guard.answers.spec.ts`, and the guarded part of the db spec on real Redis). Also closed here: the guard no longer keeps the activation's answer in
  the clear (`@SecretAnswer()`), a gap of S.5c found while adding the key.

- [x] **S.7 Guards on the manual path, and cancel (D6, D7).** Built 2026-11-12 (commit: see `git log --grep 'slice S.7'`).
  Completion and reject lock and read the task's operation and go on only with none or `failed`. Cancel gains the
  atomic `requested → failed (abandoned)` + release, and refuses on `pending`, `unknown`, succeeded-not-applied
  and an exception. All three ask `taskActions`. No task has an operation yet, so nothing changes for users; the
  specs build operations by hand.
  *Transactions:* T8, T9. *Locks:* task → line → keys → operation → wallet. *Specs:* 8–10, 14–16.
  As built: ADR 0019 "As built in S.7"; `tasks/task-operation.ts`, `tasks/task-operation.db.spec.ts` (every state
  against complete, reject and cancel; cancel against claim 60 times; a mixed run with no deadlock). Item 8's T5
  side waits for S.8.

- [x] **S.8 Settlement.** Built 2026-11-12 (commit: see `git log --grep 'slice S.8'`).
  `lines/activation-settlement.ts` (`apply`, `applyPending`, the exception write), reusing the activation handler
  of `TaskCompletion` through one shared function; `settle` writes the `provider-operation.settled` message and
  the result fields; `provider-dispatch.ts` gains the topic, its handler and the sweeper timer.
  *Transactions:* T4 (one more message), T5, T5′, T6, T7. *Locks:* T5 task → keys → operation → wallet.
  *Specs:* 6, 7, 11–13, 24, 27, 29.
  As built: ADR 0019 "As built in S.8". `lines/activation-settlement.db.spec.ts` (items 6, 7, 8, 11, 12, 13, 24,
  27, 29; the queue test on real Redis), the rule specs, and the operations specs for T4. Final review: the
  notices follow D12 (`tellActor`, for the settlement only); the sweeper also announces an unknown answer whose
  message was lost; and **D16 was amended, with the owner's approval of 2026-11-12**: `esim-code-missing`
  (no eSIM line without its activation code), with its own migration
  `20261112120000_apply_error_esim_code_missing` (ten migrations are now pending on the server,
  `docs/operations/2026-11-12-coolify-upgrade-preparation.md` 5.2).

- [x] **S.9 Decisions (O5).** Built 2026-11-12 (commit: see `git log --grep 'slice S.9'`).
  `lines/provider-decisions.ts` (`ProviderDecisions.decide`, `.answer`); `POST /office/tasks/:id/provider-decision`
  (decide: applied at once, or a proposal) and `POST /office/tasks/:id/provider-decision/approval` (the second
  account approves or refuses); zod (`ProviderDecisionBody`, `ProviderDecisionApprovalBody`), activity actions
  `provider_decision` and `provider_decision_approval`, `refuseEntered` + `requireGrant(accounting)` before
  anything is read; `permissions.http.spec.ts` (`ynynnn` for both), `routes.http.spec.ts`,
  `response-shape.spec.ts`; ten refusal codes with ar / en / he copy.
  *Transactions:* T10, T11. *Locks:* task → keys → operation → wallet. *Specs:* 19–22
  (`lines/provider-decisions.db.spec.ts`, over HTTP on PostgreSQL).
  As built: ADR 0019 "As built in S.9". What the slice had to settle, each written there:
  - *apply corrected* on `esim-code-missing` must be given the code (carried over from S.8): without one the
    answer is `400 ESIM_CODE_REQUIRED` and nothing changes; with one it is sealed onto the line, and the event
    says only that a code was supplied.
  - A confirmation whose line cannot be made is recorded as `succeeded` with the exception of D16, not lost.
  - A correction that does not fit (the number or the serial is taken too) changes nothing and writes no
    decision event; the refusal is on the activity record, which keeps the action, the task and the code only.
    Owner's decision (2026-11-12): this stands, no fifth event type, D15 unchanged.
  - **Whose sale it is (final review, owner's decision of 2026-11-12):** *confirm success* and *apply corrected*
    write the wallet entries and `task.done` in the **submitter's** name with «النظام» as the handler (D12),
    through the settlement's own function (`applyAsSettlement`); the account that decided is named in the
    decision event and the activity record only. A first version named the decider on the entry; removed.
  - A code given with a decision must have the form of an activation code (`isActivationCode`).
  - A proposal writes its event and nothing else (T10's table): no notice. The second account learns of it from
    the screens of S.10, which must list open proposals.
  - The handover of a declared failure to the branch (T6: the task's note and the handlers' notice) is the
    settlement's, from the message the approval writes; the task is the branch's from the approval's commit.

- [x] **S.10 The screens (O6). Visible** once a sale records an operation (S.11); until then seen only in specs.
  Built 2026-11-12 (commit: see `git log --grep 'slice S.10'`). Web spec first:
  `docs/superpowers/specs/2026-11-12-provider-operation-screens.md`.
  - **Reads** (API): `GET /office/tasks` rows carry `operationPhase`; `GET /office/tasks/:id` carries
    `operation { phase, reason, decisions }` and `hold`; `canTake`, `canWork` and `canCancel` now follow D6 in
    both, so a screen offers by hand only what the routes accept. New, with the gate of a decision (the owner or
    `accounting`, a session of its own): `GET /office/tasks/:id/provider-decision` (what this account may do now,
    asked of `decisionStep` through `decisionChoices`; what the form must ask for; the open proposal; the record)
    and `GET /office/provider-decisions` (the operations of open tasks that wait for a person). No read carries an
    eSIM code; reads write nothing.
  - **Screens** (web): the operation's panel on the task ticket (`provider-operation-panel.tsx`: phase, what it
    means, what became of the amount, the reason for the branch); the decision form (`decision-dialog.tsx`); the
    open proposal with approve and refuse behind a confirmation (`proposal-card.tsx`); the record; the queue at
    `/tasks/decisions` (`provider-decisions-screen.tsx`), linked from the tasks page with its count; the phase as
    a badge on the tasks list.
  - *Specs:* `provider-decisions.db.spec.ts` (the reads, over HTTP on PostgreSQL), `activation-settlement.rules.spec.ts`
    (`decisionChoices`, `holdOf`, `shownPhase`), `response-shape.spec.ts`, `permissions.http.spec.ts`,
    `tests/provider-operation.spec.ts` (Playwright: every phase, a manual task, the four decisions, approve and
    refuse, each kind of account, a stale proposal, `esim-code-missing`, the code's privacy, a 409, a lost
    connection, phone / tablet / desktop in ar and en, light and dark).
  - **Final review (2026-11-12):** the queue is paged by cursor with no ceiling (a first version served the
    oldest 200 and stopped): `?waiting=approval|decision&cursor=`, fifty a page, newest first by the operation's
    own creation time, `total` and `totals` counted in the database; the screen has two tabs and the project's
    pager. HTTP specs: 230 waiting operations all reached once with a proposal on the newest and on the oldest,
    the walk undisturbed by decisions taken meanwhile; what a point of sale, an account without the grant and an
    entered session are told (the state and the hold, nothing of a decision).
  - Left for later: the queue is not in the side navigation and raises no notice of its own; a proposal still
    tells nobody (S.9), so the second account finds it through the link's count.

- [x] **S.11 Opening.** Built 2026-11-13 (commit: see `git log --grep 'slice S.11'`). No migration.
  - `ProviderGateway.dispatches(providerCode)`. The only gateway the application binds, `SimulatedProviderGateway`,
    answers a constant `false`: no environment variable, setting, row or request field makes it true. The specs'
    `ScriptedGateway` (under `testing/`) takes the providers a spec names.
  - `LinesService.activate`: when the package runs activations automatically **and** the gateway takes its
    provider (D13), the sale goes on the dispatch route. The request's simulation hint is not part of the question.
    The request key is required there (`400 REQUEST_KEY_REQUIRED`); on the manual route it stays optional.
  - **T1** is `TasksService.openTask` with one addition, `alongside(tx, task)`: run inside the opening's
    transaction once the task's row exists, before the hold and the notices, never for a repeated request.
    `activate` passes `ProviderOperationsService.recordIn(tx, 'activate:<taskId>', request, { taskId })`, which
    writes the operation (`requested`, the task's id, unique) and its `provider-operation.requested` message. So
    the reservation, the task, the operation, the message, the hold and the notices commit or roll back together,
    in the lock order keys → (new task) → (new operation) → wallet, and nothing of the reservation or the money
    is written twice. The API calls no provider: the answer is `{ applied: false, taskId }`.
  - *Transactions:* T1 complete. *Specs:* 1 (with the operation), 4 ("required"), 28:
    `lines/activation-dispatch.db.spec.ts` (HTTP on PostgreSQL: T1; the key required, repeated, changed, per
    account, 10 / 30 / 50 at once, with the duplicate guard's store down; a fault at each write and a connection
    cut before the commit; the opened sale through the dispatcher and the settlement over the scripted gateway;
    cancel against claim; everything against everything) and `provider-dispatch-off.spec.ts` (what ships cannot
    take a sale on the route or send one).
  - **Final audit (2026-11-13):** a dispatched task is not announced (`openTask({ announce: false })`): no
    `task.opened` to the branch's handlers for a task they cannot take; T6, T7 and the exception tell who they
    told before, once. `alongside` has one caller and writes through `recordIn(tx, …)` alone; a repeat never
    reaches it (counted in the specs).
  - `dispatches` is false everywhere (S.12a has not landed), so no sale takes the route. **For S.12a:**
    `provider-dispatch-off.spec.ts` must be rewritten with it, and says how at its top: the constant becomes D18's
    four conditions, false unless all four hold; the API still holds no adapter and no credential.

- [ ] **S.12 Switching on, in two parts with a review between them.** (S.12a done; S.12b not started.)
  - **S.12a — built 2026-11-13** (commit: see `git log --grep 'slice S.12a'`), as ADR 0019 "As built in S.12a"
    says. Migration `20261113100000_provider_dispatch_target_and_readiness`. The policy
    (`providers/dispatch/dispatch-policy.ts`), the gate under the provider's row lock (`dispatch-gate.ts`), the
    empty adapter list and the worker's routing gateway, the owner's five routes, the worker's and the API's
    start-up checks, and the worker's attestation that lets the API agree with it. `providerDispatchOn()` is
    gone. *Specs:* 25, 26 (`provider-dispatch-switch.spec.ts`, `provider-dispatch.db.spec.ts`). **No adapter
    exists: nothing can be sent.** The original line of the plan follows.
  - **S.12a final corrections — built 2026-11-13** (commit: see `git log --grep 'S.12a final corrections'`), as
    ADR 0019 "Final corrections of S.12a" says. Migrations `20261113110000_provider_operation_waived_attempts`
    and `20261113120000_provider_dispatch_deployment_and_generation`. An attempt a closed gate hands back keeps
    its number and uses nothing of the budget; the deployment has a name (`DEPLOYMENT_ID`) that approvals and
    attestations carry; a credential has a generation, writing it withdraws the approval and the attestation,
    and a worker rebuilds its adapters from what is stored; the manifest of codes is apart from the worker's
    registry. **For S.12b:** add the adapter's factory to `provider-adapters.ts` and its code to
    `adapter-manifest.ts`, nothing to the API; set `DEPLOYMENT_ID` on the API and the worker of each deployment
    before `PROVIDER_DISPATCH`.
  - **S.12a The switch (D18), no adapter.** `worker.ts` runs the production settings check with the worker's list;
    `PROVIDER_ADAPTERS`, `PROVIDER_TARGET`; `providerDispatchOn()` replaced by the four conditions; the owner's
    approve / pause / credential routes (write-only, sealed, audited); the routing gateway in the worker with an
    empty adapter list. ADR 0016, ADR 0018 and the production-config plan corrected (spec section 10, items 1–3).
    *Specs:* 25, 26.
  - **S.12b The first adapter**, its own spec and review: one provider, the sandbox target, endpoints as constants,
    error mapping to `OPERATION_ERRORS`, the status check feeding `resolveUnknown`. Exercised on a staging
    deployment that is production-grade (`NODE_ENV=production`, `PROVIDER_TARGET=sandbox`, its own database, Redis
    and sandbox credentials).
  - **S.12b.1 Discovery for the first adapter** (2026-11-13; documents only): spec
    `docs/superpowers/specs/2026-11-13-first-provider-adapter-discovery.md`. No provider code has an API document,
    a sandbox, an idempotency rule or an inquiry in the repository, so **S.12b is blocked** until the owner supplies
    one provider's documents. People already close an unknown operation (S.9, `provider-decisions.ts`); what is
    missing is the automatic inquiry (an adapter method and a worker job ending in `resolveUnknown`), which needs
    the provider's contract, and two fields of the activation request (spec section 6).

## Go-live gate: nothing is dispatched to a live provider until all of these are true

1. S.1–S.12a merged and green on CI; S.12b reviewed and green.
2. The web sends the request key and the dispatch route requires it (S.6, S.11) — **O4**.
3. The waiting label, the exception view, the decision form and the approval queue are live (S.9, S.10) — **O5,
   O6**; at least **two** authorised accounts exist on the branch.
4. The reservation indexes exist on the target database and the migration's conflict report was empty (S.2).
5. eSIM codes are sealed on the target database (`seal-secrets` reports 0 clear values left) and `SECRETS_KEY` is
   set on the API and the worker (S.5b); the web reads the code from the detail and was deployed before the API
   stopped sending it in lists (S.5c).
6. The staging run on the sandbox target passed its checklist: success, refusal, timeout → unknown → decision,
   exception, cancel while requested, pause.
7. A written procedure for the branch: an unknown operation, an exception, a provider failure, a pause.
8. On the production deployment, by name: the four settings **together, in one change**, on the API and the
   worker alike (`PROVIDER_DISPATCH=1`, `PROVIDER_ADAPTERS`, `PROVIDER_TARGET=live`, `DEPLOYMENT_ID`; the worker
   also `SECRETS_KEY`) — a production process refuses to start with only some of them; then the live credential;
   then the owner's approval of the provider. Staging having passed sets none of them. (Corrected by the final
   verification of S.12a: the earlier wording set them one at a time, which the start-up check refuses.)
9. **The review conditions before the first adapter runs (S.12b) are closed by slice S.12b.0** (built 2026-11-13;
   commit: see `git log --grep 'S.12b.0'`; ADR 0019 "S.12b.0"; migration
   `20261113130000_provider_worker_attestations`). The final verification of S.12a had found five; each is built
   and tested, with no adapter yet:
   - *Attestation per worker.* One row a worker process (`ProviderWorkerAttestation`); a worker removes its own
     when it stops, and another worker of the deployment keeps the route open.
   - *The pass over waiting operations* walks them by id, a page at a time, and keeps its place between rounds
     (`WaitingPass`): a closed provider's operations, however many, hold nobody else's back.
   - *`SECRETS_KEY` on the worker* is required in production whether or not it dispatches.
   - *Clocks.* An attestation is written with PostgreSQL's `now()` and its age judged by PostgreSQL's clock.
   - *The adapter that sends is the one that was judged at the mark*: the gate answers a permit bound to it, and
     the dispatcher has no other way to a provider.
   - *The settlement's sweeper* (final audit) walks its two lists by id, in pages, each from where it stopped:
     verdicts it cannot act on, however many, hide none behind them.
   **Before deploying this code:** set `SECRETS_KEY` on the worker application itself (the same as the API's):
   on the Coolify deployment of today the worker is a Dockerfile application with its own environment.

## Order and safety

S.1, S.3, S.6 (API), S.7, S.8, S.9, S.11 change nothing visible. S.2, S.4, S.5 change the manual path as decided
and are each reviewed on their own. S.11 can route a sale to the dispatcher only where `dispatches(code)` is true,
which needs S.12a's four conditions, set by hand per deployment. Going back from any slice: revert its commit;
S.1's columns and S.2's indexes can stay.
