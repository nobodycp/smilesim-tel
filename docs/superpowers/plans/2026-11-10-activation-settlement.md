# Activation through a provider — plan

Spec: `docs/superpowers/specs/2026-11-10-activation-settlement.md` (decisions D1–D19, transactions T1–T11, specs
1–29). ADR 0019 (accepted). **S.1–S.4 and S.5a are built; each later slice starts on the owner's word.** Paths under `apps/api/`
unless said. Each slice is one commit, leaves every existing spec green on CI (including the PostgreSQL and Redis
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
  **Still to do for item 22 in S.9:** that the worker's activity purge leaves the table alone (it does not touch it
  today; the spec belongs with the code that writes events).

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
    **Open replacing tasks (owner's correction, 2026-11-11):** an open `sim` or `esim` task on a line still
    opens when the line's old code is unreadable (`replacedEsimCode`): the old code is logged and not shown, the
    task's own code is answered in its place, and the permission checks are untouched. The task's own code is
    read first with `esimCodeOrFail`, in the detail and again in `TaskCompletion.handedBack` before anything is
    written or charged, so a new code that does not open is refused; a code given at completion takes its place.
    Every other task on such a line, a closed replacing task and the line's detail keep `ESIM_CODE_UNREADABLE`.
    **For S.5b:** seal before the transaction and check that the sealed value opens to the code, so a sealing
    fault refuses the sale before any money moves.
  - **S.5b Seal on write, then backfill.** The same repositories seal on write. `src/seal-secrets.ts` gains the
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
    reports 0 may a later slice add a CHECK that `esimQr` is sealed.
    *Specs (PostgreSQL):* a run seals every clear value and leaves sealed ones byte-identical; a second run
    changes nothing; a run interrupted half-way and run again ends the same; a row updated during the run is not
    overwritten; without `SECRETS_KEY` it stops before writing.
  - **S.5c The response (the only step users can see), web first.**
    1. **Web, deployed first:** every screen found above reads the code from the **detail** response (or asks for
       the detail when it needs the code) and shows nothing, not an error, when a list row has no code. This works
       against the API as it is today, because the detail already carries the field.
    2. **API, deployed after the web is live:** `esimQr` leaves `GET /office/lines` rows and the task list; the
       line and task detail return it only to the line's point of sale, its ancestors and the branch, and record
       `line.esim_read`. `response-shape.spec.ts` and `routes.http.spec.ts` change in the same commit; the web's
       mocks and e2e are updated with the web step.
    3. **Never the other way round:** an API without the field under a web that still reads it from the list
       would show lines without their eSIM code. If the web step is reverted, the API step is reverted first.
    *Specs:* 23 (who receives the field, lists never, each read recorded) and 24 (no part of a code in the
    output, the outbox, the queue or the notices).

  *Transactions:* none new. *Roll-back:* S.5c API → S.5c web → S.5b (values stay sealed and readable by S.5a) →
  S.5a only once no sealed value exists.

- [ ] **S.6 Request key (O4): API, then web.**
  API: `Idempotency-Key` honoured by `POST /office/lines` when it opens a task (`requestKey`, `requestHash`, the
  replayed answer). Web (its own web spec first): the activation form creates and sends the key.
  *Transactions:* T1. *Specs:* 4 (without "required").

- [ ] **S.7 Guards on the manual path, and cancel (D6, D7).**
  Completion and reject lock and read the task's operation and go on only with none or `failed`. Cancel gains the
  atomic `requested → failed (abandoned)` + release, and refuses on `pending`, `unknown`, succeeded-not-applied
  and an exception. All three ask `taskActions`. No task has an operation yet, so nothing changes for users; the
  specs build operations by hand.
  *Transactions:* T8, T9. *Locks:* task → line → keys → operation → wallet. *Specs:* 8–10, 14–16.

- [ ] **S.8 Settlement.**
  `lines/activation-settlement.ts` (`apply`, `applyPending`, the exception write), reusing the activation handler
  of `TaskCompletion` through one shared function; `settle` writes the `provider-operation.settled` message and
  the result fields; `provider-dispatch.ts` gains the topic, its handler and the sweeper timer.
  *Transactions:* T4 (one more message), T5, T5′, T6, T7. *Locks:* T5 task → keys → operation → wallet.
  *Specs:* 6, 7, 11–13, 24, 27, 29.

- [ ] **S.9 Decisions (O5).**
  `lines/provider-decisions.ts`; policy rows; `POST /office/tasks/:id/provider-decision` (propose or decide) and
  `POST /office/tasks/:id/provider-decision/approval` (approve or refuse); zod, activity, `refuseEntered`;
  `permissions.http.spec.ts`, `routes.http.spec.ts`, `response-shape.spec.ts`; error copy in ar / en / he.
  *Transactions:* T10, T11. *Locks:* task → keys → operation → wallet. *Specs:* 19–22.

- [ ] **S.10 The screens (O6). Visible.**
  A web spec first: the waiting label, the exception state, the decision form with its evidence fields, the
  approval queue for the second account, the eSIM code on the detail only. Checked at every width, ar + en, light
  and dark.

- [ ] **S.11 Opening.**
  `ProviderGateway.dispatches(providerCode)`; `LinesService.route()` answers `dispatch`; `activate` opens the task
  and records the operation in one transaction; the request key is required on this route.
  `dispatches` is false everywhere (S.12a has not landed), so no sale takes the route.
  *Transactions:* T1 complete. *Specs:* 1 (with the operation), 4 ("required"), 28.

- [ ] **S.12 Switching on, in two parts with a review between them.**
  - **S.12a The switch (D18), no adapter.** `worker.ts` runs the production settings check with the worker's list;
    `PROVIDER_ADAPTERS`, `PROVIDER_TARGET`; `providerDispatchOn()` replaced by the four conditions; the owner's
    approve / pause / credential routes (write-only, sealed, audited); the routing gateway in the worker with an
    empty adapter list. ADR 0016, ADR 0018 and the production-config plan corrected (spec section 10, items 1–3).
    *Specs:* 25, 26.
  - **S.12b The first adapter**, its own spec and review: one provider, the sandbox target, endpoints as constants,
    error mapping to `OPERATION_ERRORS`, the status check feeding `resolveUnknown`. Exercised on a staging
    deployment that is production-grade (`NODE_ENV=production`, `PROVIDER_TARGET=sandbox`, its own database, Redis
    and sandbox credentials).

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
8. On the production deployment, by name and in this order: `PROVIDER_ADAPTERS`, `PROVIDER_TARGET=live`, the live
   credential, `PROVIDER_DISPATCH=1`, then the owner's approval of the provider. Staging having passed sets none of
   them.

## Order and safety

S.1, S.3, S.6 (API), S.7, S.8, S.9, S.11 change nothing visible. S.2, S.4, S.5 change the manual path as decided
and are each reviewed on their own. S.11 can route a sale to the dispatcher only where `dispatches(code)` is true,
which needs S.12a's four conditions, set by hand per deployment. Going back from any slice: revert its commit;
S.1's columns and S.2's indexes can stay.
