# Foundations for the other business lines — spec

Owner's request (2026-11-19): the system so far is one business line, mobile subscriptions («الفواتير»). Card top-up,
games and apps top-up and international eSIMs will be added after launch. Prepare the project now so that adding them
does not disturb the running system or its data; "anything that can be set up or renamed now, do it now, so we see it
working before launch".

Decisions and their reasons: ADR 0028. This spec is what is built now. **Nothing of the new lines is built.**

Status: F.1–F.6 approved by the owner's request; **F.7 (names) waits for the owner's answer.**

## The owner's answers (2026-11-19)

- **Companies and providers are separate for each line**, even when the name is the same (Cellcom of the cards line
  is not Cellcom of postpaid). Nothing to build now beyond the navigation of F.7: the postpaid line's are the ones that
  exist; a new line brings its own companies table and its own provider records (ADR 0028, decision 2a).

- **The wallet is shared by every line.** Nothing to build.
- **The other lines may price by a percentage, and pay the chain a commission as postpaid does.** Nothing to build: an
  entry stores the resulting amounts per layer (ADR 0028, decision 3), so a percentage rule is a new line's own
  pricing table and builder, and every profit figure reads its sales as it reads today's.

## Slices

### F.1 The rules (ADR 0028)

Written. The codemap (`docs/architecture/backend.md`) names it where it describes the ledger and the catalog.

### F.2 An account's wallet page lists everything that moved its balance

**Defect found while preparing this (2026-11-19).** `WalletsService.ledger` (`GET /v1/ledger`, the page «المحفظة»)
lists `PROVIDER_OPERATION_KINDS` plus `fund`, `self_fund`, `deduct`, `deduct_in`. An `addon` entry moves money and is
in none of them: on the local data one add-on took 15 ₪ from a balance and shows no row on its owner's wallet page, so
`balanceAfter` jumps unexplained. Any future kind would do the same.

- The page lists **by exclusion**: every entry of the account except the ones that move no balance and are not the
  account's business to read as movements (`hold`, `release`). The kind filter accepts any kind the account has.
- The web's kind names and filter options cover `addon` (ar / en / he).
- Proof: a db spec — an add-on's entry is on its owner's wallet page; the page's rows explain every change of
  `balanceAfter` between its first and last row (no gap) for an account with every kind of today; `hold` / `release`
  stay out. `response-shape.spec.ts` unchanged in shape.

### F.3 A sale is never written without its margins

Today `WalletLedger.post` asks `saleLadder` for a sale's ladder and writes `NO_MARGINS` when it answers null (no line,
a line whose terms name no package, a package or prices that cannot be read, an empty path). The money moves; every
layer's profit on it is 0; nothing says so. The CHECK `WalletEntry_sale_margins` passes because it only says "a ladder
needs its margins".

- **In the ledger:** an entry of a sale kind (`SALE_KINDS`) that moves money out (`amount < 0`) and has no ladder is
  refused before the INSERT (500-class invariant error naming the kind; the transaction rolls back, nothing moves).
  The slice first lists every call site that can reach `post` with a sale kind and shows which, if any, can lose its
  ladder today; a legitimate case found (if one exists) is put to the owner, not silently allowed.
- **In the database:** a CHECK `WalletEntry_sale_has_ladder`: `kind` in the sale kinds and `amount < 0` ⇒ `ladder IS
  NOT NULL`, added `NOT VALID` and validated in the same slice when no stored row breaks it (the local data: 23 sales,
  none without a ladder; the trial server is counted before the migration is written).
- The loss-marked rows (P.7) move 0 and are not sales: untouched. A refund (`amount > 0`) without its sale's ladder
  is a separate case: listed by the slice, decided there.
- No statement, read or lock is added to the sale path: `sale-lock-tree.db.spec.ts` stays 11 and 12.
- Proof: a db spec per refused case; the existing sale specs unchanged.

### F.4 Guards on the kind lists

One spec (unit, in `apps/api/src/`), so a kind added tomorrow cannot be half-added:

- The kinds in the SQL of the partial index `WalletEntry_sale_or_refund_createdAt_id` and of the CHECKs
  (`WalletEntry_operation_priced`, the new one of F.3) equal the code's lists (`SALE_KINDS`, `REFUND_KINDS`,
  `PROVIDER_OPERATION_KINDS`), read from the migration files' latest definition.
- Every kind the API can write has a name in the web's copy (ar / en / he) and is either in a sum's allow-list or
  named as "moves no profit" in one list the spec reads.
- No query filters `WalletEntry.kind` by exclusion except the statement of F.2 (named there).
- The reserved words of ADR 0028 (decision 5) are a constant the spec reads; a kind with a dot is a new line's.

