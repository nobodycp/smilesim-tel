# 0012 — The office kernel is split; one Nest module and one repository per domain

Date: 2026-11-10. Status: accepted. Spec and plan: `docs/superpowers/{specs,plans}/2026-11-10-office-kernel-split.md`.

## Context

`OfficeKernel` (441 lines) resolved the session, read grants, walked the account tree, ran transactions, wrote the
wallet ledger, priced the ladder and seeded roles. 26 files imported it, so a reader could not tell what a service
depended on. `OfficeModule` listed 18 controllers and 29 providers flat, and services called Prisma directly.

## Decision

1. The kernel became named collaborators: `UnitOfWork`, `ActorResolver`, `AccountTree` (in `office/kernel/`),
   `WalletLedger` (wallets), `PriceLadder` (terms), `LineAccess` (lines), `LayerRoles` (roles). `OfficeKernel` is gone.
2. One Nest module a domain (`<domain>/<domain>.module.ts`), exporting only what another domain uses. No cycles.
3. One repository a domain (`<domain>.repository.ts`): one method a query, taking the client when it may run in a
   transaction; no rule and no permission in it. Since plan backend-loose-ends B.1 there is no exception.
4. Done as a strangler: delegates first, then each domain switched, then the delegates deleted, specs green at
   every commit.

## Consequences

- `architecture.spec.ts` holds the lines: `kernel-use`, `prisma-in-service`, `flat-office-module`,
  `cross-domain-repository-import`, `unused-injection`, all at 0.
- A new domain is a folder with its module, service, repository, schemas and controller; it imports `KernelModule`
  and the modules whose services it calls.
