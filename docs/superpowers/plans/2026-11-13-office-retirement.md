# Plan: retiring `office` (ADR 0020)

Audit, target design, renaming table, compatibility and risks:
`docs/architecture/2026-11-13-backend-audit-and-office-refactor-plan.md`. This file is the checklist.

Rules for every slice: behaviour-preserving (same routes, shapes, activity, permissions, SQL); no transaction
body, statement order or lock order is edited (`docs/architecture/financial-invariants.md`); one slice a commit;
lint, typecheck, check:copy, the full API suite with PostgreSQL and Redis, and Playwright green; the baseline only
goes down; the backend map updated in the same commit.

- [x] **R.0 Safety baseline.** Guards that name no folder (`architecture-map.fixture.ts`,
  `architecture-boundaries.spec.ts`), the existing rules widened to every module, the HTTP security contract,
  the worker wiring contract, the financial invariants in one file. No production file changed. Commit: see
  `git log --grep 'R.0'`.
- [ ] **R.1** `OfficeFailure` → `ApiFailure`.
- [ ] **R.2** Auditing and notifications out of the umbrella; the notice writer behind a port of the platform.
- [ ] **R.3** Rules to their owners; the kernel dissolved into platform and access.
- [ ] **R.4** Tasks and sales untangled (`tasks` imports nothing of `sales`). May change how services are composed
  (a port, a provider moved to another module); changes no business rule and no transaction.
- [ ] **R.5** One composition for the worker. May change how the worker is built (a shared factory, or a Nest
  application context); changes no business rule, no transaction, no queue, no job payload.
- [ ] **R.6** Sales (`lines`, settlement, decisions).
- [ ] **R.7** Providers in three folders (directory, account, integration).
- [ ] **R.8** Catalog, pricing, wallets, access, reporting.
- [ ] **R.9** The umbrella goes; public surfaces in force (`module-surface`).
- [ ] **R.10** Prisma models `Task`, `TaskNote` with `@@map`; no migration.
- [ ] **R.A** `auth.controller.ts` thinned; the seven unrecorded writes judged.
- [ ] **W.1, W.2** Web names.
- [ ] **R.11a** The duplicate guard and the path-named middleware rules separated from the prefix.
- [ ] **R.11b** Both paths served; the web moved; old-path hits counted for one release.
- [ ] **R.11c** `/office/*` removed.

Before S.12b: R.0, R.1, R.2, R.3, R.4, R.5, R.7.

## Open from R.0 (not closed, only measured)

| Guard | Count | What it is | Closed by |
|---|---|---|---|
| `module-layering` | 32 | imports the target graph does not allow | R.2–R.8 |
| `module-mutual` | 14 | pairs of modules that import each other | R.2–R.8 |
| `root-domain-code` | 5 | domain code at `src/` root | R.3, R.5 |
| `operation-writes` | 1 | `tasks/task-operation.ts` writes a provider operation | R.4 |
| `transaction-outside-unit-of-work` | 5 | `$transaction` beside `UnitOfWork` | R.3, R.5, R.A |
| `write-without-activity` | 7 | sign-in routes that record nothing | R.A |
| `module-surface` | not in force | no module has a public surface | R.9, module by module |
| unguarded writes | 27 | `auth` and `branding` writes have no duplicate guard (15 of them by the prefix, not by a decision) | R.11a |
| lock order | no guard | written in `financial-invariants.md`, held by the PostgreSQL specs | stays a review rule |
| unused exports | not scanned | no tool for it is installed; none was added in R.0 | a later slice, with the owner's word on the tool |

## End of the project: all of these hold

1. No folder, file, class, type, function or variable named `office` in `apps/api/src` or `apps/web`, except:
   the table names `OfficeTask`, `OfficeTaskNote` and their constraints (behind `@@map`), raw SQL that names
   them, the migration folder `20261030000000_office`, and dated documents (specs, plans, ADRs).
2. No route under `/office/`; the web, its tests and the audits call the new paths only; old-path hits were zero
   for one full release before removal.
3. Every guard of `architecture.spec.ts` and `architecture-boundaries.spec.ts` at 0, `module-surface` in force
   for all twelve modules, and the baseline file holds only zeros.
4. `http-security-contract.spec.ts`: every authenticated write is guarded against duplicates whatever its path,
   or is on a stated list with its reason; every write records its activity or says why not.
5. `routes.http.spec`, `permissions.http.spec` and `response-shape.spec` pass with the new paths and the same
   permissions, events and shapes as before the project.
6. The worker and the API are composed from one description (`worker-wiring.spec.ts` or its successor).
7. `prisma migrate diff` between the database and the schema is empty: the project created no migration.
8. The financial invariants file is true to the code, and every PostgreSQL and concurrency spec of S.1–S.12b.0
   passes unchanged in what it asserts.
9. Full Playwright green in ar and en, light and dark; the visual check of the shell at every width (W.1).
10. The maps (`backend.md`, `frontend.md`), the rules files and the handover documents name no `office` structure.
