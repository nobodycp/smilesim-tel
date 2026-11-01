# Pearl Rebuild Phase 2 (Table Pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inconsistent `.filter-line` markup with the documented `.filter-bar`/`.filter-panel` pattern across the five table pages that have a filter (users, numbers, tasks, operations, packages), fix the one verified empty-state gap on the packages page, then delete the dead `.filter-line` CSS.

**Architecture:** One new shared component (`FilterBar`) wraps the existing `.filter-bar`/`.filter-panel` CSS (already defined in `desk.css`, currently unused by any page). Each page keeps its own filter fields and `onChange` handlers untouched — only the wrapping markup changes, from a raw `<div className="filter-line">` to `<FilterBar>`. No new CSS is needed for the wrapper; `desk.css` already has `.filter-bar`, `.filter-panel`, and the `.desk > .filter-bar + .pane` merge rule. The old `.filter-line` rules are deleted only after every page that used them has moved over.

**Tech Stack:** Next.js (App Router), React, hand-written CSS with `--rd-*` custom properties. No Tailwind, no new dependency.

**Spec:** `docs/superpowers/specs/2026-11-01-pearl-rebuild-phase2-tables-design.md`

## Global Constraints

- No raw hex or `rgba()` outside `tokens.css`.
- Logical properties only; no physical `left`/`right`/`ml-*`/`mr-*` in new or touched CSS.
- Fonts stay Tajawal / IBM Plex Sans Hebrew — no font change.
- Keep `tsc --noEmit` and `next build` green after every task.
- **Every page file this plan touches already has pre-existing, unrelated, uncommitted changes from the project owner** (confirmed via `git status --short` on 2026-11-01: `users/page.tsx`, `numbers/page.tsx`, `tasks/page.tsx`, `operations/page.tsx`, `packages/page.tsx` are all already modified in the working tree before this plan starts). Before editing any of these files:
  1. Run `git diff -- <file>` first and read it, so you know which lines are the owner's in-progress work.
  2. Make only the exact, minimal edit this task describes — do not touch, reformat, or "clean up" any other part of the file.
  3. **Never run `git add -A` or `git add .`** for these files. Stage only the lines this task changed.
  4. If `git add -p` cannot cleanly split your change from the owner's interleaved edits on the same lines, reconstruct the target blob by hand: take the last-committed version (`git show HEAD:<file>`), apply only this task's edit to it in a scratch copy, then stage that exact content with `git hash-object -w <scratch-file>` + `git update-index --cacheinfo 100644,<hash>,<file>`. Leave the owner's edits unstaged in the working tree either way.
  5. If a task's described old-code block does not match what you find in the file (because the owner's uncommitted work already changed that exact region), stop and report the mismatch instead of guessing — do not improvise a different edit.

## Review Focus

