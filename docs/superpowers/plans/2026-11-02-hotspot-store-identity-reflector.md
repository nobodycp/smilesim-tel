# Hotspot Store identity reflector — Foundation + `/users` pilot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring hotspot-store's Tailwind-based UI primitives into `smilesim-tel`, repointed at Pearl's existing light/dark colours, and migrate `/users` end to end as the first page built entirely on them.

**Architecture:** Add Tailwind (utilities only — Preflight off, so the existing hand-rolled reset in `base.css` stays authoritative) and `lucide-react` alongside the current plain-CSS system. New primitives (`Button`, `Select`, `Table`, `Card`, `Badge`, `Pagination`) are fresh files ported from hotspot-store's `components/ui/*`. Five existing components that are already architecturally equivalent (`Dialog`, `RowMenu`, `FilterBar`, `EmptyState`, `TableSkeleton`) are reskinned in place — same file, same name, same public props — so every existing caller across the app inherits the new look without a code change. `/users` is the only page whose JSX changes in this slice, switching its buttons/table/select/badges to the new primitives.

**Tech Stack:** Next.js 16 / React 19 (unchanged) + Tailwind CSS 3.4 (Preflight disabled) + `lucide-react` + `clsx` + `tailwind-merge`.

**Spec:** `docs/superpowers/specs/2026-11-02-hotspot-store-identity-reflector.md`

## Global Constraints

