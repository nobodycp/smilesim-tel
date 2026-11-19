# 0020 — A modular monolith of twelve modules; `office` is retired

Date: 2026-11-13. Status: accepted (owner, 2026-11-13). The audit
(`docs/architecture/2026-11-13-backend-audit-and-office-refactor-plan.md`), its running log and the plan
`2026-11-13-office-retirement` are finished and were removed on 2026-11-17 (in git history); this ADR keeps the decision.

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

## Amended by slice R.3 (2026-11-14): no kernel, under any name

- `modules/shared/` is `modules/platform/`, and holds the unit of work (`PlatformModule`). The actor, the tree, the
  policy and the grants are `modules/access/` (`AccessModule`), which imports the auth module and hands on nothing
  of it. The kernel module is gone; the guard `catch-all-module` refuses a file or folder named `kernel` and a Nest
  module that exports what another module owns (a port it binds excepted). The rules went to their owners
  (catalog, pricing, wallets, sales, tasks, platform). `Layer` is the platform's (`doors.ts`): the door hosts name
  the four layers, and sign-in imports it from there.

## Amended by slice R.4 (2026-11-14): tasks above providers

- `DEPENDS_ON` gains `tasks → providers`. A task and its provider operation are locked together, in one order, in
  the task's own transaction (task, line, claim keys, operation, wallet), and a task asks what its operation allows
  (D6, D7). The integration knows nothing of tasks: the edge points one way, and `providers` imports neither tasks
  nor sales (a named test holds it). The alternative, a port that providers implements for tasks, would put a
  lock taken inside the task's transaction behind an interface for no gain.
- What a task reads of its operation (its phase, what it allows, its hold, a repeated request, who may decide) is
  the tasks' (`tasks/task-operation.rules.ts`), moved out of the settlement's rules with its text unchanged. The
  locks an opening takes on a line, a serial and a number stay the sales' and reach `TasksService.openTask` as a
  port (`OpeningLocks`, handed in by `LinesService`): same functions, same points, same transaction. The one write
  a cancel makes to its operation is the operations' repository's (`markAbandoned`, through
  `ProviderOperationsService.abandonRequested`), the same guarded statement on the row the task's transaction has
  locked. The stored sentences and the eSIM code's storage helpers are the platform's (`stored-text.ts`,
  `esim-code.ts`): tasks, providers, access and sales all write or read them.

## Amended by slice R.5 (2026-11-14): the worker's one composition

- The worker builds its money path from one description (`src/worker/composition.ts`): the list of classes and
  the constructor metadata Nest reads for the API. It starts no Nest application, on purpose: the API's modules
  start timers (provider health, line snapshots, the catalog seed) that must run once, in the API. A collaborator
  added to a constructor reaches the worker from the same declaration, or the worker refuses to start naming it.
  `worker-wiring.spec.ts` holds the description to the API's providers.

## Amended by slice R.12 (2026-11-16): every module has a surface

`module-surface` is in force for all twelve modules (five since R.9). A module is imported by another through its
`index.ts` only; the composition roots and the specs may reach inside. Three surfaces are not at `modules/<name>/`:
the platform's also hands the platform's root files (`errors.ts`, `config.ts`, `db.ts`, `doors.ts`, `cors.ts`),
identity's is `modules/auth/index.ts`, and catalog's hands `modules/branding`. A surface holds what is imported
today and nothing more: a new name is added to it by the change that first needs it from outside.

What a surface costs: a value import from it loads every file it re-exports. The module graph has no cycle
(`module-layering`, `module-mutual` at 0), so a surface cannot make one; a file never imports its own module's
surface.

## Amended for the system monitor (2026-11-17): a thirteenth module, `monitoring`

Spec `docs/superpowers/specs/2026-11-17-system-monitor.md` (D8, approved by the owner on 2026-11-17). The request
log, the system status and the early warnings are one module, `monitoring` (`modules/monitoring/`), **above the
others**: it may import `providers`, `notifications`, `access`, `identity` and `platform` (and what lies below
them), and no module may import it (`architecture-boundaries.spec.ts`: `puts monitoring above everything it
reads`). It reads what the others did; it changes none of their rules, no money, no status.

- Every route of the module is the branch owner's alone (D1): its service asks `requireOwner` (access's policy)
  before it reads or deletes anything. A grant for staff waits for the staff roles.
