# Pearl Rebuild Phase 3 (Detail Pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the two competing "label/value fact list" patterns (`.facts` and `.account-facts`) into one `.facts` pattern that uses logical borders and a responsive multi-column grid, apply it to the line-card page and the (currently uncommitted) account page, then verify all seven detail-page routes visually.

**Architecture:** `.facts` in `desk.css` changes from a single, physical-bordered, one-column `<dl>` list into a responsive CSS grid (`repeat(auto-fit, minmax(9rem, 1fr))`) with a logical bottom border per row. `numbers/[id]/page.tsx` (already uses `.facts`) gets a small structural fix (wrap in `.pane-body` to match its sibling tab, two `bdi` fixes) with no new CSS needed. `users/[login]/page.tsx` — which has no committed history at all yet — gets its `.account-facts` markup converted to the same `dl`/`dt`/`dd` shape, and `.account-facts` is deleted from `desk.css` once it has no more consumers. The five other detail routes (three simple list pages, the line-card page's non-`.facts` parts, and the package-sheet page) already match documented patterns; they get a verification pass with fixes only if a real defect is found, not a rewrite.

**Tech Stack:** Next.js (App Router), React, hand-written CSS with `--rd-*` custom properties. No Tailwind, no new dependency.

**Spec:** `docs/superpowers/specs/2026-11-02-pearl-rebuild-phase3-detail-pages-design.md`

## Global Constraints

- No raw hex or `rgba()` outside `tokens.css`.
- Logical properties only; no physical `border-bottom`/`left`/`right` in new or touched CSS.
- Fonts stay Tajawal / IBM Plex Sans Hebrew — no font change.
- Keep `tsc --noEmit` and `next build` green after every task.
- Latin identifiers (login names, ICCIDs, phone numbers) stay in `<bdi dir="ltr">`, never a bare `dir="ltr"` on the containing element — per `content-ui.mdc`.
- **`apps/web/app/numbers/[id]/page.tsx` has pre-existing, unrelated, uncommitted owner changes** (confirmed via `git diff` on 2026-11-02 — a `useLoad`/`useAction` refactor and a `DataTable` conversion of the log tab; neither touches the `.facts` block this plan edits). Before editing it:
  1. Run `git diff -- "apps/web/app/numbers/[id]/page.tsx"` first and confirm the `tab === 'details'` block is unchanged between `HEAD` and the working tree (it was, as of this plan being written — if it no longer is, stop and report the mismatch instead of guessing).
  2. Make only the exact, minimal edit the task describes.
  3. **Never run `git add -A` or `git add .`** for this file. Stage only this task's lines.
  4. Reconstruct the target blob by hand: take `git show HEAD:"apps/web/app/numbers/[id]/page.tsx"`, apply only this task's edit to it in a scratch copy, then stage that exact content with `git hash-object -w <scratch-file>` + `git update-index --cacheinfo 100644,<hash>,"apps/web/app/numbers/[id]/page.tsx"`. Leave the owner's edits unstaged in the working tree.
- **`apps/web/app/users/[login]/page.tsx` is untracked (`git status` shows `??`) — it has no committed version at all.** This is a different situation from every file touched in Phases 1-2: there is nothing to reconstruct against, and no owner lines to protect from a commit, because the entire file's current content *is* the owner's in-progress, uncommitted feature. Task 2 below commits this file for the first time, in full, including the business logic the owner already wrote — not just the styling change. Use a normal `git add` for this file (no hash-object reconstruction needed, since there's no baseline to avoid clobbering).
- `apps/web/app/styles/desk.css` and `apps/web/DESIGN.md` have no pending owner changes (confirmed via `git status --short` on 2026-11-02) — edit and `git add` them normally.
- Do not delete `.account-facts` from `desk.css` until its only consumer (`users/[login]/page.tsx`) no longer references it — doing it in the same commit (Task 2) avoids a broken intermediate state.

## Review Focus

- **`.facts` is used directly inside `<section className="pane">` in `numbers/[id]/page.tsx` today (no `.pane-body` wrapper), while `.account-facts` is used inside `.pane-body` in `users/[login]/page.tsx`.** The new unified `.facts` CSS has no self-padding — it relies on a `.pane-body` ancestor for edge spacing (`.pane-body { padding: 12px 14px 14px }`). Task 1 adds the missing `.pane-body` wrapper around `numbers/[id]`'s details tab (matching its own `ops` tab, which already wraps in `.pane-body`) so both consumers are structurally consistent. If a reviewer finds `.facts` rendered without a `.pane-body` ancestor anywhere, that's a bug to fix, not a style choice.
- **The "duplicate" `.grant-line.head` div in `users/[login]/page.tsx` and the `label.grant-line` (not `label.check`) checkbox in its extra-roles section are intentional, not bugs** — confirmed against `desk.css`'s `.grant-head`/`.grant-board` two-column grid and the `@media (max-width: 960px)` rule that hides the second header on narrow screens. Do not "fix" either of these in any task below.
- **No `lib/api.ts` or backend contract changes anywhere in this plan.**

---

## Task 1: Unified `.facts` CSS + apply to the line-card page

**Depends on:** nothing (first task).

**Files:**
- Modify: `apps/web/app/styles/desk.css`
- Modify: `apps/web/app/numbers/[id]/page.tsx`
- Modify: `apps/web/DESIGN.md`

**Interfaces:**
- Produces: the canonical `.facts` CSS shape (grid, auto-fit columns, logical border) that Task 2 depends on for `users/[login]/page.tsx`.

- [ ] **Step 1: Read the current state**
  `git diff -- "apps/web/app/numbers/[id]/page.tsx"` — confirm the `{tab === 'details' && (...)}` block (the `.facts` dl) is untouched by the owner's diff, same as the Global Constraints note above.

- [ ] **Step 2: Update `.facts` in `desk.css`**

  Find this block:
  ```css
  .facts { display: grid; margin: 0; }
  .facts > div {
    display: flex;
    align-items: baseline;
    justify-content: flex-start;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--rd-line-soft);
  }
  .facts dt { color: var(--rd-muted); font-size: 12px; font-weight: 700; }
  .facts dd { margin: 0; font-weight: 700; }
  ```

  Replace it with:
  ```css
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 16px 24px; margin: 0; }
  .facts > div {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-width: 0;
    padding-block-end: 12px;
    border-block-end: 1px solid var(--rd-line-soft);
  }
  .facts dt { color: var(--rd-muted); font-size: 12px; font-weight: 700; }
  .facts dd { margin: 0; font-weight: 700; font-size: 15px; color: var(--rd-ink); }
  ```

  This is the only edit to `desk.css` in this task — `.account-facts` is untouched here (it still has one consumer, `users/[login]/page.tsx`, which Task 2 migrates).

- [ ] **Step 3: Wrap the details tab in `.pane-body` and fix two `bdi` gaps**

  In `apps/web/app/numbers/[id]/page.tsx`, find this block:
  ```tsx
            {tab === 'details' && (
              <dl className="facts">
                <div><dt>{t.company}</dt><dd>{line.companyName || '—'}</dd></div>
                <div><dt>{t.packageName}</dt><dd>{line.packageName}</dd></div>
                <div><dt>{t.price}</dt><dd><Money value={line.posPrice} /></dd></div>
                <div><dt>{line.esim ? t.esim : t.iccid}</dt><dd dir="ltr">{line.esim ? t.esim : line.iccid || '—'}</dd></div>
                <div><dt>{t.started}</dt><dd><bdi dir="ltr">{latinWhen(line.createdAt)}</bdi></dd></div>
                <div><dt>{t.endsOn}</dt><dd><bdi dir="ltr">{latinWhen(line.endsAt)}</bdi></dd></div>
                <div><dt>{t.status}</dt><dd>{lineStatus(t, line.status)}</dd></div>
                {!isPos && line.posLogin && <div><dt>{t.pointOfSale}</dt><dd>{line.posLogin}</dd></div>}
              </dl>
            )}
  ```

  Replace it with:
  ```tsx
            {tab === 'details' && (
              <div className="pane-body">
                <dl className="facts">
                  <div><dt>{t.company}</dt><dd>{line.companyName || '—'}</dd></div>
                  <div><dt>{t.packageName}</dt><dd>{line.packageName}</dd></div>
                  <div><dt>{t.price}</dt><dd><Money value={line.posPrice} /></dd></div>
                  <div><dt>{line.esim ? t.esim : t.iccid}</dt><dd>{line.esim ? t.esim : <bdi dir="ltr">{line.iccid || '—'}</bdi>}</dd></div>
                  <div><dt>{t.started}</dt><dd><bdi dir="ltr">{latinWhen(line.createdAt)}</bdi></dd></div>
                  <div><dt>{t.endsOn}</dt><dd><bdi dir="ltr">{latinWhen(line.endsAt)}</bdi></dd></div>
                  <div><dt>{t.status}</dt><dd>{lineStatus(t, line.status)}</dd></div>
                  {!isPos && line.posLogin && <div><dt>{t.pointOfSale}</dt><dd><bdi dir="ltr">{line.posLogin}</bdi></dd></div>}
                </dl>
              </div>
            )}
  ```

  Two content fixes bundled in here (both are existing-code gaps, not new behavior): the ICCID value moved from a bare `dir="ltr"` on `<dd>` to a `<bdi dir="ltr">` wrapper (matching `content-ui.mdc`'s "Latin identifiers stay in `<bdi dir=\"ltr\">`", and matching every other LTR value in this same list), and `line.posLogin` — a login name, same category as the ICCID — gained the `<bdi dir="ltr">` wrapper it was missing.

- [ ] **Step 4: Document the pattern in `DESIGN.md`**

  In the "Components" section, find:
  ```markdown
  - Empty: `EmptyState` inside `.empty` — muted icon in a small circle on `--rd-surface-2`, title (`children`), optional secondary `text`. Not a lone italic line.
  ```

  Add a new bullet immediately before it:
  ```markdown
  - Facts: `.facts` — a `<dl>` grid of label/value pairs (`dt`/`dd`). Columns auto-fit to the available width and collapse to one without a breakpoint. Latin identifiers inside a value stay in `<bdi dir="ltr">`. This is the only key/value detail pattern; do not write a parallel grid (for example `.account-facts`) for the same purpose.
  - Empty: `EmptyState` inside `.empty` — muted icon in a small circle on `--rd-surface-2`, title (`children`), optional secondary `text`. Not a lone italic line.
  ```

- [ ] **Step 5: Verify**
  `npx tsc --noEmit` (apps/web) — must pass. Start the dev server, open `/numbers/<any-id>` → "Details" tab, in light+dark, `ar`+`en`, at 1280px and 390px. Confirm: the fact grid shows multiple columns at 1280px and collapses to fewer (likely one) at 390px with no horizontal scroll; the bottom border under each row renders on the correct logical side in both RTL and LTR; the ICCID and point-of-sale values (when present) render LTR via `bdi`, not reversed.

- [ ] **Step 6: Commit**
  Stage `desk.css` and `DESIGN.md` normally. For `numbers/[id]/page.tsx`, reconstruct per the Global Constraints process (`git show HEAD:"apps/web/app/numbers/[id]/page.tsx"` → apply this task's edit to a scratch copy → `git hash-object -w` → `git update-index --cacheinfo`). Then:
  `git commit -m "style(web): unify .facts into a responsive grid, apply to line-card details tab"`

---

## Task 2: First commit of the account page, using the unified `.facts` pattern

**Depends on:** Task 1.

**Files:**
- Create (first commit): `apps/web/app/users/[login]/page.tsx`
- Modify: `apps/web/app/styles/desk.css`

**Interfaces:**
- Consumes: the `.facts` CSS shape from Task 1.

- [ ] **Step 1: Confirm the file is still untracked**
  `git status --short "apps/web/app/users/[login]/page.tsx"` — expect `??`. If it now shows `M` (someone committed it since this plan was written), stop and report instead of guessing which version to work from.

- [ ] **Step 2: Convert the account-facts markup to `.facts`**

  Find this block:
  ```tsx
          <div className="stack flow">
            <section className="pane">
              <div className="pane-body">
                <div className="account-facts">
                  <div><span>{t.loginName}</span><bdi dir="ltr">{row.loginName}</bdi></div>
                  <div><span>{t.layer}</span><b>{layerName(t, row.layer)}</b></div>
                  <div><span>{t.parent}</span>{row.parentLogin ? <bdi dir="ltr">{row.parentLogin}</bdi> : <b>—</b>}</div>
                  <div><span>{t.role}</span><b>{row.staff ? (row.roleName || '—') : layerName(t, row.layer)}</b></div>
                  <div><span>{t.status}</span><b>{row.frozen ? t.frozen : t.accountOpen}</b></div>
                </div>
              </div>
            </section>
  ```

  Replace it with:
  ```tsx
          <div className="stack flow">
            <section className="pane">
              <div className="pane-body">
                <dl className="facts">
                  <div><dt>{t.loginName}</dt><dd><bdi dir="ltr">{row.loginName}</bdi></dd></div>
                  <div><dt>{t.layer}</dt><dd>{layerName(t, row.layer)}</dd></div>
                  <div><dt>{t.parent}</dt><dd>{row.parentLogin ? <bdi dir="ltr">{row.parentLogin}</bdi> : '—'}</dd></div>
                  <div><dt>{t.role}</dt><dd>{row.staff ? (row.roleName || '—') : layerName(t, row.layer)}</dd></div>
                  <div><dt>{t.status}</dt><dd>{row.frozen ? t.frozen : t.accountOpen}</dd></div>
                </dl>
              </div>
            </section>
  ```

  (The `<b>` wrappers are dropped — `.facts dd` is already `font-weight: 700`, matching how `numbers/[id]`'s `.facts` usage has no `<b>` tags either.)

- [ ] **Step 3: Delete `.account-facts` from `desk.css`**

  Find this block:
  ```css
  .account-facts {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 12px 24px;
  }
  .account-facts div { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; }
  .account-facts span { color: var(--rd-muted); font-size: 12px; font-weight: 700; }
  .account-facts b,
  .account-facts bdi { color: var(--rd-ink); font-size: 15px; font-weight: 700; }
  .grant-board {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 32px;
  }
  ```

  Replace it with:
  ```css
  .grant-board {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 32px;
  }
  ```

  Then find, inside the `@media (max-width: 960px)` block:
  ```css
  @media (max-width: 960px) {
    .account-facts,
    .grant-board,
    .grant-head { grid-template-columns: 1fr; }
    .grant-head .grant-line.head + .grant-line.head { display: none; }
  }
  ```

  Replace it with:
  ```css
  @media (max-width: 960px) {
    .grant-board,
    .grant-head { grid-template-columns: 1fr; }
    .grant-head .grant-line.head + .grant-line.head { display: none; }
  }
  ```

- [ ] **Step 4: Verify**
  `npx tsc --noEmit`. `grep -rn "account-facts" apps/web/app apps/web/app/styles` — expect no output. Start the dev server, open `/users/<any-login>`, in light+dark, `ar`+`en`, 1280px and 390px. Confirm the account facts render in the new grid (multiple columns at 1280px, collapsing at 390px), the login name and parent-login values render LTR via `bdi`, and the permissions grid below (`.grant-board`) is unaffected.

- [ ] **Step 5: Commit**
  This is the first-ever commit of `apps/web/app/users/[login]/page.tsx` — stage it with a normal `git add "apps/web/app/users/[login]/page.tsx"` (no reconstruction: there is no prior committed version to preserve against). Stage the `desk.css` hunk normally too (it has no unrelated owner changes). Then:
  `git commit -m "feat(web): commit the account access page; unify its fact list onto .facts"`

  Note in the commit body: this commit includes the grants/permissions feature logic itself (the page's first commit), not only a styling change, because the file had no prior committed version — per the Phase 3 spec's Decision 3.

---

## Task 3: Full verification pass across all seven detail pages

**Depends on:** Task 2.

**Files:** none (verification only); adds files under `docs/visual-review/2026-11-02/phase3-detail-pages/`. May add small follow-up fix commits to any file listed below if a real, evidenced defect is found.

- [ ] **Step 1:** `npx tsc --noEmit` and `next build` both clean.

- [ ] **Step 2:** `npx playwright test` — compare the failing-test list against the known-pre-existing failures from Phases 1-2 (`companies-shelf.spec.ts`, `login.spec.ts` session-end, `tools-pages.spec.ts` double-click). Any *new* failure not on that list must be investigated and fixed before continuing; a failure already on that list is pre-existing and out of scope (confirm via `git diff -- <file touched by that spec>` showing unrelated owner changes, same discipline as Phases 1-2).

- [ ] **Step 3:** Capture screenshots at 1280px and 390px, light+dark, `ar`+`en` (plus one `he` sample on `/numbers/<id>` and `/users/<login>` — the two pages this plan actually changed — skip `he` on the five untouched pages to save time, same sampling approach as Phase 2), into `docs/visual-review/2026-11-02/phase3-detail-pages/`, for:
  - `/companies/<code>`
  - `/companies/<code>/<provider>`
  - `/providers/<code>`
  - `/numbers/<id>` — all three tabs (ops, details, log)
  - `/providers/<code>/<packageCode>` — all seven tabs (overview, run, prices, renewals, switches, numbers, offers)
  - `/users/<login>`

  For the three simple pages (`companies/[code]`, `companies/[code]/[provider]`, `providers/[code]`) and the package-sheet page (`providers/[code]/[packageCode]`) — none of which this plan edits — this is a visual QA check, same as Phase 2 Task 8's treatment of `/roles`, `/companies`, `/providers`: if a real, concrete defect is visible in the actual rendered page (not a stale assumption from an old screenshot), fix it inline as a small addendum commit against the specific file, with the fix and its evidence noted in the Result section below. If nothing is wrong, say so plainly and move on — do not invent a change to make the page count match the others.

- [ ] **Step 4:** On `/numbers/<id>` "Details" tab and `/users/<login>`, specifically confirm the new `.facts` grid: multiple columns at 1280px, collapsing at 390px with no horizontal scroll and no orphaned single-column row at 1280px looking sparse; the bottom border under each fact sits on the correct logical side in both `ar` (RTL) and `en` (LTR); dark theme uses `--rd-ink`/`--rd-muted` correctly (no hardcoded light-only color).

- [ ] **Step 5:** Write a `## النتيجة` section into `docs/superpowers/specs/2026-11-02-pearl-rebuild-phase3-detail-pages-design.md`, same before/after format as Phases 1-2's Result sections (in Arabic, matching the rest of that document).

- [ ] **Step 6: Commit**
  `git add docs/visual-review/2026-11-02/phase3-detail-pages docs/superpowers/specs/2026-11-02-pearl-rebuild-phase3-detail-pages-design.md && git commit -m "docs(web): phase 3 verification screenshots and result note"`

  (Any addendum fix commits from Step 3 land before this final docs commit, each with its own focused commit message, same pattern as Phase 2's Task 6b/final-review fix commit.)