- Tailwind config: `darkMode: "class"`, `corePlugins: { preflight: false }` (ruling: keeps the existing `base.css` reset authoritative; Tailwind's own reset is not part of the spec and would be a much larger, unreviewed blast radius — revisit only if a later slice needs it).
- Token mapping (both `:root` and `.dark` in `apps/web/app/styles/tokens.css`), exact resolutions:
  `--bg`→`--rd-bg`, `--surface`→`--rd-surface`, `--surface-2`→`--rd-surface-2`, `--surface-3`→`--rd-surface-3`,
  `--line`→`--rd-line`, `--line-soft`→`--rd-line-soft`, `--ink`→`--rd-ink`, `--ink-2`→`--rd-ink-2`,
  `--ink-3`→`--rd-muted`, `--ink-4`→`--rd-faint`, `--accent`→`--rd-primary-bg`, `--accent-2`→`--rd-primary-hover`,
  `--accent-fg`→`--rd-primary-fg`, `--accent-soft`→`color-mix(in srgb, var(--rd-primary-bg) 10%, transparent)`,
  `--good`→`--rd-success`, `--good-bg`→`--rd-success-soft`, `--warn`→`--rd-warning`, `--warn-bg`→`--rd-warning-soft`,
  `--bad`→`--rd-danger`, `--bad-bg`→`--rd-danger-soft`, `--focus-ring`→`--rd-focus`,
  `--shadow-card`→`--rd-shadow-card`, `--shadow-pop`→`--rd-shadow-pop`.
- `--rd-accent` (logo red) is not part of this mapping and is not referenced by any ported/reskinned component.
- Radius for every ported/reskinned surface: Tailwind `borderRadius.lg = "0.5rem"`, `borderRadius.xl = "0.625rem"` (config override, not `--rd-radius-lg`).
- `Badge`'s `info`/`violet` variants are ported as dead code this slice: typed and present, but `--info`/`--info-bg`/`--violet`/`--violet-bg` are **not** defined yet (nothing in `/users` needs them — YAGNI, per spec D2). Do not invent colours for them.
- Icons: `lucide-react`, imported directly per component (no central icon re-export needed for this slice).
- No `@/` path alias exists in this repo (`tsconfig.json` has no `paths`) and none is added — every ported file uses the same relative-import style already used throughout (see each task's exact import paths).
- hotspot-store hardcodes `dir="rtl"`; nothing in this plan copies that assumption. Any ported logic that reads direction must read `document.documentElement.dir` (already how `RowMenu`'s positioning and `.back-link svg` mirroring work) or use Tailwind's `rtl:`/`ltr:` variants, never assume RTL.
- `next build` is known to rewrite `apps/web/tsconfig.json` as a side effect. After every `next build` run: `git checkout -- apps/web/tsconfig.json` and confirm `git status --short apps/web/tsconfig.json` is empty before committing.
- Do not modify `forms.css`'s `.btn`/`button.danger`/input-height rules, or `desk.css`'s `.desk button.primary`/`.desk button.secondary`/`.desk input`/`.desk select` rules. `/login` and every page other than `/users` still reads them, and `apps/web/tests/desk-system.spec.ts` asserts their exact computed values (`34px`, `rgb(10, 10, 10)`, `1px` border) against synthetic elements on `/login` — these must stay green untouched.
- Do not modify `components/desk.tsx`, `.desk`, `.page-head`, or `.pane` — out of scope, and `apps/web/tests/desk.ts`'s `expectFullTable` helper (used by `users-desk.spec.ts`) asserts on `.desk .pane` directly.
- Reskinning `Dialog`, `RowMenu`, `FilterBar`, `EmptyState`, `TableSkeleton` changes their look on **every page that already uses them**, not just `/users` — this is the intended effect of D7 (no other page's code changes), but it means the final verification task must check at least one other page that uses each of these, not only `/users`.

## Review Focus

- RTL correctness: `RowMenu`'s reskinned trigger/panel and any mirrored icon must position and flip correctly under `dir="rtl"` (ar, he) and `dir="ltr"` (en) — not hardcoded to one direction. Task 5's steps include an explicit RTL check.
- Dark mode: every new/changed token must resolve in **both** `:root` and `.dark` in `tokens.css` — a value present in only one theme silently falls back to `initial`/transparent. Task 1's steps verify both blocks.
- `Dialog`'s focus trap, Escape-to-close, and body-scroll lock (existing `useEffect` logic in `components/dialog.tsx`) must survive the reskin — the task only touches JSX/className, not the behavioral `useEffect`s. Task 4 calls this out explicitly.
- `/users`'s `<bdi dir="ltr">{row.loginName}</bdi>` cell must still read start-to-end correctly once wrapped in the new `Table`/`Td` components and (if mobile-stacked) must not have its `data-label` flip to the wrong side — hotspot-store's own CSS has a specific `td[dir="ltr"]` rule for this that Task 3 must carry over.
- Button `disabled`/`loading` states (the dialog "save" buttons in `/users` bind `disabled={busy}`) must still render as visually disabled, not just functionally inert, after switching from `className="primary"` to `<Button>`. Task 7's steps check this on the create-account and per-row dialogs.

---

## Task 1: Tailwind foundation, `cn` helper, token mapping

**Files:**
- Modify: `apps/web/package.json` (add dependencies)
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/postcss.config.js`
- Create: `apps/web/lib/utils.ts`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/app/styles/tokens.css`

**Interfaces:**
- Produces: `cn(...inputs: import('clsx').ClassValue[]): string` in `apps/web/lib/utils.ts` — every later task imports this as `../../lib/utils` (or the correct relative depth for its own file location).
- Produces: the token set listed in Global Constraints, available in both `:root` and `.dark`.

- [ ] **Step 1: Add dependencies**

Add to `apps/web/package.json` `dependencies`: `"lucide-react": "0.468.0"`. Add to `devDependencies`:
`"tailwindcss": "3.4.17"`, `"postcss": "8.5.16"`, `"autoprefixer": "10.4.20"`, `"clsx": "2.1.1"`, `"tailwind-merge": "2.5.5"`
(versions match hotspot-store's own `package.json`, which is already proven against this exact component set). Run the repo's install command for `apps/web`.

- [ ] **Step 2: Create `apps/web/postcss.config.js`**

```js
module.exports = {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 3: Create `apps/web/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  corePlugins: { preflight: false },
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: { DEFAULT: 'var(--surface)', 2: 'var(--surface-2)', 3: 'var(--surface-3)' },
        line: { DEFAULT: 'var(--line)', soft: 'var(--line-soft)' },
        ink: { DEFAULT: 'var(--ink)', 2: 'var(--ink-2)', 3: 'var(--ink-3)', 4: 'var(--ink-4)' },
        accent: { DEFAULT: 'var(--accent)', 2: 'var(--accent-2)', soft: 'var(--accent-soft)', fg: 'var(--accent-fg)' },
        good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)',
      },
      borderRadius: { lg: '0.5rem', xl: '0.625rem' },
      boxShadow: { card: 'var(--shadow-card)', pop: 'var(--shadow-pop)' },
    },
  },
  plugins: [],
};
export default config;
```

One line on the choice: only the colour groups the ported components in this slice actually read (`bg/surface/line/ink/accent/good/warn/bad`) are declared — `info`/`violet` are intentionally omitted per Global Constraints.

- [ ] **Step 4: Create `apps/web/lib/utils.ts`**

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: Add Tailwind directives to `apps/web/app/globals.css`**

Add three lines **before** the existing comment/import block (do not reorder the existing `@import` lines relative to each other):

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* existing comment + @import lines unchanged below */
```