- **DOM adjacency matters for CSS.** `desk.css` has `.desk > .filter-bar + .pane { margin-top: -14px; border-top: 0; ... }` — this only applies when `<FilterBar>`'s rendered `<div className="filter-bar">` is immediately followed, with no wrapper in between, by a `<section className="pane">` as the next sibling. Where a page's filter is followed by something else (e.g. the packages grouped view's `<div className="stack">`), this is expected and fine — `.filter-bar` still renders correctly as a standalone card, just without the merged-top-corner treatment.
- **RTL/LTR:** `.filter-panel` is a CSS grid (`repeat(auto-fit, minmax(160px, 220px))` desktop, `1fr 1fr` under 720px) — check both directions at 1280px and 390px; nothing here should need a `dir` override since logical properties already handle it.
- **No `onChange`/state logic changes.** Every task in this plan is a pure markup/wrapper swap. If a diff touches a `useState`, `useEffect`, or handler function body, that's out of scope — revert it.
- **Packages page is the riskiest file** (two separate filter call sites in two different components, plus the one real logic fix in Task 6). Read the whole file before editing, per the Global Constraints git-hygiene steps.

---

## Task 1: `FilterBar` shared component

**Files:**
- Create: `apps/web/components/filter-bar.tsx`
- Modify: `apps/web/DESIGN.md`

**Interfaces:**
- Produces: `export function FilterBar({ children, onClear, clearLabel }: { children: ReactNode; onClear?: () => void; clearLabel?: string }): JSX.Element` in `apps/web/components/filter-bar.tsx`.

- [ ] **Step 1: Write the component**

```tsx
import type { ReactNode } from 'react';

/**
 * A thin wrapper over `.filter-bar` / `.filter-panel`. It writes the markup content-ui.mdc
 * defines ("Filters: `.filter-bar` > `.filter-panel`, above the table") and nothing else.
 * Each field is a plain `<label>` child; this component only owns the card chrome and the
 * optional trailing clear button.
 */
export function FilterBar({
  children,
  onClear,
  clearLabel,
}: {
  children: ReactNode;
  onClear?: () => void;
  clearLabel?: string;
}) {
  return (
    <div className="filter-bar">
      <div className="filter-panel">
        {children}
        {onClear ? (
          <button type="button" className="secondary" onClick={onClear}>
            {clearLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Document it in `DESIGN.md`**

  In the "Components" section, add a bullet after the "KPI" bullet (keep the one-sentence-per-component style already used there):
  ```markdown
  - Filter: `FilterBar` wraps `.filter-bar`/`.filter-panel` — a card of `<label>` fields above the table, with an optional trailing clear button (`onClear`/`clearLabel`). This is the only filter pattern; do not write a bare `.filter-line` or inline filter markup on a new page.
  ```

  Also correct the "Known gaps" section's stale "Shell gaps" list — Phase 1 already fixed the two bullets below (shell controls are 2.5rem/44px, not 2.6rem/41.6px; `.nav-label` uses `--rd-muted`, not `--rd-faint`), but the two genuinely-still-open items from Phase 1's Task 2 were never recorded. Replace:
  ```markdown
  Shell gaps (Pearl rebuild phase 1 targets the header, sidebar, and drawer; until then):

  - `.sidebar` animates `width` (180ms), which is not transform or opacity.
  - `.nav-label` and `.nav-link.locked` use `--rd-faint` for text (about 2.5:1 light, 3.4:1 dark).
  - `.shell-icon` and `.avatar-btn` are 2.6rem (about 41.6px), under 44px, and the topbar has no 44px mode.
  - Focus rings on `.icon-btn` (inside the drawer), `.lang`, `.nav-link`, `.user-btn`, and `.menu` items are the 16% `--rd-focus` outline, which is faint.
  ```
  with:
  ```markdown
  Shell gaps (Pearl rebuild phase 1 landed the header, sidebar, and drawer; two items remain):

  - `.sidebar` animates `width` (180ms), which is not transform or opacity.
  - At widths near 390px, the topbar's control row (search toggle, wallet chip, bell, theme, language, avatar) can approach the viewport width; not yet stress-tested below 390px.
  - `.shell-icon`, `.avatar-btn`, `.wallet-btn`, and `.shell-search-toggle` are not yet in the shared `:focus-visible` rule in `base.css` (every other interactive control is).
  ```

- [ ] **Step 3: Verify**
  Run `npx tsc --noEmit` (apps/web) — must pass. `filter-bar.tsx` has no consumer yet, so nothing else to check for it; proofread the `DESIGN.md` edit for typos.

- [ ] **Step 4: Commit**
  `git add apps/web/components/filter-bar.tsx apps/web/DESIGN.md && git commit -m "feat(web): add shared FilterBar component, correct DESIGN.md shell gaps"`

---

## Task 2: Users page — filter swap

**Depends on:** Task 1.

**Files:**
- Modify: `apps/web/app/users/page.tsx`

**Interfaces:**
- Consumes: `FilterBar` from Task 1 (`import { FilterBar } from '../../components/filter-bar';`).

- [ ] **Step 1: Read the current state**
  `git diff -- apps/web/app/users/page.tsx` — note what the owner already changed so you don't touch it.

- [ ] **Step 2: Add the import**
  Add `import { FilterBar } from '../../components/filter-bar';` to the import block.

- [ ] **Step 3: Replace the filter markup**

  Find this block:
  ```tsx
      <div className="filter-line">
        <label>
          {t.accountName}
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          {t.layer}
          <select value={layerFilter} onChange={(event) => setLayerFilter(event.target.value)}>
            <option value="">{t.allRows}</option>
            {layerOrder.map((value) => (
              <option key={value} value={value}>{layerName(t, value)}</option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => { setQuery(''); setLayerFilter(''); }}>{t.clearFilters}</button>
      </div>
  ```

  Replace it with:
  ```tsx
      <FilterBar onClear={() => { setQuery(''); setLayerFilter(''); }} clearLabel={t.clearFilters}>
        <label>
          {t.accountName}
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          {t.layer}
          <select value={layerFilter} onChange={(event) => setLayerFilter(event.target.value)}>
            <option value="">{t.allRows}</option>
            {layerOrder.map((value) => (
              <option key={value} value={value}>{layerName(t, value)}</option>
            ))}
          </select>
        </label>
      </FilterBar>
  ```

- [ ] **Step 4: Verify**
  `npx tsc --noEmit`. Start the dev server, open `/users` in light+dark, `ar`+`en`, at 1280px and 390px. Confirm the filter card renders above the table with no gap/overlap glitch, and the search/select still filter the table live.

- [ ] **Step 5: Commit**
  Stage only this task's lines per the Global Constraints git-hygiene steps, then:
  `git commit -m "style(web): move users filter to FilterBar"`

---

## Task 3: Numbers page — filter swap

**Depends on:** Task 1.

**Files:**
- Modify: `apps/web/app/numbers/page.tsx`

**Interfaces:**
- Consumes: `FilterBar` from Task 1.

- [ ] **Step 1: Read the current state**
  `git diff -- apps/web/app/numbers/page.tsx`.

- [ ] **Step 2: Add the import**
  Add `import { FilterBar } from '../../components/filter-bar';`.

- [ ] **Step 3: Replace the filter markup**

  Find this block:
  ```tsx
      <div className="filter-line">
        {!isPos && <OutcomePick value={outcome} onChange={setOutcome} />}
        <label>
          {t.numberSearch}
          <input value={query} dir="ltr" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          {t.status}
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t.allRows}</option>
            <option value="active">{t.lineActive}</option>
            <option value="frozen">{t.lineFrozen}</option>
            <option value="disconnected">{t.lineDisconnected}</option>
          </select>
        </label>
        <label>
          {t.packageName}
          <select value={pack} onChange={(event) => setPack(event.target.value)}>
            <option value="">{t.allRows}</option>
            {packageOptions.map((row) => (
              <option key={row.code} value={row.code}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => { setQuery(''); setNeedle(''); setStatus(''); setPack(''); }}>
          {t.clearFilters}
        </button>
      </div>
  ```

  Replace it with:
  ```tsx
      <FilterBar onClear={() => { setQuery(''); setNeedle(''); setStatus(''); setPack(''); }} clearLabel={t.clearFilters}>
        {!isPos && <OutcomePick value={outcome} onChange={setOutcome} />}
        <label>
          {t.numberSearch}
          <input value={query} dir="ltr" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          {t.status}
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t.allRows}</option>
            <option value="active">{t.lineActive}</option>
            <option value="frozen">{t.lineFrozen}</option>
            <option value="disconnected">{t.lineDisconnected}</option>
          </select>
        </label>
        <label>
          {t.packageName}
          <select value={pack} onChange={(event) => setPack(event.target.value)}>
            <option value="">{t.allRows}</option>
            {packageOptions.map((row) => (
              <option key={row.code} value={row.code}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      </FilterBar>
  ```

- [ ] **Step 4: Verify**
  `npx tsc --noEmit`. Open `/numbers` in light+dark, `ar`+`en`, 1280px and 390px, as both a non-POS and a POS account (the `OutcomePick` only shows for non-POS — confirm the grid still looks right with 2 vs 3 fields).

- [ ] **Step 5: Commit**
  Stage only this task's lines, then:
  `git commit -m "style(web): move numbers filter to FilterBar"`

---

## Task 4: Tasks page — filter swap

**Depends on:** Task 1.

**Files:**
- Modify: `apps/web/app/tasks/page.tsx`

**Interfaces:**
- Consumes: `FilterBar` from Task 1.

- [ ] **Step 1: Read the current state**
  `git diff -- apps/web/app/tasks/page.tsx`.

- [ ] **Step 2: Add the import**
  Add `import { FilterBar } from '../../components/filter-bar';`.

- [ ] **Step 3: Replace the filter markup**

  Find this block:
  ```tsx
      <div className="filter-line">
        <label>
          {t.status}
          <select value={focus} onChange={(event) => setFocus(event.target.value)}>
            <option value="">{t.allRows}</option>
            <option value="pending">{taskStatus(t, 'pending')}</option>
            <option value="working">{taskStatus(t, 'working')}</option>
            <option value="done">{taskStatus(t, 'done')}</option>
            <option value="cancelled">{taskStatus(t, 'cancelled')}</option>
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => setFocus('')}>{t.clearFilters}</button>
      </div>
  ```

  Replace it with:
  ```tsx
      <FilterBar onClear={() => setFocus('')} clearLabel={t.clearFilters}>
        <label>
          {t.status}
          <select value={focus} onChange={(event) => setFocus(event.target.value)}>
            <option value="">{t.allRows}</option>
            <option value="pending">{taskStatus(t, 'pending')}</option>
            <option value="working">{taskStatus(t, 'working')}</option>
            <option value="done">{taskStatus(t, 'done')}</option>
            <option value="cancelled">{taskStatus(t, 'cancelled')}</option>
          </select>
        </label>
      </FilterBar>
  ```

- [ ] **Step 4: Verify**
  `npx tsc --noEmit`. Open `/tasks` in light+dark, `ar`+`en`, 1280px and 390px. A single-field filter bar should still look reasonable, not stranded — if the single field + clear button look sparse in the wide `.filter-panel` grid, that is expected (the grid uses `minmax(160px, 220px)` and will not stretch a single item full-width; this is correct, do not add width overrides).

- [ ] **Step 5: Commit**
  Stage only this task's lines, then:
  `git commit -m "style(web): move tasks filter to FilterBar"`

---

## Task 5: Operations page — filter swap

**Depends on:** Task 1.

**Files:**
- Modify: `apps/web/app/operations/page.tsx`

**Interfaces:**
- Consumes: `FilterBar` from Task 1.

- [ ] **Step 1: Read the current state**
  `git diff -- apps/web/app/operations/page.tsx`.

- [ ] **Step 2: Add the import**
  Add `import { FilterBar } from '../../components/filter-bar';`.

- [ ] **Step 3: Replace the filter markup**

  Find this block:
  ```tsx
      <div className="filter-line">
        <label>
          {t.kind}
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">{t.allRows}</option>
            {kinds.map((item) => (
              <option key={item} value={item}>{actionName(t, item)}</option>
            ))}
          </select>
        </label>
        <label>
          {t.direction}
          <select value={direction} onChange={(event) => setDirection(event.target.value)}>
            <option value="">{t.allRows}</option>
            <option value="in">{t.increase}</option>
            <option value="out">{t.decrease}</option>
          </select>
        </label>
        <label>
          {t.from}
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          {t.to}
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <button type="button" className="secondary" onClick={() => { setKind(''); setDirection(''); setFrom(''); setTo(''); }}>{t.clearFilters}</button>
      </div>
  ```

  Replace it with:
  ```tsx
      <FilterBar onClear={() => { setKind(''); setDirection(''); setFrom(''); setTo(''); }} clearLabel={t.clearFilters}>
        <label>
          {t.kind}
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">{t.allRows}</option>
            {kinds.map((item) => (
              <option key={item} value={item}>{actionName(t, item)}</option>
            ))}
          </select>
        </label>
        <label>
          {t.direction}
          <select value={direction} onChange={(event) => setDirection(event.target.value)}>
            <option value="">{t.allRows}</option>
            <option value="in">{t.increase}</option>
            <option value="out">{t.decrease}</option>
          </select>
        </label>
        <label>
          {t.from}
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          {t.to}
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </FilterBar>
  ```

- [ ] **Step 4: Verify**
  `npx tsc --noEmit`. Open `/operations` in light+dark, `ar`+`en`, 1280px and 390px. Four fields should wrap into two rows of two under 720px per the existing `.filter-panel` media rule — confirm the date inputs stay usable at that width.

- [ ] **Step 5: Commit**
  Stage only this task's lines, then:
  `git commit -m "style(web): move operations filter to FilterBar"`

---

## Task 6: Packages page — filter swap (both sites) + empty-state fix

**Depends on:** Task 1.

**Files:**
- Modify: `apps/web/app/packages/page.tsx`

**Interfaces:**
- Consumes: `FilterBar` from Task 1, `EmptyState` from `apps/web/components/empty-state.tsx` (existing, no signature change needed — pass plain text children as today's other call sites do).

This page has two separate filter call sites (`BranchPackages`, and the default `PlansPage` export's agent/main_agent view) plus one real, currently-reachable gap: the agent/main_agent grouped-by-company view renders nothing at all (no table, no message) when the filtered/loaded package list is empty.

- [ ] **Step 1: Read the current state**
  `git diff -- apps/web/app/packages/page.tsx` — this file has pre-existing owner changes; read the whole diff before touching anything.

- [ ] **Step 2: Add imports**
  Add `import { FilterBar } from '../../components/filter-bar';` and `import { EmptyState } from '../../components/empty-state';` to the top-level import block (both are used by code added in Steps 3-5 below).

- [ ] **Step 3: `BranchPackages` filter swap**

  Find this block (inside `function BranchPackages`):
  ```tsx
      <div className="filter-line">
        <label>
          {t.packageName}
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          {t.company}
          <select value={company} onChange={(event) => {
            const next = event.target.value;
            setCompany(next);
            if (next && provider && !rows.some((row) => row.companyName === next && row.providerName === provider)) setProvider('');
          }}>
            <option value="">{t.allRows}</option>
            {companies.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          {t.provider}
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="">{t.allRows}</option>
            {providers.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          {t.status}
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t.allRows}</option>
            <option value="on">{t.lineActive}</option>
            <option value="off">{t.stopped}</option>
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => { setQuery(''); setCompany(''); setProvider(''); setStatus(''); }}>{t.clearFilters}</button>
      </div>
  ```

  Replace it with:
  ```tsx
      <FilterBar onClear={() => { setQuery(''); setCompany(''); setProvider(''); setStatus(''); }} clearLabel={t.clearFilters}>
        <label>
          {t.packageName}
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          {t.company}
          <select value={company} onChange={(event) => {
            const next = event.target.value;
            setCompany(next);
            if (next && provider && !rows.some((row) => row.companyName === next && row.providerName === provider)) setProvider('');
          }}>
            <option value="">{t.allRows}</option>
            {companies.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          {t.provider}
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="">{t.allRows}</option>
            {providers.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          {t.status}
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t.allRows}</option>
            <option value="on">{t.lineActive}</option>
            <option value="off">{t.stopped}</option>
          </select>
        </label>
      </FilterBar>
  ```

- [ ] **Step 4: `PlansPage` default export filter swap**

  Find this block (inside `export default function PlansPage`, the non-POS/non-branch return path):
  ```tsx
      <div className="filter-line">
        <label>
          {t.company}
          <select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}>
            <option value="">{t.allRows}</option>
            {companyNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => setCompanyFilter('')}>{t.clearFilters}</button>
      </div>
  ```

  Replace it with:
  ```tsx
      <FilterBar onClear={() => setCompanyFilter('')} clearLabel={t.clearFilters}>
        <label>
          {t.company}
          <select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}>
            <option value="">{t.allRows}</option>
            {companyNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
      </FilterBar>
  ```

- [ ] **Step 5: Fix the empty-state gap**

  Immediately after Step 4's block, find:
  ```tsx
      <div className="stack">
        {showProvider
          ? sections.map((section) => (
  ```

  And its closing, a few lines below:
  ```tsx
            ))}
      </div>
    </Desk>
  );
}
```

  The full current block to replace is:
  ```tsx
      <div className="stack">
        {showProvider
          ? sections.map((section) => (
              <section className="pane" key={section.key}>
                <header className="pane-head">
                  <div>
                    <p className="eyebrow">{t.provider}</p>
                    <h2>{section.provider}</h2>
                  </div>
                </header>
                {section.companies.map((company) => (
                  <div className="pane-body" key={company.name}>
                    <CompanyTitle name={company.name} image={marks.find((mark) => mark.name === company.name)?.image ?? ''} label={t.company} />
                    {priceTable(company.rows)}
                  </div>
                ))}
              </section>
            ))
          : sections[0]?.companies.map((company) => (
              <section className="pane" key={company.name}>
                <header className="pane-head">
                  <CompanyTitle name={company.name} image={marks.find((mark) => mark.name === company.name)?.image ?? ''} label={t.company} heading />
                </header>
                <div className="pane-body">{priceTable(company.rows)}</div>
              </section>
            ))}
      </div>
    </Desk>
  );
}
```

  Replace it with (adds one `listed.length === 0` branch before the existing two, nothing else changes):
  ```tsx
      {listed.length === 0 ? (
        <section className="pane">
          <EmptyState>{t.noLines}</EmptyState>
        </section>
      ) : (
        <div className="stack">
          {showProvider
            ? sections.map((section) => (
                <section className="pane" key={section.key}>
                  <header className="pane-head">
                    <div>
                      <p className="eyebrow">{t.provider}</p>
                      <h2>{section.provider}</h2>
                    </div>
                  </header>
                  {section.companies.map((company) => (
                    <div className="pane-body" key={company.name}>
                      <CompanyTitle name={company.name} image={marks.find((mark) => mark.name === company.name)?.image ?? ''} label={t.company} />
                      {priceTable(company.rows)}
                    </div>
                  ))}
                </section>
              ))
            : sections[0]?.companies.map((company) => (
                <section className="pane" key={company.name}>
                  <header className="pane-head">
                    <CompanyTitle name={company.name} image={marks.find((mark) => mark.name === company.name)?.image ?? ''} label={t.company} heading />
                  </header>
                  <div className="pane-body">{priceTable(company.rows)}</div>
                </section>
              ))}
        </div>
      )}
    </Desk>
  );
}
```

  Note `t.noLines` is already used elsewhere in this same file (`BranchPackages`'s `DataTable empty` prop) — no new copy key needed.

- [ ] **Step 6: Verify**
  `npx tsc --noEmit`. Manually exercise all three role views (`PosCatalog`, `BranchPackages`, and the agent/main_agent grouped view) in light+dark, `ar`+`en`, 1280px and 390px. Specifically: filter the branch view down to zero rows (confirm its existing `DataTable empty` message still shows — unchanged by this task); filter the agent/main_agent view's company select to a company with packages (normal case, unchanged) — then, to exercise the new empty branch, temporarily confirm in the browser dev tools or by reasoning through the code that `listed.length === 0` is only reachable today if the catalog itself returns zero packages (there is no per-page filter that can zero out `listed` other than `companyFilter`, and `companyFilter`'s options are built from `rows` itself, so selecting any listed company cannot produce zero rows) — document this reasoning in the commit message rather than fabricating a test scenario that cannot occur with real data.

- [ ] **Step 7: Commit**
  Stage only this task's lines, then:
  `git commit -m "style(web): move packages filters to FilterBar, add empty state to agent price view"`

---

## Task 7: Delete dead `.filter-line` CSS

**Depends on:** Tasks 2, 3, 4, 5, 6 (all must have landed — this removes CSS those tasks' old markup needed).

**Files:**
- Modify: `apps/web/app/styles/desk.css`

- [ ] **Step 1: Confirm no references remain**
  Run `grep -rn "filter-line" apps/web --include="*.tsx"`. Expected: no output. If anything is still found, stop — a prior task's page was not actually converted; fix that first instead of deleting the CSS out from under it.

- [ ] **Step 2: Delete the rule block**
  In `desk.css`, delete the full `.filter-line` rule set — these five rules, found immediately before the `.filters label` rule:
  ```css
  .filter-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--rd-line);
    border-radius: var(--rd-radius-lg);
    background: var(--rd-surface);
  }
  .filter-line label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--rd-muted);
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
  }
  .filter-line input,
  .filter-line select {
    width: 8.5rem;
    height: 34px;
    background: var(--rd-surface);
  }
  .filter-line input { width: 11rem; }
  .filter-line .secondary { margin-inline-start: auto; }
  .filter-line > .stack {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }
  .filter-line .hint {
    margin: 0;
    color: var(--rd-muted);
    font-size: 12px;
    font-weight: 700;
  }
  ```
  (Confirm the exact lines in the current file with `grep -n "filter-line" apps/web/app/styles/desk.css` before deleting — line numbers may have shifted since this plan was written.)

- [ ] **Step 3: Verify**
  `npx tsc --noEmit` and `next build`. Reload every one of the five pages touched by Tasks 2-6 and confirm none of them regressed (no unstyled/broken filter row).

- [ ] **Step 4: Commit**
  `git add apps/web/app/styles/desk.css && git commit -m "chore(web): remove dead .filter-line CSS"`

---

## Task 8: Full verification pass

**Depends on:** Task 7.

**Files:** none (verification only); adds files under `docs/visual-review/2026-11-01/phase2-tables/`.

- [ ] **Step 1:** `npx tsc --noEmit` and `next build` both clean.
- [ ] **Step 2:** `npx playwright test` — compare the failing-test list against Phase 1's known-pre-existing failures (`companies-shelf.spec.ts`, `login.spec.ts` session-end, `tools-pages.spec.ts` double-click). Any *new* failure not on that list must be investigated and fixed before continuing; any failure already on that list is pre-existing and out of scope (confirm via `git diff -- <file touched by that spec>` showing unrelated owner changes, same as Phase 1).
- [ ] **Step 3:** Capture screenshots at 1280px and 390px, light+dark, of `/users`, `/numbers`, `/tasks`, `/operations`, and all three `/packages` role views (POS, branch, agent), into `docs/visual-review/2026-11-01/phase2-tables/`. Also capture `/roles`, `/companies`, `/providers` once each (light, 1280px, `ar`) as a plain visual QA check — these three pages received no code change in this plan; if a real defect is visible (not a stale assumption — check against the actual rendered page, not only the 2026-10-30 screenshots), fix it inline as a small addendum commit; if nothing is wrong, note that in the Result section and move on without inventing a change.
- [ ] **Step 4:** Compare the packages-page screenshots against `docs/visual-review/2026-10-30/design-system/after-packages-light-en-1280.jpg` specifically, to confirm the empty-section rendering problem shown there no longer reproduces with current data (or, if it was already stale/inapplicable to current code, say so plainly).
- [ ] **Step 5:** Write a `## Result` section into `docs/superpowers/specs/2026-11-01-pearl-rebuild-phase2-tables-design.md`, same before/after format as Phase 1's.
- [ ] **Step 6: Commit**
  `git add docs/visual-review/2026-11-01/phase2-tables docs/superpowers/specs/2026-11-01-pearl-rebuild-phase2-tables-design.md && git commit -m "docs(web): phase 2 verification screenshots and result note"`
