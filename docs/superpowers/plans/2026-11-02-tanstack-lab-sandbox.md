# TanStack lab sandbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hidden, branch-only `/sandbox/tanstack-lab` page that renders the same `officeLines` data twice — once through the existing `usePaged` + `PagedTable`, once through `@tanstack/react-query` + `@tanstack/react-table` with client-side sorting added — so the team can compare them on real data.

**Architecture:** One new route folder, `apps/web/app/sandbox/tanstack-lab/`, with its own layout (scoped `QueryClientProvider`), two pane components (one per approach), and a page that lays them out side by side. No existing file changes except `package.json` (two new deps) and the lockfile.

**Tech Stack:** Next.js (existing), `@tanstack/react-query`, `@tanstack/react-table`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-02-tanstack-lab-sandbox-design.md`.
- Route is reachable only by URL — no nav link anywhere.
- Gated by `useRequireLayer(['branch'])` (see `apps/web/app/providers/page.tsx` for the pattern).
- Read-only: no mutations, no activation form, no filters.
- Reuses `api.officeLines` — no backend changes.
- `QueryClientProvider` lives only in this route's `layout.tsx`, not in the root layout.
- No new CSS file or class added to `apps/web/app/styles/`. Layout spacing for the two panes uses an inline `style` on the wrapping `div` only, since this page is marked temporary and is not part of the design system surface.
- Page must be checked in Arabic, English, light and dark before the task is considered done (`interface-direction` skill).

---

### Task 1: Add TanStack dependencies

**Files:**
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces: `@tanstack/react-query` and `@tanstack/react-table` importable from any file under `apps/web`.

- [ ] **Step 1: Add the two dependencies**

In `apps/web/package.json`, add to `"dependencies"` (keep alphabetical with the existing two entries):

```json
"dependencies": {
  "@tanstack/react-query": "^5.90.0",
  "@tanstack/react-table": "^8.21.3",
  "next": "^16.4.3",
  "react": "^19.3.1",
  "react-dom": "^19.3.1"
}
```

- [ ] **Step 2: Install**

Run: `npm install --workspace web`
Expected: lockfile at repo root updates; no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json package-lock.json
git commit -m "chore(web): add TanStack Query and Table for sandbox comparison"
```

---

### Task 2: Scoped QueryClientProvider

**Files:**
- Create: `apps/web/app/sandbox/tanstack-lab/query-provider.tsx`
- Create: `apps/web/app/sandbox/tanstack-lab/layout.tsx`

**Interfaces:**
- Consumes: `QueryClient`, `QueryClientProvider` from `@tanstack/react-query`.
- Produces: `TanstackLabQueryProvider` component, used only by this route's `layout.tsx`. No other file in the app imports it.

- [ ] **Step 1: Write the provider**

`apps/web/app/sandbox/tanstack-lab/query-provider.tsx`:

```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

// Scoped to /sandbox/tanstack-lab only. No other route gets a query client;
// this is deliberate — see docs/superpowers/specs/2026-11-02-tanstack-lab-sandbox-design.md.
export function TanstackLabQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 2: Write the route layout**

`apps/web/app/sandbox/tanstack-lab/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { TanstackLabQueryProvider } from './query-provider';

