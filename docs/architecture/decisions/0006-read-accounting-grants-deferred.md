# 0006 — The `read` and `accounting` grants are not enforced yet

Date: 2026-11-08 · Status: accepted (owner), to be revisited

## Context
The permission matrix (`apps/api/src/modules/office/permissions.http.spec.ts`, improvement 2) showed that the API never
checks the `read` or `accounting` grants. The roles screen offers them, but they change nothing: any branch-layer
account, a staff member with no grant included, can fund any account from its own wallet (the branch wallet has no
ceiling), change ceilings, and read finance, wallets, users, tasks, lines and the audit log. The grants that are
checked are `edit`, `tasks`, `reports`, `staff`, `enter` and the three transfer grants.

## Decision
Leave the behaviour as it is for now (owner, 2026-11-08). The staff roles are not defined yet: employees, accountants,
sales representatives and technicians will each get their own permissions and tasks inside the program, and the
grant checks will be designed with those roles, in their own spec.

## Consequences
- The matrix pins today's answers; the nine affected rows carry the comment "read/accounting not checked". Enforcing
  the grants later changes those rows on purpose.
- Until then, only trusted people should get a branch-layer account. Agents and points of sale are not affected: their
  money moves are limited to their own children and their ceilings.
- Revisit with the staff-roles spec (it must cover fund, ceiling, finance, wallets, ledger and the read lists).
