# Foundations for the other business lines — spec

Owner's request (2026-11-19): the system so far is one business line, mobile subscriptions («الفواتير»). Card top-up,
games and apps top-up and international eSIMs will be added after launch. Prepare the project now so that adding them
does not disturb the running system or its data; "anything that can be set up or renamed now, do it now, so we see it
working before launch".

Decisions and their reasons: ADR 0028. This spec is what is built now. **Nothing of the new lines is built.**

Status: F.1–F.6 approved by the owner's request; **F.7 (names) waits for the owner's answer.**

## The owner's answers (2026-11-19)

- **Companies and providers are separate for each line**, even when the name is the same (Cellcom of the cards line
  is not Cellcom of bills). Nothing to build now beyond the navigation of F.7: the bills line's are the ones that
  exist; a new line brings its own companies table and its own provider records (ADR 0028, decision 2a).

- **The wallet is shared by every line.** Nothing to build.
- **The other lines may price by a percentage, and pay the chain a commission as bills do.** Nothing to build: an
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
`reports`, `notices`, `system`). The bills-only parts hold general words: `/v1/packages`, `/v1/lines`,
`/v1/companies`, `/v1/sell-prices`, `/v1/offers`, and the pages `/packages`, `/companies`, `/numbers`. When cards and
games arrive with `/v1/cards/products`, `/v1/games/products`, bills would be the one line with no prefix, and
"packages" would mean "the bills line's packages" for ever.

Proposed (the owner prefers the clearest contract even when the rename is wide; data is trial data; no client or
bookmark exists before launch — after it, a rename breaks both):

- **API:** the bills-only routes move under `/v1/bills/…` (`/v1/bills/packages`, `/v1/bills/lines`,
  `/v1/bills/companies`, `/v1/bills/sell-prices`, `/v1/bills/offers`), no alias kept. Shared routes stay.
- **Web:** the bills pages move under `/bills/…` (`/bills/numbers`, `/bills/packages`, `/bills/companies`); the
  sidebar groups them under one heading, «الفواتير», so the next line is a second heading and not a reshuffle.
- **The four lines' words** in code and URLs: `bills`, `talkman` (the owner's word for the cards line, «توكمان»),
  `games`, `travel-esim` (the local eSIM swap keeps the word `esim`).
- **Companies and providers by line** (the owner, 2026-11-19; ADR 0028, decision 2a): the bills line's companies and
  providers sit under the bills heading with the rest of it («الشركات والرزم», «المزودون», «حسابات المزودين»,
  «عمليات المزودين»), so the next line brings its own under its own heading and nothing is ever listed mixed.
- **Not renamed:** the wallet-entry kinds of bills (bare words by rule, ADR 0028), the tables (`Package`, `Line`,
  `Company`: a table rename is instant at any size, and the code's modules already scope them), the modules.

The slice, once approved, starts with the inventory: every route and page classified shared or bills, the mixed ones
(`tasks`, `home`, `overview`, `provider-operations`) decided one by one in the plan before any file moves.

## Out of scope

The new lines themselves: their tables, kinds, pricing, providers, pages, on/off switch (each its own spec, starting
from ADR 0028). A business-line column on existing tables, a generic product/order model, currencies.
