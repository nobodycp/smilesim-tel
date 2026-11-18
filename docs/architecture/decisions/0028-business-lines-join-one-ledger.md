# 0028 — Other business lines join later with their own tables, over the one wallet and the one ledger

- Date: 2026-11-19
- Status: **accepted in part** — the owner, 2026-11-19: one wallet for every line («المحفظة مشتركة أكيد للكل»); the
  other lines may price by a percentage and pay the chain a commission as bills do; "anything that can be prepared or
  renamed now, do it now, before launch". **Open:** the names (decision 7), put to the owner.
- Spec: `docs/superpowers/specs/2026-11-19-business-lines-foundation.md`. Plan:
  `docs/superpowers/plans/2026-11-19-business-lines-foundation.md`.
- Builds on ADR 0020 (modules and their surfaces), 0025 (an operation's provider and cost on its entry), 0026 (each
  sale's margins on its entry). Changes none of them.

## Context

Everything built so far is one business line: mobile subscriptions («الفواتير»: companies, packages, numbers,
activation and renewal). The client runs three more that will be added **after launch**: card top-up («شحن كروت»),
games and apps top-up («شحن ألعاب وبرامج»: PUBG UC, live apps, TikTok coins), and international eSIMs («شرائح دولية»).
Each has its own products and one or several providers. The owner asked that the project be prepared now so that adding
them does not disturb the running system or its data.

Three models argued it over two rounds (a minimalist, a platform architect, a risk hunter), each reading the schema
and the code; they ended close to each other. What follows is where they agreed, what the owner decided, and the one
point they left open.

## What is already general, and stays as it is

- **The wallet and its ledger.** `Wallet` is one row an account; `WalletEntry.kind` is a string; `lineId`, `msisdn`,
  `packageName`, `companyName` are nullable. A sale with no phone number fits.
- **The stored ladder and margins** (ADR 0026): amounts per layer on the entry; every profit sum reads them, never
  the package.
- **The provider's books** (ADR 0025): `providerId` and `providerCost` on the entry; `ProviderEntry`. A provider is
  not tied to one line (Areen lists games beside subscriptions): one provider, one balance.
- Tasks, notices, the activity log, grants (a list that only grows), the request log.

What is bills-only: `Line` (`msisdn` unique, `endsAt`), `Package` (renewal prices, durations, the `auto*` / `allow*`
flags), `Company` (a telecom operator), `periods.ts`, the provider adapter's `products()`, the reconciliation's match
key (number, day, amount).

## Decisions

1. **One wallet an account, for every line** (the owner). One balance, one ceiling, one held amount. Nothing changes.
2. **A new line gets its own tables** for its products and its orders (and its stock of codes, if it has one). It
   never reuses `Package`, `Line` or `Task` with made-up values: no dummy renewal price, no fake number. The shared
   part is what it writes: wallet entries through `WalletLedger`, provider operations, tasks, notices.
3. **Money goes only through the ledger**, with a sale that carries its provider, its cost and its ladder. **A line's
   pricing may be anything — a fixed price, a percentage of the price, a commission for each layer of the chain — but
   what the entry stores is the result: a ladder of integer agorot per layer** (ADR 0026). A percentage is worked out
   at the sale, rounded to whole agorot, the remainder to the branch; the rate that gave it is kept in the ladder for
   audit. So the profit figures, the finance list and the provider's books read a new line's sales with no change.
4. **A sale is never written without its margins.** Today a sale whose ladder cannot be built is written with no
   margins and no error. It is refused instead (spec, F.3): a silent zero profit becomes a refusal.
5. **Words are reserved.** A wallet-entry kind names one thing for ever (entries are never rewritten). The bare kinds
   of today (`activate`, `charge`, `extend`, `reactivate`, `disconnect`, `switch`, `esim`, `sim`, `refresh`,
   `transfer`, `rename`, `freeze`, `unfreeze`, `addon`) belong to bills. `charge` is a renewal; `esim` is the local
   eSIM swap: the international eSIM takes another word. A new line's kinds carry its prefix (`cards.…`, `games.…`).
   A sum over kinds is an allow-list (a new kind is absent until its line adds it, never counted under another
   heading); **a statement** — an account's own wallet page — **lists by exclusion**, so nothing that moved a balance
   is hidden.
6. **Schema changes after launch are additive and online**: a new table, a nullable column or one with a constant
   default (metadata only), `NOT VALID` then `VALIDATE` for a constraint, `CREATE INDEX CONCURRENTLY` for an index on
   a large table (a changed partial-index predicate is two releases: build the new index, then change the code and
   drop the old). One such migration is proven through the deployment before launch (spec, F.6), because every later
   addition depends on it.
7. **Names** (open, the owner's): whether the bills-only API routes and pages move under a prefix of their own now
   (`/v1/bills/…`, `/bills/…`) so that every line reads the same way, and the words for the four lines. Spec, F.7.
8. **A line is off until it is whole**: a server-side switch, off by default, comes with the first new line; no
   reconciliation for a line until it has a match key.

## Deliberately not built now (waiting costs nothing)

A "business line" column on the existing tables (a constant-default column is metadata-only at any size; kind and the
line's own tables tell the rows apart), a generic product/order model, a stock of codes, currencies, per-line grants,
a second provider-adapter interface. Each comes with the first line that needs it.

## Consequences

- Before launch: the refusals and guards of the spec (F.2–F.6), and the renames the owner approves (F.7).
- A new line's spec starts from this ADR: its tables, its kinds with their prefix, its ladder builder, its on/off
  switch, its pages under its own prefix, and a spec that pins the bills figures unchanged with its rows present.
