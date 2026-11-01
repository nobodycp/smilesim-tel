# Pearl Rebuild Phase 1 (Shell + Home) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the shell (sidebar, topbar, drawer) and the home dashboard to the craft level of `account_manger`'s Pearl system, on the existing React/Next + `--rd-*` token stack, with no stack or font change.

**Architecture:** Extract two new shared primitives (`Icon`, `Stat`) out of page-local code so later phases reuse them instead of re-inventing per page. Raise the global icon stroke weight once in `base.css`. Rework `shell.css` (topbar + sidebar) and `desk.css` (stat, empty state, shortcuts) in place — no new stylesheet, no reordering of the `globals.css` import chain. Reassemble `app/page.tsx` on top of the new primitives last, after they exist and have been reviewed individually.

**Tech Stack:** Next.js (App Router), React, hand-written CSS with `--rd-*` custom properties (unchanged). No Tailwind, no icon library, no new dependency.

**Spec:** `docs/superpowers/specs/2026-11-01-pearl-rebuild-phase1-shell-home-design.md`

## Global Constraints

- No raw hex or `rgba()` outside `tokens.css` (`DESIGN.md`).
- Logical properties only (`margin-inline-*`, `text-start`); no `ml-*`/`mr-*`/physical `left`/`right` in new CSS.
- Fonts stay Tajawal / IBM Plex Sans Hebrew — do not add Inter Tight, Noto Kufi, or any `next/font` entry.
- Touch targets ≥ 44px under 720px width (existing responsive breakpoint in `responsive.css`).
- Motion stays transform/opacity only, under `prefers-reduced-motion: no-preference`.
- Do not reorder `globals.css` imports.
- Keep `tsc --noEmit` and `next build` green after every task.

## Review Focus

- **RTL mirroring:** every new icon, chip, and stat tile must read correctly in `dir="rtl"` (Arabic/Hebrew) — no icon that silently assumes LTR (e.g. an arrow glyph not covered by existing `[dir="rtl"]` flip rules).
- **Dark mode contrast:** new `.stat` tone tints and the `EmptyState` icon circle must stay ≥ 4.5:1 (text) / ≥ 3:1 (meaningful non-text) in `.dark`, not just light.
- **Collapsed sidebar state:** `office-shell.tsx` has a `collapsed` (desktop, icon-only) and a `mobile` (drawer) render path through the same `sidebar()` closure — a sidebar CSS change must be checked in both, not just the default expanded desktop view.
- **Existing `EmptyState` call sites:** it is used outside the home page already (grep before changing its props) — a prop-signature change must not silently blank other pages.
- **Collapsed icon-only nav labels:** `title={item.label}` is the only accessible name when `compact` hides the `<span>` — icon changes must not drop that attribute.

---

## Task 1: Shared `Icon` component + global stroke weight

**Files:**
- Create: `apps/web/components/icon.tsx`
- Modify: `apps/web/components/office-shell.tsx:391-437` (remove the inline `IconName` type and `Icon` function; import from `./icon` instead)
- Modify: `apps/web/app/styles/base.css:22` (`stroke-width: 1.8` → `2.2`)

**Interfaces:**
- Produces: `export type IconName = 'home' | 'settings' | 'wallet' | 'bell' | 'plans' | 'numbers' | 'providers' | 'tasks' | 'staff' | 'reports' | 'lock' | 'menu' | 'close' | 'chevron' | 'logout' | 'collapse' | 'expand' | 'sim'` and `export function Icon({ name }: { name: IconName }): JSX.Element` in `apps/web/components/icon.tsx`, same render output contract (`<svg viewBox="0 0 24 24" aria-hidden="true">...</svg>`) so every existing call site (`<Icon name="..." />`) keeps working unchanged.

- [ ] **Step 1: Extract the component**
  Move the `IconName` type and `Icon` function verbatim from `office-shell.tsx` into `apps/web/components/icon.tsx`, add the two exports above. Tighten the path geometry only where a glyph is visibly inconsistent with the others (same corner radius treatment, same stroke endpoints) — do not redesign the icon set, this is a consistency pass, not new icons.

- [ ] **Step 2: Rewire the import**
  In `office-shell.tsx`, replace the inline type/function with `import { Icon, type IconName } from './icon';`. Delete the now-dead inline code.

- [ ] **Step 3: Raise the stroke weight**
  In `base.css`, change the bare `svg { ... stroke-width: 1.8 ... }` rule to `2.2`.

- [ ] **Step 4: Verify**
  Run `npx tsc --noEmit` (apps/web) — must pass with zero errors (the extraction must not change any exported type). Run `npx playwright test tests/desk-head.spec.ts tests/desk-system.spec.ts` — must stay green (no class name changed yet).

- [ ] **Step 5: Commit**
  `git add apps/web/components/icon.tsx apps/web/components/office-shell.tsx apps/web/app/styles/base.css && git commit -m "refactor(web): extract shared Icon component, raise stroke weight to 2.2"`

---

