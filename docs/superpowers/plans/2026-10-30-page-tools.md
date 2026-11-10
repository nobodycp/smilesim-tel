# Page tools and list unification — 2026-10-30

Slice of the 2026-10-30 frontend audit (its files were removed on 2026-11-10): T7 (shared tools), T8 (list and line unification), and the dead-route part of T5.. Goal: the same DOM and the same behaviour per layer, with the fetch, action, guard, table, and empty patterns written once.

## Decisions (owner away)

1. **Hooks are exercised through real pages.** No React test harness exists and adding one is a new dependency. `useLoad`, `useAction`, `usePaged`, `useRequireLayer`, and `DataTable` are covered by the Playwright specs of the pages that use them (`tools-pages.spec.ts`), plus pure unit tests for `company-mark`.
2. **`usePaged` + `LoadMore` are added.** The cursor-paging block (ticket, key, "more", append) was copied into six pages by the paging slice; leaving it out would leave T8.1 half done. `useLoad` stays the simple one-shot fetch.
3. **`DataTable` keeps today's markup.** Header classes `num`/`row-actions`/`fit` and cell classes are written for both header and cell; the skeleton, the empty message, and `.sheet` are placed as the audited pages had them (`keepHead` for the three ledger lists, `bare` for tables inside another block).
4. **`lineActions` has one rule set.** The list has no freeze; the line card has it. `freeze` is an option, off for the list. A number locked for a package switch shows no immediate action (the backend refuses them).
5. **`useRequireLayer(layers)`** expels with `router.replace('/')`; `allowed` needs both the door and the account in `layers`.
6. **`names.ts`** holds `layerName/actionName/lineStatus/taskStatus`; `desk.tsx` re-exports them so no page import changes, and `office-shell.tsx` imports from `names.ts` (importing `desk.tsx` would be a cycle).

## Tasks

| # | Task | Files |
|---|---|---|
| 1 | Hooks | `lib/use-load.ts`, `lib/use-action.ts`, `lib/use-paged.ts`, `lib/use-require-layer.ts` |
| 2 | Components | `components/data-table.tsx`, `empty-state.tsx`, `load-more.tsx`, `line-actions.ts`, `names.ts` |
| 3 | `company-mark` + unit test | `lib/company-mark.ts`, `tests/company-mark.spec.ts` |
| 4 | Pages: ledger lists | `app/accounting`, `audit`, `operations` |
| 5 | Pages: numbers | `app/numbers/page.tsx`, `app/numbers/[id]/page.tsx` |
| 6 | Pages: the rest | `tasks`, `roles`, `users` (fetch and actions only), `packages`, `providers/*`, `reports/[kind]`, `app/page.tsx` |
| 7 | Shell | `office-shell.tsx` (`noticeAction` removed), `shell-search.tsx` (ignores `nextCursor`) |
| 8 | Dead code | `app/plans`, `staff`, `wallets`, `ledger/[scope]`; `RowIcon` unexported; `four-layers.html` to `docs/reference/` |
| 9 | Verify | `tests/dom-snapshot.mjs` before/after, `tests/tools-pages.spec.ts`, tsc, eslint, Playwright, `next build` |

## Later (named while working, not built here)

- `toast.tsx` and its provider in `layout.tsx` are dead; deleting them needs a `layout.tsx` edit (owned by the infra slice).
- `ApplyResult` and the `run` wrappers of `numbers` could move into `lineActions` callers once the T9 split lands.