- [ ] **Step 6: Add the mapped tokens to `apps/web/app/styles/tokens.css`**

Inside the existing `:root { ... }` block, add (near the end, before `color-scheme: light;`):

```css
--bg: var(--rd-bg);
--surface: var(--rd-surface);
--surface-2: var(--rd-surface-2);
--surface-3: var(--rd-surface-3);
--line: var(--rd-line);
--line-soft: var(--rd-line-soft);
--ink: var(--rd-ink);
--ink-2: var(--rd-ink-2);
--ink-3: var(--rd-muted);
--ink-4: var(--rd-faint);
--accent: var(--rd-primary-bg);
--accent-2: var(--rd-primary-hover);
--accent-fg: var(--rd-primary-fg);
--accent-soft: color-mix(in srgb, var(--rd-primary-bg) 10%, transparent);
--good: var(--rd-success);
--good-bg: var(--rd-success-soft);
--warn: var(--rd-warning);
--warn-bg: var(--rd-warning-soft);
--bad: var(--rd-danger);
--bad-bg: var(--rd-danger-soft);
--focus-ring: var(--rd-focus);
--shadow-card: var(--rd-shadow-card);
--shadow-pop: var(--rd-shadow-pop);
```

Add the identical block (same variable names, no values change — they all resolve through the `--rd-*` names which already differ per theme) inside the existing `.dark { ... }` block, before `color-scheme: dark;`.

- [ ] **Step 7: Verify**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS, no new errors.

Run: `cd apps/web && npm run build`, then `git checkout -- apps/web/tsconfig.json` and confirm `git status --short apps/web/tsconfig.json` is empty.
Expected: build succeeds. No visual change anywhere yet (nothing references the new classes/tokens outside `tokens.css`).

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/tailwind.config.ts apps/web/postcss.config.js apps/web/lib/utils.ts apps/web/app/globals.css apps/web/app/styles/tokens.css
git commit -m "feat(web): add Tailwind + lucide-react foundation, map hotspot-store tokens to Pearl colours"
```

---

## Task 2: Port `Button`, `Select`, `Card`, `Badge`

**Files:**
- Create: `apps/web/components/ui/button.tsx`
- Create: `apps/web/components/ui/select.tsx`
- Create: `apps/web/components/ui/card.tsx`
- Create: `apps/web/components/ui/badge.tsx`

**Interfaces:**
- Consumes: `cn` from `../../lib/utils` (one directory up from `components/ui/`, i.e. `../../lib/utils`).
- Produces: `Button` (`forwardRef<HTMLButtonElement, ButtonProps>`, `ButtonProps` extends `React.ButtonHTMLAttributes<HTMLButtonElement>` with `variant?: 'primary'|'secondary'|'outline'|'ghost'|'danger'`, `size?: 'sm'|'default'|'lg'|'icon'`, `loading?: boolean`).
- Produces: `Select` (`forwardRef<HTMLSelectElement, SelectProps>`, `SelectProps` extends `React.SelectHTMLAttributes<HTMLSelectElement>` with `invalid?: boolean`).
- Produces: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` (all `(props: React.HTMLAttributes<...>) => JSX.Element`).
- Produces: `Badge` (`props: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant; dot?: boolean }`, `BadgeVariant = 'default'|'success'|'warning'|'danger'|'muted'|'info'|'violet'`).
- `Select` needs a `Spinner` import for `Button`'s `loading` state — this repo's existing spinner is `Spinner` from `../../components/loading` (not a new file); import it there instead of porting hotspot-store's separate `spinner.tsx`.

- [ ] **Step 1: Port `Button`**

Copy the component body from `/Users/nobody1/Desktop/Digtail teach/hotspot-store/frontend/src/components/ui/button.tsx` into `apps/web/components/ui/button.tsx`, with two changes: the `cn` import path becomes `../../lib/utils`, and the `Spinner` import becomes `import { Spinner } from '../loading';`. Variant/size class strings and the `var(--...)` references are copied verbatim — they already resolve through the tokens from Task 1.

- [ ] **Step 2: Port `Select`**