export default function TanstackLabLayout({ children }: { children: ReactNode }) {
  return <TanstackLabQueryProvider>{children}</TanstackLabQueryProvider>;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:web`
Expected: no errors from the two new files (the route's `page.tsx` doesn't exist yet, so this only checks these two files parse and type-check standalone; a full pass happens in Task 5).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/sandbox/tanstack-lab/query-provider.tsx apps/web/app/sandbox/tanstack-lab/layout.tsx
git commit -m "feat(web): scoped QueryClientProvider for tanstack-lab sandbox"
```

---

### Task 3: Left pane — current approach

**Files:**
- Create: `apps/web/app/sandbox/tanstack-lab/current-pane.tsx`

**Interfaces:**
- Consumes: `usePaged` (`apps/web/lib/use-paged.ts`), `pick` (`apps/web/lib/use-load.ts`), `PagedTable`/`Column` (`apps/web/components/data-table.tsx`), `lineStatus` (`apps/web/components/desk.tsx`), `api.officeLines`/`LineRow` (`apps/web/lib/api.ts`), `usePrefs` (`apps/web/lib/prefs.tsx`).
- Produces: `CurrentPane` component, no props, rendered by `page.tsx` (Task 5).

- [ ] **Step 1: Write the pane**

`apps/web/app/sandbox/tanstack-lab/current-pane.tsx`:

```tsx
'use client';

import { PagedTable, type Column } from '../../../components/data-table';
import { lineStatus } from '../../../components/desk';
import { api, type LineRow } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { pick } from '../../../lib/use-load';
import { usePaged } from '../../../lib/use-paged';

/** Left pane: the existing data layer, unmodified. The control in this comparison. */
export function CurrentPane() {
  const { t } = usePrefs();
  const list = usePaged<LineRow>('all', async (cursor) =>
    pick(await api.officeLines({ cursor }), (data) => ({ rows: data.lines, next: data.nextCursor })),
  );

  const columns: Column<LineRow>[] = [
    { key: 'number', header: t.number, cell: 'msisdn', render: (line) => <bdi dir="ltr">{line.msisdn}</bdi> },
    { key: 'company', header: t.company, render: (line) => line.companyName || '—' },
    { key: 'package', header: t.packageName, render: (line) => line.packageName },
    {
      key: 'status',
      header: t.status,
      render: (line) => (
        <span className={line.status === 'active' ? 'badge' : line.status === 'frozen' ? 'badge pending' : 'badge cancelled'}>
          {lineStatus(t, line.status)}
        </span>
      ),
    },
    { key: 'ends', header: t.endsOn, render: (line) => new Date(line.endsAt).toLocaleDateString() },
  ];

  return (
    <section className="pane">
      <header className="pane-head">
        <h2>usePaged + PagedTable</h2>
      </header>
      {list.error && <p className="hint">{list.error}</p>}
      <PagedTable list={list} columns={columns} rowKey={(line) => line.id} empty={t.noLines} skeleton={{ rows: 5, columns: 5 }} />
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/sandbox/tanstack-lab/current-pane.tsx
git commit -m "feat(web): tanstack-lab left pane using existing usePaged/PagedTable"
```

---

### Task 4: Right pane — TanStack Query + Table, with client-side sort

**Files:**
- Create: `apps/web/app/sandbox/tanstack-lab/tanstack-pane.tsx`

**Interfaces:**
- Consumes: `useInfiniteQuery` (`@tanstack/react-query`), `useReactTable`/`flexRender`/`getCoreRowModel`/`getSortedRowModel` (`@tanstack/react-table`), `EmptyState` (`apps/web/components/empty-state.tsx`), `LoadMore` (`apps/web/components/load-more.tsx`), `TableSkeleton` (`apps/web/components/loading.tsx`), `lineStatus` (`apps/web/components/desk.tsx`), `api.officeLines`/`LineRow` (`apps/web/lib/api.ts`), `usePrefs` (`apps/web/lib/prefs.tsx`).
- Produces: `TanstackPane` component, no props, rendered by `page.tsx` (Task 5). Renders the same `.sheet > table.data` markup `DataTable` uses, built by hand with `flexRender`, so the table looks like every other table in the app.

- [ ] **Step 1: Write the pane**

`apps/web/app/sandbox/tanstack-lab/tanstack-pane.tsx`:

```tsx
'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { lineStatus } from '../../../components/desk';
import { EmptyState } from '../../../components/empty-state';
import { LoadMore } from '../../../components/load-more';
import { TableSkeleton } from '../../../components/loading';
import { api, type LineRow } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';

/**
 * Right pane: TanStack Query (cursor pagination via `useInfiniteQuery`) and TanStack Table
 * (headless, rendered through Pearl's own `.sheet` / `.data` markup). The "ends on" column is
 * sortable client-side — the one capability the left pane does not have today, included so the
 * comparison shows a real gap instead of two ways to draw the same fetch.
 */
export function TanstackPane() {
  const { t, locale } = usePrefs();
  const [sorting, setSorting] = useState<SortingState>([]);

  const query = useInfiniteQuery({
    queryKey: ['tanstack-lab-lines'],
    queryFn: async ({ pageParam }) => {
      const result = await api.officeLines({ cursor: pageParam });
      if (!result.ok) throw new Error(result.message);
      return result.data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.lines) ?? [], [query.data]);

  const columns = useMemo<ColumnDef<LineRow>[]>(
    () => [
      { accessorKey: 'msisdn', header: t.number, cell: (info) => <bdi dir="ltr">{info.getValue<string>()}</bdi> },
      { accessorKey: 'companyName', header: t.company, cell: (info) => info.getValue<string>() || '—' },
      { accessorKey: 'packageName', header: t.packageName },
      {
        accessorKey: 'status',
        header: t.status,
        cell: (info) => {
          const value = info.getValue<string>();
          return (
            <span className={value === 'active' ? 'badge' : value === 'frozen' ? 'badge pending' : 'badge cancelled'}>
              {lineStatus(t, value)}
            </span>
          );
        },
      },
      {
        accessorKey: 'endsAt',
        header: t.endsOn,
        enableSorting: true,
        cell: (info) => new Date(info.getValue<string>()).toLocaleDateString(),
      },
    ],
    [t],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const errorMessage = query.error instanceof Error ? query.error.message : '';
  const sortHint =
    locale === 'en'
      ? 'Click "ends on" to sort — the left pane cannot do this today.'
      : locale === 'he'
        ? 'לחצו על "מסתיים ב" כדי למיין — הלוח השמאלי לא יכול לעשות זאת כיום.'
        : 'اضغط على "تنتهي في" للفرز — اللوحة اليسرى لا تقدر تعمل هذا حاليًا.';

  return (
    <section className="pane">
      <header className="pane-head">
        <h2>TanStack Query + Table</h2>
      </header>
      <p className="hint">{sortHint}</p>
      {errorMessage && <p className="hint">{errorMessage}</p>}
      {query.isLoading ? (
        <div className="sheet">
          <TableSkeleton rows={5} columns={5} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState>{t.noLines}</EmptyState>
      ) : (
        <div className="sheet">
          <table className="data">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      style={header.column.getCanSort() ? { cursor: 'pointer' } : undefined}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' ? ' ▲' : header.column.getIsSorted() === 'desc' ? ' ▼' : ''}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {query.hasNextPage && (
        <LoadMore shown={rows.length} loading={query.isFetchingNextPage} onMore={() => void query.fetchNextPage()} />
      )}
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/sandbox/tanstack-lab/tanstack-pane.tsx
git commit -m "feat(web): tanstack-lab right pane using TanStack Query/Table with client sort"
```

---

### Task 5: Page, banner, and layer gate

**Files:**
- Create: `apps/web/app/sandbox/tanstack-lab/page.tsx`

**Interfaces:**
- Consumes: `Desk` (`apps/web/components/desk.tsx`), `useRequireLayer` (`apps/web/lib/use-require-layer.ts`), `usePrefs` (`apps/web/lib/prefs.tsx`), `CurrentPane` (Task 3), `TanstackPane` (Task 4).
- Produces: the route itself, `GET /sandbox/tanstack-lab`.

- [ ] **Step 1: Write the page**

`apps/web/app/sandbox/tanstack-lab/page.tsx`:

```tsx
'use client';

import { Desk } from '../../../components/desk';
import { usePrefs } from '../../../lib/prefs';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { CurrentPane } from './current-pane';
import { TanstackPane } from './tanstack-pane';

const BRANCH = ['branch'];

export default function TanstackLabPage() {
  const { locale } = usePrefs();
  const allowed = useRequireLayer(BRANCH);

  const banner =
    locale === 'en'
      ? 'Internal evaluation tool, not a feature. Compares the current data layer with TanStack Query + Table on the same data. Delete this route after the comparison is reviewed.'
      : locale === 'he'
        ? 'כלי הערכה פנימי, לא תכונה. משווה את שכבת הנתונים הנוכחית מול TanStack Query + Table על אותם נתונים. יש למחוק נתיב זה אחרי סקירת ההשוואה.'
        : 'أداة تقييم داخلية، مو ميزة. تقارن طبقة البيانات الحالية مع TanStack Query + Table على نفس البيانات. تُحذف هذه الصفحة بعد مراجعة المقارنة.';

  return (
    <Desk title={allowed ? 'TanStack lab' : ''} lede="" error="" note="">
      <p className="hint" role="note">
        {banner}
      </p>
      {allowed && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))' }}>
          <CurrentPane />
          <TanstackPane />
        </div>
      )}
    </Desk>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/sandbox/tanstack-lab/page.tsx
git commit -m "feat(web): tanstack-lab page, gated to branch layer"
```

---

### Task 6: Verify

**Files:** none (verification only).

- [ ] **Step 1: Typecheck and lint**

Run: `npm run typecheck:web && npm run lint --workspace web`
Expected: both pass with no errors in the new `app/sandbox/tanstack-lab/` files.

- [ ] **Step 2: Start the stack**

Run: `docker compose up --build` (or, without Docker: start postgres/redis, then `npm run build --workspace api && npm run start --workspace api` and `npm run dev --workspace web`, per `README.md`).

- [ ] **Step 3: Sign in and open the route**

Sign in at `http://admin.localhost:3000` with the trial `branch` account (`123456`, dev only, from `docker-compose.override.yml`). Navigate to `http://admin.localhost:3000/sandbox/tanstack-lab`.

Expected: the banner shows, both panes load the same lines, "load more" works in both, clicking "ends on" in the right pane sorts it (left pane has no such control).

- [ ] **Step 4: Check direction and theme**

Per the `interface-direction` skill: switch language to English, then Hebrew, then back to Arabic — the banner and headers must read correctly in each, and the page must stay RTL for ar/he and LTR for en. Toggle dark mode — the page fill, pane background, and badge colors must change (they come from `--rd-*` tokens already; nothing new was added here, but confirm nothing broke).

- [ ] **Step 5: Confirm the gate**

Open the same URL signed in as a non-`branch` layer (or signed out). Expected: redirected to `/`, per `useRequireLayer`.

- [ ] **Step 6: Final commit**

If Step 1–5 required any fixes, commit them:

```bash
git add -A
git commit -m "fix(web): tanstack-lab verification fixes"
```
