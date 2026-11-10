# Activation through a provider — plan

Spec: `docs/superpowers/specs/2026-11-10-activation-settlement.md`. ADR 0019. **Not started.** The owner answered
O1–O6 on 2026-11-10 and agreed the direction; the slices wait for the owner's review of the revised spec. Paths
under `apps/api/` unless said. Each slice is one commit, leaves every existing spec green, and changes nothing a
user can see unless it says so.

## Slices

- [x] **S.0 Decisions.** O1–O6 answered; spec section 9.
- [ ] **S.1 Schema (additive).** `ProviderOperation`: `taskId` (FK, indexed), `appliedAt`, `applyError`,
  `applyFailedAt`, `resultMsisdn`, `resultIccid`, `resultEsimCode`. `OfficeTask`: `requestKey` (unique),
  `requestHash`. New `ProviderVerdict`. Nothing reads them. `prisma migrate diff` empty.
- [ ] **S.2 Reservation in the database (O1).** A migration that lists open activation tasks sharing a serial or
  a number and stops if any exist, then creates the two partial unique indexes. `TasksService.openTask` for
  activations: advisory locks, live-line check, insert `ON CONFLICT DO NOTHING` → `409 SIM_TAKEN` /
  `NUMBER_TAKEN`; line creation checks open activation tasks under the same locks. **Visible change:** a second
  manual task for the same card is refused when it is opened instead of failing when it is completed. Specs 2, 3,
  17, 18.
- [ ] **S.3 Rules.** `src/modules/office/lines/activation-settlement.rules.ts` (pure): `operationKey(taskId, n)`,
  `inFlight(operation)`, `taskMayBe{Completed,Rejected,Cancelled}(operation)`, `settlementOf(operation)`,
  `verdictAllowed(...)`. `provider-operation.rules.ts`: `confirmed` evidence carries the result fields. Specs
  beside them.
- [ ] **S.4 Ledger `capture` (O2).** `wallets/wallet-ledger.ts` `capture`; manual completion
  (`lines/task-completion.ts`) uses it in place of release-then-debit. **Visible change:** a ceiling lowered after
  a task opened no longer blocks its completion. Specs 11, 24 and the existing wallet and line concurrency specs.
- [ ] **S.5 Request key (O4), API side.** `Idempotency-Key` honoured by `POST /office/lines` when it opens a task
  (`requestKey`, `requestHash`, the replayed answer). Spec 19 (without the "required" case).
- [ ] **S.6 Request key, web side.** A web spec first; the activation form creates and sends the key. After it,
  the header can be required.
- [ ] **S.7 Guards on the manual path.** Completion, reject and cancel lock and read the task's operation and
  refuse unless there is none or it is `failed`. No task has an operation yet; specs build one by hand. Specs 6–8,
  10 (cancel while `requested`).
- [ ] **S.8 Settlement.** `lines/activation-settlement.ts` (`apply`, `applyPending`, the exception write T5′),
  reusing the activation handler of `TaskCompletion`; `settle` writes the `provider-operation.settled` message;
  `provider-dispatch.ts` gains the topic, the handler and the sweeper timer. Specs 4, 5, 9, 12–16, 21.
- [ ] **S.9 Verdict and exception (O5).** Policy rows, `POST /office/tasks/:id/provider-verdict` and
  `POST /office/tasks/:id/provider-exception` (zod, activity, `ProviderVerdict`), `permissions.http.spec.ts`,
  `routes.http.spec.ts`, `response-shape.spec.ts`. Specs 22, 23.
- [ ] **S.10 The screens (O6).** A web spec first: the waiting label, the exception state, the verdict form with
  its evidence fields, the copy in ar / en / he. Checked at every width, light and dark.
- [ ] **S.11 Opening.** `ProviderGateway.dispatches(providerCode)` (false in the simulated gateway);
  `LinesService.route()` answers `dispatch`; `activate` opens the task and records the operation in one
  transaction; the request key is required on this route. Specs 1, 19 (required), 20.
- [ ] **S.12 First adapter**, on staging only (`NODE_ENV=staging`, `PROVIDER_DISPATCH=1`), one provider, one
  package. Its own spec: credentials sealed with `SECRETS_KEY`, error mapping to `OPERATION_ERRORS`, the provider's
  status check feeding `resolveUnknown`.

## Go-live gate: nothing dispatches for a real provider until all of these are true

1. S.1–S.11 merged and green on CI, including the PostgreSQL and Redis job.
2. The request key is sent by the web and required on the dispatch route (S.5, S.6, S.11) — **O4**.
3. The waiting label, the exception view and the verdict screen are live (S.9, S.10) — **O5, O6**.
4. The reservation indexes exist on the target database and its conflict report was empty (S.2).
5. A written procedure for the branch: an unknown operation, an exception, a provider failure.
6. The production settings of ADR 0016 are set, and the owner approves the adapter (S.12) by name.

## Order and safety

S.1, S.3, S.5, S.7, S.8 change nothing visible. S.2 and S.4 change the manual path as the owner decided (O1, O2)
and are reviewed on their own. S.11 is the first slice that can route a sale to the dispatcher, and only where
`dispatches(code)` is true, which is nowhere until S.12. Going back from any slice: revert its commit; S.1's
columns and S.2's indexes can stay.
