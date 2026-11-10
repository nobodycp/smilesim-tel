# 0014 — One list contract, bounded lists, route names

Date: 2026-11-10. Status: accepted (owner approved the spec's decisions as proposed).
Spec and plan: `docs/superpowers/{specs,plans}/2026-11-10-lists-and-routes.md`.

## Context

Lists answered under eight different keys (`lines`, `tasks`, `users`, `entries`, `rows`, …) with three cursor
formats (a row id, `rank:login` in clear, an opaque time-and-id). Seven lists had no limit. Some routes named their
target in the body, one route was an upsert, one took a path segment that had one legal value, and a target outside
the caller's tree answered 403 where a missing one answered 404.

## Decision

1. **Envelope.** Every paged list answers `{ items, nextCursor, total }` plus its own extra keys (`unread`,
   `poses`, `stats`, `totals`, `addresses`). `apps/api/src/modules/shared/paging.ts` is the only place that builds
   it; the web's `Page<Row>` (`lib/api-types.ts`) is its mirror.
2. **Cursor.** Opaque, `?cursor=` only, and a cursor the API did not issue is `400 INVALID`. Time-ordered lists use
   the time and id of the last row (`page()`, `after()`); lists ordered by a text key (accounts) use that key
   (`keyPage()`, `usersPage`). Prisma's row cursor is not used.
3. **Bounded lists.** `users`, `directory`, `wallets` and `reports/balances` are paged. `packages`, `companies`,
   `offers`, `roles` and `reports/providers` are served whole up to `LIST_CAP` (1,000) and answer `capped`.
4. **Reading a short list whole is the web's job.** The name map, the account pickers and the balances report need
   every row; `lib/all-pages.ts` reads the pages one after another (at most 50). The API never answers an unbounded
   list, and no screen changed. Pickers that search as the owner types are a later web change.
5. **Routes.** `PUT /office/companies/:code/image`; `POST /office/roles` and `PUT /office/roles/:id`;
   `GET /office/ledger`; `GET /office/reports/{providers,operations,balances,supply}` with
   `…/{balances,supply}/export`; `GET /office/lines?loginName=`. No `/v2`: API and web ship together.
6. **Not found.** A target that is missing or outside the caller's tree answers `404 NOT_FOUND`; `403` is for a
   visible target the caller may not act on; a grant that does not depend on the target is judged before the read.

## Not done, on purpose

- `PATCH /office/packages/:code/chain` stays PATCH: its body is partial.
- The body fields `posLogin` and `parentLogin` keep their names: responses use the same names, so only a rename of
  both sides would be consistent. Owner's call.
- An account move keeps its own refusal order (`transfers.service.ts`), already written so it tells nothing.
- No export was added for the providers and operations reports.

## Consequences

- A new list goes through `page()`, `keyPage()` or `capList()`; `architecture.spec.ts` rule `list-envelope` refuses
  an answer that carries `nextCursor` without `items`.
- A client of the old shapes breaks at once (no compatibility layer): the web and its Playwright mocks moved in
  the same commits.
