# 0015 — Reads do not write, queries are parsed, a package's code does not name its provider

Date: 2026-11-10. Status: accepted (owner: «اكمل» to the two proposals, and «ضيف الثغرة إلى خطة العمل وكملها»).
Spec and plan: `docs/superpowers/{specs,plans}/2026-11-10-backend-loose-ends.md`.

## Decisions

1. **A `GET` writes nothing.** The home's line snapshot is written by a timer (`desk/line-snapshots.service.ts`,
   at start and every hour, an upsert per account and day); the layer roles are made by the boot seed. The home's
   "change" figure now compares with the last count of the day before the period, whether or not the account
   opened its home that day. `testing/get-writes-nothing.http.spec.ts` calls every GET route.
2. **A query is parsed like a body.** `@Query() query: XQuery`, parsed by the service after its permission
   check. An unknown parameter name is dropped; a named one with a value outside its set is `400 INVALID` (it used
   to be ignored, and the list came back unfiltered). The web's filter options are checked against the schemas in
   `testing/query-filters.http.spec.ts`.
3. **Writes that belong together are one transaction**, and what they check is read inside it; side effects
   outside the database run after the commit (the account delete).
4. **A package's public code is `<company>-<size>[-<months>m]-<5 characters of its id>`.** The provider's product
   code is `Package.providerProductCode`, for the branch and the gateway. Codes that existed were renamed by one
   atomic migration together with the codes stored in `Line.terms` and the activity log. Old links answer 404: a
   lookup by the old code would keep the leak. Below the branch, `GET /office/packages` answers `sellable` and
   `activateInput` in place of the provider's code and the run mode, and task rows carry no provider name.

## Consequences

- Guards at 0: `multi-write-outside-tx`, `unused-injection`, `untyped-query`, `prisma-in-service`; rules 1.x, 3.4,
  4.1, 4.10 in `.cursor/rules/backend-engineering.mdc`.
- A bookmarked list URL with a filter value the API no longer knows shows an error instead of the whole list.
