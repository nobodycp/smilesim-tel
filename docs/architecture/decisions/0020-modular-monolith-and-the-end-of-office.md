# 0020 — A modular monolith of twelve modules; `office` is retired

Date: 2026-11-13. Status: accepted (owner, 2026-11-13). Audit and plan:
`docs/architecture/2026-11-13-backend-audit-and-office-refactor-plan.md`,
`docs/superpowers/plans/2026-11-13-office-retirement.md`.

## Context

`modules/office/` holds 81% of the API: an umbrella over sixteen Nest modules, a kernel, a shared rules folder.
The name marks no boundary. Before a real provider is connected (S.12b) the owner wants the boundaries named and
enforced, and the word `office` gone from the internal structure, the web and, in the end, the HTTP paths.

## Decision

1. **A modular monolith, not services.** One API process, one worker, one database, Redis. No rewrite.
2. **Twelve modules:** platform, identity, auditing, notifications, access, catalog, pricing, wallets, providers,
   tasks, sales, reporting. What each owns and what it may import is `apps/api/src/architecture-map.fixture.ts`
   (`DEPENDS_ON`); the graph has no cycle and every module may use the platform.
3. **Accounts and access are one module** (`access`), on one condition: it does not become a new kernel. It owns
   the actor, grants, roles, the account tree and accounts. It owns no money, no price, no line and no task, and
   it imports none of them (`module-layering` holds this).
4. **Removing `office` covers the internal structure, the web and the HTTP paths.** `/office/*` stays served
   during the move for compatibility; its final removal is a required end, after the clients and the upgrade are
   proved safe (plan R.11).
5. **Table names stay.** Prisma models are renamed with `@@map`; no physical rename, no historical migration edited.
6. **Guards first (R.0).** The boundaries are measured on today's code before any file moves, by rules that name
   no folder: who owns a file is the map; which file may write what is said by the file's name.
7. **The slices run before the first provider adapter.** They change how services are composed and what depends
   on what (R.4 and R.5 above all); they do not change business behaviour, the rules of money, a transaction's
   body or the order of locks (`docs/architecture/financial-invariants.md`).

## Consequences

- `architecture-boundaries.spec.ts` holds the new ratchets; `architecture.baseline.json` records today's counts:
  `module-layering` 32, `module-mutual` 14, `root-domain-code` 5, `operation-writes` 1,
  `transaction-outside-unit-of-work` 5, `write-without-activity` 7; the rest 0. Each may only go down.
- `module-surface` is defined and proved but **not in force**: no module has a public surface yet. It comes into
  force module by module as each gets its `index.ts`.
- The duplicate-write guard is keyed on the path prefix `/office/`. `http-security-contract.spec.ts` pins that and
  fails when a write route leaves the prefix. The guard is separated from the prefix before any route moves.
- The worker keeps its hand-built graph until R.5; `worker-wiring.spec.ts` holds it to the API's.
- The project is finished only when the end criteria of the plan hold (no `office` left but in history and in
  table names, every route and screen proved).
