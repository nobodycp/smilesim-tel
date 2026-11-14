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

## Amended by slice R.2 (2026-11-14): two ports, and auditing above access

- **The activity log is recorded through a port of the platform** (`shared/activity.ts`: the abstract
  `ActivityRecorder`, `ActivityDraft`, the action list; the decorator and the interceptor beside it). Auditing owns
  the one implementation (`PrismaActivityRecorder`, provided under the port by the global `ActivityModule`) and
  the reading of the log (the audit page). So **auditing owns recording and reading**, as the owner asked, and it
  sits **above access and identity**: it reads sessions (the token's hash, `auth/session-token.ts`) and, for the
  audit page, the actor and the tree. Identity no longer imports auditing; the hashing did not move and did not
  change.
- **Notices are written through a port of the platform** (`shared/notices.ts`: `NoticeWriter`, its token
  `NOTICE_WRITER`, and the notice kinds as a type-only contract, as `errors.ts` holds the error codes). The unit of
  work holds the port and never builds a writer; notifications owns the one implementation (`NoticeService`,
  provided as itself and under the token, one instance, by the global `NoticeWriterModule`). Notifications sits
  above access only.
- `DEPENDS_ON` changed accordingly: `identity: [platform]`, `access: [identity, platform]`,
  `auditing: [access, identity, platform]`, `notifications: [access, platform]`. Still no cycle.
- The R.0 map's choice to put the audit page under reporting is withdrawn: it reads the log auditing writes.
- **Corrections before R.2 was pushed:** the audit page's CSV no longer comes from reporting. The one CSV writer
  of the API is the platform's `shared/csv.ts` (`csvCell`, `csvDocument`: BOM, CRLF, quoting, the formula guard),
  and it knows nothing of money: amounts are written as text by the wallets (`shekels`) before they reach it. The
  ledger, the profit report, the reports and a provider's account use it too, so the logic is in one place. The
  worker closes the notice writer it built, last, after its timers' running rounds and its queues' running jobs
  finished; a writer it was handed is never closed by it.