Copy from `.../hotspot-store/frontend/src/components/ui/select.tsx` into `apps/web/components/ui/select.tsx`, same `cn` import fix. No other changes.

- [ ] **Step 3: Port `Card`**

Copy from `.../hotspot-store/frontend/src/components/ui/card.tsx` into `apps/web/components/ui/card.tsx`, same `cn` import fix. `Card`'s own `className="card"` depends on the `.card` CSS class added in Task 3 (Table wraps non-bare tables in `Card`) — note this dependency in a one-line comment at the top of the file.

- [ ] **Step 4: Port `Badge`**

Copy from `.../hotspot-store/frontend/src/components/ui/badge.tsx` into `apps/web/components/ui/badge.tsx`, same `cn` import fix. Leave the `info`/`violet` entries in `variantClasses` exactly as hotspot-store has them (referencing `--info`/`--violet` etc.) — per Global Constraints, these are intentionally not wired to real colours yet.

- [ ] **Step 5: Verify**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/ui/button.tsx apps/web/components/ui/select.tsx apps/web/components/ui/card.tsx apps/web/components/ui/badge.tsx
git commit -m "feat(web): port Button, Select, Card, Badge from hotspot-store"
```

---

## Task 3: Port `Table` family + `.card` CSS + `Pagination`

**Files:**
- Create: `apps/web/components/ui/table.tsx`
- Create: `apps/web/components/ui/pagination.tsx`
- Modify: `apps/web/app/styles/desk.css` (add `.card` and the mobile-stack table rules)

**Interfaces:**
- Consumes: `cn` from `../../lib/utils`; `Card` from `./card` (same directory); `EmptyState` from `../empty-state` (existing component, one directory up — Task 6 reskins it but does not change its props, so this import is stable now).
- Consumes (Pagination only): `Button` from `./button`, `Select` from `./select`.
- Produces: `Table`, `THead`, `TBody`, `Tr`, `Th`, `Td`, `TdLabel`, `MixedLabel` (same signatures as hotspot-store's `table.tsx`) from `apps/web/components/ui/table.tsx`.
- Produces: `Pagination`, `shouldShowPagination`, `PAGE_SIZE_OPTIONS` from `apps/web/components/ui/pagination.tsx` — ported but not imported by any page in this slice (standing primitive for a later page-slice, per spec D10).

- [ ] **Step 1: Add `.card` and mobile-stack CSS to `apps/web/app/styles/desk.css`**

Append (this file "owns" the pane/card/table surface per `pearl-ui.mdc`'s stylesheet table):

```css
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
}
@media (max-width: 767px) {
  .data-table--stack, .data-table--stack > tbody, .data-table--stack > tbody > tr { display: block; width: 100%; }
  .data-table--stack > thead { display: none; }
  .data-table--stack > tbody > tr { padding: 4px 2px; }
  .data-table.data-table--stack > tbody > tr > td {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    width: 100%; max-width: none; padding: 3px 8px; text-align: end; white-space: normal; overflow-wrap: anywhere;
  }
  .data-table.data-table--stack > tbody > tr > td::before {
    content: attr(data-label); flex-shrink: 0; color: var(--ink-4); font-size: 11px; font-weight: 500; text-align: start;
  }
  .data-table.data-table--stack > tbody > tr > td:not([data-label]) { justify-content: flex-end; }
  .data-table.data-table--stack > tbody > tr > td[dir='ltr'] { flex-direction: row-reverse; }
  .data-table.data-table--stack > tbody > tr > td:not([data-label]):empty { display: none; }
  .data-table--stack > tbody > tr + tr { border-top: 1px solid var(--line-soft); }
}
```

This is copied directly from hotspot-store's `globals.css` (`@layer components` block) — the `[dir='ltr']` row-reverse rule is the one covered by this plan's Review Focus item on `/users`'s `<bdi dir="ltr">` login cell.

The ported `Table` renders `className="data-table ..."` (hotspot-store's own class name, required for the `.data-table--stack` rule above to match), not the existing `.data` class. The existing alignment helpers (`.data th.num`/`.data td.num`, `.data th.fit`/`.data td.fit`, `.data th.row-actions`/`.data td.row-actions` — all in this same file, further down) only match `.data`. Add parallel rules so `/users` (Task 7) can keep using the same `fit`/`num`/`row-actions` class names on `<Th>`/`<Td>`:

```css
.data-table th.num, .data-table td.num { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
.data-table th.fit, .data-table td.fit { white-space: nowrap; }
.data-table th.row-actions, .data-table td.row-actions { padding-inline: 8px; text-align: start; vertical-align: middle; white-space: nowrap; }
```

Do not carry over `table-layout: fixed` from `.canvas .data` — the ported `Table` follows hotspot-store's own default (auto layout); this is an intentional behavior change, not an oversight.

- [ ] **Step 2: Port `Table`**

Copy from `.../hotspot-store/frontend/src/components/ui/table.tsx` into `apps/web/components/ui/table.tsx`. Import fixes: `cn` from `'../../lib/utils'`, `Card` from `'./card'`, `EmptyState` from `'../empty-state'`. Keep the `useMobileCellLabels` hook and the `MixedLabel`/`TdLabel` RTL-sensitive comments as-is — they are exactly the behavior Review Focus calls out.

- [ ] **Step 3: Port `Pagination`**

Copy from `.../hotspot-store/frontend/src/components/ui/pagination.tsx` into `apps/web/components/ui/pagination.tsx`. Import fixes: `Button` from `'./button'`, `Select` from `'./select'`, `cn` from `'../../lib/utils'`. The `formatInteger` helper it imports from hotspot-store's own `lib/utils` does not exist in this repo — inline it in the same file instead:
`function formatInteger(value: number) { return value.toLocaleString('en-US'); }`

- [ ] **Step 4: Verify**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ui/table.tsx apps/web/components/ui/pagination.tsx apps/web/app/styles/desk.css
git commit -m "feat(web): port Table family and Pagination from hotspot-store"
```

---

## Task 4: Reskin `Dialog`

**Files:**
- Modify: `apps/web/components/dialog.tsx` (JSX/className only)
- Modify: `apps/web/app/styles/dialog.css`

**Interfaces:**
- Unchanged: `Dialog`'s props (`open, title, closeLabel, onClose, error, children, footer, size`) and `PageAlert`'s props — no caller anywhere in the app changes.
- Consumes (new): `X` icon from `lucide-react` for the close button, replacing the current `×` text glyph.

- [ ] **Step 1: Update `.dialog-scrim`/`.dialog` rules in `apps/web/app/styles/dialog.css`**

Replace the existing `.dialog-scrim` and `.dialog` rules (and the `.dialog > header` rule) with hotspot-store's `Modal` look, re-pointed at Pearl tokens and this repo's existing `[data-size]` sizing (keep `data-size='confirm'`/`'wide'` width overrides as they are — only the base panel's radius/shadow/backdrop change):

```css
.dialog-scrim {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 16px;
  background: var(--rd-scrim);
  backdrop-filter: blur(2px);
}
.dialog {
  display: flex;
  flex-direction: column;
  width: min(600px, 100%);
  max-height: min(720px, calc(100vh - 48px));
  overflow: hidden;
  padding: 0;
  border-radius: 0.625rem;
  background: var(--rd-surface);
  box-shadow: var(--rd-shadow-pop);
}
.dialog > header {
  display: flex;
  flex: none;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
  padding: 14px 16px;
  border-bottom: 1px solid var(--rd-line);
}
.dialog > header .icon-btn {
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: 0.5rem;
  color: var(--rd-faint);
}
.dialog > header .icon-btn:hover { background: var(--rd-surface-2); }
```

Leave every other rule in the file (`.dialog[data-size=...]`, `.dialog-who`, `.dialog-body`, `.dialog-foot`, `.dialog button.*`, `.perm-grid`, `.op-blocks`, `.row-menu*`) untouched in this task — `.row-menu*` is Task 5's.

- [ ] **Step 2: Swap the close glyph in `apps/web/components/dialog.tsx`**

Import `X` from `'lucide-react'` at the top. Replace `<button type="button" className="icon-btn" onClick={onClose} aria-label={closeLabel}>×</button>` with the same button, children `<X size={18} aria-hidden="true" />` instead of `×`. Do not touch any other line in the file — the focus-trap `useEffect`, the Escape handler, the body-scroll lock, and the `createPortal` call all stay exactly as they are (Review Focus item).

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

Run: `cd apps/web && npx playwright test tests/users-desk.spec.ts tests/packages-roles-desk.spec.ts`
Expected: PASS (both exercise a `Dialog` indirectly through page flows that reference it).

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/dialog.tsx apps/web/app/styles/dialog.css
git commit -m "feat(web): reskin Dialog to hotspot-store's Modal look"
```

---

## Task 5: Reskin `RowMenu`

**Files:**
- Modify: `apps/web/components/row-menu.tsx` (JSX/className only)
- Modify: `apps/web/app/styles/dialog.css` (`.row-menu*` rules only)

**Interfaces:**
- Unchanged: `RowMenu`'s props (`label: string; items: RowAction[]`) and `RowAction`'s shape — no caller changes.
- Consumes (new): `MoreHorizontal` from `lucide-react` for the trigger, replacing the inline three-dot SVG.

- [ ] **Step 1: Replace `.row-menu-btn`/`.row-menu-panel` rules in `apps/web/app/styles/dialog.css`**

```css
.row-menu-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--rd-faint);
}
.row-menu-btn:hover { background: var(--rd-surface-3); color: var(--rd-ink); }
.row-menu-btn[aria-expanded='true'] { background: var(--rd-surface-3); color: var(--rd-ink); }
.row-menu-btn svg { width: 16px; height: 16px; }
.row-menu-panel {
  position: fixed;
  z-index: 80;
  inset: auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: max-content;
  min-width: 10rem;
  max-width: min(280px, calc(100vw - 16px));
  padding: 4px 0;
  border: 1px solid var(--rd-line);
  border-radius: 0.5rem;
  background: var(--rd-surface);
  box-shadow: var(--rd-shadow-pop);
}
.row-menu-panel button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: auto;
  min-height: 32px;
  padding: 0 12px;
  border: 0;
  background: transparent;
  color: var(--rd-ink-2);
  font-size: 13px;
  font-weight: 600;
  text-align: start;
  white-space: nowrap;
}
.row-menu-panel button:hover { background: var(--rd-surface-2); color: var(--rd-ink); }
.row-menu-panel button.danger { color: var(--rd-danger); }
.row-menu-panel button.danger:hover { background: var(--rd-danger-soft); }
.row-menu-rule { display: block; height: 1px; margin: 4px 0; background: var(--rd-line); }
```

Note: `44px` touch target shrinks to `28px`/`32px` for the trigger/items — this matches hotspot-store's density (`.htap` note in its own file: "h-7 w-7"). If this conflicts with the 44px touch-target rule in `responsive.css` on narrow viewports, that media-query rule wins there already (not touched by this task); desktop density follows hotspot-store.

- [ ] **Step 2: Swap the trigger glyph in `apps/web/components/row-menu.tsx`**

Import `MoreHorizontal` from `'lucide-react'`. Replace the inline `<svg>` with three `<circle>`s inside the trigger `<button>` with `<MoreHorizontal size={16} aria-hidden="true" />`. Leave the `Glyph` function and every row-item icon (`edit`/`trash`/etc.) untouched — those are `RowAction.icon` glyphs, out of scope for this task. Leave all positioning/keyboard-nav logic untouched (Review Focus item).

- [ ] **Step 3: Verify — RTL check**

Run: `cd apps/web && npm run dev` (or use an existing dev server), open `/users` as a branch account in each of `ar`, `en`, `he`, open a row's menu in each, and confirm the panel anchors to the trigger's inline-end edge and stays fully on-screen in all three. Screenshot each into `docs/visual-review/2026-11-02/hotspot-reflector-pilot/row-menu-{ar,en,he}.png`.
Expected: panel visibly anchored correctly, no screenshot shows it clipped or mirrored wrong.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/row-menu.tsx apps/web/app/styles/dialog.css docs/visual-review/2026-11-02/hotspot-reflector-pilot/row-menu-ar.png docs/visual-review/2026-11-02/hotspot-reflector-pilot/row-menu-en.png docs/visual-review/2026-11-02/hotspot-reflector-pilot/row-menu-he.png
git commit -m "feat(web): reskin RowMenu to hotspot-store's ActionMenu look"
```

