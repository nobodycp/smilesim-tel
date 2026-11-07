# 0001 — TanStack Query as the web data layer

Date: 2026-11-08 · Status: accepted (owner)

## Context
`lib/use-load.ts`, `lib/use-paged.ts`, `lib/use-action.ts` and `lib/connection.ts` re-implement fetching, cursor paging, mutation-then-reload and reconnect refetch. They have no shared cache, no keep-previous data and no invalidation, which causes the stale topbar balance, refetch storms after each action, blank tables on filter change, and stale records after a route param change.

## Decision
Adopt `@tanstack/react-query` for all server state in `apps/web`. Query keys per domain live in `features/<domain>/queries.ts`. Cursor lists use `useInfiniteQuery`; filters use `placeholderData: keepPreviousData`; money mutations invalidate `['me']`; reconnect uses `refetchOnReconnect` instead of `connection.generation`.

## Consequences
- One new runtime dependency.
- Custom hooks are removed slice by slice (Phase 4); until then, Phase 1 applies small fixes to them.
- Form/draft state stays in components and is never overwritten by a refetch.
