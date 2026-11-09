# 0008 — The company is the catalog's root (branch)

Date: 2026-11-09 · Status: accepted · Spec: `docs/superpowers/specs/2026-11-09-admin-review.md`, section 4

## Context

The branch reached a package from four lists (`/packages` grouped by company, a company's package cards,
`/companies/[c]/[p]`, a provider's package tab), all reading the same shelf and all opening
`/providers/[p]/[pkg]`. Package on/off had two switches; provider balance and credit showed in three places. The owner
found the catalog tangled («تشابك وترابط بيعمل خربطه») and asked for the company as the base.

## Decision

For the branch only:

- `/companies/[code]` is where packages are found: «الرزم» (one table, provider as a column and a filter, read-only
  prices, margin and status), «المزودون» (the providers that serve it), «الإعدادات» (SIM rules, eSIM default).
- A package's page is `/companies/[code]/packages/[pkg]`; on/off is changed only on its head.
- A provider's page keeps its run defaults and eSIM price, and lists the companies it serves (each opening that
  company's «الرزم» filtered by it). Its balance and credit stay read-only links to `/provider-accounts/[code]`.
- `/packages` sends the branch to `/companies`; old paths redirect (`/providers/[p]/[pkg]`, `/companies/[c]/[p]`).

Main agents, agents and points of sale keep `/packages`, unchanged.

## Alternatives

- **Provider as the root.** Matches the data (`Provider → Package → Company`) but not how the owner thinks of the
  catalog, and a company served by two providers would be split in two places.
- **Keep `/packages` for the branch as a flat search.** One more list showing the same rows: the duplication the owner
  asked to remove.

## Consequences

The API and its response shapes are unchanged (the shelf already carries company → provider → packages). Links and
tests that named `/providers/[p]/[pkg]` now name the company path.