- Its surface (`modules/monitoring/index.ts`) is empty: nothing imports monitoring. The composition roots wire it:
  `modules/registry.ts` registers `MonitoringModule` last, and the request-log middleware (`src/`, owner `app`)
  hands each request's row to the module's writer.
- The activity log stays the business record; the request log is technical. Clearing the request log is itself
  recorded in the activity log, which monitoring never deletes from.
- The alerts (slice M.6) read two tables of other modules **directly, through monitoring's own repository**
  (`alert.repository.ts`): `RequestLog` (its own) and `ActivityEvent` (the auditing module's), for the refused
  sign-ins by login name and the wrong second-step codes. Chosen over adding `auditing` to monitoring's
  `DEPENDS_ON`: auditing's surface offers no such read (it would have to grow one used by monitoring alone), and a
  read of rows changes nothing of auditing's rules. Monitoring writes nothing there. The parts that are down are
  judged by the status's own probes and rules (`StatusRepository`, `StatusRedis`, `status.rules.ts`), not a copy.
- The alert pass runs in the worker (`worker.ts`, owner `app`, a composition root), on the dispatch's unit of work,
  apart from `WORKER_MONEY_PATH`; the API runs no pass.
- `GET /v1/me` (reporting) carries the owner's count of open, unseen alerts. Reporting does not import monitoring:
  `DeskRepository.openUnseenAlerts` counts the `Alert` table, a read of one number, the same way monitoring reads
  the tables below it. Nothing else of monitoring is read from below.


## Amended by slice F.7e (2026-11-19): a business line's modules carry its name; a fourteenth module, `site`

ADR 0028 ("Names"): `postpaid` is the backend's word for what is the postpaid line's alone. The three modules that
are the postpaid line's live under `modules/postpaid/` and carry the line's name in the map
(`architecture-map.fixture.ts`): `postpaid-catalog` (`modules/postpaid/catalog/`, was `modules/catalog/`),
`postpaid-pricing` (`modules/postpaid/pricing/`, was `modules/pricing/`) and `postpaid-sales`
(`modules/postpaid/sales/`, was `modules/sales/`). Their layering inside and their surfaces (`index.ts`) are as they
were. Every other module is shared by the lines and keeps its name and place; `tasks` stays general (the owner: one
inbox for every line).

What the catalog held that every line shares became a module of its own, **`site`** (`modules/site/`, surface
`modules/site/index.ts`): the site identity (`site/branding/`, which the map gave to `catalog` until then), the
offers (`site/offers/`: no package or company link) and the offer picture route (`site/pictures/`, `GET
/pictures/offers/:id`), with how every picture route answers (`sendPicture`, `PictureQuery`) and what a picture is
(`site/rules/pictures.ts`). The pictures controller became two under the same prefix: the company mark stays the
postpaid catalog's. Adding to the catalog from a provider (`provider-catalog.*` and the catalog adapter it asks)
moved from `providers/directory/` into `postpaid/catalog/provider-catalog/`, with its own repository and schemas
(the same queries and bodies); its routes are the same.

The fourteen modules: `platform`, `identity`, `auditing`, `notifications`, `access`, `site`, `postpaid-catalog`,
`postpaid-pricing`, `wallets`, `providers`, `tasks`, `postpaid-sales`, `reporting`, `monitoring`.

`DEPENDS_ON` is no wider: `site` may import `access` and `platform` (what `catalog` could); `postpaid-catalog` imports
`site`, which was inside it before, so whatever could reach the catalog reaches the same files now. The other
entries are the old ones with the new names. **Known edges from shared modules into postpaid**, kept exactly as wide
as they were and named in the fixture: `wallets` → `postpaid-pricing` (the ledger builds the postpaid ladder itself:
`SALE_KINDS`, `REFUND_KINDS`, `ladderOf`, `refundLadder`, `Ladder`, `PriceLadder`, `costsAtProvider`, `TermsModule`),
`providers` → `postpaid-catalog` (and `postpaid-pricing` below it: provider settings read postpaid rules), and
`tasks` reading the postpaid catalog through `providers` (`Action`, `simRulesOf`). The first new line turns the
ledger's edge into "the line hands the ledger its ladder" (ADR 0028, decision 3).

Paths named in the dated records before this day (older amendments here, ADRs 0021–0027, plans, specs, reviews)
are the old ones: `catalog/…`, `pricing/…` and `sales/…` are now under `modules/postpaid/`, `branding/` and
`catalog/offers/` under `modules/site/`.
