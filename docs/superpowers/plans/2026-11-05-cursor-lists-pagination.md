# Plan: pagination on cursor lists

Spec: `docs/superpowers/specs/2026-11-05-cursor-lists-pagination.md`

1. API: `total` on `lines`, `tasks`, `ledger`, `audit`, `providerOperations`, `finance`, `notices`, `entryReport`
   (and through `report`). Count with the same `where` minus the cursor clause, in `Promise.all` with the page
   read. Test mocks that only had `findMany` gain `count`.
   Files: `apps/api/src/modules/office/office.service.ts`, `office-lists.spec.ts`, `operation-log.spec.ts`,
   `response-shape.spec.ts`.
2. Web lib: `PageOf.total`; `usePaged` returns `all`, `total`, `hasNext`, `loadMore`, `key`. Every page's
   `fetchPage` maps `total` through.
   Files: `apps/web/lib/use-paged.ts`, `apps/web/lib/api.ts` (response types), the eight pages' `pick(...)` mappers.
3. Web table: `PagedTable` pages `all` by the saved page size, renders `Pagination`, loads chunks on demand,
   resets to page 1 on filter key or page-size change. Remove `PageNav`, `.page-nav` CSS, and `shownCount`.
   Files: `apps/web/components/data-table.tsx`, `apps/web/app/styles/desk.css`, `apps/web/lib/copy/{ar,en,he}.ts`.
4. Verify: API specs, typecheck, `check:copy`, browser on `/finance`, `/provider-operations`, `/numbers`
   (page size change, page jump that needs another chunk, `all`).
