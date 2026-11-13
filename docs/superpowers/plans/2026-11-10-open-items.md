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
- Related, also open: some spec files run a pass over every operation in the shared database
  (`settlement.applyPending`, `recoverExpired`), which can act on another file's rows. `provider-dispatch.db.spec.ts`
  no longer does, and judges a settlement by the row.

## Settled on 2026-11-10

- «سكاي» is both a provider and a network (a company) of the same name: the seed is right as it is.
- `PUT /branding` from an entered session: covered by `branding.http.spec.ts`.
- `session-and-secret-storage` T.3, T.5 and S.7: done (see that plan).
- **S.12b is blocked on provider documents (2026-11-13).** Discovery
  (`docs/superpowers/specs/2026-11-13-first-provider-adapter-discovery.md`): none of the provider codes (`sky`,
  `lian`, `aren`, `quickline`, `alloha`, `neod`, `tokman`) has an API document in the repository. Needed from the
  owner: one provider's document, sandbox access, and answers to P1–P14 of the spec. Open on our side whatever the
  provider: an inquiry port, an inquiry job and a person's route that closes an unknown operation (`resolveUnknown`
  has no caller outside tests).
