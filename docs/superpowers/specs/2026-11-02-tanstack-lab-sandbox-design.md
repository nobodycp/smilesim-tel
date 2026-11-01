# TanStack lab: sandbox comparison page

## Goal

Give the office team a real, side-by-side comparison of the current data layer
(`useLoad` / `usePaged` / `DataTable`) against TanStack Query + TanStack Table,
using real data from a real endpoint, so a future decision to adopt either
library (or not) is based on evidence instead of a claim made from memory.

This is a throwaway evaluation tool, not a production feature.

## Context

A prior discussion speculated that TanStack Query would remove "manual
useEffect refetch" pain and TanStack Table would add sorting. Reading the
actual code showed that:

- `lib/use-load.ts`, `lib/use-paged.ts`, `lib/use-action.ts` already handle
  race conditions, single-flight actions, and reload-after-action.
- `components/data-table.tsx` (`DataTable` / `PagedTable`) has no client-side
  sort today, and the list pages page through the server by cursor, not
  through a client-side in-memory dataset.

So the honest comparison isn't "fix a bug", it's "does TanStack give us
anything the current, intentionally small hooks don't, for the cost of two
new dependencies". The sandbox page exists to answer that with a working
example instead of a guess.

## Decisions

- **Route**: `apps/web/app/sandbox/tanstack-lab/page.tsx`, reachable only by
  typing the URL. Not added to any nav, sidebar, or topbar.
- **Access**: gated with `useRequireLayer(['branch'])` — the branch layer
  (the "admin" door in `README.md`'s table) only, since this is a
  developer/evaluation tool, not an office feature.
- **Data**: `api.officeLines` — the same endpoint `/numbers` already uses.
  Read-only: no activation form, no mutations. Using the same data keeps the
  comparison fair.
- **Layout**: one `Desk` page with two `.pane` blocks side by side (wide
  screen) or stacked (narrow), per the screen-size rule.
  - **Left pane — current approach**: `usePaged` + `PagedTable` /
    `DataTable`, unchanged, imported as-is. This is the control.
  - **Right pane — TanStack approach**: `@tanstack/react-query`
    (`useInfiniteQuery`, mirroring the existing cursor pattern) +
    `@tanstack/react-table` (`useReactTable`) rendering the same rows through
    Pearl's `.sheet` / `.data` markup (not TanStack's own markup — Table is
    headless, so this is possible without fighting Pearl).
- **One deliberate asymmetry**: the right pane adds client-side column
  sorting (e.g. clicking "ends on") that the left pane does not have today.
  Without this, the two panes would just be two ways to render the same
  fetch and the comparison would prove nothing. This is the one concrete
  capability gap being tested, not a feature request for production.
- **Query client scope**: a `QueryClientProvider` created in a file local to
  `app/sandbox/tanstack-lab/` and used only by that route's layout. The root
  `layout.tsx` and all existing providers are untouched.
- **Dependencies**: `@tanstack/react-query` and `@tanstack/react-table` added
  to `apps/web/package.json` only.
- **Marked as temporary**: a small banner at the top of the page states it is
  an internal evaluation tool to be deleted after the comparison is reviewed.
- **Language/theme**: the page is real UI, so it still gets checked in
  Arabic and English, light and dark, per the `interface-direction` skill —
  even though it is temporary.

## Non-goals

- Not touching `/numbers` or any production page.
- Not replacing `useLoad`, `usePaged`, `useAction`, or `DataTable` anywhere.
- Not adding a server-side sort parameter to the API — the sort demonstrated
  is client-side, over the rows already loaded in the right pane.
- Not making a stack-wide recommendation in this task. That decision comes
  after the user has looked at the sandbox page, as a separate follow-up.
- Not adding either library as a project dependency pattern (no shared
  hook, no reuse elsewhere) until/unless a follow-up task says so.

## Removal

Once the comparison has served its purpose, the whole `app/sandbox/`
directory and the two dependencies should be removed in one commit. This
spec does not schedule that removal; it is a reminder for whoever decides
the outcome of the trial.