---

## Task 6: Reskin `FilterBar`, `EmptyState`, `TableSkeleton`

**Files:**
- Modify: `apps/web/app/styles/desk.css` (`.filter-bar`, `.filter-panel`, `.empty*`, `.skeleton*`, `.table-skeleton*` rules)

No JSX changes in this task — `filter-bar.tsx`, `empty-state.tsx`, and `loading.tsx` are pure CSS-class wrappers already; only stylesheet rules change, all in `desk.css`.

**Interfaces:** Unchanged props for `FilterBar`, `EmptyState`, `TableSkeleton`, `Spinner`, `PageSkeleton`.

- [ ] **Step 1: Reskin filter bar rules in `apps/web/app/styles/desk.css`**

Replace the existing `.filter-bar, .filters` block and `.filter-panel` block with:

```css
.filter-bar, .filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--rd-line);
  border-radius: 0.625rem;
  background: var(--rd-surface);
  box-shadow: var(--rd-shadow-card);
}
.filter-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
}
.filter-panel label { display: grid; gap: 4px; min-width: 9rem; color: var(--rd-muted); font-size: 11px; font-weight: 700; }
.filter-panel input, .filter-panel select { height: 34px; border-radius: 0.5rem; background: var(--rd-surface); }
.filter-panel .quiet { height: 34px; }
@media (max-width: 720px) {
  .filter-panel { flex-direction: column; align-items: stretch; }
  .filter-panel label { min-width: 0; }
}
```

