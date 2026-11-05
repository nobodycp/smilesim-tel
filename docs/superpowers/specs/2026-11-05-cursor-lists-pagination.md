# Pagination on cursor lists

## Goal

Every long list in the office pages the same way. The full-list tables (`DataTable`) already show the shared
`Pagination` footer: "page X of Y · N rows", a per-page size (10 / 15 / 20 / all) saved in preferences, page
numbers, previous and next. The cursor lists (`PagedTable` over `usePaged`: numbers, finance, provider
operations, tasks, audit, operations, notices, reports) only showed a bare ‹ 1 2 › strip, and only once the
server had handed a second chunk, so finance with 26 rows had no paging at all. They get the same footer.

## Decisions

- The server answers `total` beside `nextCursor` on every cursor list: the row count that matches the same
  filters with no cursor. Lists that read from the database count with the same `where`; provider operations,
  which filters in memory, reports `ranged.length` (already `stats.count`).
- `usePaged` keeps reading the server in chunks (30 / 50 / 80 rows) but exposes the loaded rows as one buffer
  (`all`), the server `total`, `hasNext`, and `loadMore()`. Filters still reset the buffer.
- `PagedTable` pages that buffer on the client with the saved page size and renders the shared `Pagination`
  with `count = total ?? all.length`. Moving to a page whose rows are not loaded yet reads the next chunks in
  order until they are (chunks are cursor-sequential, so a far jump reads several). Page size `all` reads
  every chunk and shows what has arrived while the rest loads.
- Column sort stays per visible page, as it was.
- The old `PageNav` and its copy key `shownCount` are removed.

## Non-goals

- No change to chunk sizes or to server ordering.
- No virtualised rows; `all` on a very long feed loads it in full, as the full-list tables do.
