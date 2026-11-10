# Office kernel split, domain modules, repositories — spec

Follows `docs/superpowers/specs/2026-11-10-backend-hardening.md` (item left open: plan 5.5). Backend only; no route,
response shape, status code or business rule changes. Every slice is behaviour-preserving and proven by the specs
that already exist.

## Why

`OfficeKernel` (441 lines) is one class that resolves the session, reads grants, walks the account tree, runs
transactions, writes the wallet ledger, prices the ladder and seeds roles. 26 production files import it, so every
domain can reach everything, and a new developer cannot tell what a service really depends on. `OfficeModule`
registers 18 controllers and 29 providers in one flat list, and services call Prisma directly (about 250 calls in
23 files), mixing queries with rules.

## Measured starting point (2026-11-10, commit 314d290)

Kernel members and who uses them (count of call sites):

| Member | Used by |
|---|---|
| `prisma` | every service (see repository table in the plan) |
| `runTx` | lines 9, tasks 6, terms 2, transfers 2, wallets 2, task-completion 1, accounts 1, packages 1, offers 1, provider-health 1 |
| `queueNotices` / `publishQuietly` / `notice` | tasks, wallets, transfers, provider-health, task-completion, notice-inbox |
| `actor` | `ActorInterceptor` only |
| `grantsFor` | kernel `actor`, tasks 1 |
| `accounts` | wallets 7, tasks 4, terms 4, accounts 3, transfers 3, line-pricing 3, desk 2, packages 2, line-reads 2, overview 1, audit 1, insights 1, lines 1 |
| `pathOf` | terms 4, transfers 3, line-pricing 3, packages 2, line-reads 2, desk 1, wallets 1, lines 1 |
| `visibleAccount`, `chainIds` | accounts 2, 1 |
| `visibleLine` | lines 10, transfers 1 |
| `move` | lines 5, wallets 4, task-completion 3 |
| `hold` / `release` | tasks 1 / tasks 2, task-completion 1 |
| `recordOp` | lines 6, task-completion 2, transfers 1 |
| `lockWallets` | wallets 2 |
| `termsFor` | terms 5, line-pricing 2, packages 1, lines 1 |
| `ladderRows` / `stampWith` | terms, line-pricing, wallets |
| `ensureLayerRoles` | roles, accounts, catalog-seed |
| `auth` | accounts 5, account-session 4, notice-inbox 1 |

## Target

```
office/kernel/            what every domain may use, nothing domain-specific
  unit-of-work.ts         UnitOfWork: prisma, runTx, queueNotices, publishQuietly   (+ the spec hook `prismaClient`)
  actor-resolver.ts       ActorResolver: actor(gate), grantsFor(user, db)
  account-tree.ts         AccountTree: accounts(db), pathOf, chainIds, visibleAccount, nodeOf
  actor.interceptor.ts    uses ActorResolver
  kernel.module.ts        KernelModule (exports the three + NoticeService)
office/wallets/wallet-ledger.ts     WalletLedger: lockWallets, hold, release, move, recordOp (+ saleLadder, refundOf)
office/terms/price-ladder.ts        PriceLadder: termsFor, ladderRows, stampWith, PRICE_COLUMNS
office/lines/line-access.ts         LineAccess: visibleLine
office/roles/layer-roles.ts         LayerRoles: ensureLayerRoles
office/<domain>/<domain>.module.ts  one Nest module per domain, exporting only what others use
office/<domain>/<domain>.repository.ts   the domain's Prisma queries, where the service has them today
```

`OfficeKernel` is deleted at the end. `OfficeModule` imports the domain modules.

## Decisions

1. **Strangler, not big bang.** First the new classes are created with the code moved into them and `OfficeKernel`
   keeps its public surface as one-line delegates. Then each domain switches its constructor from the kernel to
   the collaborators it really uses. When a member has no caller left its delegate is deleted. Specs stay green at
   every commit.
2. **The spec hook moves once.** Specs replace the client through `facade.prismaClient` → `kernel.prismaClient`.
   It becomes `UnitOfWork.prismaClient`; the facade forwards to it, so no spec file changes in that slice.
3. **A ratchet for each goal** in `architecture.spec.ts`, added in the first slice with today's counts:
   `kernel-use` (files outside `kernel/` and `testing/` that import `OfficeKernel`), `prisma-in-service` (`.prisma.`
   and `tx.<model>.` calls in `*.service.ts`), `flat-office-module` (providers listed in `office.module.ts`).
4. **Module graph** (no cycles, from today's constructor dependencies):
   `Kernel` ← everything · `Wallets` ← Tasks, Lines, Transfers, Providers, Reports, Desk · `Tasks` ← Lines, Reports ·
   `Terms` ← Lines, Transfers · `Lines` ← Transfers, Reports · `Providers` ← Lines (gateway), Desk · `Reports` ← Desk.
   Accounts, Roles, Companies, Packages, Offers, Notices, Audit, Catalog import only `Kernel` (Accounts and Catalog
   also `Roles` for `LayerRoles`).
5. **Spec apps keep working unchanged.** `OFFICE_CONTROLLERS` and `OFFICE_PROVIDERS` stay exported from
   `office.module.ts`, built by concatenating each module's own lists.
6. **Repositories are thin.** A repository method is one query with a name that says what it reads or writes; it
   takes the client (`db`) when it may run inside a transaction. No rule and no permission in a repository. A
   service with fewer than five queries keeps them until it grows (rule 5.1 is about mixing, not ceremony).
7. **Import boundary** added to the guard once modules exist: a file in `office/<a>/` imports from `office/<b>/`
   only a `*.service`, a `*.module`, a pure rule file or a `*.schemas` file — never a repository or a controller.

## Non-goals

- Splitting `rules/office-rules.ts` by topic (separate small plan).
- Any change the web app can see.
- Caching `accounts()` (every visibility check still loads the tree; measured later, with real data sizes).

## Risks

- The full `test:api` and the build run on GitHub Actions only. Each slice runs `tsc`, ESLint, `architecture.spec`
  and the domain's spec files locally; the nine unpushed hardening commits should be pushed and green **before**
  this starts, so a red run is attributable.
- Nest dependency injection errors show only at boot: every module slice ends by booting the compiled API on a
  spare port (`PORT=3099 node dist/main.js`) and calling `/health`.
- `ProviderHealthService` and `CatalogSeed` start timers and seed at boot: their modules must keep the
  `isTest()` / no-database guards.