### F.5 One definition of "a provider's operation"

`providerPurchases` reads `providerId IS NOT NULL`; the provider's ledger list, `provider-operations` and the
providers report read `kind IN PROVIDER_OPERATION_KINDS`. They agree today only because `operationColumns` stores a
provider for those kinds alone. Every read uses the stored fact, `providerId IS NOT NULL` (the partial index
`WalletEntry_provider_createdAt_id` already has that predicate), so the books and the lists cannot part for any kind.
The kind filter of the screens stays a filter. Behaviour today is unchanged: proven by the existing provider specs and
one that compares the two predicates on the test data.

### F.6 One online migration, proven through the deployment

Every migration so far was written for a small table and deployed with writes stopped; none uses `CONCURRENTLY`. The
API applies migrations at container start (`prisma migrate deploy`).

- One migration that builds an index with `CREATE INDEX CONCURRENTLY` (alone in its file, as Prisma requires), on a
  real need of this spec if there is one, else the smallest honest one; the handover's operator guide says how such
  a migration behaves at start, what a failed concurrent build leaves (`INVALID` index) and how it is cleaned.
- Proven locally (applied by the dev copy's start while it serves), then on the trial server at the next deployment,
  with writes running. Until it is seen there the slice is not ticked.

### F.7 Names (waits for the owner)

The question the owner asked: will the API's names be affected later. As they stand: yes, in one way. The shared
parts are named for what they are (`users`, `wallets`, `finance`, `tasks`, `providers`, `provider-accounts`,
`reports`, `notices`, `system`). The postpaid-only parts hold general words: `/v1/packages`, `/v1/lines`,
`/v1/companies`, `/v1/sell-prices`, `/v1/offers`, and the pages `/packages`, `/companies`, `/numbers`. When cards and
games arrive with `/v1/prepaid/products`, `/v1/games/products`, postpaid would be the one line with no prefix, and
"packages" would mean "the postpaid line's packages" for ever.

Proposed (the owner prefers the clearest contract even when the rename is wide; data is trial data; no client or
bookmark exists before launch — after it, a rename breaks both):

- **API:** the postpaid-only routes move under `/v1/postpaid/…` (`/v1/postpaid/packages`, `/v1/postpaid/lines`,
  `/v1/postpaid/companies`, `/v1/postpaid/sell-prices`; the exact list is F.7a's), no alias kept. Shared routes stay.
- **Web:** the postpaid pages move under `/postpaid/…` (`/postpaid/numbers`, `/postpaid/packages`, `/postpaid/companies`); the
  sidebar groups them under one heading, so the next line is a second heading and not a reshuffle. **What the
  user reads stays «الفواتير»** (the owner, 2026-11-19: `postpaid` is the word of the API and of the backend's names;
  on screen it is «الفواتير» only): the heading, the page titles and every text keep the word of today.
- **The four lines' words** in code and URLs: `postpaid` («بوست بيد», the line built so far), `prepaid` («بيربيد», the cards line),
  `games`, `travel-esim` (the local eSIM swap keeps the word `esim`).
- **Companies and providers by line** (the owner, 2026-11-19; ADR 0028, decision 2a): the postpaid line's companies and
  providers sit under the postpaid heading with the rest of it («الشركات والرزم», «المزودون», «حسابات المزودين»,
  «عمليات المزودين»), so the next line brings its own under its own heading and nothing is ever listed mixed.
- **The backend's names** (the owner, 2026-11-19: "use postpaid in the API and in the backend's names"): what is
  the postpaid line's alone carries the word, so that a table or a module named `Company` or `Package` is never read
  as "of every line" once prepaid has its own. The inventory (first step of the slice) classifies every Prisma model,
  module and route as **shared** (accounts, auth, wallets and the ledger, the provider machinery, notices, the
  activity log, monitoring, platform) or **postpaid** (companies, packages and their durations, renewals, switches
  and add-ons, lines, the per-account package terms and sell prices, offers, the line tasks and their settlement),
  and decides the mixed ones (`Task`, `ProviderOperation`, the home and overview reads) one by one. Postpaid models
  and tables take the prefix (`PostpaidCompany`, `PostpaidPackage`, `PostpaidLine`, …: a table rename is a
  metadata-only `ALTER TABLE … RENAME`, written as plain SQL migrations with the constraints and indexes renamed with
  them); postpaid-only modules are named for the line (ADR 0020 amended in the same slice).
- **Not renamed:** the wallet-entry kinds of postpaid (bare words by rule, ADR 0028: entries are never rewritten,
  and a kind is a stored value, not a name), and every text the user reads.

The slice, once approved, starts with the inventory: every route and page classified shared or postpaid, the mixed ones
(`tasks`, `home`, `overview`, `provider-operations`) decided one by one in the plan before any file moves.

### F.7a The inventory (2026-11-19)

Every Prisma model (39), route (202), page (48) and module was classified from the code; the full tables are the
slice's working paper, the decisions are here.

**Models and tables.** Postpaid, take the prefix `Postpaid` (model name = table name, as today): `Company`,
`Package`, `PackageDuration`, `PackageRenewal`, `PackageSwitch`, `PackageAddon`, `UserPackage`, `SellPrice`, `Line`,
`LineCountSnapshot` (10 models). `Task` and `TaskNote` stay shared (below). Every
other model is shared and keeps its name, `Provider` and `Offer` included (**`Offer` is shared**: it has no package or
company link — the earlier text of this spec that listed offers as postpaid was wrong). The postpaid columns of shared
tables stay as they are (`WalletEntry.lineId` / `msisdn` / `packageName` / `companyName`,
`ProviderOperation.packageCode`, …): they describe what an entry or an operation was for.

**API routes.** Under `/v1/postpaid/…` (the controllers keep the `v1` prefix; each route's path gains `postpaid/`):
the lines (`lines…`, 18 with the line transfer), the activation settlement (`tasks/:id/complete`,
`provider-decisions`, `tasks/:id/provider-decision[/approval]`), the packages and their settings, the companies, the
provider's catalog (`providers/:code/catalog/…`, `POST companies`, `POST packages`), the shelf and sell prices, the
per-account package terms (`packages/:code/…`, `users/:login/packages…`, `users/:login/ops`); the company picture
becomes `/pictures/postpaid/companies/:code`. 56 routes and the picture; the tasks list stays (below). **Stay:** accounts, auth, wallets, finance, the ledger, the provider machinery (`providers`,
`provider-accounts`, `reconciliations`, `provider-operations`), `reports/*`, `home` / `overview` / `me` (the one place
that reads across lines: a new line adds its part to the answer), offers, notices, system, the account transfer
(`users/:login/transfer…`: the tree is shared, the lines travel with it).

**Pages.** Under `/postpaid/…`: numbers, packages, companies, and the line's providers, provider accounts and provider
operations (their API stays shared: a provider record belongs to one line, ADR 0028 decision 2a, so its pages sit with
its line). The redirect aliases of old addresses (`/operations`, `/reports/orders`,
`/reports/sales`, `/companies/[code]/[provider]`, `/providers/[code]/[packageCode]`) are deleted: nothing is kept in
an old form (the owner's standing rule). Stored page paths (`Notice.href`, `Offer.actionHref`) are rewritten by the
slice's migration.

**Modules.** `sales` is postpaid; `catalog` and `pricing` are mixed: the shared parts leave first (offers and
branding to a shared module; the profit ladder's type and `marginOf` are shared, the package terms and sell prices
postpaid); then the postpaid modules move under `modules/postpaid/…`. `reporting` stays shared. Two known edges from
shared to postpaid stay and are named in the module map: the ledger builds the postpaid ladder itself (`wallets` →
`pricing`), and the provider settings read postpaid rules (`providers` → `catalog` / `pricing`); the first new line
turns the first into "the line hands the ledger its ladder" (ADR 0028, decision 3).

**Never renamed** (stored values and history): wallet-entry kinds, activity actions and subject kinds, notice kinds,
grant codes, written migrations, response JSON keys, relation field names, queue names, environment variables. A new
line's activity actions and notice kinds carry its prefix, as its entry kinds do.

**Tasks are general** (the owner, 2026-11-19: "keep the tasks general for now"). The other lines are simple: their
sales are direct operations at the provider, with no number and almost no later operation (a card has one, a refund;
a game top-up has no cancel; an international eSIM has neither), and **a task is only what a sale becomes when the
connection to the provider fails**. So there is one «المهام» inbox for every line: `Task` and `TaskNote` keep their
names, the tasks routes (`/v1/tasks…`) and pages (`/tasks…`) stay where they are, the sidebar item stays at the top.
What a task of today carries for postpaid (its package, number, activation kind) stays; a new line's failed sale
becomes a task by the columns it needs, added then (a nullable column and dropping `NOT NULL` on `packageId` are
metadata-only). Completing a postpaid task runs the postpaid line's own handler, which is why
`POST /v1/postpaid/tasks/:id/complete` and the provider decisions sit under the line while the list is shared.

## Out of scope

The new lines themselves: their tables, kinds, pricing, providers, pages, on/off switch (each its own spec, starting
from ADR 0028). A business-line column on existing tables, a generic product/order model, currencies.