## Task 2: Shell chrome — topbar controls + sidebar nav (`shell.css` only)

**Depends on:** Task 1 (uses the heavier icon weight while tuning sizes).

**Files:**
- Modify: `apps/web/app/styles/shell.css` (`.shell-icon`, `.avatar-btn`, `.avatar`, `.wallet-btn`, `.lang` shell variant, `.nav-label`, `.nav-link`, `.brand-mark`/`.brand-block` spacing — rule-by-rule, no restructuring of the file's selectors beyond their declarations)

**Interfaces:**
- Consumes: `Icon` from Task 1 (icon sizing inside `.shell-icon svg` / `.wallet-btn svg`).
- Produces: no new class names required by later tasks — Task 6 (home assembly) does not depend on this task's output, so it can run concurrently with Task 3.

- [ ] **Step 1: Unify control sizing**
  Give `.shell-icon`, `.avatar-btn`, `.wallet-btn` (and the `.lang` shell-variant button) the same width/height/border-radius declaration (one shared value, not three near-identical ones) in the default (desktop) state, and the same enlarged value under the existing `max-width: 991.98px` / touch breakpoint already used elsewhere in `shell.css`. Pick values consistent with the existing `--rd-radius-*` scale (do not introduce a new raw px radius).

- [ ] **Step 2: Hover/focus states**
  Ensure every one of those controls shares one hover background rule and relies on the existing shared `:focus-visible` rule in `base.css` (do not add a competing focus style in `shell.css`).

- [ ] **Step 3: Sidebar nav polish**
  Adjust `.nav-label` spacing above/below, `.nav-link` padding and `.is-active`/hover treatment, and the gap between `.brand-block` and the first nav group, for both the expanded and `.compact` (icon-only, `collapsed` desktop) rendering and the `.drawer` (mobile) rendering — check all three, per Review Focus.

- [ ] **Step 4: Verify**
  Start the dev server, open `/` in light+dark and `ar`+`en`+`he`, at 1280px and 390px width; confirm no control looks mismatched in size and the collapsed sidebar still shows icon-only with a visible active state. Run `npx playwright test tests/desk-head.spec.ts` (it asserts control heights — update the expected px value in the test if the chosen size changed it) and confirm it's green.

- [ ] **Step 5: Commit**
  `git add apps/web/app/styles/shell.css apps/web/tests/desk-head.spec.ts && git commit -m "style(web): unify shell control sizing and sidebar nav spacing"`

---

## Task 3: `Stat` component + `EmptyState` redesign (`desk.css` + two component files)

**Depends on:** Task 1 (uses `Icon`). Independent of Task 2's file (`shell.css`) — safe to run concurrently with Task 2.

**Files:**
- Create: `apps/web/components/stat.tsx`
- Modify: `apps/web/app/styles/desk.css` (delete the `.stat-card`/`.stat-row`/`.stat-icon`/`.stat-pending`/`.stat-live`/`.stat-stopped` block at lines ~394-425; add new `.stat`/`.stat-row`/`.stat-icon` rules with four tone variants: `success`, `warning`, `danger`, `muted`)
- Modify: `apps/web/components/empty-state.tsx`
- Modify: `apps/web/app/styles/desk.css` (the `.empty` rule set — add an icon-circle sub-element)

**Interfaces:**
- Produces: `export function Stat({ icon, tone, value, label, meta }: { icon: IconName; tone: 'success' | 'warning' | 'danger' | 'muted'; value: ReactNode; label: string; meta?: ReactNode }): JSX.Element` and `export function StatRow({ children }: { children: ReactNode }): JSX.Element` in `apps/web/components/stat.tsx`.
- Produces: `EmptyState` keeps its current call signature (`children` as the message, used as the title) — grep every existing `<EmptyState>` call site first (`rg "<EmptyState"`) and confirm the new internal markup (icon circle + title + optional `text` prop) does not require changing any of them; add `text?: ReactNode` as an optional second prop only, default omitted.

- [ ] **Step 1: Build `Stat`**
  New component renders: icon tile (`.stat-icon` with a `tone-*` modifier class), label, large tabular value, and the optional `meta` slot under a hairline divider — matching the spec's description (tile, label, value, divider, meta). Reuses `Icon` from Task 1.

- [ ] **Step 2: Rewrite the CSS**
  Replace the old `.stat-card` block in `desk.css` with `.stat` rules carrying real tonal background contrast (not the near-invisible `*-soft` tints at full opacity — use the existing `--rd-success-soft` etc. tokens, verified against 4.5:1/3:1 in both themes per Review Focus) and the meta-row divider.

- [ ] **Step 3: Redesign `EmptyState`**
  Add a small circle (`--rd-surface-2` background) holding a muted icon, a title (current `children`), and the new optional `text`. Default icon when none is specified is acceptable (document the default in a comment).

- [ ] **Step 4: Verify**
  `npx tsc --noEmit`. Visually check every existing `EmptyState` call site (grep first, open each page) in light+dark — none should regress to blank/broken. Confirm `.stat` tone contrast with a contrast checker in both themes (success/warning/danger/muted × light/dark = 8 checks).

- [ ] **Step 5: Commit**
  `git add apps/web/components/stat.tsx apps/web/components/empty-state.tsx apps/web/app/styles/desk.css && git commit -m "feat(web): add shared Stat component, redesign EmptyState"`

---

## Task 4: Documentation and rule updates (independent — no code dependency, can run anytime)

**Files:**
- Modify: `apps/web/DESIGN.md` (document `Stat`/`StatRow` and the new `EmptyState` shape under "Components"/"Inner pages"; update the icon stroke-width note if one exists)
- Modify: `.cursor/rules/content-ui.mdc` (remove or rewrite the sentence "The header and sidebar are finished. Do not restyle `.topbar`, `.sidebar`, `.drawer`, or `.shell-*`." to reflect that the shell is now in scope for the Pearl rebuild)
- Modify: `docs/superpowers/specs/2026-10-30-frontend-audit.md` (close the "القرارات تنتظر المالك" font question: record that Tajawal is kept, per `2026-11-01-pearl-rebuild-phase1-shell-home-design.md`)

- [ ] **Step 1: Update `DESIGN.md`**
- [ ] **Step 2: Update `content-ui.mdc`**
- [ ] **Step 3: Close the font decision in the audit spec**
- [ ] **Step 4: Commit**
  `git add apps/web/DESIGN.md .cursor/rules/content-ui.mdc docs/superpowers/specs/2026-10-30-frontend-audit.md && git commit -m "docs: record Pearl rebuild phase 1 decisions in DESIGN.md and rules"`

---

## Task 5: Home page assembly (`app/page.tsx` + shortcut chip styling)

**Depends on:** Task 1 (`Icon`), Task 3 (`Stat`, `EmptyState`). Does not depend on Task 2 or 4, but should land after them so the whole home screen is reviewed against the final shell.

**Files:**
- Modify: `apps/web/app/page.tsx` (replace the hand-rolled `stat-row`/`stat-card` markup with `<StatRow>`/`<Stat>`; give each `shortcuts` entry an `icon: IconName` and render it inside the chip)
- Modify: `apps/web/app/styles/desk.css` (`.shortcut-row`/`.shortcut` → chip styling with room for a leading icon)

**Interfaces:**
- Consumes: `Stat`, `StatRow` from Task 3; `Icon`, `IconName` from Task 1.

- [ ] **Step 1: Swap the KPI row**
  Replace the three hand-written `<Link className="stat-card ...">` blocks with `<StatRow>` wrapping three `<Stat>`s, tone mapped as today (`pending` → `warning`, `live` → `success`, `stopped` → `danger`), each still a `Link` to its filtered destination (wrap `<Stat>`'s output in `Link`, or extend `Stat` with an optional `href` — pick whichever keeps `Stat` reusable for non-link KPI usage elsewhere; document the choice in a one-line comment).

- [ ] **Step 2: Shortcut chips**
  Add an `icon` to each entry in the existing `shortcuts` array (reuse an existing `IconName` that matches the destination, e.g. `/users` → `staff`), update `.shortcut` CSS to a chip with a leading icon slot.

- [ ] **Step 3: Verify**
  `npx tsc --noEmit`, `next build`. Manually load `/` in both roles that produce different `shortcuts` arrays (`pos` layer and the default/branch layer) to confirm both render correctly with icons.

- [ ] **Step 4: Commit**
  `git add apps/web/app/page.tsx apps/web/app/styles/desk.css && git commit -m "feat(web): rebuild home page on Stat/Icon primitives"`

---

## Task 6: Full verification pass (last, depends on all prior tasks)

**Files:** none (verification only); may touch `apps/web/tests/*.spec.ts` if a selector/height assertion needs updating, and adds new files under `docs/visual-review/2026-11-01/`.

- [ ] **Step 1:** `npx tsc --noEmit` and `next build` both clean.
- [ ] **Step 2:** `npx playwright test` — full suite green (update any assertion that targeted an old class name or pixel height, per the Review Focus items already called out in Tasks 2-3).
- [ ] **Step 3:** Capture screenshots of `/` and the shell at 1280px and 390px, light+dark, `ar`+`en`+`he` (12 shots) into `docs/visual-review/2026-11-01/phase1-shell-home/`, named like the existing `docs/visual-review/2026-10-30/design-system/` set.
- [ ] **Step 4:** Compare against `docs/visual-review/2026-10-30/design-system/after-home-light-ar-1280.jpg` (the "before" for this phase) and write a two-paragraph before/after note into `docs/superpowers/specs/2026-11-01-pearl-rebuild-phase1-shell-home-design.md` under a new `## Result` heading.
- [ ] **Step 5: Commit**
  `git add docs/visual-review/2026-11-01 docs/superpowers/specs/2026-11-01-pearl-rebuild-phase1-shell-home-design.md && git commit -m "docs(web): phase 1 verification screenshots and result note"`