(One-line note: kept as a flex row rather than porting the full `DashboardFiltersToolbar` grid — matches spec D7's "reskin only, same simple children API".)

- [ ] **Step 2: Reskin empty-state rules in `apps/web/app/styles/desk.css`**

Replace the `.empty.empty-state`, `.empty .empty-icon`, `.empty .empty-title`, `.empty .empty-text` rules with:

```css
.empty.empty-state {
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 8px;
  min-height: 100%;
  padding: 24px 14px;
  text-align: center;
}
.empty .empty-icon {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.625rem;
  background: var(--rd-surface-2);
  color: var(--rd-faint);
}
.empty .empty-icon svg { width: 1.125rem; height: 1.125rem; }
.empty .empty-title { margin: 0; color: var(--rd-ink); font-size: 0.9rem; font-weight: 600; }
.empty .empty-text { margin: 0; color: var(--rd-muted); font-size: 12.5px; }
```

- [ ] **Step 3: Fix and reskin the skeleton shimmer in `apps/web/app/styles/desk.css`**

The existing `@keyframes shimmer { to { transform: translateX(100%); } }` is defined but never applied to `.skeleton::after` — fix this bug as part of the reskin. Replace the `.skeleton` and `.skeleton::after` rules:

```css
.skeleton {
  display: block;
  position: relative;
  overflow: hidden;
  border-radius: 0.5rem;
  background: var(--rd-surface-3);
}
.skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--rd-surface) 55%, transparent), transparent);
  animation: shimmer 1.6s infinite;
}
```

Leave `@keyframes shimmer` itself and every other rule (`.sk-title`, `.sk-lede`, `.sk-stat`, `.sk-num`, `.table-skeleton-row`) as they are — only `.skeleton`/`.skeleton::after` change.

- [ ] **Step 4: Verify**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

Open `/users` while the accounts request is delayed (or throttle network), confirm the skeleton rows visibly shimmer left-to-right instead of sitting static.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/styles/desk.css
git commit -m "feat(web): reskin FilterBar/EmptyState, fix and reskin skeleton shimmer"
```

---

## Task 7: Migrate `/users` to the new primitives

**Files:**
- Modify: `apps/web/app/users/page.tsx`

**Interfaces:**
- Consumes: `Button` (`../../components/ui/button`), `Select` (`../../components/ui/select`), `Table, THead, TBody, Tr, Th, Td` (`../../components/ui/table`), `Badge` (`../../components/ui/badge`) — all from Tasks 2–3.
- No change to any hook, handler, or API call in the file — this task is presentation-only.

- [ ] **Step 1: Replace raw buttons with `Button`**

Every `<button type="button" className="primary" ...>` becomes `<Button type="button" ...>` (default variant is `primary`). Every `className="secondary"` becomes `<Button variant="secondary" ...>`. Every `className="danger"` becomes `<Button variant="danger" ...>`. The create-account trigger button, both dialogs' footer buttons, and the inline per-row operation buttons are all affected. `disabled={busy}` props carry over unchanged — `Button` already supports `disabled` and dims it visually (Review Focus item).

- [ ] **Step 2: Replace the layer filter `<select>` and both dialog `<select>`s with `Select`**

The `FilterBar`'s layer `<select>`, the create-account dialog's layer/role/parent `<select>`s, and the transfer-operation dialog's destination `<select>` all become `<Select ...>` with the same `value`/`onChange`/children (`<option>`s stay plain `<option>` — `Select` renders a native `<select>` underneath). Keep the free-text inputs (`<input>`) as they are — this task does not touch them.

- [ ] **Step 3: Replace the raw `<table className="data">` with the `Table` family**

```tsx
<Table>
  <THead>
    <Tr>
      <Th>{t.accountName}</Th>
      <Th className="fit">{t.layer}</Th>
      <Th className="fit">{t.parent}</Th>
      <Th className="num">{t.balance}</Th>
      <Th className="num">{t.ceiling}</Th>
      <Th className="fit">{t.status}</Th>
      <Th className="row-actions">{t.lineOps}</Th>
    </Tr>
  </THead>
  <TBody>
    {shown.map((row) => (
      <Tr key={row.loginName}>
        <Td>...</Td>
        ...
      </Tr>
    ))}
  </TBody>
</Table>
```

Keep every cell's existing children (the `Link`, `Money`, `layerName`, `<bdi>`, `RowMenu`) exactly as they are — only the wrapping `table`/`thead`/`tbody`/`tr`/`th`/`td` elements change to the component versions. Remove the now-unused `<div className="sheet">` wrapper (`Table`'s non-bare mode already provides its own scroll container via `Card`).

- [ ] **Step 4: Replace the status `<span className={...badge...}>` with `Badge`**

`<span className={row.frozen ? 'badge pending' : 'badge'}>{row.frozen ? t.frozen : t.accountOpen}</span>` becomes `<Badge variant={row.frozen ? 'warning' : 'success'}>{row.frozen ? t.frozen : t.accountOpen}</Badge>` (this is the status→variant mapping spec D10 asks to record in `DESIGN.md` — Task 8 records it).

- [ ] **Step 5: Verify — typecheck and build**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

Run: `cd apps/web && npm run build`, then `git checkout -- apps/web/tsconfig.json`.
Expected: build succeeds.

- [ ] **Step 6: Verify — Playwright**

Run: `cd apps/web && npx playwright test tests/users-desk.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/users/page.tsx
git commit -m "feat(web): migrate /users to Button, Select, Table, Badge"
```

---

## Task 8: Full verification pass + `DESIGN.md`

**Files:**
- Modify: `DESIGN.md`
- Create: screenshots under `docs/visual-review/2026-11-02/hotspot-reflector-pilot/`

**Interfaces:** None (documentation + verification only).

- [ ] **Step 1: Record the new system in `DESIGN.md`**

Add a new section (after the existing "Tokens" table, before whatever currently follows) documenting: the Tailwind + `lucide-react` stack addition, the full token-mapping table from Global Constraints, the `0.5rem`/`0.625rem` radius rule, and the `/users` status→variant mapping decided in Task 7 (`frozen` → `warning`, open → `success`) as the standing convention for later pages.

- [ ] **Step 2: Screenshot `/users` — all languages × both themes × two viewports**

For each of `ar`, `en`, `he` × light/dark × (1440px wide, 390px narrow): load `/users` as a branch account with at least 2 seeded users (one frozen, one open) so both `Badge` variants, the table, `FilterBar`, and a `RowMenu` open are all visible. Save to `docs/visual-review/2026-11-02/hotspot-reflector-pilot/users-{lang}-{theme}-{viewport}.png` (12 files).

- [ ] **Step 3: Screenshot one other page that uses the reskinned shared components**

Per Global Constraints, `Dialog`/`RowMenu`/`FilterBar`/`EmptyState`/`TableSkeleton` changed everywhere, not just `/users`. Pick one other page that uses at least one of them (e.g. `/numbers` for `FilterBar` + `RowMenu`, or `/companies` for `Dialog`) and screenshot it in `ar`/light and `ar`/dark at 1440px: `docs/visual-review/2026-11-02/hotspot-reflector-pilot/other-page-ar-{light,dark}.png` (2 files). Confirm nothing looks broken (clipped panel, invisible text, wrong colours).

- [ ] **Step 4: Run the full Playwright suite**

Run: `cd apps/web && npx playwright test`
Expected: PASS. Any failure outside `/users`'s own tests is a regression from the shared-component reskins (Tasks 4–6) and must be fixed before this task is done, not deferred.

- [ ] **Step 5: Commit**

```bash
git add DESIGN.md docs/visual-review/2026-11-02/hotspot-reflector-pilot/
git commit -m "docs: record hotspot-store identity reflector in DESIGN.md, verify foundation + /users pilot"
```
