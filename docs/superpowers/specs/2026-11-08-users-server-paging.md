# Users list paged by the server (plan 4.4c)

Date: 2026-11-08 · Status: done

## Problem

`GET /office/users` answers every account the actor can see, with its wallet, in one go. The users page filtered,
ordered and paged that list in the browser. A branch with thousands of points of sale downloads them all to show ten.

## Change

- **API.** `GET /office/users?paged=1[&q][&layer][&cursor]` answers one page `{ users, nextCursor, total }`, 50 rows,
  in the order the page always drew (branch, main agent, agent, point of sale; then login name). `q` matches the
  login or the full name as typed (same test as before), `layer` keeps one layer, `total` counts every match. The
  cursor is the last row's place in that order (`<layer rank>:<login>`), so a row deleted between two reads does not
  lose the place. Wallets are read for the page's rows only. Pure rules in `accounts/users-page.ts`.
- **Without `paged`** the route answers exactly as before (`{ users }`, everything visible): the shell search, the
  line card and the package sheet read it, and so do the users page's dialogs.
- **Web.** The users table is a `PagedTable` over `usePaged` (key `q|layer`), like numbers and tasks: the pager
  counts pages from `total` and reads the next cursor when a page runs past what is held. The whole list is read
  only while "new account" (parent choice) or "move" (destinations) is open. A write reloads both.

## Behaviour that changes

- Typing in the name filter narrows the table after the 300 ms pause that already updates the address, not on every
  key (the request goes to the server). Same as numbers and tasks.
- Nothing else on screen: same columns, order, counts, empty states.

## Checks

`users-page.spec.ts` (order, filters, cursor, a deleted cursor row, page size), `accounts.http.spec.ts` (paged and
unpaged answers), `tests/users-desk.spec.ts` (filters in the request, the next cursor read past the first fifty, the
whole list only for a dialog). DOM of the 30 snapshot pages unchanged.
