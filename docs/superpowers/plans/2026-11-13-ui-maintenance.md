# UI maintenance — plan

Spec: `docs/superpowers/specs/2026-11-13-ui-maintenance.md`. Findings: `docs/reviews/2026-11-13-ui-audit.md` (moved from the untracked root `AUDIT_REPORT.md` in P0.1, content unchanged; Arabic; §3 tables
3.1–3.10 = 277 findings). Every finding has an id `3.T-NN` (table, row order) in the **Coverage appendix** at the end,
with the slice that closes it.

Paths are relative to `apps/web/` unless they start with `docs/`, `scripts/` or `.cursor/`. Line numbers were checked
against the tree on 2026-11-13 (HEAD `626f61b`; re-checked in review rounds 4 and 5; HEAD `82fb84c` at round 8 is
docs-only, so the lines hold; re-checked on 2026-11-14 at HEAD `a84484f` after the backend's web renames,
which were all line-for-line); they move as slices land, so **find by selector, then by line**.
"graphite" = `app/styles/graphite.css`.

## Status

| Phase | Slices | State | Gate (two agents) |
|---|---|---|---|
| P0 Owner decisions + isolated high-severity fixes | P0.1–P0.9 | in progress | P0.1 7517db0, P0.2 983ea10, P0.3 827e449, P0.4 9b26b48, P0.5 b8bcb4d |
| P1 Tokens, role tokens, cascade guard (zero-diff) | P1.1–P1.8 | not started | — |
| P2 Fold graphite.css into its owners, remove dead rules | P2.1a–P2.11 | not started | — |
| P3 Core components | P3.1–P3.14 | not started | — |
| P4 Page templates and screens | P4.1–P4.10 | not started | — |
| P5 Responsive, breakpoint scale | P5.1–P5.6 | not started | — |
| P6 RTL and accessibility | P6.1–P6.8 | not started | — |
| P7 Docs final | P7.1–P7.2 | not started | — |
| P8 Visual audit and fix loop | P8.1–P8.6 | not started | — |

Decisions: ADR 0021 (`docs/architecture/decisions/0021-ui-maintenance-decisions.md`) — D1–D28 the owner's answer of
2026-11-13 (every recommendation; D28 = a); branch `ui-maintenance` (owner 2026-11-13; created from `a84484f` on
2026-11-14); audit file (a), rule files (a), graphify (a) and the `V.click` deferral (yes) taken as recommended by the
orchestrator under the owner's instruction of 2026-11-14, to be confirmed by the owner; the three named exceptions to
one primary per view (ADR 0021 D2: the tasks list row's own `sm` «أخذ المهمة»; the task ticket — take beside «إكمال»
in its head on an unassigned task, and its in-page submits, the open complete form's «إكمال» and the note composer's
«إضافة ملاحظة»; a tab's main form beside the page-head action — the company «الإعدادات» tab's «حفظ», the provider account
«المطابقة» tab's «مقارنة») are P0.1's own reading, not an owner answer, also to be confirmed by the owner.

Each finished slice gets its commit hash here (`P0.2 abc1234`) and in its slice heading. **Non-commit steps:** P8.2
(capture run), P8.3 (inspection) and P8.6 (final gate) change no tracked file; their evidence is the run folder
(`audit-output/visual-audit/<RUN>/`), recorded here as `P8.2 run <RUN>` instead of a hash, and G1 accepts that.

### Why this order (and where it departs from the audit's draft)

1. **P0 before everything**: decisions D1–D28 change what several slices write; the nine high-severity findings
   (3.1-01, 3.2-01/02/03, 3.4-01, 3.7-01, 3.10-01/02/03) are isolated and safe, so they do not wait for the refactor.
   R1 (topbar menus anchored to the bar) must land before any touch-size growth of topbar icons (conflict 4).
2. **P1 tokens before P2 merge**: the merge rewrites each moved rule, so tokens must exist first. P1 tokenises only the
   sheets that survive (ui, controls, forms, doors, base, dialog, shell, desk/*); graphite's ~180 literals are tokenised
   **as they move** in P2 (one rewrite per rule instead of two).
3. **P2 merge before P3 components**: a component cannot get one definition while graphite restates it. P2 is
   zero-diff except P2.11 (named typography normalisation).
4. **P3 components before P4 templates**: templates compose Pane, FormActions, EmptyState, Stat.
5. **P5 responsive after P4**: the templates fix the markup the breakpoint rules address; the breakpoint scale lands
   before P6's touch rules, which use it.
6. **P6 a11y last of the code phases**: contrast tokens and touch sizes are measured on the final markup.
7. **P7 docs** is a consolidation; every slice already updates the maps it touches (CLAUDE.md "Keep the maps current").

## Standard checks (referenced by every slice)

- **CHK-LOCAL** (repo root): `npm run lint`, `npm run typecheck`, `npm run check:copy`. From P1.1 on, `npm run lint` in
  `apps/web` also runs `node scripts/check-css.mjs` (the CSS guard). **From P0.9 on** (where it is written) CHK-LOCAL
  also runs `node scripts/contrast.mjs` from `apps/web` (seconds; it catches a moved or changed crimson-fill rule in
  P2.3, P3.2, P3.5 and every other slice before P6.4 puts it inside `npm run lint`). All must pass with 0 errors /
  0 warnings.
- **CHK-ZERO** (zero-diff slices): **used only from P1.1 on.** Before P1.1 lands the snapshot hashes mid-animation
  (`tests/dom-snapshot.mjs:177` waits a fixed 400ms, no reduced motion, `rd-rise` entrances with staggered delays), so
  two runs with no code change can differ; P0 slices therefore prove "unchanged" with **CHK-READ** (below), never
  CHK-ZERO. With the one app copy running on 3000 (`.claude/launch.json` → `smilesim`), from
  `apps/web`, before editing and again after:
  `STYLES=1 STATES=1 WIDTH=<w> THEME=<t> LOCALE=<l> node tests/dom-snapshot.mjs audit-output/maintenance/<slice>/snap/<before|after>-<w>-<t>-<l> http://admin.localhost:3000`
  for `(w,t,l)` ∈ {**390, 700, 768, 1024, 1280**} × {(dark, ar), (light, en), (dark, he)} — fifteen runs each side,
  **one at a time**. 700 sits inside the 641–767 band and 1024 inside 900–1099, so every band the sheets use is
  rendered. Add **860 and 861** when the slice touches sign-in rules (the `.gauth` split), **1200** when it touches the
  topbar or search, **899/900** when it touches the shell, and **the width inside every `@media` block the slice moves
  a rule into or out of** (the slice lists them). The script answers `/api` from its own fixtures in the browser and
  starts no server. From P1.1 on it also hashes `::before` / `::after` of every element and writes a forced-state pass
  (`.states.tsv`, see P1.1), and **settles every animation and transition before each hash** (P1.1 step 3: running
  animations finished, infinite ones cancelled, so the hash holds the `animation-*` / `transition-*` longhands and the
  end values, never an in-flight opacity or transform). Then `diff -r audit-output/maintenance/<slice>/snap/before-… …/after-…` must show **no
  difference in any `.styles.tsv` or `.states.tsv`** (markup differences are allowed only where the slice removes a
  dead class or element; rows are keyed by a stable key, P1.1 step 3, so a removed sibling shows as one missing row
  and does not shift its later siblings). Any difference is a defect, not a judgement call. Run *before* and *after* in the same session (fixture
  dates such as `endsAt` and the server-side branding read from the API on 3001 can change across midnight or a data
  edit); if a difference looks unrelated to the slice, stash only the slice's own paths (`git stash push -- <slice paths>`,
  never a bare `git stash`, which would also take the owner's unrelated tracked changes), re-run *before*, compare
  again, then `git stash pop --index`. Use `git stash push --include-untracked -- <slice paths>` when the slice adds
  new files (a plain path stash skips untracked files); the noise procedure runs only before the slice's files are
  staged.
  **Cost:** P1.1 measures one full fifteen-run side and records its wall time in its evidence note, so the
  orchestrator can plan how long each zero-diff slice holds the browser token. **Threshold:** if one side takes more
  than **45 minutes**, the orchestrator puts a reduced set to the owner (in Arabic) before P1.2 starts — for example
  the five widths in (dark, ar) plus 390 and 1280 in the other two combos, with the full fifteen kept for the last
  slice of each phase — and the answer is recorded in the Status table and the spec (ADR 0021); until the owner
  answers, the full set applies.
  **Narrower sets:** the widths, combos and cases a slice's Verify line names for CHK-ZERO are **additions**; they
  never narrow the fifteen-run set above (or the owner's reduced set). Where a Verify line reads narrower (P4.10 "on
  every case whose screen changed", P6.3 "at 390/1280 ar/en"), that names where the slice's specific change is
  looked at; the full set still runs.
  **Reuse:** the previous slice's *after* folder may serve as this slice's *before* when the tree under `apps/web`
  now equals the tree that folder was taken on — `git diff <HEAD.txt> HEAD -- apps/web` shows exactly the committed
  previous-slice diff and `git status -- apps/web` is clean apart from known owner files (`HEAD.txt` holds
  `git rev-parse HEAD` at capture time; HEAD itself always moves with the slice and `docs(plan)` commits) — it is the
  same day, and the case list is the same;
  the executor copies it and says so in the evidence note. From P1.1 on the script freezes the page clock (see P1.1),
  so fixture dates no longer make runs session-dependent.
- **CHK-READ** (P0 "unchanged" proofs, before CHK-ZERO is usable): with the built-in browser on 3000, a script reads
  `getComputedStyle()` (the properties the slice touches plus `display`, `position`, `inset-*`, `width`, `height`,
  `padding-*`, `margin-*`) and `getBoundingClientRect()` of the elements the slice names, at the widths it names, in
  ar-dark and en-light, after `document.getAnimations().forEach(a => a.finish())`; *before* and *after* are saved as
  JSON in the evidence folder and compared with `diff`. Any difference in a named element is a defect.
- **CHK-LOOK** (visible slices): on `http://admin.localhost:3000` (and `main.`, `agent.`, `pos.` where the slice's pages
  exist), with the built-in browser: the slice's listed pages at **375, 390, 768, 1024, 1280** (and 1440 for layout
  slices, **and 1920 for layout slices: every P4.x and P5.x slice and any slice that changes a grid, a pane width or a
  page template** — screen-size.mdc's wide monitor), **ar-dark, en-light, he-light** (he-dark too when a colour changes), plus the listed open states. Read the
  computed styles of the changed element on **every page that has it** with a script (verify-before-reply.mdc §1–2),
  then look at full-size screenshots. Record numbers in `audit-output/maintenance/<slice>/look.md` (git-ignored).
  **Binding set:** every visible slice (P0.2–P0.9, P1.2, P1.8's named change if any, P2.11, every P3–P6 slice not
  marked zero-diff, every `Pn.fix-k` and `V.nn` slice) runs CHK-LOCAL + CHK-LOOK + CHK-AUDIT whether or not its Verify
  line names them. The pages, widths, combos and states a slice's Verify line lists are **additions** that say where
  its specific measurement is taken; they never narrow this set (375, 390, 768, 1024, 1280; 1440/1920 for layout
  slices; ar-dark, en-light, he-light). A reviewer fails a slice whose evidence lacks any width or combo of this set.
  **Data states (verify-before-reply.mdc §5):** a changed element is also checked in each data state it can have —
  empty, loading, error, one row, many rows, long names, unlimited / none values — using the snapshot fixtures or a
  `page.route` answer built from the real response shape (as P8.1's state table does; never a saved data change);
  the evidence note lists each state checked or why the element cannot have it.
  **Clicks and "not checked" (verify-before-reply.mdc §4 and §6), every visible slice:** the executor clicks what the
  slice changed (open / close, submit, hover, focus by Tab) and measures with `getBoundingClientRect()` before and
  after that nothing around it jumps; `look.md` ends with a **"Not checked"** list (what and why), empty only when
  everything was checked. A reviewer fails a visible slice whose `look.md` lacks either. The only deferral is the
  P8.2 window's `V.click` pass, on the owner's yes.
- **CHK-AUDIT**: after every visible slice (P0.2–P0.9, P1.2, P1.8's named change if any, P2.11, all of P3–P6, every
  `Pn.fix-k` and `V.nn` slice; verify-before-reply.mdc §3), re-run the existing visual audit for the touched routes:
  `cd apps/web && ONLY=<route> npx playwright test -c visual-audit/audit.config.ts` (`ONLY` is a substring match,
  `audit.visual.ts:81`: `ONLY=/` runs every route — for the home page use the runner's exact-match form if it has one,
  else accept the full run or name the home case's slug; drives port 3000, one worker,
  starts no server; sanctioned by verify-before-reply.mdc §3) and read `audit-output/visual-audit/latest/findings-*.json`
  (P8.1 keeps writing that `latest/findings-*.json` file beside its new per-run tree, so this check reads the same path
  for `V.nn` slices). Before P8.1 the executor deletes `audit-output/visual-audit/latest/` before each run (so no
  earlier run's file reads as clean) and copies the findings into its evidence `audit/` folder after each run. **Pages
  the runner does not list:** before P8.1 the runner's `ROUTES` holds 28 routes (`audit.visual.ts:13–17`); a slice
  whose route is not among them (`/login`, `/password`, `/two-factor`, `/companies/new`,
  `/companies/[code]/packages/new`, `/tasks/decisions`, `/reports/[kind]`, `/users/[login]` other than `main` / `pos`)
  records that route as "not covered by the runner" in its evidence note, and CHK-LOOK carries it; an empty findings
  file for such a route is never read as clean. **Doors:** the runner defaults to `DOOR=admin USER_LOGIN=branch`; a
  slice whose pages exist on main, agent or pos (P0.7's sell cells, `/wallet`, the POS forms) runs it once per door
  with `DOOR=<door> USER_LOGIN=<login>` from the trial seed. A runner login adds a session and may revoke the oldest one beyond the account's limit
  (`auth.service.ts` `makeRoom`), which can sign the built-in browser out: CHK-LOOK after a CHK-AUDIT run logs in
  again with the trial seed when it finds the sign-in screen.
- **E2E**: each slice lists the specs in `tests/` it affects. The executor updates them in the slice; they run **only on
  GitHub Actions when the owner asks for a push** (machine-limits.mdc). Never run Playwright e2e locally.
- **Logins** for doors: the trial seed (`apps/api/src/modules/auth/trial-seed.ts`): `branch` (admin.), `main`
  (main.), `agent` (agent.), `pos` (pos.), with the password the visual-audit runner already uses.
- **Evidence folder**: one root, `apps/web/audit-output/maintenance/<slice>/` (git-ignored by the root `.gitignore`
  `audit-output` line): `snap/` (CHK-ZERO before/after), `read/` (CHK-READ before/after JSON), `look.md` and screenshots (CHK-LOOK), `audit/` (a copy of
  the CHK-AUDIT findings), `review-<round>-<A|B>.json` (reviewer verdicts), `gate-<agent>.json` (phase gates, in a per-phase folder `apps/web/audit-output/maintenance/gate-<phase>/`). The
  visual-audit runner keeps its own output under `apps/web/audit-output/visual-audit/`. Nothing in either is committed.

---

## EXECUTION PROTOCOL (binding)

**Autonomous run (owner instruction, 2026-11-14).** The owner wrote, before leaving the run unattended: «ابدأ العمل
علي كل قسم بقسمه ينتهي واحد تبدأ الثاني لوحدك بدون مراجعه واعطيني تقرير بالنهايه» — run phase after phase alone,
without asking between phases, and report at the end. Until the owner speaks again, this section **overrides** every
step of this plan that says ask, tell or escalate to the owner, or that a parked slice or an open gate stops later
work (protocol steps 4 and 5, the working-tree and branch preconditions, the fix-slice and amendment rules, the PHASE
GATE bound and the P0, P8 and P8.6 gate items that need an owner answer). Everything else is unchanged. The final
report lists every item below as it happened.

- **P0.1's questions.** D1–D28: the owner's own answer of 2026-11-13 ("accept all" recommendations; D28 = a). Branch:
  the owner's own answer, `ui-maintenance`, created by the orchestrator before P0.1. The remaining P0.1 questions take
  their recommended answer — audit-file (a), (i) yes (slices may edit the `.cursor/rules/*.mdc` files the plan names,
  and ADR 0021 carries the interim precedence sentence), (ii) yes, (iv) yes — and ADR 0021 records each as
  "recommended answer taken by the orchestrator under the owner's instruction of 2026-11-14; to be confirmed by the
  owner", never as the owner's own answer. The P0 gate accepts that record in place of an owner answer for these four.
  The P0.1 notice that runner logins can sign out the owner's oldest `branch` sessions goes into the final report.
- **The CHK-ZERO cost threshold** (P1.1): if one side exceeds 45 minutes, the reduced set this plan gives as its
  example (the five widths in (dark, ar), plus 390 and 1280 in the other two combos; the full fifteen on the last slice
  of each phase) applies, recorded in Status and ADR 0021 as taken under this instruction.
- **CI (G6, P7 gate, P8.2, P8.6).** Nothing is pushed. Each gate records "CI not run (autonomous run, no push asked)"
  and carries the list of untested specs forward; that alone is never blocking. The P8.6 gate stays open on its CI
  item only, which is reported, not turned into a fix slice. The final report states that the production build and
  the updated e2e specs have not run.
- **Parking** replaces every escalation (protocol step 4's round limit and second dispute, fix slices or amendments
  needing a choice or a visible change outside the spec's list, a selector no amendment can resolve, every failed
  commit check except a staged path no agent of the run staged, which halts — see below). First every slice path is staged
  (`git add -A -- <slice paths>`, so a new file not yet staged is kept; `<slice paths>` are only the files this slice
  changed — a file with foreign changes is never among them); then the slice's staged diff is saved to `apps/web/audit-output/maintenance/<slice>/parked.patch`
  (`git diff --cached --binary`) and its unstaged slice edits to `parked-unstaged.patch` (`git diff --binary --
  <paths>`); then its tracked paths are restored (`git restore --staged --worktree -- <paths>`) and files it added are
  removed (`git rm -f --cached -- <new paths>`, then `rm -- <new paths>`). **Never removed or restored by parking:**
  this plan, the spec, `AUDIT_REPORT.md` and its `docs/reviews/` copy — they are only unstaged (`git restore --staged`),
  and if the root `AUDIT_REPORT.md` was already deleted it is copied back from the `docs/reviews/` copy. Status records
  `parked — <reason>` (when the plan is tracked), and the item goes to the final report with the evidence and the
  options. The next slice starts only if its executor confirms (step 2.1) that none of its edits depend on a parked
  slice; otherwise it is parked too, with that reason.
- **Gates.** G1 passes with the parked list recorded; G2 excludes the findings of parked slices (listed, not checked
  as closed); the gate agents check that nothing committed depends on a parked slice. If a gate is still not ready
  after its third round: the run **halts** when the phase is P0 or P1 (ADR 0021, the CHK-ZERO tooling and the token
  foundation are what every later phase builds on), when any open item is a G3 item (the tree is not clean), or when
  a gate agent marks an open item as one later phases build on; otherwise its open items are recorded in the Status
  "Gate" column and the final report, and the next phase starts. P8.6's three-round regression bound reads the same way: the open items are reported.
- **Stops that halt the run** (the workflow ends and the orchestrator reports; nothing foreign is touched): once the
  branch exists (the orchestrator creates it before P0.1), the branch or HEAD check fails (`git branch --show-current` ≠ `ui-maintenance`, or HEAD has commits the run did not
  make); the commit check finds a staged path that no agent of the run staged; **P0.1 is parked** (the plan and spec
  are tracked only by P0.1's commit, and ADR 0021 is every executor's input). **A file with changes the slice did not
  make** (working-tree precondition) parks that slice without touching the foreign change. **No `git merge main`**
  happens during the autonomous run.
- **P8.2's window and snapshot.** The no-data-change window runs from P8.2 to the end of the run (no saves in any check);
  the orchestrator takes the local snapshot itself (the `pg_dump` command, which only reads); the restore is never run
  without the owner. The §4 click deferral is (iv) above. If the capture outlasts the run, it continues from the
  manifest when the owner resumes it. P8.6's merge waits for «ادمج في المين» as written.
- **Mechanical git steps.** Every commit the plan gives the orchestrator (the step-5 slice commit after the staged-set
  check, `docs(plan): record`, `status`, `add` and `amend`, and parking) is carried out by a **commit clerk** agent
  that follows step 5 to the letter and changes no other file or line; wherever the protocol says "the orchestrator
  commits" read "the orchestrator, through its commit clerk". The clerk never judges a slice.
- **Browser.** Agents have no built-in browser: CHK-READ, CHK-LOOK, reviewer and gate checks use headless Chromium
  through Playwright scripts against the one app copy on 3000 (as `tests/dom-snapshot.mjs` and the visual-audit runner
  already do), written as `.mjs` under the slice's evidence folder (never `.ts`, which CHK-LOCAL would type-check;
  never under `tests/`). The browser-token rule holds: one agent uses the browser at a time. During review Reviewer A
  holds the browser (live checks, the review-after CHK-ZERO); Reviewer B uses no browser at all and reviews the code,
  the staged diff and the evidence files; gate agents run one after the other.

**Roles.** The *orchestrator* (the session running the workflow) assigns work, never edits files (one stated
exception, step 5), owns the one dev server, and commits. The *executor*, *fixer*, *reviewers*, *gate agents* and
*fix-slice authors* (below) are separate agents.

**Fix slices (`Pn.fix-k`, `V.nn`).** A fix slice is never defined by its own executor. Its text — Goal, Files, Steps,
Closes, Risks, Verify (the standard checks it needs), Blast radius (P8.5), Commit — is written by a named author: for
`Pn.fix-k` one of the two gate agents of that phase (the one whose blocking items it fixes; if both, the first), for
`V.nn` the P8.4 consolidation agent; for a `Pn.fix-k` that comes from a failed CI job or spec (G6), a fresh author
agent given the job log. The author appends the text to this plan under **"Fix slices"** (the section
before "Review notes"); the two other agents of that step (for `Pn.fix-k` the other gate agent plus one fresh reviewer;
for `V.nn` the two P8.4 reviewers) check it against the defect evidence, the spec's visible-change list and
work-plan.mdc (every file it touches named), each returning approve / changes as in step 3; on approval the
orchestrator commits it as `docs(plan): add <slice>` (that file only), and only then does the slice's executor start
under steps 1–6. A fix that would change something visible that is not in the spec's "What changes for users" list, or
that needs a choice between real alternatives, goes to the owner first (in Arabic); the answer is added to the spec and
ADR 0021 in the same `docs(plan)` commit (the author edits those, not the orchestrator).

**Mid-phase amendments.** When a slice stops because its text or the spec is wrong or incomplete (P3.13's hit no
earlier slice owns, P5.1's width not in the table, P5.2's fallback, a selector that no longer exists), the slice's
executor writes the amendment to the slice text and/or the spec, the two reviewers of that slice check it as in
step 3, and the orchestrator commits it as `docs(plan): amend <slice>` (those files only) before work resumes. A
piece of **earlier** work found missing becomes a `Pn.fix-k` slice authored by one of the two reviewers and checked
by the other plus one fresh reviewer, as above. An amendment that changes something visible outside the spec's list
or needs a choice goes to the owner first, as above.

**The browser token.** There is one app copy and one built-in browser. Whoever needs the browser (executor for
CHK-LOOK, a reviewer, a gate agent for G4, the P8 capture agent, a split-check agent) asks the orchestrator for the
token, works alone while holding it, and hands it back. Code reading and diff review run in parallel; **every browser
step runs one agent after the other**. CHK-ZERO and the visual-audit runner also count as browser use.

**Branch precondition (both branch answers).** There is one working tree and one app copy: port 3000 serves whatever
the checkout holds (`ui-maintenance` under answer a, `main` under answer b). The HEAD and index checks below apply under
both answers. At slice start, before each evidence run (CHK-ZERO, CHK-READ, CHK-LOOK,
CHK-AUDIT) and before commit, the executor (or reviewer / gate agent holding the browser token) checks that
`git branch --show-current` equals the chosen branch and that HEAD equals the last commit recorded in the evidence
notes plus only known `docs(plan)` / owner commits; otherwise it **stops** and the orchestrator asks the owner. The
P0.1 branch question tells the owner how his backend commits reach `main` under (a): pause backend work while a slice
is open, commit backend work on `main` only at a slice boundary (switching the checkout back to the branch before the
next slice starts and merging `main` in as step 5 says), or use a separate no-server worktree for backend commits.
**Concurrent backend edits (both answers).** Uncommitted backend edits in this tree restart the API on 3001
(`scripts/dev-local.sh`), so while a slice is open (from its first evidence run to its commit) and for the whole
P8.2–P8.6 capture window, no backend file in this tree is edited: backend work pauses or runs in a separate worktree
with no server. P0.1's branch question states this rule to the owner. An API restart seen during CHK-LOOK, CHK-AUDIT
or a capture voids that run; it is repeated, never recorded as a UI defect.

**Working-tree precondition.** The owner may keep unrelated uncommitted or untracked files in the tree (the list
changes from day to day, and other workstreams — the backend office-retirement plan among them — share this tree; run
`git status --short` at the start of every slice and record it in the evidence note). Interactive `git add -p` is unavailable, so before a slice edits a file the executor runs `git status --short <file>`;
if the file already has changes the slice did not make, the executor **stops** and the orchestrator asks the owner to
commit or stash them first. No slice ever stages a hunk it did not write.

**Concurrent plan: office retirement.** `docs/superpowers/plans/2026-11-13-office-retirement.md` (backend, ADR 0020,
accepted 2026-11-13) shares this tree and the one app copy. Its web-facing slices W.1/W.2 ("Web names"), R.11a and
R.11b (the web calls `/v1/...`) landed on `main` before P0 (HEAD `a84484f`, 2026-11-14), and this plan, the spec and
the audit report were amended for them before P0 (`components/office-shell.tsx` → `components/app-shell.tsx`, `.office` →
`.app-shell`, `.office-main` → `.app-main`, `/api/office/...` → `/api/v1/...`; every rename was line-for-line, so
line numbers hold). What remains of that plan is R.11c (the server stops serving `/office/*`), blocked on a deployed
release; it changes no web file this plan names. Should any later backend commit touch `apps/web`, a `git merge main`
that carries it is taken **only at a phase boundary** (after the gate, before the next phase's first slice), is
followed by a `docs(plan): amend` of every affected path and selector in this plan and the spec (author + two
checkers, as under "Mid-phase amendments") before work resumes, and is **held during the P8.2–P8.6 window** like a
migration merge (a class or path rename changes the stable element keys and would flood `unexplained.json`). The
orchestrator checks `git log --oneline HEAD..main -- apps/web` before any merge.

1. **One slice at a time.** A slice starts only when the previous slice is committed (or the owner explicitly parks
   it). No agent works on two slices at once. No agent starts work belonging to a later slice, even "while there".
2. **Executor (exactly one agent, the strongest available model).** Inputs: this slice's text, the spec, ADR 0021
   (decisions; where an owner answer quoted in ADR 0021 and a `.cursor/rules/*.mdc` sentence disagree before P7.1
   has aligned them, the quoted answer wins — see P0.1), `CLAUDE.md`, `DESIGN.md`, `.cursor/rules/*.mdc`, the audit rows the slice closes, and for any
   slice that edits `components/`, `features/` or `app/**/*.tsx` also `apps/web/AGENTS.md` (Next 16: read the relevant
   guide in `node_modules/next/dist/docs/` before writing code). It:
   1. re-verifies every selector and line the slice names (`grep -n`), and writes corrections into its evidence note;
   2. captures the *before* evidence (CHK-ZERO or CHK-LOOK measurements);
   3. makes the change, **including** the doc updates the slice lists (DESIGN.md, `docs/architecture/frontend.md`,
      ADR, "Last verified" line) and the e2e spec updates. **Binding even when the slice's Files list omits them**
      (CLAUDE.md "Keep the maps current"): a slice that adds, removes or renames a component, hook, context, token,
      stylesheet, primitive **or script** (`scripts/check-css.mjs`, `scripts/contrast.mjs`, test/audit runners)
      updates `docs/architecture/frontend.md` and/or DESIGN.md and their "Last verified" line in the same commit.
      **graphify:** `graphify-out/` is local and git-ignored and the post-commit hook rebuilds the code graph; the
      `/graphify . --update` re-extraction of core docs that CLAUDE.md asks for after a core-doc edit is deferred to
      the last slice of each phase (the orchestrator runs it before the gate) and once more in P7.2 and P8.6 — no
      slice is blocked on it;
   4. runs CHK-LOCAL and captures the *after* evidence;
   5. stages **only its own files** (`git add <paths>`; never the owner's unrelated changes under `apps/api/`,
      `AUDIT_REPORT.md`, `docs/client/`), does not commit, and hands back: files changed, findings closed, evidence
      paths, anything it could not do.
3. **Two reviewers (independent agents, preferably two models different from the executor's and from each other).**
   Reviewers **never edit, stage or commit**. Each reads `git diff --cached`, the slice text, the code around every
   change, the rules and the audit rows, and tries to find what the executor left behind:
   - missed instances (run the slice's "grep for leftovers" commands and their own);
   - places the change breaks elsewhere (the selector's other users; a moved rule now losing or winning against a later
     sheet; a token used by other rules; the risks listed in the slice);
   - dark / light, ar / en / he, 375–1440 regressions; open states (dialog, popover, drawer, empty, loading, error);
   - zero-diff slices: Reviewer A (holding the browser token) first checks that `git diff --stat -- apps/web`
     (unstaged) is empty, so the tree `next dev` serves is the staged diff, then re-runs only the *after* side of
     CHK-ZERO at 390 and 1280 dark-ar on the staged tree, into `snap/review-after-…`, and diffs it against the executor's *before* folder
     (reviewers never stash or edit, so they never produce a *before*); any `.styles.tsv` / `.states.tsv` difference
     fails;
   - docs, ADR, plan status, "Last verified", e2e specs not updated; copy keys missing in a language.
   Code review runs in parallel; **browser checks run one reviewer after the other** (one app copy, one browser).
   Each returns a verdict:
   `{ "slice": "P1.3", "verdict": "approve" | "changes", "defects": [{ "file": "...", "line": 0, "what": "...",
   "evidence": "...", "severity": "blocker|major|minor" }], "checked": ["..."] , "not_checked": ["..."] }`.
   A reviewer may not approve with a non-empty `not_checked` that covers a check the slice requires.
4. **Fix loop.** If either reviewer returns `changes`, the orchestrator gives the union of defects to **one fixer
   agent** (may be the executor's model, a fresh agent). The fixer fixes, re-runs CHK-LOCAL and the evidence the defect
   needs, restages, and lists each defect as fixed or disputed with a reason. Then **two reviewers evaluate again**
   (new agents or the same two; both must re-check the whole slice, not only the fixes). Loop until both approve.
   - **Round limit:** three fix rounds. Escalation fires at the **first** of: (a) the fixer disputes an item and a
     reviewer re-raises the same item after the dispute (second dispute of one item — can happen in round 2), or
     (b) the review after the third fix round still has a defect. The orchestrator then stops the slice, keeps the
     staged diff, and **escalates to the owner** with the disputed items, the evidence, and the options. A parked
     slice blocks its phase gate (G1 fails) and nothing later starts until the owner answers.
   - A `minor` defect cannot be waived by the fixer; only the owner can waive, in writing, in the escalation.
5. **Commit.** When both reviewers approve in the same round, the orchestrator first checks that
   `git diff --cached --name-only` equals exactly the executor's (and fixers') reported file list — any extra staged
   path (for example from the backend workstream) stops the commit and goes to the owner — and that
   `git diff -- <those paths>` is empty (a pathspec commit takes the working-tree content, so an unstaged edit would slip
   in); then commits with a pathspec, `git commit -m <message> -- <those paths>`, locally with the slice's commit message (shape below) and records the reviewer verdicts in the evidence folder. A commit cannot
   contain its own hash, so the hash is recorded afterwards in a separate commit
   `docs(plan): record <slice> <hash>` that touches only this plan's Status table and the slice heading — **the one
   stated exception** to "the orchestrator never edits files" (no other line may change in that commit; reviewers of
   the next slice check it with `git show --stat`). Never amend. **Every other Status-table entry** the plan asks the
   orchestrator to record — a fix slice's row (added when its text is committed, hash when it lands), the owner's
   answers it is told to note (P8.2's window and snapshot, the branch), "CI not run" and the carried spec list (G6),
   the P5.2 fallback, a CI waiver (P8.6), `P8.2 run <RUN>`, each phase's gate result in the "Gate" column — goes through the same kind of commit
   (`docs(plan): status <what>`), touching only the Status table (and a slice heading for a hash); no other
   orchestrator edit exists. Every `docs(plan)` commit (record, status, add, amend) uses the same staged-set check and pathspec.
   **No push** unless the owner says «ارفع» (machine-limits.mdc). Branch: the one chosen in P0.1 (recommended a work
   branch `ui-maintenance`, because the owner pushes local `main` for backend work and would otherwise ship
   half-finished phases; local `main` if the owner prefers). **Branch lifecycle (branch answer a):** the orchestrator
   asks the owner the branch question *before* P0.1's executor starts and, on answer (a), runs
   `git switch -c ui-maintenance main` (P0.1 itself is committed on the branch). The owner's backend commits on
   `main` reach the branch only by `git merge main` (never rebase: slice hashes are recorded in this plan and commits
   are never rewritten), done by the orchestrator at a slice boundary (no staged diff), after telling the owner, with
   CHK-LOCAL re-run on the merge; a merge conflict in a file this plan touches is escalated to the owner. The branch
   reaches `main` only at the end (P8.6) when the owner says «ادمج في المين»: merge into `main`, push, watch the
   GitHub Actions run (CLAUDE.md). **Branch answer (b), local `main`:** no branch is created; wherever this plan says
   "push the work branch" or "a run on the `ui-maintenance` branch" read "push `main`" / "a run on `main`", and P8.6's
   merge step is skipped. The owner is told when asked (P0.1) that under (b) any push of `main` he makes for backend
   work also ships whatever UI phase is half-finished at that moment.
6. **Commit message shape.** `<type>(web): <what changed, plain> (UI maintenance <slice>; closes <ids>)` — type is
   `fix` (visible defect), `refactor` (zero-diff), `feat` (new component / guard), `docs` (docs only), `test` (specs
   only). Body: what changed, what did not, the decisions applied (D#), the checks run. End with the attribution line
   the session's system reminder gives (`Co-Authored-By: …`).
7. **The app.** One copy on 3000. If it is not running, the orchestrator starts it with `preview_start` (`smilesim`)
   after checking `lsof -nP -iTCP -sTCP:LISTEN`; never a second copy. `next dev` hot-reloads CSS; no restart needed.

## PHASE GATE (binding)

A phase starts only after the previous phase is complete and **two gate agents** (independent; not the executor of any
slice in that phase; preferably different models) each return `{ "phase": "P1", "ready": true|false, "blocking": [...] }`
with `ready: true`. Common checklist for every gate:

- G1 every slice of the phase is committed, with both reviewer approvals in its evidence folder and its hash in Status;
  every fix slice of the phase has its text in "Fix slices" committed (`docs(plan): add <slice>`) before its code commit;
- G2 every finding the coverage appendix assigns to the phase is closed — the gate agent opens each finding's location
  and confirms the defect is gone (or the owner decision / won't-fix note is recorded). **One finding stays open by
  decision:** 3.3-32's width part (D12 = later; its padding part closes in P5.3). No gate fails on it; the P7 and P8
  gates check that ADR 0021 records the owner's D12 answer. **Closed by an accepted decision, not by unifying values**
  (under the recommended D6 a and D23 a; the gate agent checks that each difference is now on its own named token and
  documented in DESIGN.md, and fails any *other* leftover): 3.4-17 (S17 inset differences kept, P2.10), the sidebar
  row-edge half of 3.4-04 (S4, P3.14), the two zebra recipes of 3.1-13 (D23, P1.8 / P2.10), and the half-pixel and
  off-step values of 3.1-08 and 3.1-12 (named role tokens, not rounded, D6). If the owner answered D6 b or D23 b, these
  close by the unified value instead. If the owner answered D12 = now, a separate spec and plan
  are written before P4 starts (not run inside this plan) and G2 of P4 checks that they exist;
- G3 CHK-LOCAL clean on the committed tree; `git status --short` shows no staged files and no unstaged
  modifications left by an executor or fixer (only the owner's known files recorded in the evidence notes);
- G4 the phase's visual checks are recorded (the evidence folders hold the measurements and screenshots the slices
  required), and a gate-level spot check: the gate agent opens five pages of its choosing at 375 and 1280, ar-dark and
  en-light, and finds no regression in what the phase touched;
- G5 maps current: DESIGN.md, `docs/architecture/frontend.md`, ADRs, "Last verified" lines, `docs/handover/` where the
  phase changed something a handover guide describes; **`.cursor/rules/smilesim-ui.mdc` and `content-ui.mdc` do not
  contradict DESIGN.md or ADR 0021** (grep them for every phrase the phase changed in DESIGN.md); for P3 and P4 (where
  components are created and removed) `node docs/architecture/generate.mjs` has been run and its boards committed —
  by the last slice of the phase (P3.14 and P4.10 list it in their steps); **for every other phase** in which a file
  the generator lists (`docs/architecture/generate.mjs`, its component and file lists) was added, removed or renamed
  — e.g. P6.1's `lib/direction.ts`, P6.8's `ModalFrame`, a P1/P5 script or stylesheet — the last slice of that phase
  runs the generator and commits the boards with its own commit (the executor checks `git diff --stat
  docs/architecture` after running it; no diff, nothing to commit). CLAUDE.md asks for this in the same change; the
  deferral to the phase's last slice is the same one the graphify re-extraction uses (protocol step 2.3) and the gate
  checks it;
- G6 the e2e specs the phase touched are updated and listed. **CI evidence:** e2e never runs locally, so at every gate
  the orchestrator asks the owner (in Arabic) whether to push the work branch for a GitHub Actions run — it never
  pushes on its own. If the owner pushes, the run id is recorded and **each job's own conclusion is read**, not the
  run's: `gh run view <id> --json jobs --jq '.jobs[] | {name, conclusion}'`. The `e2e` job is `continue-on-error`
  (`.github/workflows/ci.yml`, "e2e (playwright, non-blocking)"), so a green run can hide failed specs: the orchestrator
  reads the e2e job's log (`gh run view <id> --log-failed` / the Playwright report artifact) and lists every failed
  spec. A failed `verify` or `db` job, or **any failed e2e spec that the phase touched or that covers a page the phase
  changed**, becomes a `Pn.fix-k` slice before the next phase starts, even when the run shows green (after-push.mdc: a
  broken e2e test is ours though the job is non-blocking; machine-limits.mdc: a red run is fixed on the work branch
  first). A failed spec unrelated to the phase is recorded with its reason. If the owner declines, the gate records
  "CI not run" and the list of untested specs carries forward to the next gate; P8.6 closes that list. **At the P7
  gate** the orchestrator tells the owner plainly that if no push has happened yet, the production build and the ≈60
  updated e2e specs have never run, and that a code fix found only after P8's multi-night capture forces a
  blast-radius re-capture; it recommends a branch push and run before P8.2.

If either gate agent says `ready: false`, its blocking items become a fix slice (`Pn.fix-k`) run under the execution
protocol, then both gate agents check again. **Bound:** three gate rounds per phase. If the gate after the third
round of fix slices still returns `ready: false` (or a gate agent re-raises an item a fix slice disputed), the
orchestrator stops and escalates to the owner (Arabic) with the open items, the evidence and the options; the next
phase does not start until the owner answers. Phase-specific additions:

| Phase | Extra gate items |
|---|---|
| P0 | ADR 0021 records D1–D28, the branch, the audit-file, the rule-file and the graphify answers with the owner's answers and date (and on audit-file (a) `docs/reviews/2026-11-13-ui-audit.md` is tracked); DESIGN.md button section and `.cursor/rules/smilesim-ui.mdc` primary-button bullet rewritten (D2 precedence); contrast script output shows every pair in P0.9's crimson-fill table ≥ 4.5:1 (text) / ≥ 3:1 (glyph-only marks) in both themes, text and hover, and the script fails on any `background: var(--rd-accent)` rule with text content that is not in the table. |
| P1 | `scripts/check-css.mjs` runs inside `npm run lint`; its baseline file exists and no count rose; the duplicate key is (at-rule chain, selector, property) as P1.1 defines; `tests/dom-snapshot.mjs` hashes `::before`/`::after`, writes the forced-state `.states.tsv`, uses a per-case wait selector and reaches the sign-in cases (proved by one run at 1280 dark-ar whose output lists every case); the snapshot is deterministic (P1.1's twice-run check gave byte-identical `.styles.tsv` / `.states.tsv`); every P1 slice from P1.2 on has a clean CHK-ZERO diff at the five widths (P1.1 changes the snapshot's output and no CSS, so its proof is its canary runs, not a diff), except the visible changes named in P1.2 (and P1.8 only if D23 = b), each measured in its CHK-LOOK note; every new token is in DESIGN.md Scales. |
| P2 | `app/styles/graphite.css` no longer exists and `globals.css` does not import it; `check-css` duplicate-selector count = 0, undefined-token count = 0, raw-colour-outside-tokens = 0, **(f) half-pixel / rem font-size = 0, (j) literal line-height = 0 (outside the named one-off allowlist, whose entries each carry file, selector and reason), (k) literal spacing / radius = 0**; `grep -rn 'ink) 11%' app/styles | grep -v tokens.css` = 0 (every mix is `var(--rd-line-strong)`); every token whose first-use slice (P1.4 table) is P1.5–P2.10 has ≥1 use (3.1-08,
3.7-08, 3.7-19, 3.1-11, 3.1-17, 3.4-07 close here); every P2.1–P2.10 slice has a clean CHK-ZERO (styles and states, including the widths inside every moved `@media` block); P2.11's visible changes measured. |
| P3 | ESLint feature-markup rule (P3.13) passes with 0 hits; **`check-css` guard (l) = 0 and every disabled control in P3.1 step 4's list (Button, Select, checkbox/radio, steps, number-card operations, pick card, sign-in buttons, outage bar, live switch, dialog buttons) measured at opacity 0.5** (3.6-24); every token a P3 slice introduced is in DESIGN.md Scales; Button sizes measured on every page that has a Button (heights 32/34/40/36/28, 44 under the touch breakpoint after P6 — not yet); pager page numbers and pager arrows measured at one height (P3.1); no `.ui-btn` rule outside `ui.css` changes `height`/`min-height`/`padding` (`grep -rn "\.ui-btn" app/styles \| grep -v ui.css`); `tests/desk-system.spec.ts` updated; `Pane`/`PaneHead` exist and the four P3.6 panes use them. |
| P4 | Every desk screen renders through `Desk` (grep: no `className="page-head"` in `features/`, except documented exceptions); **every hand-written pane is a `Pane`: `grep -rn 'className="pane-head' features` = 0 and `grep -rnE 'className="pane( \|")' features` = 0 except the exceptions listed in DESIGN.md (each with a reason), and the P3.13 lint selector for them reports 0** (3.6-17 closes here, P4.10); the `action` alias is gone from `Desk` and `tests/desk-head.spec.ts` asserts `actions?:`; one save placement per form kind; table top position measured before/after on every migrated page. |
| P5 | At 1920 (sidebar open and folded) on `/`, `/numbers`, `/users`, `/companies/[code]`, `/finance`, the package sheet and `/reports/balances`: no pane keeps its content in a narrow strip with the rest empty (screen-size.mdc) — each pane's content box width and its inner grid's column count recorded, and any strip is a `P5.fix-k` slice; topbar controls measured: 44px at 375/768/899, 36px at 900/1280, the 768 topbar row fits on one row on all four doors (or P5.2's recorded fallback); `check-css` @media-width rule passes: only `max-width` 640/767/899/1099 and `min-width` 641/768/900/1100 (direction checked) **or a width in the named-exception allowlist** that P5.1 writes into `check-css.mjs` and DESIGN.md "Breakpoints" per D26 (each with file, reason and the owner's answer); `scrollWidth ≤ clientWidth` on `.app-shell`, `.canvas`, every `.pane` at 320, 375, 390, 768, 900, 1100, 1280 with the sidebar open and folded, every popover opened. |
| P6 | Contrast script: every text/background pair ≥ 4.5:1 and every control boundary / resting icon ≥ 3:1 in both themes; smallest touch target under 767 ≥ 44px on every route, and at 768/1024/1280 control heights unchanged from P5 (no coarse-pointer growth unless D27 = b; the 44px drawer-mode topbar at 768–899 is P5.2's listed change, not growth); Tab walk recorded on 10 pages with visible focus at every stop; `check-css` physical-property and `outline: none` counts = 0; **every token defined in `tokens.css` has ≥1 use outside its definition** (`for t in $(grep -oE -- '--rd-[a-z0-9-]+:' app/styles/tokens.css \| tr -d :); do grep -rq -- "var($t" app/styles components features \|\| echo $t; done` prints nothing; an unused token is deleted in a `P6.fix-k` slice with its DESIGN.md row); `node scripts/contrast.mjs` runs inside `npm run lint` (P6.4). |
| P7 | DESIGN.md has the final "Fixed rules" section, no contradiction left (grep the old phrases: "Primary action is ink", "Primary button: ink fill", "the action first", `.notice-pop`, "solid `--rd-ink` outline", `FigureBand` name check); **the same greps over `.cursor/rules/*.mdc` return nothing, and `smilesim-ui.mdc` / `content-ui.mdc` name no removed token (`--rd-primary-bg`), class (`.empty` as a bare paragraph, `.pack-pick`) or model ("the sheet scrolls" fill model) — every rule sentence has a matching DESIGN.md rule**; every map's "Last verified" bumped; graphify updated; ADR 0021 records the D12 answer. **Stated plainly to the
owner (Arabic) at this gate:** under the recommended answers (D6 a, D23 a, D12 later) the visual differences that
3.3-32's width part, 3.4-04's sidebar row edges, 3.4-17, 3.1-08, 3.1-12 and the 3.1-13 zebra describe **remain on
screen** — they are named and documented, not removed — so the P8 audit will show them and they are not P8 defects
(3.1-05's display scale is in the same group). If the owner picks D6 b, D23 b or a D12 width, each needs its own
follow-up spec and plan (work-plan.mdc); none is done inside this plan. |
| P8 | Every matrix cell captured or explicitly marked n/a — proved by `visual-audit/completeness.mjs` exiting 0 (manifest ids = `expected.json` ids, every status `ok` or `n/a`+reason), not by reading the matrix; every inspection unit inspected 1+2 with `viewed` == `assigned` in every verdict file and each confirmer's clean-capture sweep recorded; every confirmed defect fixed and re-captured clean (blast-radius set, P8.5), or escalated and answered by the owner; the final full re-capture (P8.6) has an empty unexplained-change list, or every entry in it confirmed harmless by 1 inspector + 2 confirmers; every inspection record (assigned, viewed, sweep subset) is counted in **tiles** (P8.1); the decision-kept
differences named in the P7 row (D6 a, D23 a, D12 later) are recorded in the visual-audit record as "kept by
decision", not as open defects, and the owner was told they remain visible. |

---

## P0 — Owner decisions and isolated high-severity fixes

### P0.1 Owner decisions record — 7517db0

- **Goal:** get D1–D28 (spec table) answered and recorded before any code changes; tell the owner that CHK-AUDIT and P8 runner logins can sign out his own oldest `branch` sessions beyond the account's limit; fix the button contradiction in the
  doc and in the always-applied rule file first (conflict 10), so later demotions are not read as regressions.
- **Files:** `docs/architecture/decisions/0021-ui-maintenance-decisions.md` (new), `DESIGN.md` (Identity :15, the
  Buttons bullets :88, :98–100, :108–110, Components :264, Inner pages :247 foot order, :249),
  `.cursor/rules/smilesim-ui.mdc` (:11 "Primary action is ink (`--rd-primary-bg`)…"), `.cursor/rules/content-ui.mdc`
  (Dialog bullet :22 foot order per D8 only; the Empty, Page title and Scroll bullets are rewritten by P3.9, P4.1 and
  P2.2), the spec and this plan (both untracked today: this slice commits them), this plan's Status; on audit-file
  answer (a) also `docs/reviews/2026-11-13-ui-audit.md` (the audit moved from the untracked root `AUDIT_REPORT.md`,
  content unchanged).
- **Precondition:** working-tree precondition (protocol) for `DESIGN.md` and the two rule files.
- **Steps:** (1) The orchestrator puts the spec's decision table to the owner (Arabic, in chat) with the
  recommendations, plus "which branch: `ui-maintenance` (recommended) or local `main`?" (asked first; the branch is
created before this slice's executor starts, protocol step 5) and the **audit-file** question: (a, recommended)
commit `AUDIT_REPORT.md` as `docs/reviews/2026-11-13-ui-audit.md` so the committed spec, plan and P7.1 cite a tracked
source (`git mv` is not possible for an untracked file: copy, then delete the root file, after the owner agrees); (b)
keep it local and untracked, and the spec says so. On (a) the executor updates every `AUDIT_REPORT.md` path in the
spec and this plan in the same commit. Four more questions in the same message: (i) may the slices edit the
always-applied rule files (`.cursor/rules/smilesim-ui.mdc`, `content-ui.mdc`, `direction-theme.mdc` — in P0.1, P2.2,
P3.9, P4.1, P6.2 and P7.1), and may ADR 0021 carry the interim precedence sentence below; (ii) the deferral of
`/graphify . --update` after a core-doc edit to the end of each phase (protocol step 2.3) **and** of the Excalidraw
board regeneration (`node docs/architecture/generate.mjs`) to the last slice of each phase in which a listed file
changed (G5) — both deviations from CLAUDE.md, asked together; on "no" each slice that edits a core doc or adds /
removes a listed file runs them itself;
(iii) for D28, the cost is stated beside the options: option (a) is about 9,650 captures (≈ 24,000 tiles), of which
inspectors view roughly 20,000 tiles in ≈ 170 inspection units, each unit read by three agents (≈ 510 agent runs),
plus several nights of sequential capture; (b) adds ≈ 50% to Tier 2 and to the viewed tiles; (c) saves ≈ a fifth of
the inspection runs; (iv) verify-before-reply.mdc §4's click checks of `V.nn` slices deferred to one `V.click` pass
under P8.2's no-data-change window (asked now so the deviation is known up front; P8.2 then confirms only the window
dates and the snapshot, and re-asks only if the owner said "later"). A "no" to (i) stops every slice that edits a rule file until the owner says how to proceed. (2) The executor writes ADR
  0021 (**number check first:** `ls docs/architecture/decisions/`; if 0021 is taken by then, use the next free
  number, name the file `NNNN-ui-maintenance-decisions.md`, and replace every "ADR 0021" in the spec and this plan in
  the same commit — reviewers grep for the old number): one section per D#, question, options, the owner's answer and date, the slices it drives, and one interim
  sentence (only on answer (i) = yes): "until P7.1 aligns them, where a `.cursor/rules/*.mdc` sentence and an owner
  answer quoted in this ADR disagree, the quoted answer wins" — limited to the quoted answers, not the rest of the ADR
  text. (3) Rewrites
  DESIGN.md's button statements to the D2/D3/D8/D19 answers: one crimson model, the precedence rule ("one primary per
  view: the page-head action, else the submit of the view's main form; a save in a secondary pane, a lookup step and a
  per-row save are secondary"), chosen page number per D3, foot order per D8, «إكمال» per D13, button radius per D19;
  removes "Primary action is ink" (:15), "Primary button: ink fill…" (:264), "take / complete in ink" (:109).
  (4) Rewrites `smilesim-ui.mdc:11` in the same commit to the same model ("Primary action is crimson
  (`--rd-accent-fill`, one per view, precedence in DESIGN.md); logo red marks one accent; ink fills are not actions"),
  and `content-ui.mdc:22`'s foot order to the D8 answer. `--rd-accent-fill` is named here before it exists; the rule
says "(defined in P0.9)" until P0.9 lands, and P0.9 removes the parenthesis.
  (5) **Answers that differ from the recommendation.** Where the owner picks an answer this plan has no written steps
  for (e.g. D1 a/c, D5 = 720, D9 = keep clamp, D11 = keep frozen, D27 b), the affected slice texts are amended through
  the "Mid-phase amendments" path (author + two checkers + `docs(plan): amend`) **before P0.2 starts**; no executor
  "adapts" unwritten steps. D2 = b stops the plan for a re-plan of P0.9 and P3.2 (owner told in Arabic). D6 b or D23 b
  are out of scope here and need a follow-up spec (P7 gate says so to the owner).
- **Closes:** none directly (enables س3 slices; conflict 10).
- **Risks:** an answer that differs from a recommendation changes later slices — the ADR lists, per D#, the slices to
  re-read; the executor of each later slice must read ADR 0021 first.
- **Verify:** CHK-LOCAL (docs only: `npm run lint` unaffected). Reviewers check every D# answered, DESIGN.md and
  `.cursor/rules/*.mdc` no longer contradict themselves or each other on buttons (grep "ink fill", "in ink",
  "action first", "Primary action is ink", "primary-bg").
- **Done:** ADR committed locally; owner's answers quoted with date; spec and plan tracked; the branch exists (answer
  a) and P0.1 is committed on it; the audit file tracked or the spec says it stays local.
- **Commit:** `docs: UI maintenance decisions D1–D28, one button model in DESIGN.md and the UI rule (UI maintenance P0.1; ADR 0021)`

### P0.2 Textarea uses the interface font — 983ea10

- **Goal:** every `textarea` inherits the font (today the browser's monospace ≈13px).
- **Files:** `app/styles/base.css` (rule `button, input, select { font: inherit; color: inherit; }`, :19),
  `app/styles/desk/components.css` (`.package-details-form textarea { resize: vertical; font: inherit; }`, :312).
- **Steps:** add `textarea` to the base rule (`button, input, select, textarea { … }`); remove the now-redundant
  `font: inherit` from `components.css:312` (keep `resize: vertical`).
- **Closes:** 3.7-01. Single extra issue of §2.
- **Risks:** line wrapping changes in fixed-height textareas (`.dialog textarea` is 44px under 720px,
  `dialog.css:171–174`) — check that the decision dialog's reason field still shows its first line.
- **Verify:** CHK-LOCAL; CHK-LOOK on: the decision dialog (`/tasks/[id]` of a task with a provider decision →
  decision form), `/offers` (add offer → text), `/tasks/[id]` compose box, `/companies/[code]/packages/[pkg]`
  «التفاصيل» tab, at 375/768/1280, ar-dark, en-light, he-light; measure `font-family` and `font-size` of every
  textarea: the family must equal the body's, and size, weight and line-height must equal the textarea's parent's
  (amended in P0.2: `font: inherit` takes the parent's font, so "the body's size" holds only where the parent has it —
  the compose box, 14px; a textarea inside a `label` takes the label's, as every text input in that label already
  does — 11px/700 in a dialog, 11px/600 in the details form, where the pane inputs beside it are 13px only because
  `desk/pane.css:68` sizes `input` and not `textarea`, unchanged from today; field size against label size is left
  to P3.7, which owns the label and field rules, and P3.7's Verify line carries the measurement).
  E2E affected: `task-notes.spec.ts`, `offers.spec.ts` (no assertion change expected).
- **Done:** no textarea computes a monospace family.
- **Commit:** `fix(web): textareas use the interface font (UI maintenance P0.2; closes 3.7-01)`

### P0.3 Visible focus in the filter chip list — 827e449

- **Goal:** `.filter-pop` options show focus.
- **Files:** graphite `.filter-pop button:hover, .filter-pop button:focus-visible { … outline: none; }` (:892).
- **Steps:** split the rule: `:hover` keeps the fill; `:focus-visible` gets `outline: 2px solid var(--rd-accent);
  outline-offset: -2px;` and the same fill. Do not add a second rule elsewhere (P2.6 moves it).
- **Closes:** 3.10-02.
- **Risks:** the inset outline must not be clipped by `.filter-pop`'s overflow — check the first and last option.
- **Verify:** CHK-LOCAL; CHK-LOOK `/numbers`, `/finance`, `/tasks` filter chips at 1280 and 768: open a chip,
  Tab through options, screenshot each focused row, ar-dark and en-light (amended in P0.3: the list has no arrow-key
  handling — an arrow key goes to the chip's native `<select>` and never moves the focus into the list; probe in
  headless Chromium on macOS: focus stays on the `<select>`, value and URL unchanged; what the `<select>` itself does
  with an arrow key is the browser's and differs by platform — so the keyboard reaches the options by Tab, which lands
  on the first option after the bar's remaining controls; arrow keys in the list are not this slice's to add). E2E: `url-filters.spec.ts`, `lists-desk.spec.ts` (no change expected).
- **Done:** focus ring visible on every option in both themes.
- **Commit:** `fix(web): the filter list shows keyboard focus (UI maintenance P0.3; closes 3.10-02)`

### P0.4 Visible focus on number-card operations — 9b26b48

- **Goal:** `.line-op` (cut corner via `clip-path`) shows focus inside its shape.
- **Files:** graphite `.line-op:focus-visible { outline: 2px solid var(--rd-accent); outline-offset: 2px; }` (:680),
  `.line-op` box-shadow hairline (:663).
- **Steps (primary approach, round 5):** the hover glow `.line-op::after` (`z-index: -1` inside the element's
  `isolation: isolate`) paints **above** the element's own inset box-shadow, so an inset ring on the element itself
  would be tinted on hover. Draw the ring on a pseudo-element above the glow instead:
  `.line-op:focus-visible { outline: none; }` and `.line-op:focus-visible::before { content: ''; position: absolute;
  inset: 0; z-index: 1; border-radius: inherit; box-shadow: inset 0 0 0 2px var(--rd-accent); pointer-events: none; }`
  (`.line-op` has no `::before` today and is the positioned containing block of its `::after`; P6.6 later swaps `2px`
  for `var(--rd-ring-width)`). The element keeps its 1px hairline; the 2px ring covers it. (Amended in P0.4:
  `border-radius: inherit` added — the card has 6px corners (`--rd-radius-sm`) and `clip-path` is a sharp polygon that
  does not round them, so a pseudo-element with square corners would paint crimson outside the card's rounded
  corners; with it the ring follows the card's three rounded corners, as the hairline does.)
- **Closes:** 3.10-03.
- **Risks:** the hover glow `.line-op::after` (`z-index: -1`) — check that with hover and focus together the ring is
  still 2px and not tinted by the glow; the cut corner (`clip-path`) clips the ring on the diagonal — the ring must
  still read as a closed shape there.
- **Verify:** CHK-LOCAL; CHK-LOOK `/numbers/[id]` «العمليات» tab: Tab through every card at 375/1280, ar-dark, en-light,
  he-light; the danger card too. Measure the visible ring: a zoomed screenshot of one card's straight edge and its cut
  diagonal, focus alone and hover+focus, counting crimson pixels across the edge (2 device px at DPR 1). E2E:
  `numbers-desk.spec.ts`, `detail-desk.spec.ts`, `tools-pages.spec.ts` (uses `.line-op`; no change expected).
- **Fallback (only if the `::before` ring paints over the card's content in a way the screenshots show):** a single
  inset layer on the element, as `.co-card` does (graphite :997): `.line-op:focus-visible { outline: none; box-shadow:
  inset 0 0 0 2px var(--rd-accent); }`, with the hover+focus tint measured and recorded. Do **not** stack the hairline
  as a first layer: in a multi-layer `box-shadow` the first layer paints on top and would leave 1px of crimson.
- **Done:** a 2px crimson ring along every straight edge of every card, untinted with hover+focus. At the cut
  diagonal the ring may be open: an inset shadow is rectangular and `clip-path` cuts it there; that is accepted and
  recorded in `look.md` (the diagonal stays inside the visible shape, never outside it).
- **Commit:** `fix(web): number-card operations show focus inside their cut corner (UI maintenance P0.4; closes 3.10-03)`

### P0.5 Task ticket scrolls on narrow widths — b8bcb4d

- **Goal:** under `@container task-ticket (max-width: 36rem)` the conversation and compose bar stay reachable.
- **Files:** `app/styles/desk/tasks.css` (`@container task-ticket (max-width: 36rem)` block, :223–235); `DESIGN.md`
  (the task-ticket bullet says how a narrow ticket reads; added in P0.5).
- **Steps (amended in P0.5, see the note below):** in that block, on `.task-board` replace `grid-template-columns: 1fr;
  grid-template-rows: max-content minmax(18rem, 1fr);` with `display: flex; flex-direction: column; overflow-y: auto;`;
  on `.task-rail` delete `min-height: max-content` and add `flex: none` (keep `max-height: 40%` and `overflow: auto`;
  leave the block's two border lines as they are — they are already dead under graphite `.task-rail { border: 0 }`
  :726, and the frame is graphite :723's inset shadow on `.task-rail, .task-thread`; P2.8 deletes the dead border lines
  when it moves the rule); add `.task-thread { flex: 1 0 auto; min-height: 12rem; }` and `.task-tree-scroll {
  overflow-x: auto; overflow-y: hidden; overscroll-behavior: auto; }` (fix round 1: the log's base `overflow: auto;
  overscroll-behavior: contain` would keep a vertical scroll box that no longer overflows, and Chromium ≥ 144 applies
  `overscroll-behavior` to such a box, so a wheel or touch scroll starting on the log would not reach the board; fix
  round 2: the log keeps its sideways scroll — `overflow: visible` there cut a message wider than the ticket, an
  unbroken string or a long URL in `.task-tree-card p` (`white-space: pre-wrap`, no `overflow-wrap`), at the ticket's
  edge with no way to reach it, where before the slice and at 768 and wider the log scrolls sideways to it; with
  `overflow-y: hidden` the log does not scroll vertically, so a vertical wheel or swipe on it still reaches the board);
  qualify the file's head comment ("only the inspection tree scrolls") for the narrow ticket. Above 36rem nothing changes: the
  board keeps its two-column grid.
  *Amended in P0.5 (measured, `audit-output/maintenance/P0.5/preview.mjs` injecting each candidate on the live page,
  then the after run):* the first text, `grid-template-rows: fit-content(40%) minmax(12rem, 1fr)` with `min-height`
  deleted, does not reach Done. At 375×667 on a working task the board is 323.5px tall (the page head with its
  wrapped actions takes the rest). The rows resolve to 117.5px + 192px. The rail's `max-height: 40%` resolves against
  its grid row, not the board, so the rail is 47px with 70px of empty row under it. The thread's 192px cannot hold its
  head plus the compose bar, which is 197px at ≤28rem, where its controls stack, so the compose bar stays clipped by
  the thread's and the ticket's `overflow: hidden`. At 320×568 the board also overflows by 11px. Letting the rail
  fill its row (`max-height` removed) and the Risks fallback (`auto minmax(12rem, 1fr)`, `40dvh`) both leave the same
  192px thread. No fixed-height grid fits rail, thread head and compose bar into 323px, so under 36rem the board
  itself scrolls. It becomes a flex column. The rail's percentage `max-height` then resolves against the board's
  definite height: 40% = 129.4px at 375×667. `flex: none` stops the rail shrinking to 0 against the growing thread.
  The thread grows to its whole log, at least 12rem, and fills the rest when the log is short. The last message and
  the compose bar scroll into view in the board, and the log has no vertical scroll of its own there (it keeps the
  sideways scroll it has today for a message wider than the ticket; fix round 2). This is the spec's
  "the task ticket's conversation and compose bar scroll into view".
- **Closes:** 3.2-03.
- **Risks:** removing only `min-height` is not enough (report) — both lines change; the 28rem compose block
  (`:236–241`) stays after it. (Amended in P0.5: the paragraph from here to the fallback describes the first
  text, which the note under Steps replaces; it is kept as the record of what was measured. `order` applies in the
  flex column as it does in grid auto-placement, so P5.6's reordering is unaffected in kind: P5.6 must reset `order` in
  the container block to keep the rail above the thread. The P0.5 measurement that the container block never applies
  at a viewport ≥ 900 (Verify below) also amended the premise of P2.8's Steps, P5.6's stated visible change and Verify,
  and the review note on P2.8/P5.6; their executors re-measure the ticket width at 900–920 with the sidebar open
  before relying on it. The spec's P5.6 line still holds its first text, the 900–~916 stacking; P0.5 does not edit the
  spec. P5.6's executor corrects that line as its own amendment before it starts, with the text written in P5.6.) `fit-content(40%)` as a row track resolves only against a definite block size;
  `.task-board` is `flex: 1` inside `.task-ticket` (`.desk > .pane.task-ticket`, (0,3,0), gives `flex: 1;
  overflow: hidden` and beats graphite's `.desk > .pane { flex: none }`), so it is definite. **Fallback** if the 375
  measurement shows the rail row at `max-content`: `grid-template-rows: auto minmax(12rem, 1fr)` with the rail's cap
  moved from `max-height: 40%` (a percentage max-height on an item of an auto-sized row is circular and does not cap)
  to `max-height: 40dvh` (or a `rem` value measured to match 40% of the board at 375×667); record which one landed and
  the measured rail height.
- **Verify:** CHK-LOCAL; CHK-LOOK `/tasks/[id]` (a task with ≥10 log entries and the internal-note toggle) at 375, 390,
  768, 1024 with the sidebar open and folded, **and 900 and 960 with the sidebar open** (there the ticket can be
  ≤36rem while graphite's `@media (min-width: 900px) .task-board { grid-template-columns: … }` (graphite.css:716–720)
  beats the container block's one column — today's behaviour, measured and recorded, not changed),
  ar-dark/en-light/he-light: the last message and the compose bar visible after scrolling the thread; rail scrolls
  inside 40%. (Amended in P0.5: the scroll is the board's, not the thread's. Measured at 900 and 960 with the sidebar
  open, the ticket is 596px and 654px wide, the sidebar being 268px, so the container block does not apply there today.
  It applies only in drawer mode up to a viewport of about 608px, ticket width = viewport − 32px; 600, 608 and 610 are
  added to the measured widths.) *Amended in P0.5 fix round 1:* the scroll is checked with real input, not by setting
  `scrollTop`: wheel (`page.mouse.wheel`) on the log to the board's end and back, on the thread head, on the compose bar,
  its textarea and button, and on the rail (the rail first, then the board; back up the rail first); touch
  (`Input.synthesizeScrollGesture`) on the log, the thread head, the rail to its end and on, and up from the compose
  bar; keys (PageDown, Space, End, Home, PageUp after a click on a log card's text). *Fix round 2:* a long-string case
  (a log message with an 80-character unbroken string, wider than the ticket): a horizontal wheel and a horizontal
  touch swipe on it scroll the log sideways to the message's far edge and back while the board stays still, a
  vertical wheel and swipe on it still move the board, and the log does not clip its messages vertically (also with a
  15px space-taking scrollbar on the log). Data states add a task with a
  provider operation (`.po-panel` first in the rail, from `provider-operation.spec.ts`'s fixture shape): the panel's
  share at load, its first decision and its history's last entry reached by wheeling the rail, a click on the decision
  (its dialog opens, Escape closes it, nothing sent), and the reject form open in the rail (phase failed). E2E:
  `task-notes.spec.ts`, `tasks-desk.spec.ts`, `provider-operation.spec.ts` (its phone case loads `/tasks/t1` at 390×844,
  inside the block: the panel is now in a rail capped at 40% of the board; its checks are horizontal
  (`boundingBox` x, `scrollWidth`) and `click()` scrolls the nested rail itself, so no change is expected; not run
  locally).
- **Done:** at 375 the compose bar is reachable with no clipped content.
- **Commit:** `fix(web): the task ticket keeps its conversation and compose bar in reach on narrow widths (UI maintenance P0.5; closes 3.2-03)`

### P0.6 Topbar menus stay on screen on phones

- **Goal:** the search and notice popups anchor to the topbar, not to their button, under 767px (viewport). Desktop
  widths where only the topbar container is ≤720px keep today's button-anchored popups (they fit there).
- **Files:** `app/styles/shell.css` (`@media (max-width: 767px)` block :697–736, `@container topbar (max-width: 720px)`
  block :738–762, `.notice-wrap .shell-panel` :412, `.notice-wrap { position: relative; }` :655, `.shell-panel` :342–352).
- **Cascade fact (round 2):** the search popup rule in the `@media (max-width: 767px)` block (:722–731) is repeated
  in the `@container topbar (max-width: 720px)` block (:745–756), which comes **later** at the same specificity
  (0,3,0). At phone widths the topbar is narrower than 720px, so the container block wins and an edit inside the
  media block alone would never reach the search popup (it would reach only the notice panel, and only search between
  ~737 and 767). So the anchoring rules go in a block placed **after** the container block.
- **Steps:** (1) in the existing `@media (max-width: 767px)` block delete `inset-inline-end: 0; width: min(18rem,
  72vw);` from `.shell-search.is-open .shell-search-desk` (the rest of that rule stays). (2) add a new, short
  `@media (max-width: 767px)` block **directly after** the `@container topbar (max-width: 720px)` block, holding only:
  `.shell-search, .notice-wrap { position: static; }` and `.shell-search.is-open .shell-search-desk, .notice-wrap
  .shell-panel { inset-inline: var(--rd-space-2); width: auto; max-width: none; }` with a comment saying why it sits
  after the container block. `inset-inline` sets both edges, so it overrides the container block's
  `inset-inline-end: 0` and its `width` on phones. (3) leave the `@container topbar (max-width: 720px)` block as it is:
  it also fires on desktop viewports of about 900–1000px with the sidebar open, where the viewport is ≥768 and the
  button-anchored 18rem popups fit; a bar-wide sheet there would be an unlisted desktop change. (P5.2 folds the two
  767 blocks and decides whether the container block's search rules fold into the media rule, L29.) `.topbar` is
  `position: sticky` (shell.css:225), so it becomes the containing block (it also has `container-type: inline-size`
(:235, layout containment) and `backdrop-filter` (:238–239), each of which makes it the containing block for
positioned descendants; the evidence note states these three facts with their measured lines). Do **not** shrink by vw instead. Both popups
  then render the same bar-wide sheet at every width ≤767.
  *Amended in P0.6 (measured, `audit-output/maintenance/P0.6/`):* the same new block also caps the notice list,
  `.notice-wrap .shell-panel { max-height: min(480px, calc(100dvh - 100% - 0.6rem - var(--rd-space-2))); }`, with a
  comment. Anchored to the topbar, the panel starts under the whole bar, not under the bell: the phone topbar is
  101px tall (two rows) and 151px at 320 on the main, agent and pos doors (the wallet chip wraps a third row), so the
  panel's top is at 109.6px / 159.6px. With the plain 480px cap its bottom reached 589.6px at 320×568 (22px past the
  screen; before the slice it was 541.6px, under the bell). `100%` in an absolutely positioned box's `max-height`
  resolves against its containing block, here the topbar's padding box, so the list ends `--rd-space-2` above the
  screen's bottom whatever the bar's height, and scrolls inside as it does today. At 375×667 and taller nothing
  changes: the formula gives more than 480px there.
  *Fix round 1:* the search sheet needs the same cap. Anchored to the topbar it starts at 106px (156px on a
  three-row bar) instead of about 58px, so field plus results (`min(420px, 60vh)`) ran past a short or landscape
  screen (667×375: bottom 395px, 20px past; 568×320: 42px past), where it fitted before. The same block makes the open
  `.shell-search-desk` a column flex box with `gap: 0` (it is a `<form>`, and forms.css gives forms a gap) and
  `max-height: calc(100dvh - 100% - 6px - var(--rd-space-2))`, keeps the field at its height (`flex: none`) and lets
  the results shrink (`min-height: 0`), which scroll as they do today. Where the sheet already fits nothing moves.
  CHK-LOOK adds short and landscape screens on all four doors: 320×480, 568×320, 640×360, 667×375, 736×414, 740×360 and
  767×400, both sheets inside the viewport.
  *Fix round 2:* step (1) also deletes `display: block;` from that rule, so "the rest of that rule stays" now means
  everything but the two insets, the width and the display. The new block's `display: flex` has the same media
  condition, selector and specificity and comes later, so it always won; the old line was a dead same-key duplicate.
  No computed value changes (re-read of the open search sheet at 320–768 and on short screens:
  `audit-output/maintenance/P0.6/fix2/`, `display: flex` at every width ≤767).
- **Closes:** 3.2-01.
- **Risks:** under 900px the topbar has two rows (path row below, responsive.css:22–26), so the menus open under the
  path row — accepted (spec D16 note in R1); check the notice panel's `max-height: 480px` still fits at 375×667 (amended in P0.6: it does; at 320×568 it did not, so the new block caps it, and on short and landscape screens the search sheet too, see Steps).
  Conflict 4: this must land before P6.5 grows topbar icons. Other `.shell-panel` users (account menu, language) are
  not in these wrappers — grep `shell-panel` in `components/` and confirm.
- **Verify:** CHK-LOCAL; CHK-LOOK any desk page at 320, 375, 390, 600, 767, 768, 899, 900 with search open and with
  notices open, ar-dark/en-light/he-light: `getBoundingClientRect()` of the panel inside `[0, innerWidth]`, and the
  search and notice panels with the same `left`/`right` (bar-wide, `--rd-space-2` from each edge) at 375, 600 and 767;
  read the winning rule of the search popup's `inset-inline-start` in the computed styles to prove the new block wins; plus 920,
  960, 1000 and 1024 with the sidebar open (topbar **content box** ≤720: the container query measures inside the 28px
  padding, so with the 268px sidebar it fires up to a viewport of about 1044): popups inside the viewport, and a
  **CHK-READ** of `.topbar`, its direct children, `.shell-search`, `.shell-search-desk`, `.notice-wrap`,
  `.notice-wrap .shell-panel` and `.canvas-inner` (search open, then notices open) identical to *before* at those four
  widths and at 1280 (not CHK-ZERO: it is not deterministic before P1.1). E2E:
  `topbar-narrow.spec.ts`, `shell-a11y.spec.ts`, `transfer-notices.spec.ts`.
- **Done:** no popup edge outside the viewport at any listed width.
- **Commit:** `fix(web): search and notice menus open under the topbar on phones (UI maintenance P0.6; closes 3.2-01)`

### P0.7 Price editors fit their phone card

- **Goal:** in the phone card layout (<640px) table cells that hold editors take the whole card row and wrap.
- **Files:** graphite phone block `@media (max-width: 640px)` with `table.data:has(td[data-label])…` (:1308–1350);
  `app/styles/desk/users.css` (`:is(.desk .pane, .dialog-body) .terms-price input { width: 6.5rem … }` :145–159);
  `app/styles/desk/packages.css` (`.price-pair` :194, `.sell-cell` :198); markup `features/catalog/screens/packages-screen.tsx`
  (`.sell-cell` :328), `features/catalog/screens/package-sheet-screen.tsx` (`.price-pair` :276, :293, :311).
- **Steps:** in the graphite 640 phone block (until P2.6 moves it) add, scoped to table cards only:
  `table.data:has(td[data-label]) td:has(.sell-cell, .price-pair) { grid-column: 1 / -1; }` and
  `table.data:has(td[data-label]) :is(.sell-cell, .price-pair) { flex-wrap: wrap; justify-content: flex-start; }` and
  `table.data:has(td[data-label]) .terms-price input { inline-size: min(6.5rem, 100%); }`. The last rule wins over
  `users.css`'s `width: 6.5rem` because `inline-size` and `width` share one cascade slot (logical and physical
  properties resolve together) and the new selector has higher specificity — the executor states this in the evidence
  note. `.terms-price` is an `inline-flex` column, so `100%` resolves against its shrink-to-fit width: measure it.
- **Closes:** 3.2-02.
- **Risks:** `.terms-price input` is also in the line-prices dialog and `package-addons` — the selectors above are
  limited to `table.data:has(td[data-label])` inside the 640 block; check the line-prices dialog at 375 is unchanged.
- **Verify:** CHK-LOCAL; CHK-LOOK `/packages` (main and agent doors: sell cells), `/companies/[code]/packages/[pkg]`
  «أسعار خاصة» tab, the line-prices dialog, at 375/390/640/641/768, ar-dark/en-light/he-light; audit runner's
  `cell-overflow` = 0 on those routes; measure the `.terms-price input` width at 375 in the phone card (≤ cell width)
  and in the line-prices dialog (unchanged 6.5rem). E2E: `package-custom-prices.spec.ts`, `line-prices.spec.ts`,
  `branch-packages.spec.ts`.
- **Done:** no editor overflows its cell; desktop unchanged — checked by a CHK-READ inside CHK-LOOK, not CHK-ZERO (before P1.1 the
  snapshot reaches no main/agent door, `tests/dom-snapshot.mjs:161`, and its `package-sheet` case is PackageMoved, not
  the price sheet): at 1280, ar-dark and en-light, on `main.localhost:3000/packages` (sell cells) and the real package
  sheet `/companies/[code]/packages/[pkg]` (price pairs), read each editor's and cell's computed width/height and the
  pair layout before and after; equal numbers.
- **Commit:** `fix(web): price editors wrap inside their phone card (UI maintenance P0.7; closes 3.2-02)`

### P0.8 Topbar edge matches the page edge on phones

- **Goal:** `.topbar { padding-inline: 28px }` applies from 768px only; phones use the phone gutter (D9: 16px).
- **Files:** graphite `.topbar { min-height: 64px; padding-inline: 28px; }` (:447) and its `@media (min-width: 768px)`
  block (:450); `app/styles/shell.css` phone rule `.topbar { padding-inline: var(--rd-space-2); … }` (:698).
- **Steps:** graphite :447 keeps `min-height: 64px` only; add `padding-inline: 28px` inside the existing
  `@media (min-width: 768px)` block (:450). In shell.css:698 set `padding-inline: var(--rd-space-4)` (16px, D9; if the
  owner chose otherwise use that). P5.3 later replaces both numbers with `--rd-gutter`.
- **Closes:** 3.4-01, 3.2-05.
- **Risks:** at 375 the topbar padding goes from 28px to 16px a side, so the bar gains 24px of room against today
  (it renders 28, the 8px phone rule being dead), though 16px is 16px less room than that dead 8px rule intended; check `topbar-narrow`
  widths 320/360/390 still fit all icons (theme and language move to the drawer foot under 360, DESIGN.md:308).
- **Verify:** CHK-LOCAL; CHK-LOOK any page at 320, 360, 375, 390, 767: topbar content edge x = canvas content edge x
  (measure `.topbar` first child vs `.canvas-inner` first child). At 768 and above only "unchanged" is checked: there
  `.canvas-inner.wide` uses `clamp(16px, 2vw, 28px)` while the topbar uses 28px, so the edges align only after P5.3. E2E: `topbar-narrow.spec.ts`,
  `topbar-balance.spec.ts`.
- **Done:** edges align at every phone width; ≥768 unchanged — a **CHK-READ** of `.topbar`, its direct children,
  `.shell-search-desk` and `.canvas-inner` (and `.canvas-inner`'s first child) at 768, 1024 and 1280, ar-dark and
  en-light, identical to *before* (not CHK-ZERO: it is not deterministic before P1.1).
- **Commit:** `fix(web): the topbar uses the phone gutter under 768px (UI maintenance P0.8; closes 3.4-01, 3.2-05)`

### P0.9 Legible text on crimson fills

- **Goal:** one token pair for content on a crimson fill that passes 4.5:1 in both themes (D1).
- **Files:** `app/styles/tokens.css` (`--rd-on-accent` :48 / :156, `--rd-on-mark` :49 / :157, add `--rd-accent-fill`,
  `--rd-accent-fill-hover`); every rule in the crimson-fill table below; `tests/desk-system.spec.ts`; DESIGN.md token
  table (:108); new `scripts/contrast.mjs`; `docs/architecture/frontend.md` (scripts: what `contrast.mjs` checks and
  when it runs); `.cursor/rules/smilesim-ui.mdc` (remove the "(defined in P0.9)" parenthesis P0.1 wrote; the
  working-tree precondition and the rule-file answer apply).
- **Why the old list was not enough:** today dark `--rd-on-accent` is `#111213`, and some crimson fills pass *only*
  because of it (`.gauth-mark`, `.side-user .avatar`, the brand-mark glyph). Making `--rd-on-accent` white without
  moving their background to `--rd-accent-fill` would create new white-on-`#ff4d63` (3.23:1) failures. So every rule
  that pairs a crimson background with content is listed and moved together.
- **Crimson-fill table** (verified 2026-11-13; re-run the two greps in step 2 and add any new hit before editing):

  | Selector | File:line | Background today | Content colour today (effective) | After |
  |---|---|---|---|---|
  | `.ui-btn.ui-btn-primary` (+ `:hover`) | graphite :523–524 | `--rd-accent` (hover mix toward ink) | `--rd-on-mark` | `--rd-accent-fill` / `-hover`, `--rd-on-accent` |
  | `.ui-btn.ui-btn-accent` (+ `:hover`) | graphite :519–520 | `--rd-accent` | `--rd-on-mark` | same as primary (class deleted in P2.1c) |
  | `.gauth-go` | graphite :396 | `--rd-accent` | `--rd-on-mark` | fill, `--rd-on-accent` |
  | `.gauth-mark` (Wifi glyph) | graphite :318–327 | `--rd-accent` | `--rd-on-accent` (`#111213` in dark) | fill, `--rd-on-accent` |
  | `.nav-count` | graphite :566–576, colour overridden by :635 | `--rd-accent` | `--rd-on-mark` (:635 wins) | fill, `--rd-on-accent`; :635 loses `.nav-count` |
  | `.notice-count` | graphite :492, :595, :635 | `--rd-accent` | none visible (:595 makes it an 8px dot, `font-size: 0`) | stays `--rd-accent` (decorative dot) |
  | `.account-hero-mark` | graphite :695–702 | `--rd-accent` | `--rd-on-mark` | fill, `--rd-on-accent` |
  | `.settings-page .identity-mark` | graphite :1083 | `--rd-accent` | `#fff` | fill, `--rd-on-accent` |
  | `.date-pop-day.on` | graphite :1415 | `--rd-accent` | `--rd-on-mark` | fill, `--rd-on-accent` |
  | `.sidebar .brand-mark, .drawer .brand-mark` + its `svg` stroke | shell.css:62–70, :73 | `--rd-accent` | stroke `--rd-on-accent` | fill, stroke `--rd-on-accent` |
  | `.side-user .avatar` | shell.css:183 | `--rd-accent` | `--rd-on-accent` | fill, `--rd-on-accent` |
  | `.offer-action` (+ `:hover`) | desk/home.css:123–131 | `--rd-accent` (hover `--rd-primary-hover`) | `--rd-on-mark` | fill / `-hover`, `--rd-on-accent` |
  | `.bp-btn` (branding preview button) | desk/branding.css:120–127 | `--rd-accent` | `--rd-on-mark` | fill, `--rd-on-accent` |
  | `.account-fund > button` | desk/packages.css:104–111 | `--rd-accent` | `--rd-on-mark` | fill, `--rd-on-accent` |
  | `.return-bar button` | desk/components.css:12–19 | `--rd-accent` | `--rd-on-mark` | fill, `--rd-on-accent` (P3.2 later makes it secondary) |
  | `input[type='checkbox'/'radio']:checked` + `::before` mark | controls.css:24–25 (`::before`, mark `background`), :28–29 (`:checked`) — find by selector, lines drift | `--rd-accent` | mark `--rd-on-mark` | fill **and** `border-color` (`controls.css:29`, so dark shows no lighter 1px ring), mark `--rd-on-accent` (glyph: ≥3:1 suffices, 4.5 preferred); the hover rule `input[type=checkbox\|radio]:hover:not(:disabled) { border-color: var(--rd-accent) }` (controls.css:32–33 on 2026-11-13, specificity (0,3,1), beats `:checked` (0,2,1)) becomes `:hover:not(:disabled):not(:checked)`, so a hovered checked box keeps the fill-coloured border |
  | `.pack-card > button`, `.login-room … .login-go` | desk/packages.css:68, auth.css:206/214 | — | — | **skip**: dead, deleted in P2.1c / P2.1a |

  **Stay on `--rd-accent` (decoration, no content):** `.dialog::before` thread (graphite :92), `.gauth-art-tag`
  (:417–427), `.topbar::after` (:587), `.cap-bar i` (:1051), `.unread-dot` (:1073), `.hero-bar i.on` (:1095),
  `.trend-dot` (:1141), shell.css:139–144 (active rail bar), :167 (`.nav-bullet`), :195 (`.holds::before`), :442
  (unread dot), `.figure-tile.lead::before` (home.css:261), `.users-meter i` (home.css:383), `.brand-rule`
  (base.css:76), `.notice-dot` (shell.css:657, dead — P2.1b), `.login-seam` (auth.css:115, dead — P2.1a).
- **Steps (D1 = b; if the owner chose a or c, these steps were amended in P0.1 step 5 before this slice starts):**
  1. tokens: `--rd-accent-fill` light = `var(--rd-accent)` (#d93049), dark = `#d93049` (or the value the contrast
     script picks ≥4.5:1 with white); `--rd-accent-fill-hover` = `color-mix(in srgb, var(--rd-accent-fill) 88%, #000)`
     in both themes; `--rd-on-accent` = `#fff` in both themes (delete the dark `#111213`).
  2. Re-run both greps and reconcile with the table:
     `grep -nE "on-accent|on-mark|#fff\b|#ffffff" app/styles/*.css app/styles/desk/*.css` and
     `grep -nE "background(-color)?: *var\(--rd-accent\)" app/styles/*.css app/styles/desk/*.css`. Every hit is either
     a table row, a "stay" item, or a company-mark use (`packages.css:63`, `auth.css:207`, `.co-mark` → keep
     `--rd-on-mark`). A hit in none of the three is added to the table before editing.
  3. Apply the table: `background: var(--rd-accent-fill); color: var(--rd-on-accent)` (hover rules →
     `--rd-accent-fill-hover`). Decorative items stay on `--rd-accent`.
  4. Write `apps/web/scripts/contrast.mjs` (no dependency): reads `tokens.css`, resolves both themes, and checks
     **every pair it finds**, not a hand list: it scans the sheets for rules whose `background`/`background-color` is
     `var(--rd-accent)`, `var(--rd-accent-fill[-hover])` **or a `color-mix(…var(--rd-accent)…)` hover recipe** (today
     `.gauth-go:hover` graphite :397, `.return-bar button:hover` `desk/components.css:24`, `.ui-btn-primary:hover`
     graphite :524 — each becomes `--rd-accent-fill-hover` in step 3) and that set `color`, `stroke` or a `::before` background,
     prints the ratio per theme (text pairs ≥4.5:1; glyph-only pairs — `.gauth-mark`, brand-mark svg, checkbox mark —
     ≥3:1), and **exits non-zero** if any pair fails or if a `var(--rd-accent)` fill rule sets a content colour (so a
     missed rule fails the slice). The script carries the table's "stay" list as an explicit **allowlist** (selector +
     reason); `.notice-count` is on it — its `color` declarations (graphite :492, :635) paint nothing because :595 sets
     `font-size: 0`, and P2.1b reduces it to one rule without `color`, after which the allowlist entry is removed.
     Keep the script for P6.4.
  5. Update `tests/desk-system.spec.ts` (`primaryBg` expected value: the dark `--rd-accent-fill` value, e.g.
     `rgb(217, 48, 73)` if `#d93049` is kept, not today's `rgb(255, 77, 99)`) and record that expected value in the
     evidence note (P6.4's contrast run may pick another dark fill; it then updates the spec again) and DESIGN.md
     token table (new tokens, :108). 6. Remove "(defined in P0.9)" from `.cursor/rules/smilesim-ui.mdc`.
- **Closes:** 3.1-01, 3.10-01.
- **Risks:** do not change `--rd-on-mark` (company marks) or `--rd-accent` (thread, focus ring, links); the dark fill
  is now darker than the thread — check the brand tile and nav count still read as crimson; hover must darken.
- **Verify:** CHK-LOCAL; `node scripts/contrast.mjs` exits 0; CHK-LOOK every page with a primary button (list them by
  `grep -rln "<Button" features`), and **every table row's element**: the sign-in «دخول» and `.gauth-mark`, the date
  picker's chosen day, nav count, account hero mark, settings identity mark, sidebar/drawer brand mark, side-user
  avatar, home offer action, branding preview button, package-sheet `.account-fund` buttons, the impersonation return
  bar, a checked checkbox and radio — reading computed `background-color` and `color` of each with a script, at
  390/1280, ar-dark (default), en-light, he-dark, hover and focus states. E2E: `desk-system.spec.ts` (updated),
  `login.spec.ts`.
- **Done:** script output attached; every table row moved; no crimson fill with content uses `--rd-on-mark`, `#fff`
  or a bare `--rd-accent` background.
- **Commit:** `fix(web): text on crimson fills passes 4.5:1 in both themes (UI maintenance P0.9; closes 3.1-01, 3.10-01; D1)`

---

## P1 — Tokens, role tokens, cascade guard (zero-diff except where named)

### P1.1 CSS guard and snapshot coverage

- **Goal:** a guard that stops the cascade from drifting, with a ratchet baseline; snapshots that cover every screen.
- **Files:** `scripts/check-css.mjs` (new, in `apps/web/scripts/`), `scripts/css-baseline.json` (new),
  `package.json` (`"lint": "eslint . --max-warnings 0 && node scripts/check-css.mjs"`), `tests/dom-snapshot.mjs`
  (cases), `docs/architecture/frontend.md` (scripts), `DESIGN.md` (Stylesheets: the guard).
- **Steps:**
  1. `check-css.mjs` (Node, no new dependency; parse with a small tokenizer or `postcss`, already a dev dependency) over
     `app/styles/**/*.css`, counting: (a) duplicates, keyed by **(at-rule chain, normalised selector, property)** — the
     at-rule chain is the full list of enclosing `@media` / `@container` / `@supports` preludes, normalised for
     whitespace — counted when one key is declared in more than one file, or twice in one file. A mobile-first base
     rule plus a `@media (min-width: …)` override of the same property is two different keys and is **not** a
     duplicate (P2.8 and P5 rely on that pattern); (b) `var(--rd-x)` where `--rd-x` is not defined in `tokens.css`;
     (c) `var(--rd-x, fallback)` where `--rd-x` is defined; (d) hex / `rgb(` / `rgba(` / `hsl(` outside `tokens.css`;
     (e) `outline: none` / `outline: 0` with no `box-shadow` or `outline` replacement in the same rule;
     (f) `font-size` with a `.5px` value or a `rem` value; (g) `font-weight: 800|900`; (h) `@media` widths not in
     {640, 767, 768, 899, 900, 1099, 1100} (counted, not failing until P5; P5.1 adds a named-exception allowlist per
     D26); (i) physical properties (`margin-left|right`, `padding-left|right`, `left:|right:` without inset-inline,
     `border-left|right`, `text-align: left|right`, and block-axis `margin-top|bottom`, `padding-top|bottom`,
     `border-top|bottom`); (j) `line-height` with a literal number, length or percentage (anything but `var(--rd-…)`,
     `normal`, `0` or `inherit`) outside `tokens.css`, except an entry in the named one-off allowlist below (P1.4 lists the
     four fixed-box centring line-heights that go there); (k) a literal length in `padding*`, `margin*`, `gap`,
     `row-gap`, `column-gap` or `border-radius*` outside `tokens.css` — allowed: `0`, `auto`, `50%`, `var(--rd-…)`,
     `calc()` built only from tokens and numbers (e.g. `calc(-1 * var(--rd-space-2))`), and the named one-offs listed
     in an allowlist inside the script (file, selector, property, reason; mirrored in DESIGN.md); (l) `opacity` with a
     literal number in a rule any of whose selectors contains `:disabled` or `[aria-disabled` (anything but
     `var(--rd-disabled-opacity)`), selector lists split as for (a), so a multi-line list such as `controls.css:36–37`
     is counted once per member (counted from today, failing at zero from the P3 gate, P3.1 step 4). (h) checks the
     **direction** too: `max-width` ∈ {640, 767, 899, 1099}, `min-width` ∈ {641, 768, 900, 1100}, so a 1px overlap
     such as `(max-width: 900px)` or `(min-width: 640px)` is counted.
     **Selector lists are split:** for (a) every member of a comma list (`.a::after, .b::after`) is its own key, after
     whitespace normalisation, so `.a, .b { x }` plus `.b { x }` counts one duplicate.
  2. Baseline: run once, write today's counts to `css-baseline.json`; the script fails if any count is **above** its
     baseline, prints the new hits, and prints "ratchet: lower <key> to N" when a count drops (the slice that lowers it
     updates the baseline).
  3. Extend `tests/dom-snapshot.mjs` so CHK-ZERO can see what a cascade move breaks (today it hashes only
     `getComputedStyle(el)` at rest, :186–200; reaches only `admin.`/`pos.` hosts, :161; waits for `.canvas-inner`,
     :175):
     - freeze the clock: an init script fixes `Date` (Playwright `page.clock.setFixedTime('2026-11-13T09:00:00')`, or a
       `Date` override via `addInitScript` if the installed version lacks `page.clock`) so fixture dates and relative
       times render the same in every run;
     - **settle motion before every hash** (today the script waits a fixed 400ms, :176, and Chromium runs with
       `prefers-reduced-motion: no-preference`, so the `rd-rise 420ms both` card staggers (delays up to 160ms), `.dialog`
       `rd-drop`, `filter-slide`, `.filter-pop` and the trend draw are read mid-flight, and `.spinner`, `shell-bell`,
       `shimmer`, `trend-breathe` never end): before hashing the rest state, and again after each forced state and each
       click step, run in the page
       `document.getAnimations().forEach((a) => { try { a.finish(); } catch { a.cancel(); } })` (an infinite animation
       throws on `finish()` and is cancelled), then wait two animation frames. Reduced motion is **not** emulated: the
       stagger and motion rules that P2.4, P2.7, P2.9 and P6.1 move must stay visible to the hash. The hash therefore
       covers the computed `animation-*` / `transition-*` longhands and the settled end values, not in-flight values;
     - **stable row keys:** each `.styles.tsv` / `.states.tsv` row is keyed by the element's id if it has one, else the
       parent's key plus `tag.class.chain:nth-of-type(n)` counted among siblings with the same tag and class chain (the
       DOM-index path stays as an extra column for reading). A slice that removes a dead element (P2.1b `.wallet-word`)
       or adds one (P3.x markup) then shows only that row as missing / added, not a shift of every later sibling;
       rows are sorted by key so `diff` aligns them;
     - the `main.` and `agent.` layers: the case layer field accepts `main` and `agent` (host `main.localhost` /
       `agent.localhost`, fixture session of that layer), so cascade moves that show only on those doors are seen;
     - hash `getComputedStyle(el, '::before')` and `getComputedStyle(el, '::after')` for every element whose pseudo
       has `content` other than `none`, as extra columns of the same `.styles.tsv` row;
     - `STATES=1`: a forced-state pass using CDP `CSS.forcePseudoState` (`hover`, `focus-visible`, `active`) on every
       `button`, `a`, `input`, `select`, `textarea`, `[role=tab]`, `[role=menuitem]`, `.line-op`, `.co-card`,
       `.pick-card`, `.pack-pick`, `.filter-pop button`, row-menu items — one state at a time, settling motion (above)
       after forcing it, then hashing **the forced element's whole subtree** and the pseudos of each node (so rules of
       the form `.x:hover .child`, e.g. `.line-op:hover .line-op-go` that P2.7 moves, are seen), and releasing the
       state before the next — written to `<case>.states.tsv`; plus a `disabled` / `aria-*` pass that hashes elements already in
       those states;
     - a per-case wait selector (`[name, path, layer, empty, { wait, click }]`; default `.canvas-inner`, sign-in cases
       `.gauth`), and an optional `click` list of steps run before hashing (open states below);
     - `WIDTH` accepts any value (CHK-ZERO uses 390/700/768/1024/1280, plus 860/861/899/900/1200 when a slice needs
       them).
  4. Extend `tests/dom-snapshot.mjs` cases with fixtures for: `/login`, `/password`, `/two-factor`, `/companies`,
     `/companies/cell`, `/companies/new`, `/companies/cell/packages/new`, `/companies/cell/packages/cell-400`,
     `/users/main1`, `/tasks/t1`, `/tasks/decisions`, `/notices`, `/profits`, `/wallet` (pos), `/offers`, `/branding`,
     `/provider-accounts`, `/provider-accounts/cell`, `/reports/balances`, `/reports/supply`, and open states the
     script can reach by a click step (`[name, path, layer, empty, click?]`): one `Dialog` (users → new account),
     the filter drawer at 390, a RowMenu, the date picker; and layer cases `packages-main`, `packages-agent`,
     `users-main`, `wallet-main`, `wallet-agent` (sell cells and wallet heads render only there). Keep existing cases.
- **Closes:** none (guards for س1, س2, س6, س7, س9).
- **Risks:** a new failing lint blocks CI — baseline makes it pass on day one; parse errors must fail loudly.
- **Verify:** CHK-LOCAL passes; deliberately add a duplicate selector in a scratch copy and see the guard fail (then
  revert); add a base + `@media (min-width: 768px)` override of one property in a scratch copy and see the guard **not**
  count it; run the extended snapshot at 1280 dark-ar once and check its output lists every case including the
  sign-in cases and the open states; **determinism:** run the full case list twice with no code change (1280 dark-ar
  and 390 light-en, `STYLES=1 STATES=1`) into two folders and require byte-identical `.styles.tsv` and `.states.tsv`
  (any difference is run-to-run noise and is fixed in this slice before P1.2 starts); change one `:hover` rule, one
  `.x:hover .child` rule and one `::after` rule in a scratch copy and see the snapshot diff report them (then revert);
  delete one sibling element in a scratch copy and see exactly one missing row (stable keys); **cost:** record the wall
  time of one full fifteen-run CHK-ZERO side (all cases, `STYLES=1 STATES=1`) in the evidence note.
- **Done:** guard in lint, baseline committed, snapshot covers the listed cases, pseudo-elements and forced states.
- **Commit:** `feat(web): CSS guard with a ratchet baseline, and snapshot cases for every screen (UI maintenance P1.1)`

### P1.2 Undefined and contradicting tokens

- **Goal:** every referenced token exists; no fallback contradicts its token; warning tint derives from warning.
- **Files:** `app/styles/tokens.css`; graphite :1043, :1044, :1143, :1156 (`var(--rd-text)`), :1078
  (`var(--rd-line-strong, var(--rd-line))`); `desk/home.css` :357, :358, :377, :398 (fallbacks).
- **Steps:** replace `var(--rd-text)` with `var(--rd-ink)` (4 lines; **visible**: period chip / chart tip / task ref
  now ink as designed). Define `--rd-line-strong` = `color-mix(in srgb, var(--rd-ink) 11%, transparent)` in `:root`
  (the value the 22 literal mixes use) — application in P1.8/P2. Remove fallbacks from `home.css` 357/358/377/398
  (the token values apply; **visible**: they already apply, so zero-diff — confirm with CHK-ZERO). Also remove the
  two graphite fallbacks so guard (c) reaches 0: `.grant`'s `var(--rd-line-strong, var(--rd-line))` (:1078) becomes
  `var(--rd-line-strong)` once the token is defined (the darkening is the named `.grant` change), and `.trend-tip`'s
  `var(--rd-surface-3, var(--rd-surface-2))` (:1143, the same line as its `--rd-text` fix) becomes
  `var(--rd-surface-3)` (defined in both themes, tokens.css:7 / :119, so the fallback is dead — zero-diff). Set light
  `--rd-warning-soft: color-mix(in srgb, var(--rd-warning) 12%, transparent)` (**visible, slight**).
- **Closes:** 3.1-07, 3.1-20, 3.1-27, 3.4-22. (3.7-23's fallback part; its weight part is P2.11.)
- **Risks:** `.grant` tiles (graphite :1078) darken when `--rd-line-strong` becomes defined — intended (T13 note), check
  `/roles`.
- **Verify:** CHK-LOCAL (guard count (b) and (c) drop — lower the baseline); CHK-ZERO except the named visible changes
  (the reviewers check that every `.styles.tsv` difference belongs to one of the four named elements and nothing
  else); CHK-LOOK `/`, `/finance` (period chip), `/wallet` (trend tip), `/tasks/[id]` (task ref), `/roles`, any
  warning badge, light and dark; CHK-AUDIT on those routes. These visible changes are listed in the spec's "What
  changes for users".
- **Done:** guard (b) = 0 and (c) = 0.
- **Commit:** `fix(web): define the tokens the sheets use and drop contradicting fallbacks (UI maintenance P1.2; closes 3.1-07, 3.1-20, 3.1-27, 3.4-22)`

### P1.3 Token file hygiene

- **Goal:** theme-independent tokens once; no alias names with equal values; the ink fill named for what it is.
- **Files:** `app/styles/tokens.css` (:28–47 / :136–155 login block — leave for P2.1a; `--rd-qr-tile`, `--rd-on-mark`,
  `--rd-scrim-strong`, `--rd-shadow-sm`, `--rd-radius-lg` repeated in `.dark` :157, :172–175), all sheets using
  `--rd-radius-md|card|tile|lg` and `--rd-primary-bg|hover|fg|soft`, `DESIGN.md` (Tokens, Scales, :207, :219, :247).
- **Steps:** (1) delete from `.dark` every token whose value equals `:root`'s. (2) radius aliases: keep
  `--rd-radius-sm` (6px) and `--rd-radius-lg` (8px) as the two control/card radii; replace `--rd-radius-md` → `-sm`,
  `--rd-radius-card` and `--rd-radius-tile` → `-lg` everywhere (`grep -rn "radius-md\|radius-card\|radius-tile"`),
  delete the aliases. (3) rename `--rd-primary-bg/-hover/-fg/-soft` → `--rd-ink-fill/-hover/-fg/-soft` everywhere they
  serve ink fills (logo, default badge, Select focus, offer timer, `ui.css:159` pager); do not point them at crimson.
  (4) DESIGN.md: radius rule rewritten to the real values (toast, row menu 12px vs 8px, dialog sm), token table rows.
- **Closes:** 3.1-14, 3.1-16, 3.1-18.
- **Risks:** a missed rename leaves an undefined token — guard (b) catches it; `.ui-btn-primary`'s old ink fill in
  `ui.css:33` is dead (graphite :523 wins) — leave it for P2.3.
- **Verify:** CHK-LOCAL (guard (b) = 0); CHK-ZERO.
- **Done:** `grep -rn "primary-bg\|radius-md\|radius-card\|radius-tile" app components features` = 0.
- **Commit:** `refactor(web): one definition per token, no radius aliases, the ink fill named (UI maintenance P1.3; closes 3.1-14, 3.1-16, 3.1-18)`

### P1.4 Role tokens (definitions only)

- **Goal:** the role tokens the later slices apply, **at today's values** (D6).
- **Files:** `app/styles/tokens.css` (`:root`), `DESIGN.md` (Scales, Type).
- **Steps:** add, each with a one-line comment naming its role and where today's value comes from:
  - type: `--rd-text-title: 1.25rem` (page h1, D4; 24px if D4 = 24), `--rd-text-display-sm: 20px`,
    `--rd-text-display: 22px`, `--rd-text-display-md: 26px`, `--rd-text-display-lg: 28px`, `--rd-text-display-xl: 30px`
    (only the steps actually used: confirm by `grep -rhoE "font-size: *[0-9.]+(px|rem)" app/styles | sort | uniq -c`),
    `--rd-text-figure: 1.45rem`, `--rd-text-figure-sm: 1.2rem`, `--rd-text-figure-lg: 1.9rem`, `--rd-text-sheet: 1.5rem`;
    half steps per D6 named by role: `--rd-text-tag: 11.5px`, `--rd-text-row: 12.5px`, `--rd-text-label: 13.5px`,
    `--rd-text-item: 14.5px` (the executor lists every half-pixel use and assigns each a role; no unnamed literal stays);
  - leading `--rd-leading-tight: 1.15`, `--rd-leading-snug: 1.35`, `--rd-leading-body: 1.5` plus a named token for
    **every other value in use today** (1, 1.1, 1.2, 1.25, 1.3, 1.4, 1.45, 1.55, 1.6 — confirm with
    `grep -rhoE "line-height: *[0-9.]+" app/styles | sort | uniq -c`), named by role where one role owns it
    (`--rd-leading-figure: 1.1`, `--rd-leading-heading: 1.2`, `--rd-leading-ui: 1.25`, `--rd-leading-label: 1.3`,
    `--rd-leading-hint: 1.4`, `--rd-leading-lede: 1.45`, `--rd-leading-message: 1.55`, `--rd-leading-prose: 1.6`,
    `--rd-leading-none: 1`) — every literal must have a token to map to, because guard (j) reaches 0 at the P2 gate;
    **length line-heights** (`grep -rnE "line-height: *[0-9.]+(px|rem)" app/styles`; unitless tokens cannot replace
    them without changing the computed value): `--rd-leading-control: 1.25rem` (20px; `ui.css:44,45` md/lg Button and
    `:104` regular Select). The four that only centre text in a fixed-height box and equal that box's height —
    `shell.css:593` (1.05rem, the badge whose `height` is 1.05rem), graphite `:183` (30px), `:253` (42px, drawer label
    of height 44px with a 1px frame), `:923` (36px, the 36px filter search) — go into the guard's named one-off
    allowlist (P1.1 step 1, extended to cover (j)) with that reason, wherever their rule lives after P2; a slice that
    deletes the rule removes its allowlist entry;
  - **no letter-spacing token:** the 22 `letter-spacing` declarations are `em` values that scale with their own font
    size and belong to one role each (0, ±0.01–0.03em, 0.06em, 0.12em); guard (k) does not count them; the positive
    ones move under `:lang(en)` / Latin identifiers in P6.2 (3.7-13). Recorded in DESIGN.md Type as a rule, not a scale;
  - weights `--rd-weight-regular 400`, `-medium 500`, `-semibold 600`, `-bold 700`;
  - icons `--rd-icon-sm: 14px`, `--rd-icon-md: 16px`, `--rd-icon-lg: 18px`, `--rd-icon-nav: 19px`;
  - focus `--rd-ring-width: 2px`, `--rd-ring-color: var(--rd-accent)`, `--rd-ring-offset: 2px`;
  - `--rd-disabled-opacity: 0.5` (today's `.ui-btn` and `.gauth-go` value; the other disabled rules use 0.4 / 0.45 /
    0.55 / 0.6 and keep their literals until P3.1 step 4 applies the token to every one of them — **visible**, listed
    in the spec; guard (l) counts them);
  - motion `--rd-ease-glide` (the sidebar curve from `shell.css:95/99`), `--rd-stagger: 40ms`;
  - direction `--rd-dir: 1` (and `[dir='rtl'] { --rd-dir: -1; }`);
  - space roles `--rd-space-8: 32px`, `--rd-pane-pad-inline: 18px`, `--rd-pane-pad-block: 14px`,
    `--rd-card-pad: 14px`, `--rd-gutter: 16px` (phone) / `--rd-gutter-wide: 28px`, `--rd-form-gap: 14px`,
    `--rd-field-gap: 6px`, `--rd-popup-offset: 6px`, `--rd-popup-pad: var(--rd-space-1-5)`,
    `--rd-popup-item-pad: var(--rd-space-2-5)`, `--rd-tag-inset: var(--rd-space-2)` (8px) **and**
    `--rd-tag-inset-tight: 7px` (the 7px tag of S17 keeps its value, D6 a — applying the 8px token to it would break
    zero-diff), `--rd-counter-pad: 5px` (S17 counters; not `--rd-space-1-5`), `--rd-row-h: 46px`,
    `--rd-canvas-pad-top: 22px`, `--rd-doors-gap: 22px`, `--rd-doors-pad: 18px`, `--rd-lede-gap: 18px`,
    `--rd-toast-pad-block: 11px` (named one-offs per D6);
  - radius `--rd-radius-pill` already exists (999px, tokens.css:75) — use it; add `--rd-hairline: 1px`, and for the
    1px / 2px radii in use today (`grep -rhoE "border-radius: *[0-9.]+px" app/styles`: four of each) the named
    tokens `--rd-radius-hair: 1px` and `--rd-radius-tick: 2px` (3px and 4px already exist as `-2xs` / `-xs`), so guard
    (k) can reach 0;
  - shadow `--rd-shadow-tip` (graphite :1143's `0 6px 16px rgb(0 0 0 / 0.25)`, both themes).
- **Closes:** none alone (applied in P1.5–P2.11; the appendix names the closing slice).
- **Tokens defined by later slices:** a few role tokens are introduced by the slice that first needs them, not here
  (`--rd-select-chevron` P1.5, `--rd-pair-gap-tight` and `--rd-zebra` / `--rd-zebra-alt` P1.8, `--rd-pager-item`
  P3.1, `--rd-pick-tick-space` P3.6, `--rd-form-gap-pane` P3.7, and any other the executor names). **Each such slice defines its token in
  `tokens.css` and adds it to DESIGN.md Scales (value and role) in the same commit**; reviewers reject a slice that
  uses an undocumented token, and the P1/P3 gate item "every new token is in DESIGN.md Scales" is checked by
  `grep -oE -- "--rd-[a-z0-9-]+:" app/styles/tokens.css` against DESIGN.md.
- **First use of each token** (protocol step 1 forbids applying a token in a slice that does not own that work, so a
  token defined here may stay unused until its slice):

  | Tokens | First applied in |
  |---|---|
  | type (`--rd-text-title`, display steps, `--rd-text-figure`, `-sheet`, the four half steps), leading, weights, `--rd-ease-glide`, `--rd-stagger`, `--rd-space-8`, `--rd-pane-pad-*`, `--rd-card-pad`, `--rd-tag-inset*`, `--rd-counter-pad`, `--rd-doors-*`, `--rd-lede-gap`, `--rd-toast-pad-block`, `--rd-hairline`, `--rd-radius-hair`, `--rd-radius-tick`, `--rd-shadow-tip` | P1.5–P2.10 (each where its literal is tokenised; a token of this row with no literal left to replace and no later slice naming it is deleted in P2.10) |
  | `--rd-disabled-opacity` | P3.1 step 4 |
  | `--rd-icon-sm`, `-md`, `-lg` | P3.4 |
  | `--rd-icon-nav`, `--rd-popup-offset`, `--rd-popup-pad`, `--rd-popup-item-pad` | P3.14 |
  | `--rd-form-gap`, `--rd-field-gap` | P3.7 |
  | `--rd-text-figure-lg`, `--rd-text-figure-sm` | P3.8 (`-sm` also P5.5) |
  | `--rd-row-h` | P4.3 |
  | `--rd-gutter`, `--rd-gutter-wide`, `--rd-canvas-pad-top` | P5.3 (or earlier if a P1/P2 slice tokenises that literal) |
  | `--rd-dir` | P6.1 |
  | `--rd-ring-width`, `--rd-ring-color`, `--rd-ring-offset` | P6.6 (P0.4 writes 2px literals that P6.6 swaps) |

- **Risks:** a token defined and never used. P2.10 checks ≥1 use only for the tokens of the first row; the **P6 gate**
  checks that every token in `tokens.css` has ≥1 use (an unused one is deleted there with its DESIGN.md row).
- **Verify:** CHK-LOCAL; CHK-ZERO (definitions only).
- **Done:** every token documented in DESIGN.md Scales with value and role.
- **Commit:** `feat(web): role tokens for type, leading, icons, focus, motion and spacing at today's values (UI maintenance P1.4; D6)`

### P1.5 Tokenise ui, controls, forms, doors, base

- **Goal:** zero-diff replacement of literals by tokens; physical inline padding → logical.
- **Files:** `app/styles/ui.css` (rem paddings :24, :43–45, :57, :60, :85–86, :115, :129–150; `padding-left/right`
  :43–45, :85–86, :140, :149–150), `controls.css` (:21, :25 motion), `forms.css` (:4, :7, :9, :10, :13), `doors.css`
  (:6–8, :11, :16), `base.css` (:98 motion).
- **Steps:** replace each literal equal to a token with the token (`2px→--rd-space-0-5 … 24px→--rd-space-6`, rem
  values by their computed px: `0.75rem`=12px→`--rd-space-3`, `0.5rem`→`--rd-space-2`, `2.25rem`=36px stays a named
  literal `--rd-select-chevron` if used twice). `padding-left/right` pairs → `padding-inline` (same values; check no
  later physical rule overrides — a logical property does not reset a later physical one). Off-scale doors/forms
  values → the P1.4 named tokens (`--rd-doors-gap`, `--rd-doors-pad`; the `.lede` 18px margin gets its own
  `--rd-lede-gap: 18px` — do not reuse the pane token for a different role). Motion → `--rd-dur-*`, `--rd-ease-*`. `.ui-btn`'s `--ui-btn-shadow: 0 0 #0000` (ui.css:24, the only raw colour in
  ui.css; guard (d) counts it) → `0 0 0 0 transparent` (the keyword is not a raw colour; the computed `box-shadow`,
  `rgba(0, 0, 0, 0) 0px 0px 0px 0px`, is unchanged — CHK-ZERO).
  **Half-pixel sizes and line heights** (they equal no scale step, so "replace literals equal to a token" alone would
  leave them): `ui.css:61` (badge `font-size: 11.5px`) → `--rd-text-tag`; `ui.css:137` (`.ui-pager-size-label`
  11.5px) → `--rd-text-tag`; `ui.css:151` (pager page 12.5px) → `--rd-text-row`; `forms.css:7` (`line-height: 1.25`)
  → `--rd-leading-ui`; `base.css:9` (`body { line-height: 1.5 }`) → `--rd-leading-body`; `ui.css:44,45,104`
  (`line-height: 1.25rem`) → `--rd-leading-control` (a length token, so the computed 20px is unchanged — never the
  unitless `--rd-leading-ui`). Lower guard (f) and (j).
- **Closes:** 3.4-08, 3.4-12, 3.4-13, 3.8-15. (Parts of 3.1-11, 3.1-12, 3.1-22, 3.7-09; closed later as listed.)
- **Risks:** rem sizes follow the browser's font size; px tokens do not — a user with a larger default font sees the
  primitives' padding stop growing. Accepted (DESIGN.md exception removed); note it in DESIGN.md.
- **Verify:** CHK-LOCAL (guard (i) count drops for ui.css); CHK-ZERO.
- **Done:** these five files have no literal that equals a token (grep each step value), no half-pixel or rem
  `font-size` and no literal `line-height` (guard (f) and (j) hits in these files = 0; the three `1.25rem` values are
  `--rd-leading-control`).
- **Commit:** `refactor(web): tokens and logical padding in the primitives, controls, forms, doors and base sheets (UI maintenance P1.5; closes 3.4-08, 3.4-12, 3.4-13, 3.8-15)`

### P1.6 Tokenise dialog.css

- **Goal:** every literal colour, size, radius and line height in `dialog.css` reads a token; nothing visible changes (zero-diff).
- **Files:** `app/styles/dialog.css` (:6–7, :18–19, :41, :50, :240, :276; radius :22, :72, :246; line-height :108).
- **Steps:** as P1.5. Line heights `dialog.css:108` (1.45) → `--rd-leading-lede`, `:250`, `:266` (1.25) →
  `--rd-leading-ui`. `padding-block: 11px` on the toast (:18) → named `--rd-toast-pad-block: 11px` (D6).
  `font-size: 16px` (:41) → `--rd-text-xl`. Row menu panel 2px/6px → `--rd-space-0-5` / `--rd-space-1-5`.
- **Closes:** 3.4-14, 3.4-24. (Parts of 3.1-11, 3.7-16, 3.7-19.)
- **Verify:** CHK-LOCAL; CHK-ZERO (include the dialog and RowMenu snapshot cases).
- **Commit:** `refactor(web): tokens in the dialog, toast and row menu sheet (UI maintenance P1.6; closes 3.4-14, 3.4-24)`

### P1.7 Tokenise shell.css

- **Goal:** every literal font size, half pixel, spacing, radius and motion value in `shell.css` reads a token; nothing visible changes (zero-diff).
- **Files:** `app/styles/shell.css` (rem font sizes :312, :337–591, :382, :398, :422, :434, :476–477, :574, :578;
  half px :128, :206, :215, :221; spacing :50, :120, :175, :202, :215–216, :259, :261; radii :143, :161, :195; motion
  :95, :99, :132, :151).
- **Steps:** rem font sizes → the `--rd-text-*` step equal to the **computed** px (0.8rem=12.8px is not 13px: use a named
  role token from P1.4 or add one; never round — D6); half px → P1.4 half-step tokens; spacing 11/7/3px → named or
  scale; radii 999px/4px → `--rd-radius-pill` / `-xs`; sidebar curve → `--rd-ease-glide`. Half px by line:
  `shell.css:128` (13.5px) → `--rd-text-label`, `:206` (12.5px) → `--rd-text-row`, `:215` (11.5px) → `--rd-text-tag`,
  `:221` (14.5px) → `--rd-text-item`. Line heights `:58` (1.35) → `--rd-leading-snug`, `:514` (1.2) →
  `--rd-leading-heading` (`:608` `.user-copy` 1.15 is dead — P2.1b deletes it; skip). `:593` (`line-height:
  1.05rem`, equal to its own box `height`) stays as the allowlisted fixed-box entry (P1.4) unless P2.1b deletes the
  rule. Guard (f) and (j) hits in shell.css = 0 except the dead blocks P2.1b removes and that allowlisted line.
- **Closes:** 3.4-16. (Parts of 3.1-08, 3.1-09, 3.1-17, 3.1-22, 3.7-08, 3.7-09.)
- **Risks:** `.notice-pop` / `.user-menu` dead blocks are removed in P2.1b — skip them here.
- **Verify:** CHK-LOCAL; CHK-ZERO (+ open the drawer at 390 in the snapshot click step).
- **Commit:** `refactor(web): tokens in the shell sheet (UI maintenance P1.7; closes 3.4-16)`

### P1.8 Tokenise desk/*.css

- **Goal:** the `desk/*.css` sheets read tokens for spacing, type, radii, motion and zebra rows; zero-diff under D6 a / D23 a.
- **Files:** `app/styles/desk/{frame,pane,table,filters,components,numbers,tasks,users,packages,home,settings,branding}.css`
  — notably `numbers.css:60–126` (spacing, 12px :71, zebra :67/:72, 1–2px gaps :92/:101/:113, motion :109/:141/:158),
  `users.css:11/22/32/33`, `tasks.css:48/102/131/142/151`, `home.css:50/53/292/363/396`, `pane.css:101/138`,
  `settings.css:46/52`, `branding.css:102/108`, `components.css:193/228`, `packages.css:157`.
- **Steps:** as P1.5. 1px label/value gaps (`numbers.css:92,101,113`, `settings.css:46`): under D6 = a (recommended)
  → `--rd-pair-gap-tight: 1px` (zero-diff); under D6 = b → `--rd-space-0-5` (**visible, +1px**, then this slice is
  visible and runs CHK-LOOK + CHK-AUDIT). Zebra rows per **D23**: (a, recommended) two tokens at today's values,
  `--rd-zebra` and `--rd-zebra-alt` (zero-diff; the two recipes stay documented); (b) one `--rd-zebra` (the other
  recipe's users switch — **visible, tiny**: CHK-LOOK + CHK-AUDIT, and the change is in the spec's visible list).
  `color-mix(… ink 11% …)` in desk files → `var(--rd-line-strong)`.
  **Half-pixel sizes and line heights in desk files** (by line; re-grep with
  `grep -rnE "font-size: *[0-9]+\.5px|line-height: *[0-9.]+;" app/styles/desk`): `numbers.css:72` (`.detail-rows dd`
  13.5px) → `--rd-text-label`; `settings.css:52` (12.5px) → `--rd-text-row`; line heights `numbers.css:103` (1.2) →
  `--rd-leading-heading`, `numbers.css:115` (1.35) → `--rd-leading-snug`, `components.css:77` (1.6) →
  `--rd-leading-prose`, `components.css:102` (1.3) → `--rd-leading-label`, `components.css:112` (1.15) →
  `--rd-leading-tight` (`.stat-value` line-height — **live**: graphite :74 sets only size, weight and letter-spacing,
  so this line renders; P2.1c must not delete it), `components.css:265`
  (1.4) → `--rd-leading-hint`, `tasks.css:165` (1.5) → `--rd-leading-body`, `tasks.css:202` (1.55) →
  `--rd-leading-message`, `settings.css:31` (1.2) → `--rd-leading-heading`, `users.css:78` (1.25) →
  `--rd-leading-ui`, `home.css:119` (1.3) → `--rd-leading-label`, `home.css:120` (1.6) → `--rd-leading-prose`,
  `home.css:256` (1.25) → `--rd-leading-ui`, `home.css:378` (1.35) → `--rd-leading-snug`, `table.css:92` (1.25) →
  `--rd-leading-ui`, `packages.css:126` (1.1) → `--rd-leading-figure`; `home.css:377` (`line-height: 1`) →
  `--rd-leading-none` here (P2.11 then changes it to `--rd-leading-tight`, Y23). Guard (f) and (j) hits in `desk/` = 0.
- **Closes:** 3.4-20, 3.4-21, 3.4-23, 3.1-09 (desk + shell parts done → closed here), 3.7-09 (closed here).
- **Verify:** CHK-LOCAL (guard (f), (j) drop; lower the baseline); CHK-ZERO — clean under D6 = a and D23 = a; under
  D6 = b or D23 = b every difference must belong to the named elements, and the slice adds CHK-LOOK and CHK-AUDIT.
- **Commit:** `refactor(web): tokens in the inner-page sheets (UI maintenance P1.8; closes 3.1-09, 3.4-20, 3.4-21, 3.4-23, 3.7-09)`

---

## P2 — Fold graphite.css into its owners, remove dead rules

**Rules for every P2 slice (conflict 2):** the value that wins **today** is the value written in the owner; the losing
declaration is deleted, not "revived". Moving a rule from the last sheet to an earlier one can make a later sheet win
(`dialog.css`, `controls.css`, `responsive.css`, `ui.css` load after `desk/*`): for every moved selector the executor
greps the later sheets for the same selector/property and resolves it in the same slice. Tokenise each moved literal
(P1.4 tokens). After each slice, lower the guard's duplicate-selector baseline. Zero-diff (CHK-ZERO, styles **and**
states) for P2.1–P2.10. **Widths:** the five standard widths, plus one width inside every `@media` block the slice
moves a rule into or out of (e.g. 520 for `.method-cards`, 860/861 for `.gauth`, 1000 for `.home-top-row`, 1200 for the
search width, 420 for `.detail-rows`, 560 for doors/dialog grids, 640/641 for the table-card block); the slice's
evidence note lists the blocks and the widths run. Interactive states moved across sheets (`:hover`,
`:focus-visible`, `:active`, `:disabled`, `aria-*`) are covered by the `.states.tsv` pass; any state the forced pass
cannot reach (a JS-driven open state) is checked in CHK-LOOK with a screenshot before and after.

### P2.1a Dead sign-in rules

- **Files:** `app/styles/auth.css` (:2–17 `.auth`, `.auth-tools`; :33–326 `.login-*` legacy frame incl. `.login-seam`
  :115 and its media blocks :246–326, :350–357), `app/styles/tokens.css` (`--rd-login-*` :28–47, :136–155),
  `responsive.css` `.auth …` selectors (:37–39 — **remove only the `.auth` lines**; the `.gauth` replacement is P6.5).
- **Steps:** for each selector `grep -rn "<class>" components features app lib` including template strings
  (`` `login-${…}` ``); delete the unused. Keep `.auth-card` (:18–30), `.login-enter` and `@keyframes login-in`
  (:330–336). Delete the 17 `--rd-login-*` tokens no rule uses (`grep -rn "var(--rd-login-" app components features`);
  **keep `--rd-login-room`, `--rd-login-ink` and `--rd-login-shut`** — the live `.gauth-art` rules use them (graphite
  :414–415, :429); P2.10 renames them with the `.gauth` move.
- **Closes:** 3.1-19, 3.3-26, 3.4-10, 3.8-08, 3.2-24 (auth part; the `.gauth` redirect closes in P6.5).
- **Verify:** CHK-LOCAL; CHK-ZERO including `/login`, `/password`, `/two-factor` cases.
- **Commit:** `refactor(web): delete the unused legacy sign-in frame and its tokens (UI maintenance P2.1a; closes 3.1-19, 3.3-26, 3.4-10, 3.8-08)`

### P2.1b Dead shell rules

- **Files:** `app/styles/shell.css` (`.user-menu` :317, `.avatar-btn` (every rule: :278, :286, :318, :327–328, :341,
  and the selector-list members at :704, :711; plus `base.css:41,46`), `.user-btn` (`base.css:23,36,39` selector-list
  members; `responsive.css:8`), `.shell-identity`, `.user-copy`,
  `.notice-pop` :608/:656/:692–693, `.notice-dot`, duplicate `.notice-btn` :579, `kbd` rules :370/:512/:591/:692 if
  unused, `.wallet-word` (see step below), `.shell-search { width: 16rem }` :409 (never wins: the 767
  block sets `auto` below 768 and graphite :455/:460 set 200/260px from 768 — confirm with the snapshot, then delete),
  `responsive.css:7–8` (`.user-copy, .user-btn > svg`), `components/app-shell.tsx:514`,
  `.notice-count` definitions (shell.css:581; graphite :492, :595, :635) → one rule (the visible dot, graphite :595,
  plus the `.nav-count` colour from :635), `components/sparkline.tsx` (unused) **with its CSS**
  (`desk/home.css:264–266` `.sparkline`, `.sparkline-line`, `.sparkline-area`, and the two motion lines
  `home.css:338–339`; the comment at `home.css:329` loses "the sparkline draws") and the `shell` branch of
  `LanguageSwitch` in `components/chrome.tsx:39` if unused (grep `<LanguageSwitch shell`).
- **Steps (beyond deleting):** (1) `.avatar-btn` and `.user-btn` are in no `.tsx` file (`grep -rn "avatar-btn\|user-btn"
  components features app`): grep each class over `app/styles` and delete **every** rule, removing only the dead member
  from a selector list and keeping the live members. (2) `.wallet-word` is **not** a dead rule but a dead element:
  `app-shell.tsx:514` still renders `<span className="wallet-word">`, the base rule `shell.css:653` styles it, and
  graphite :479 `display: none` is what hides it at every width (the 640 rule `shell.css:654` is the only dead line).
  Delete the `<span>` **and** `shell.css:653–654` **and** graphite :479 together (deleting the CSS alone would show
  the word); keep the `walletPage` copy key if it has another use (`grep -rn "walletPage"`). The markup difference in
  the snapshot is allowed (dead element removed; it was `display: none`, so nothing renders differently).
- **Closes:** 3.3-28, 3.7-17, 3.2-25, 3.1-26. (3.6-26 dead parts; its search part closes in P4.5.)
- **Risks:** `.shell-lang` shares `.shell-icon` rules — keep; `DESIGN.md:207` names `.notice-pop` — fix the line.
- **Verify:** CHK-LOCAL; CHK-ZERO (+ notices open, search open at 390 and 1280).
- **Commit:** `refactor(web): delete dead shell rules and keep one unread-dot rule (UI maintenance P2.1b; closes 3.3-28, 3.7-17, 3.2-25, 3.1-26)`

### P2.1c Dead desk, dialog and button rules

- **Files:** `dialog.css` (`.dialog-foot .danger` :133, `.op-block > button` :165), `desk/packages.css`
  (`.pack-card > button` :68, `.price-board > .secondary` :147, `.target-list > .secondary` :186), `desk/table.css`
  (`td.when` break under 1100, :129–136: delete **only** the `white-space: normal` rule on `.canvas .data td.when,
  .canvas .data td.when bdi` and the `max-width: 5.5rem` declaration, which graphite :537 overrides; keep
  `display: inline-block` on `.canvas .data td.when bdi` (live below 1100) and the `.canvas .data th, td
  { padding-inline }` rule in the same block, which P5.1 remaps), `desk/frame.css` 720 block duplicate field heights (:53–57 → keep `.back-link`
  only), `desk/pane.css:50` (`.pane-head h2` font, dead), `desk/table.css:35–36` (`.data th`, dead),
  `desk/components.css:108–109` (`.stat-value` size/weight, dead), graphite `.ui-btn.ui-btn-accent` (:519–520) **with**
  its two users `features/lines/screens/numbers-screen.tsx:251`, `features/desk/screens/home-screen.tsx:73` (remove the
  class; identical look via `.ui-btn-primary`).
- **Closes:** 3.5-19, 3.6-32, 3.2-22, 3.2-23, 3.1-28, 3.1-15, 3.5-12.
- **Risks:** `components.css:108` is dead only while graphite :74 wins; when P2.4 moves `.stat-value`, re-check
  `responsive.css:5` (conflict 2).
- **Verify:** CHK-LOCAL; CHK-ZERO.
- **Commit:** `refactor(web): delete dead desk, dialog and accent-button rules (UI maintenance P2.1c; closes 3.5-19, 3.6-32, 3.2-22, 3.2-23, 3.1-28, 3.1-15, 3.5-12)`

### P2.2 Page head, panes, desk frame

- **Files:** graphite :8–18 (page head, panes), :140–151 (`.desk > .pane { flex: none }`, `.desk .sheet`, terms),
  :633 (`.desk > .steps`); `desk/frame.css` (:20–21, :43–48 `:has(.stack)` rules, :91 `.canvas .page-head h1`),
  `desk/pane.css` (:2–10 fill model, `.pane.fit`, :40, :65), markup `features/catalog/screens/company-screen.tsx:162`
  , `features/accounts/screens/users-screen.tsx:174` and `features/roles/screens/roles-screen.tsx:146` (`fit`),
  `company-screen.tsx:213–225` comment/offset.
- **Steps:** (1) one `.page-head h1` rule in `frame.css`: `font-size: var(--rd-text-title); font-weight: var(--rd-weight-bold);
  letter-spacing: 0; margin: 0` (D4; today's computed: 1.25rem/700/0); delete graphite :9 and frame.css:21, :91.
  (2) panes: move graphite :13–17 into `pane.css`, padding → `--rd-pane-pad-block` / `--rd-pane-pad-inline`.
  (3) delete the dead fill model: **only** the `flex: 1` declaration in `.desk > .pane` (pane.css:9 — keep its live
  `display: flex; flex-direction: column; width: 100%; min-height: 0`, which graphite :146 does not override), the
  `.pane.fit` rule (:10), the stale scroll-model comment (:2–8, rewritten to what renders), graphite :146 (`flex: none`
  becomes the base declaration in that rule), and `fit` in the three screens (conflict 3). In `.desk .sheet`
  (pane.css:~26) only `flex: 1` is dead; its `overflow: auto` still supplies the computed `overflow-y: auto` that
  graphite :147's `overflow-x: auto` does not cancel — the merged rule is `flex: none; min-height: 0; overflow: auto`
  (CHK-ZERO proves it). The `frame.css:43–48` `:has(.stack)` rules set flex /
  min-height / overflow on `.canvas-inner.wide`, `.desk` and `.desk > .stack` — not the pane fill model — so delete
  them **only if** CHK-ZERO shows the computed styles of `.canvas-inner`, `.desk` and `.stack` on the stack pages
  unchanged without them; otherwise keep them and say so in the commit body; keep `.desk .sheet` as
  today's computed (above). (4) `.desk > .steps` into `pane.css`.
- **Closes:** 3.1-04, 3.7-02, 3.3-33, 3.3-30, 3.4-02.
- **Risks:** the scroll model must stay what renders **today**, not what the dead fill model describes: `.desk > .pane`
  is `flex: none` (graphite :146), `.desk .sheet` is `flex: none; overflow-x: auto` (:147), and `.canvas` is the
  scroll container (`frame.css:2` `overflow: auto`). So the page head scrolls away with the page and only the table
  `thead` is sticky (`table.css:30`); `.sheet` scrolls horizontally only. Do not "restore" a sheet that scrolls
  vertically (D10, conflict 3). `.cursor/rules/content-ui.mdc:17` ("Workbench lists … fill the canvas and **the sheet
  scrolls**") describes the dead model: rewrite that bullet in this slice to "the canvas scrolls; the table head is
  sticky; a sheet scrolls only sideways" (working-tree precondition applies).
- **Files (addition):** `.cursor/rules/content-ui.mdc` (Scroll bullet :17).
- **Verify:** CHK-LOCAL; CHK-ZERO; on `/numbers`, `/users`, `/companies/[code]` at 1280 and 390, before and after:
  scroll the canvas to the bottom and record `.canvas.scrollTop` / `scrollHeight`, the `thead` `getBoundingClientRect().top`
  (equal to the canvas top while scrolled), `.sheet` `scrollHeight == clientHeight` (no vertical scroll) and
  `scrollWidth` vs `clientWidth` (sideways only) — every number equal before and after.
- **Commit:** `refactor(web): one page-title rule, panes in pane.css, the dead fill model removed (UI maintenance P2.2; closes 3.1-04, 3.7-02, 3.3-33, 3.3-30, 3.4-02)`

### P2.3 Buttons, tabs, fields, badges, switch, pager

- **Files:** graphite :19–63 (buttons, tabs, fields, status diamonds, switch), :509–524 (pager, primary);
  `ui.css` (:18, :26–31, :33–35, :159), `desk/pane.css` (`.steps`, `.seg`), `forms.css`/`base.css` (fields).
- **Steps:** primary → `ui.css` as today's computed (crimson fill from P0.9, no shadow, hover), delete `ui.css:33` ink
  fill and graphite :22/:523–524 (B13). Secondary/outline look → `ui.css` (identical rules; the rename is P3.1). Pager
  current page: one rule in `ui.css` per D3 (default ink: `background: var(--rd-ink); color: var(--rd-bg)`), delete
  the other (T2/B1). `:focus-visible` box-shadow (graphite :26 wins today) → `ui.css`. Tabs, `.seg` → `pane.css`.
  Field inset look (graphite :40–53) → `forms.css` (border mix stays 70% today; P6.4 changes it). Badge diamond,
  switch → `ui.css` / `components.css`.
- **Closes:** 3.5-13, 3.1-02, 3.5-01, 3.4-09 (pager/steps/seg parts; table part in P2.6 — closed at P2.6).
- **Risks:** `.ui-pager-nav .ui-btn-outline` (graphite :515) — move it as is; P3.1 deletes it; `dialog.css` and
  `controls.css` load after `pane.css` — check `.dialog .seg button` and checkbox rules after the move.
- **Verify:** CHK-LOCAL; CHK-ZERO including `.states.tsv` (the `.ui-btn:focus-visible` and hover rules move into
  `ui.css`, which loads before `dialog.css` / `controls.css`; the forced-state pass must show them unchanged in the
  dialog, filter drawer and pager cases). E2E `desk-system.spec.ts` unchanged.
- **Commit:** `refactor(web): button, tab, field and pager looks live in their own sheets (UI maintenance P2.3; closes 3.5-13, 3.1-02, 3.5-01)`

### P2.4 Figure cards, fact cards, card motion

- **Files:** graphite :64–115 (stat, fact-grid, op-card, company/pack card `::after`, motion), :709
  (`.stat.highlight`), :825–833 (wallet figures), :1299–1303 (branch band); `desk/components.css` (Stat :76–119),
  `responsive.css:3–6` (`.stat-row`, `.stat`, `.stat-value 1.2rem` dead).
- **Steps:** move to `components.css` with today's computed values. **Conflict 2:** once `.stat-value` lives in
  `components.css`, `responsive.css:5` (later) would win on phones — delete `responsive.css:5` in this slice (the
  revival is P5.5 by decision D10). Keep `.stat-row` / `.stat` phone rules that win today. **One stagger rule
  (3.1-22):** the card stagger is copied four times today (graphite :106–109, :684–687, :789–791, :1002–1004; also
  `home.css:330–334`). This slice writes its single home: one block in `components.css` ("Motion: stagger") whose
  delays are `calc(var(--rd-stagger) * k)`; it starts with the `.stat-row`, `.fact-grid`, `.op-grid` selectors, and
  P2.7 (`.line-op-grid`, `.mode-grid`) and P2.9 (`.co-grid`, the `home.css:330–334` lists) **add their selectors to this
  block** instead of moving their copies. Zero-diff: the caps differ today, in **three** shapes — (1) `n + 5` at
  160ms for stat/fact/op/line-op and for `.home`, `.home-side`, `.shortcut-grid` (`home.css:334`); (2) `n + 4` at
  120ms for mode/co grids; (3) delays for children 2–4 only, **no** `n + 5` line, for `.figure-band > *` and
  `.home-main > *` (`home.css:331–333`: they appear in the 2/3/4 lines but not in the `n + 5` line, so a fifth child
  has no delay). Keep three capped lines inside the one block; P2.9 must not add `.figure-band` / `.home-main` to the
  `n + 5` line (CHK-ZERO would show it as a new `animation-delay` on a fifth child).
- **Closes:** none alone (part of 3.1-03 handled in P5.5).
- **Verify:** CHK-LOCAL; CHK-ZERO at 390 especially (`home`, `finance`, `users/main1`, reports cases).
- **Commit:** `refactor(web): figure and fact cards live in components.css (UI maintenance P2.4)`

### P2.5 Topbar and shell details

- **Goal:** the topbar and shell rules leave graphite.css for `shell.css` with today's computed values (zero-diff).
- **Files:** graphite :445–494 (topbar, search widths, icons), :580–606 (shell details, `.topbar { position: sticky }`
  :586, path :590–598, notice dot), relevant parts of the phone block; `shell.css`, `responsive.css:18–27`.
- **Steps:** move into `shell.css` at today's computed values; one `.topbar` rule (sticky only once); the narrow path
  layout set in one place (`responsive.css:24` vs graphite :591/:596). Do **not** change search widths (R4 is P5.2).
- **Closes:** 3.3-31.
- **Verify:** CHK-LOCAL; CHK-ZERO at 390/768/899/900/1280 (add 899/900 runs for this slice).
- **Commit:** `refactor(web): the topbar and shell details live in shell.css (UI maintenance P2.5; closes 3.3-31)`

### P2.6 Tables, filters, chip list, price board

- **Goal:** the table, filter, chip-list and price-board rules leave graphite.css for their owner sheets (zero-diff).
- **Files:** graphite :94–100, :152–297 (filters, drawer), :495–517 (tables), :525–539, :850–904 (`.price-board` 720
  duplicate :850, chip list `.filter-pop` :862–904 incl. the P0.3 focus rule), table-card phone block :1304–1350;
  `desk/table.css`, `desk/filters.css`, `desk/packages.css:187`.
- **Steps:** move; keep one `.price-board` breakpoint rule (`packages.css`); the table-card phone block → `table.css`
  (with the P0.7 additions); fix `table.css` comment (14→8).
- **Closes:** 3.4-09 (closed here).
- **Verify:** CHK-LOCAL; CHK-ZERO incl. `.states.tsv` (lists, filter drawer at 390, chip list open; `.filter-pop`
  hover/focus moves next to `controls.css`/`responsive.css`, which load later; 640/641 for the table-card block).
- **Commit:** `refactor(web): tables, filters and the chip list live in their own sheets (UI maintenance P2.6; closes 3.4-09)`

### P2.7 Number card, numbers cells, line operations, mode cards

- **Goal:** the number-card, numbers-cell, line-operation and mode-card rules leave graphite.css for their owner sheets (zero-diff).
- **Files:** graphite :116–139, :540–579, :637–691, :765–799; phone parts; `desk/numbers.css`, `desk/components.css`
  (mode cards / op cards), `desk/pane.css`.
- **Steps:** move at today's values; `[dir='ltr'] .line-op:hover .line-op-go` stays as written (P6.1 rewrites
  direction); keep the P0.4 focus rule; the `.line-op-grid` and `.mode-grid` staggers join the one stagger block P2.4
  created (no copy moves).
- **Closes:** none alone.
- **Verify:** CHK-LOCAL; CHK-ZERO incl. `.states.tsv` (`numbers`, `numbers-pos`, `number-card`, `provider`; the
  `.line-op:hover` / `::after` glow and the P0.4 focus ring must hash the same).
- **Commit:** `refactor(web): number-card and operation rules live in numbers.css (UI maintenance P2.7)`

### P2.8 Tasks, users, provider operations, settings, notices, roles

- **Goal:** the tasks, users, provider-operations, settings, notices and roles rules leave graphite.css for their owner sheets (zero-diff).
- **Files:** graphite :607–636, :692–764, :800–824, :1059–1089, :1430–1486; `desk/tasks.css`, `desk/users.css`,
  `desk/settings.css`, `desk/components.css` (notices), new section in `desk/users.css` or a `desk/roles.css`
  (if added, import it after `users.css` in `globals.css` and add the row to DESIGN.md's Stylesheets table).
- **Steps:** move; the task board order (graphite :714–718) moves as an `@media (min-width: 900px)` block in
  `tasks.css` **after the `@container task-ticket (max-width: 36rem)` block** (tasks.css:223, i.e. at the end of the
  board rules), not just after the base: today graphite loads after `tasks.css`, so at equal specificity the media
  rule beats the container rule wherever both apply; placed before the container block it would lose wherever they
  overlap. *(Amended in P0.5: measured, they do not overlap today. The ticket pane is 596px at viewport 900 with the
  sidebar open, 606 at 910, 611 at 916, 615 at 920, all above 36rem = 576px, and the container block applies only in
  drawer mode up to a viewport of about 608px. The placement is kept as a safeguard. Re-measure the ticket width at
  900 and 910 with the sidebar open before the move; CHK-ZERO adds a 608 run on `tasks/t1`, the widest width inside
  the container block, in place of the 910 sidebar-open run the first text named.)* (R14 rewrite is P5.6.) `.task-rail { border: 0 }` (graphite :724) wins over the
  `border-inline-end` / `border-block-end` lines in the `@container task-ticket (max-width: 36rem)` block
  (`tasks.css`): delete those two dead lines and keep `border: 0` in the base (zero-diff).
- **Verify:** CHK-LOCAL; CHK-ZERO (`tasks`, `tasks/t1`, `users`, `users/main1`, `settings`, `roles`, `notices`).
- **Commit:** `refactor(web): tasks, users, settings, notices and roles rules live in their sheets (UI maintenance P2.8)`

### P2.9 Catalog, home, reports, wallet

- **Goal:** the catalog, home, reports and wallet rules leave graphite.css for their owner sheets (zero-diff).
- **Files:** graphite :834–861, :905–1058, :1090–1171, :1238–1303; `desk/packages.css`, `desk/home.css`,
  `desk/components.css` (report layout, period), `desk/branding.css`.
- **Steps:** move at today's values; the `.co-grid` stagger (graphite :1002–1004) and the `home.css:330–334` stagger lists
  join the one stagger block from P2.4 (no copy stays), each selector in the capped line of its own shape (P2.4: the
  `.figure-band` / `.home-main` children keep delays for 2–4 only).
- **Verify:** CHK-LOCAL; CHK-ZERO (`home`, `packages`, `packages-pos`, `companies`, `company`, report cases, `wallet`).
- **Commit:** `refactor(web): catalog, home, report and wallet rules live in their sheets (UI maintenance P2.9)`

### P2.10 Sign-in, dialog, date and name fields, phone block — and delete graphite.css

- **Files:** graphite :90–93 (dialog thread), :298–444 (`.gauth`), :1172–1237 (NameField), :1384–1429 (DateField),
  :1304–1383 remainder (phones); `auth.css`, `dialog.css`, `desk/components.css` (or a new `desk/fields.css` imported
  after `components.css`), `globals.css` (remove `@import './styles/graphite.css'`), DESIGN.md (Stylesheets table row
  12 removed; every row's "Holds" updated), `docs/architecture/frontend.md`, `docs/architecture/generate.mjs` (styles
  zone, :201–220) and its two `.excalidraw` boards.
- **Steps:** move the rest; confirm graphite is empty; delete the file and its import; the boards list every
  stylesheet with its role (`generate.mjs` styles zone), so add a row for each sheet this phase added (`desk/fields.css`
  if created here, `desk/roles.css` if P2.8 created it), update the roles of sheets whose contents changed, and run
  `node docs/architecture/generate.mjs` (CLAUDE.md: when file roles change); run the guard: duplicate
  selectors 0, undefined tokens 0, raw colours outside tokens 0, **(f) half-pixel / rem font-size 0, (j) literal
  line-height 0** apart from the allowlisted fixed-box entries named in P1.4 (graphite's 30/36/42px move with their
  rules and keep their allowlist entries, updated to the new file) (in every sheet, not only the moved rules — a remaining hit outside graphite means a P1.5–P1.8 step
  was missed: fix it here and say so in the commit body), every token of P1.4's first-use row "P1.5–P2.10" used ≥1
  (the tokens whose first use is a later slice are **not** checked here — the P6 gate checks every token); tokenise
  every literal the moved rules carried (graphite had ~180), **including graphite's 19
  `color-mix(in srgb, var(--rd-ink) 11%, transparent)` mixes (:23 … :1394), each written as `var(--rd-line-strong)` as
  it moves** (check-css does not count a mix of tokens as a raw colour, so only the grep below catches a miss; P1.8
  already did the three in `desk/`). Under D6 = a the S17 differences (tag insets 7 vs 8px, counters 5px vs
  `--rd-space-1-5`, donut key 3 vs 6px) and the pane paddings 16/20 vs 14/16 stay **as they render today**, each on its
  own named token; this slice names them, it does not unify them (unifying is D6 b, out of scope).
- **Closes:** 3.1-05, 3.1-08, 3.1-10, 3.1-11, 3.1-13, 3.1-17, 3.1-22, 3.4-07, 3.4-17, 3.7-03, 3.7-08, 3.7-16, 3.7-19.
- **Verify:** CHK-LOCAL; full CHK-ZERO (all cases, all fifteen width/theme/locale runs, plus 860/861 for the
  `.gauth` rules and the width inside every moved `@media` block). Guard (k) = 0 (literal spacing / radius; remaining
  hits outside graphite are fixed here like (f)/(j)); `grep -rn 'ink) 11%' app/styles | grep -v tokens.css` = 0;
  the first-row token check: `for t in <first-row tokens>; do grep -rq -- "var($t" app/styles || echo $t; done` prints
  nothing.
- **Commit:** `refactor(web): fold the last Graphite rules into their sheets and delete graphite.css (UI maintenance P2.10; closes 3.1-05, 3.1-08, 3.1-10, 3.1-11, 3.1-13, 3.1-17, 3.1-22, 3.4-07, 3.4-17, 3.7-03, 3.7-08, 3.7-16, 3.7-19)`

### P2.11 Typography normalisation (visible, named)

- **Goal:** the typography changes the decisions approve, in one reviewed slice.
- **Files:** every sheet with `font-weight: 800` (21 uses: `grep -rn "font-weight: 800" app/styles`), `desk/tasks.css:201`
  (message 15px), tabs selected weight (moved from graphite :33, now `pane.css`), counters `desk/pane.css:62,143`,
  `desk/home.css:396`, `desk/home.css:377` (800 / line-height 1).
- **Steps:** D7: every 800 → `var(--rd-weight-bold)`; task message → `--rd-text-base`; the selected tab keeps weight 600 and
  is marked by colour and its underline only, so its width does not change; counters one weight (600); `home.css:377` weight 700, line-height `--rd-leading-tight`.
  Guard (g) = 0. If `--rd-leading-none` has no use left after the `home.css:377` change, delete it (and its
  DESIGN.md row) in this slice.
- **Closes:** 3.7-14, 3.7-18, 3.7-20, 3.7-21, 3.7-23.
- **Risks:** removes emphasis in ar/en (D7 accepted); check headings on `/`, `/numbers/[id]`, `/settings`.
- **Verify:** CHK-LOCAL; CHK-LOOK `/`, `/tasks/[id]`, `/numbers/[id]`, `/users/[login]`, `/companies/[code]`, tab strips
  on 3 pages, at 390/1280, ar-dark/en-light/he-light; measure tab widths before/after selection (no change).
- **Commit:** `fix(web): weights capped at 700, steady tab width, task message at body size (UI maintenance P2.11; closes 3.7-14, 3.7-18, 3.7-20, 3.7-21, 3.7-23; D7)`

---

## P3 — Core components (Button, IconButton, icons, marks, Pane, fields, Stat)

Every P3 slice: **visible** unless it says zero-diff; CHK-LOCAL, CHK-LOOK, CHK-AUDIT for the touched routes.

### P3.1 Button primitive

- **Files:** `components/ui/button.tsx`, `ui.css`, `components/ui/pagination.tsx:101`, the 11 outline call sites
  (`grep -rn "outline" features components --include='*.tsx' | grep -i "variant"`), sheets with context button rules
  (`grep -rn "\.ui-btn" app/styles | grep -v "^app/styles/ui.css"`): pager nav `.ui-pager-nav .ui-btn-outline`,
  `desk/branding.css:55` (`.drop-clear` 30px), `desk/filters.css:69` (28px), filter clear `color: var(--rd-accent)`,
  `desk/tasks.css:219–221` (32px forced), `dialog.css:180` (`.dialog button:disabled { opacity: 0.45 }`),
  `tests/desk-system.spec.ts`.
- **Steps:** (1) remove `outline` from `ButtonVariant`; delete the `.ui-btn-outline` members from every selector list
  (`ui.css:35–36` and the rules P2.3 moved from graphite :23–24; `grep -rn "ui-btn-outline" app/styles components
  features` = 0 after the slice); migrate the 11 sites to `secondary` (the pager arrows go to
  `ghost`, step 3b, so no pager context rule is needed). Keep `danger` as the red outline (conflict 8).
  (2) one radius (B14) per **D19**: (a, recommended) keep 6px rendered (`var(--rd-radius-sm)`) and fix DESIGN.md — no
  visible change; (b) `var(--rd-radius-lg)` (8px) — visible, `desk-system.spec.ts` radius assertion changes.
  (3) delete context resizes: `.drop-clear` → `size="sm"`; filter 28px duplicate; the ticket compose button uses the
  default size (B22; it stays primary beside the head's primaries, a named exception of ADR 0021 D2 (2)); filter clear loses its crimson text (B21).
  (3b) **pager (B20):** delete `.ui-pager-nav .ui-btn-outline { height: 30px; … }` and its hover (graphite :515–516,
  moved to `ui.css` by P2.3 — find by selector) instead of renaming it; render the pager arrows in
  `components/ui/pagination.tsx` as `<Button variant="ghost" size="sm">`, and define **one pager-item size** in
  `ui.css` shared by `.ui-pager-page` and the arrows: `--rd-pager-item: 32px` (= Button `sm`) for height and
  `min-width` of `.ui-pager-page` (today 30px, graphite :512 — **visible, +2px**, listed in the spec). The 640 block's
  `.ui-pager-page { min-width: 40px; height: 40px }` (graphite :1361) applies to both items until P6.5 replaces it
  with 44px (follow-up recorded for P6.5). Measure page numbers and arrows at one height at 390 and 1280. (4) **one disabled opacity (C24)** —
  list every disabled-state opacity first: guard (l)'s hit list (it splits multi-line selector lists such as the
  checkbox rule), cross-checked with `grep -rn -A3 -E ":disabled|\[aria-disabled" app/styles | grep opacity`. Today (2026-11-13, lines before P2 moves them; find by selector) that list is: `.ui-btn:disabled` 0.5
  (`ui.css:31`), `.ui-select-field:disabled` **0.6** (`ui.css:101`), `input[type=checkbox|radio]:disabled` 0.45
  (`controls.css:36–37`), `.dialog button:disabled` 0.45 (`dialog.css:180`), `.steps button:disabled` **0.4**
  (`desk/pane.css:132`), `.line-op:disabled` 0.45 (graphite `:681`, number-card operations), `.pick-card:disabled`
  0.55 (graphite `:1284`), `.gauth-go:disabled, .gauth-passkey:disabled` 0.5 (graphite `:401`), `.outage-bar
  button:disabled` **0.6** (`desk/components.css:52`), `.live-switch button:disabled` 0.45 (`desk/components.css:229`)
  (`auth.css:231` `.login-passkey` 0.72 is a legacy rule P2.1a deletes; if it still exists, the slice stops and
  reports). Set each to `opacity: var(--rd-disabled-opacity)`, keeping each rule's own `cursor` and other
  declarations; give `.seg` a `:disabled` rule with the token if it has disabled buttons (today `.seg` has no
  disabled rule and relies on `.dialog button:disabled` inside dialogs: `grep -rn 'className="seg' features components`
  finds its users), then delete `dialog.css:180` (its 0.45 would otherwise beat
  `.ui-btn:disabled` inside dialogs, `(0,2,1)` vs `(0,2,0)`). Before deleting it, list every raw `<button>` that can
  be disabled inside a dialog and has no `:disabled` rule of its own (`grep -rn "disabled=" features components
  --include='*.tsx'` filtered to `<button` without `buttonClass`/`Button`; known today: `.link-btn` in
  `components/mode-cards.tsx:54` — give `.link-btn:disabled` the token rule here; P3.2 later turns that button into a
  ghost Button and removes the rule if `.link-btn` has no disabled user left), `.esim-open` in `components/esim-qr.tsx:33` (disabled while busy; it has its own
  `[aria-busy='true']` 0.55 rule in `desk/numbers.css:145` — give it `.esim-open:disabled` with the token if it renders
  inside a dialog)) and give each the token rule in its own sheet, so no dialog button loses its dimmed look. Lower guard (l) to **0** in the baseline; from this
  slice the guard fails on any new literal disabled opacity.
- **Closes:** 3.5-14, 3.5-15, 3.6-25, 3.5-18, 3.5-20, 3.5-21, 3.5-22, 3.6-24.
- **Risks:** pager page numbers carry a stronger selector (`.ui-pager-page[aria-current='page']`) — the shared size
  must apply to the current page too; the pager's ghost arrows must keep a transparent rest state (today
  `background: transparent; box-shadow: none`).
- **Verify:** measure every Button on every route (script: all `.ui-btn` heights/radius/colours) at 390/1280,
  ar-dark/en-light. Disabled look: on a page that renders each listed control disabled (a dialog with a disabled
  submit, `/numbers/[id]` operations on a line that blocks them, the steps strip at its first step, the outage bar, the
  live switch while saving, a disabled Select and checkbox, `/login` with an empty form), read computed `opacity`
  = 0.5 for every one, ar-dark and en-light; screenshot each. E2E: `desk-system.spec.ts` (radius if changed), `numbers-paging.spec.ts`, `offers.spec.ts`,
  `reconciliation.spec.ts`, `provider-accounts.spec.ts`.
- **Done (disabled):** guard (l) = 0; `grep -rnE "disabled[^{]*\{[^}]*opacity: *[0-9.]" app/styles` returns nothing;
  every control in the list measured at 0.5.
- **Commit:** `fix(web): one secondary variant, one radius, one disabled look, no context button rules (UI maintenance P3.1; closes 3.5-14, 3.5-15, 3.5-18, 3.5-20, 3.5-21, 3.5-22, 3.6-24, 3.6-25)`

### P3.2 One primary per view

- **Files:** `features/catalog/screens/packages-screen.tsx:349`, `features/auth/session-rules.tsx:153`,
  `features/providers/screens/provider-account-screen.tsx:110`, `features/providers/matching-pane.tsx:57`,
  `features/providers/reconciliation.tsx:95,142`, `features/catalog/screens/add-package-screen.tsx:151`,
  `features/catalog/screens/add-company-screen.tsx:114`, `features/tasks/screens/task-ticket-screen.tsx:106–130,230`,
  `features/desk/screens/home-screen.tsx:71`, `features/wallets/screens/finance-screen.tsx:145`,
  `features/catalog/screens/company-screen.tsx:171`, `features/offers/screens/offers-screen.tsx:161`,
  `features/auth/sign-in-methods.tsx:132,153`, `desk/components.css:13`
  (`.return-bar button`), `components/mode-cards.tsx:54` (`.link-btn`), `controls.css:40–49`, `ui.css` (pressed style).
- **Steps:** per DESIGN.md precedence (P0.1): per-row save → `variant="secondary" size="sm"`, disabled until the row
  changed (D14; no bulk save); session-rules saves secondary except the main form's; matching save secondary,
  «مقارنة» the tab's primary, head «تسجيل دفعة» stays (a named exception, ADR 0021 D2); «استعلام» secondary in both
  create screens; ticket «إكمال» always `primary` with `.ui-btn[aria-pressed='true']` style (new rule in `ui.css`:
  inset ring + darker fill), «رفض» / «إلغاء» stay `danger` (D13), the open complete form's submit (`:231`) stays
  `primary` (a named exception, ADR 0021 D2 (2)); «تعبئة حساب» secondary on home and primary only on
  `/users`' owner page (rule "primary only in the page that owns it": on `/finance` it becomes secondary); destructive: picture removal `danger`, offer
  delete → RowMenu danger item (the add-on delete button, `package-addons.tsx:79`, and the draft delete, `add-package-screen.tsx:215`, become
  `<Button variant="danger" size="iconSm">` in **P3.3**, which owns those lines; reviewers of P3.2 do not flag them, and
  3.5-09 is checked closed at the P3 gate after both slices); «إيقاف التحقق
  بخطوتين» `danger`; «إلغاء» there `secondary`; reconciliation row actions → one RowMenu; return-from-impersonation bar
  button → `secondary` look on the bar (stays visible; B17); `.link-btn` «الرجوع للموروث» → `<Button variant="ghost"
  size="sm">` (check other `.link-btn` users first).
- **Closes:** 3.5-02, 3.5-03, 3.5-04, 3.5-05, 3.5-06, 3.5-09, 3.5-17, 3.5-23, 3.5-24, 3.5-26, 3.5-28, 3.9-06, 3.9-10,
  3.9-21.
- **Risks:** demotions are visible by design (DESIGN.md already says so after P0.1); the per-row disabled state needs
  the row's draft vs saved values (`setDraft` in packages-screen) — read-only change, no behaviour change.
- **Verify:** count crimson buttons per view with a script on every route (≤1, except documented dialogs and the three
  named exceptions of ADR 0021 D2 / `DESIGN.md` Components → Primary button: each takeable row's own `sm` «أخذ المهمة»
  on `/tasks`; on `/tasks/[id]` take beside «إكمال» in the head on an unassigned task, and the open complete form's
  «إكمال» and the note composer's «إضافة ملاحظة» beside the head's primaries; a tab's main form beside the head action — `/companies/[code]`
  «الإعدادات» tab «حفظ» beside «إضافة رزمة», `/provider-accounts/[code]` «المطابقة» tab «مقارنة» beside «تسجيل دفعة»)
  at 1280;
  click each changed button. E2E: `branch-packages.spec.ts`, `session-rules.spec.ts`, `reconciliation.spec.ts`,
  `add-from-provider.spec.ts`, `task-notes.spec.ts`, `tasks-desk.spec.ts`, `home-overview.spec.ts`,
  `finance-head.spec.ts`, `offers.spec.ts`, `addons.spec.ts`, `sign-in-methods.spec.ts`, `inherited-modes.spec.ts`,
  `packages-terms.spec.ts` (agent and pos `/packages`: the row save becomes secondary and disabled until changed; the
  spec fills the field first, so it should pass — re-read it), `activation-request-key.spec.ts`.
- **Commit:** `fix(web): one primary action per view, danger for destructive, pressed state for the ticket (UI maintenance P3.2; closes 3.5-02, 3.5-03, 3.5-04, 3.5-05, 3.5-06, 3.5-09, 3.5-17, 3.5-23, 3.5-24, 3.5-26, 3.5-28, 3.9-06, 3.9-10, 3.9-21; D2, D13, D14)`

### P3.3 IconButton

- **Files:** `components/dialog.tsx:133`, `components/filter-bar.tsx:147`, `features/lines/line-details.tsx:125–127`,
  `features/catalog/screens/add-package-screen.tsx:214–215`, `features/catalog/package-addons.tsx:79`,
  `dialog.css` (`.dialog > header .icon-btn` :111–118), `desk/numbers.css:119`, `ui.css` (`.ui-btn-icon`,
  `.ui-btn-icon-sm`).
- **Steps:** replace each raw `.icon-btn` in features/dialog/filter drawer with `<Button variant="ghost" size="icon">`
  (copy: `iconSm`; addon delete: `variant="danger" size="iconSm"`). Note: the add-on delete at `package-addons.tsx:79`
  is **not** a raw `.icon-btn` — it is already `<Button variant="outline" size="sm">` (P3.1 makes it secondary); this
  slice changes it to `variant="danger" size="iconSm"` like the draft delete. Delete the context rules the raw
  buttons used; keep `.icon-btn`
  for shell icons only (`app-shell.tsx:362`, `chrome.tsx:20`). Icon colour at rest `--rd-muted` (A5 handled in P6.4 —
  here use the Button's ghost colour). Touch 44px comes in P6.5 on `.ui-btn-icon*` itself.
- **Closes:** 3.6-01, 3.5-16. (3.10-29 starts here — the delete buttons become `size="iconSm"`; the defect, a 32–34px
  touch width, closes in P6.5.)
- **Verify:** dialog close, filter drawer close, copy, delete: size 36/28, focus ring, hover. E2E `dialog-focus.spec.ts`
  (locators by role, update if by class), `addons.spec.ts`, `add-from-provider.spec.ts`.
- **Commit:** `feat(web): icon-only actions are Button size icon (UI maintenance P3.3; closes 3.6-01, 3.5-16)`

### P3.4 Icons: sizes in CSS, lucide only

- **Files:** `base.css:22` (`svg { width:16px; height:16px; stroke-width:1.9 … }`), call sites with dead `size=` /
  `strokeWidth=`: `features/roles/screens/roles-screen.tsx:126`, `features/desk/home-top.tsx:25,30,175`,
  `features/lines/screens/line-card-screen.tsx:44`, `features/lines/line-details.tsx:74,88,112,136`,
  `features/tasks/screens/tasks-screen.tsx:108`, `features/catalog/package-addons.tsx:80`,
  `features/wallets/screens/finance-screen.tsx:180` (+ `grep -rn "size={\|strokeWidth" features components`);
  `components/row-menu.tsx:17` (Glyph), `components/icon.tsx` (Icon), `components/table-search.tsx:15` (SearchIcon),
  `features/auth/screens/login-screen.tsx:134–145` (UserMark, LockMark), `features/auth/sign-in-methods.tsx:229–231`
  (KeyIcon), `features/auth/screens/settings-screen.tsx:234–236` (DeviceIcon); new `components/icons.tsx`.
- **Steps (conflict 7 — remove props first, never enable them all at once):** (1) keep the global rule but read
  tokens: `svg { width: var(--rd-icon-md); height: var(--rd-icon-md); stroke-width: 1.9 }`. (2) For every call site that
  wanted a non-16 size, add a context rule (`.grant svg { width: var(--rd-icon-sm) … }`, `.change svg`, `.task-mark svg`,
  `.ld-* svg` …) with the size the design shows **today in the prototype comment / DESIGN.md**; where the intended
  size is unknown keep 16 (no visible change) and delete the prop. (3) Delete every dead `size=` / `strokeWidth=`.
  (4) Map RowMenu `Glyph`, `Icon`, `SearchIcon` and the four auth/settings glyphs to lucide (`User`, `Lock`,
  `KeyRound`, `Monitor`, …); a glyph lucide lacks (sim) moves to `components/icons.tsx`. Donut keeps its override.
- **Closes:** 3.1-06, 3.6-04, 3.1-29.
- **Risks:** stroke weight differences on the sign-in page (approved design) — compare screenshots 1:1 at 1280.
- **Verify:** measure every `svg` box on 10 routes before/after (only intended ones change). E2E: `login.spec.ts`,
  `shell-a11y.spec.ts`.
- **Commit:** `refactor(web): icon sizes set in CSS from tokens, lucide glyphs only (UI maintenance P3.4; closes 3.1-06, 3.6-04, 3.1-29)`

### P3.5 Marks and company marks

- **Files:** graphite-moved rules for 36px marks (were :672, :785, :1067), `.account-mark` (twice), `.identity-mark`
  (52 vs 44px; :1083), `.dialog-mark` (`dialog.css:91,98` round vs cut), `desk/table.css:65`; `components/mark.tsx`
  (new), `components/company-mark.tsx` (new, wraps `lib/company-mark.ts` `markColor`); call sites
  `features/catalog/screens/packages-screen.tsx:123,183–185`, `features/catalog/screens/companies-screen.tsx:53`,
  `features/catalog/screens/company-screen.tsx:146`, `features/lines/screens/numbers-screen.tsx:197`,
  `features/catalog/screens/package-sheet-screen.tsx:413`, `features/lines/screens/line-card-screen.tsx:408`.
- **Steps:** one `.mark` class with modifiers `.mark-sm|md|lg` (28/36/48), `.mark-cut`, `.mark-round`, tone modifiers
  (`.danger`, `.success`, accent); delete the three identical 36px rules; `<CompanyMark company size>` renders `.co-mark`
  (picture or letters on `markColor`, cut corner) everywhere — the packages list's `.company-logo/.company-mark`
  becomes `.co-mark` (DESIGN.md:249), package sheet uses the picture when present, the line card passes `markColor`.
  `.pack-pick` mark size changes with it (P3.6).
- **Closes:** 3.6-03, 3.6-08, 3.3-13.
- **Risks:** `.company-card` stays (documented); `.co-mark` inside `.data` needs the 36px size modifier before the old
  classes go. `tests/company-mark.spec.ts` (contrast ≥4.67:1) must still pass.
- **Verify:** every route with a company mark (numbers, packages ×3 doors, companies, company, package sheet, number
  card, users/[login] packages tab) at 390/1280; ar-dark/en-light. E2E: `company-mark.spec.ts`, `companies-shelf.spec.ts`,
  `numbers-desk.spec.ts`, `branch-packages.spec.ts`.
- **Commit:** `feat(web): one Mark and one CompanyMark (UI maintenance P3.5; closes 3.6-03, 3.6-08, 3.3-13)`

### P3.6 Pane, clickable cards, PickCard

- **Files:** `components/pane.tsx` (new: `Pane`, `PaneHead` with `title`, `count`, `hint` + `placement` (D17), `actions`),
  `features/desk/overview.tsx:19` (`Card`); in this slice migrate **only** the four panes the report names
  (`settings-screen.tsx:197`, `wallet-head.tsx:71`, `task-ticket-screen.tsx:151`, overview `Card`) — the remaining
  hand-written panes (28 `className="pane-head"` in 15 files, 66 `className="pane"`/`"pane …"` in 38 files on
  2026-11-13) move in P4.5/P4.6 where those slices touch them and are swept to zero by **P4.10**;
  clickable card base (`.co-card`, `.pack-card`, `.company-card`: `desk/packages.css:43`, rules moved from graphite
  :654/:978) → one `.card-link` recipe + modifiers (do not edit the `.stat …` group selector, C9 note);
  `components/pick-card.tsx` (new) replacing `.pack-pick` (`line-card-screen.tsx:407`) and `.pick-card`
  (`add-package-screen.tsx:162–167`, `add-company-screen.tsx:125–134`) inside a `role="radiogroup"` with roving
  tabindex and arrow keys (pattern in `components/tabs.tsx`); `.pick-card` reserves the tick space in every card
  (`padding-inline-end: var(--rd-pick-tick-space)` on all, not only `.on`, R26 — a new token `--rd-pick-tick-space: 34px`
  defined in `tokens.css` and DESIGN.md Scales in this slice, since guard (k) is at 0 from the P2 gate); section title style: `PaneHead` h2 = `--rd-text-base` / 700
  (Y5 — 13px sub-titles that are deliberate become `.pane-subhead`).
- **Closes:** 3.6-09, 3.6-10, 3.10-18, 3.10-31, 3.2-26, 3.7-05. (3.6-17 starts here; closed in P4.10.)
- **Risks:** DESIGN.md excepts `.pack-pick` — update; `PickCard` in the dialog at 375 (two a row). `.pack-pick` and
  `.line-op` are also used by the local audit scripts (`audit/operations.audit.ts:142` `.pack-pick`,
  `audit/screens.audit.ts:52` and `operations.audit.ts:130` `.line-ops`; `npm run audit`, not in CI) and by
  `tests/tools-pages.spec.ts` (`.line-op`, `.line-op-grid`): update the `.pack-pick` locator to the PickCard's role
  (`getByRole('radio', { name })`) in the same slice.
- **Verify:** keyboard: Tab into a radiogroup, arrows move and select, focus visible; 375/1280 ar-dark/en-light/he-light.
  E2E: `add-from-provider.spec.ts`, `detail-desk.spec.ts`, `home-overview.spec.ts`, `activation-result.spec.ts`,
  `tools-pages.spec.ts`, `finance-head.spec.ts` and `users-desk.spec.ts` (they locate `.pane-head` / `.figure-tile`);
  local audit script `audit/operations.audit.ts` (locator updated, not run).
- **Commit:** `feat(web): Pane, one clickable-card recipe and PickCard radios (UI maintenance P3.6; closes 3.6-09, 3.6-10, 3.10-18, 3.10-31, 3.2-26, 3.7-05)`

### P3.7 Fields and labels

- **Files:** `components/field-row.tsx` (new), call sites `features/catalog/screens/package-sheet-screen.tsx:476`,
  `features/catalog/screens/provider-packages-screen.tsx:182`, rules `desk/packages.css:105`, `desk/pane.css:154`,
  moved graphite :1266; `features/auth/session-rules.tsx:64,82` → `RangeField` (in `components/range-field.tsx` or
  `features/auth/`), `.role-input` (34px) vs `.gauth-box` (44px) → one framed-field **recipe** (border, radius, background, focus halo)
  shared by both; heights do **not** change: the desk field keeps the md height 34px (44px under 767 from P6.5) and the
  sign-in box keeps 44px as a documented sign-in modifier (`.gauth-box`), so neither the role dialog nor the sign-in
  field is resized; labels: `dialog.css:178–179`,
  `forms.css:15–16`, `desk/pane.css:67`, `desk/filters.css:70`, auth label rule, `desk/tasks.css:54`,
  `desk/numbers.css:71`, `desk/users.css:77`, `features/tasks/components/decision-dialog.tsx:119,125`; legends
  `dialog.css:153,196`; form rhythm `dialog.css:176`, `forms.css:10,13`, `desk/pane.css:66`, `.account-form`;
  `features/catalog/chain-board.tsx:52,66–67`.
- **Steps:** `.field-row` one rule (gap `--rd-space-2`), delete the context button rules (C13); field label: one style
  `--rd-text-xs` / 600 / `--rd-muted` on the container rules (not on the bare `label` element, Y6 note), sign-in label a
  documented modifier; **one `dt` style** (Y6's second half: three dt values today — `.detail-rows dt` 12px/600
  `numbers.css:71`, `.ld-item dt` xs/600 `numbers.css:114`, `.fact-card dt` sm/500 `users.css:77`, `.po-facts dt`
  xs/700 moved graphite :734, `.task-facts dt` `tasks.css:52`): `--rd-text-xs` / 600 / `--rd-muted`, the same as the
  field label, on those container rules (P3.8's Facts `rows` then uses it; `.fact-card dt` keeps `-sm` only if the
  executor shows it is a card title, documented); `.hint` "(مطلوب)" → `--rd-text-xs` / 500; one legend style; `--rd-form-gap` / `--rd-field-gap`
  applied to dialog and form containers; pane forms per **D21**: (a, recommended) keep today's 8px as a named token
  `--rd-form-gap-pane` (no visible change; the two rhythms are documented as two roles in DESIGN.md); (b) unify to
  `--rd-form-gap` 14px (visible, listed in the spec, CHK-LOOK measures every pane form). Chain-board labels one style
  and `role="group"` on the labelled div (A30).
- **Closes:** 3.6-13, 3.6-35, 3.7-06, 3.7-07, 3.7-22, 3.4-06, 3.10-30.
- **Risks:** long dialogs (role dialog) may start to scroll — check at 768×700.
- **Verify:** measure label font/weight/colour in dialog, pane, filter, sign-in on 8 routes. Also measure the
  font-size, weight and line-height of the **text inside every input and textarea** that sits in a label this slice
  restyles (found in P0.2: fields inherit the label's font through `font: inherit` — the offer body and the decision
  note are typed at 11px/700 from `dialog.css:178`, the «التفاصيل» textarea at 11px/600 while the pane inputs beside
  it are 13px from `desk/pane.css:68`); record each before/after, and list any field whose typed text changes as a
  visible change. E2E: `session-rules.spec.ts`,
  `package-sheet-drafts.spec.ts`, `transfer.spec.ts` (44px label assertion), `name-field.spec.ts`.
- **Commit:** `feat(web): one field row, one label style, one form rhythm (UI maintenance P3.7; closes 3.6-13, 3.6-35, 3.7-06, 3.7-07, 3.7-22, 3.4-06, 3.10-30)`

### P3.8 Stat lead, value tone, FigureTile, Facts rows

- **Files:** `components/stat.tsx`, `desk/components.css` (Stat), `components/facts.tsx:11`, new `components/figure-tile.tsx`
  (`FigureTile`, `FigureBand`, `CeilingTicks`) from `features/wallets/wallet-head.tsx:42`, `features/desk/home-top.tsx:73`,
  `desk/users.css:78`; `features/catalog/screens/package-sheet-screen.tsx:435` (`.sheet-stats` → `StatRow`);
  `features/lines/line-details.tsx:87,103,113` (`<dl>` → `Facts` density `rows`, A32 valid dl; the usage ring's raw
  `<svg className="ld-ring-track">` at :87 → new `components/usage-ring.tsx`), `features/tasks/components/provider-operation-panel.tsx:56,70`;
  `docs/architecture/frontend.md` (FigureTile, FigureBand, CeilingTicks, UsageRing);
  screens: `features/providers/reconciliation.tsx:158–168`, `features/providers/screens/provider-account-screen.tsx:116`,
  `features/accounts/screens/account-screen.tsx:305`, `features/wallets/screens/provider-operations-screen.tsx:113–116`,
  `features/reports/screens/report-pages.tsx:75–77`, `features/wallets/screens/profits-screen.tsx:53`,
  `features/audit/screens/audit-screen.tsx`.
- **Steps:** `Stat` gains `lead` (one per row: larger value `--rd-text-figure-lg`, accent top thread) and `valueTone`
  (colours the value; `tone` keeps colouring the icon — do not repaint every value, H29 note); remove the `.tone-*`
  hand wrappers in report pages. FigureTile/Band replaces the nine `.figure-tile` copies (same markup, one component).
  Facts `rows` density for line details and the provider-operation panel (Alert for errors, Spinner for loading; `.po-money`
  keeps inline children). Screens: reconciliation difference first, `valueTone` danger/warning when ≠ 0, the rest
  compact; account «المتاح للبيع» first, «المستعمل» merged into the ceiling card; provider operations «المطابَق» ink;
  report pages: the first figure is the lead (one documented rule). **One figure scale (C2):** Stat, FigureTile and
  the package sheet's stats (via `StatRow`) show the value at `--rd-text-figure` / 700; a lead at
  `--rd-text-figure-lg` / 700; compact figures (Facts cards and `rows`) at `--rd-text-figure-sm` / 600; value colours
  use one set of names (`valueTone`: `success | warning | danger | accent | muted`, the Badge tone names) — visible:
  `.sheet-stats` 1.5rem/800 → 1.45rem/700, Facts cards 18px → 1.2rem (listed in the spec). **Usage ring:** extract
  `UsageRing` (`components/usage-ring.tsx`, renders the track `<svg>` and the icon, `aria-hidden`) and use it in
  line-details' `Meter`, so no raw `<svg>` stays under `features/` for P3.13 (P4.7 later adds its "awaiting" modifier
  through it). DESIGN.md: KPI section, Figure band (`FigureBand` exists now; `Sparkline` replaced by `TrendLine` —
  C26), the figure scale above.
- **Closes:** 3.6-02, 3.6-11, 3.9-09, 3.9-13, 3.9-28, 3.9-29. (3.10-32 starts here — the dt/dd markup becomes valid;
  its second half, the silent copy button, closes in P6.7.)
- **Verify:** 375/768/1280, ar-dark/en-light/he-light on `/`, `/finance`, `/wallet`, `/users/[login]`,
  `/provider-accounts/[code]` (matching tab), `/provider-operations`, `/profits`, `/reports/balances`, `/audit`,
  `/numbers/[id]` details. E2E: `reconciliation.spec.ts`, `account-head.spec.ts`, `finance-head.spec.ts`,
  `home-overview.spec.ts`, `profits.spec.ts`, `provider-operation.spec.ts`, `reports-hub.spec.ts`, `expiring.spec.ts`.
- **Commit:** `feat(web): Stat lead and value tone, one FigureTile, Facts rows, one usage ring (UI maintenance P3.8; closes 3.6-02, 3.6-11, 3.9-09, 3.9-13, 3.9-28, 3.9-29)`

### P3.9 EmptyState and its uses

- **Files:** `components/empty-state.tsx:14` (+ `tone`, `role`, `actions`, `compact`), `components/load-failed.tsx:15`,
  `app/error.tsx:21`, `app/not-found.tsx:15`; empties as text: `features/catalog/screens/package-sheet-screen.tsx:391`,
  `features/tasks/screens/task-ticket-screen.tsx:269,337`, `features/lines/screens/line-card-screen.tsx:401`,
  `features/catalog/screens/add-package-screen.tsx:159`, `features/catalog/screens/add-company-screen.tsx:122`,
  `features/providers/reconciliation.tsx:174`, `features/auth/sign-in-methods.tsx:196`.
- **Steps:** extend EmptyState; LoadFailed / error / not-found use it (OutagePanel untouched); replace the eight text
  empties (`compact` inside dialogs). Rewrite `.cursor/rules/content-ui.mdc:23` ("Empty: `.empty` inside the pane…") to
  "Empty: `EmptyState` (`compact` in dialogs); never a bare `<p className="empty">`" (working-tree precondition).
- **Closes:** 3.6-23, 3.6-12.
- **Verify:** empty states on each listed screen (use the dom-snapshot empty cases / an empty account) at 390/1280.
  E2E: `not-found.spec.ts`, `error-codes.spec.ts`, `session-outage.spec.ts`, `tools-pages.spec.ts` (uses `.empty`).
- **Commit:** `feat(web): EmptyState with tone and actions everywhere a list can be empty (UI maintenance P3.9; closes 3.6-23, 3.6-12)`

### P3.10 Create-flow pieces

- **Files:** `features/catalog/screens/add-package-screen.tsx` (:141, :187, :204, :208–215, :230, :242),
  `features/catalog/screens/add-company-screen.tsx` (:104, :149, :166), `features/catalog/package-addons.tsx`,
  `features/catalog/screens/company-screen.tsx:170,192–198`, `features/offers/screens/offers-screen.tsx:157`,
  `features/providers/reconciliation.tsx:120`; new `StepPane`, `SimRulesFields`, `AddonRows`, `FilePickButton`
  (in `components/` or `features/catalog/`); moved step spacing rules (were graphite :1263, :1291).
- **Steps:** `<StepPane n title>` for the seven step heads (numbering from the rendered order, conditional steps
  renumber); step spacing: delete the double margin (L24; confirm `.add-actions` is not inside a pane body);
  `SimRulesFields` with `disabled`, eSIM as `LiveSwitch` that does not save on toggle in the create path (D18);
  `AddonRows` shares layout only (PriceField saves on blur in the package page — behaviour unchanged);
  `FilePickButton` (accepts a ref for the company upload) wraps the hidden input in `.file-pick` (focus ring, A17).
- **Closes:** 3.6-31, 3.3-24, 3.6-15, 3.3-22, 3.6-14, 3.5-27, 3.10-17.
- **Verify:** both create flows end to end at 375/1280 (no save), keyboard focus on file pickers. E2E:
  `add-from-provider.spec.ts`, `addons.spec.ts`, `offers.spec.ts`, `companies-shelf.spec.ts`.
- **Commit:** `feat(web): StepPane, shared SIM rules, add-on rows and one file picker (UI maintenance P3.10; closes 3.6-31, 3.3-24, 3.6-15, 3.3-22, 3.6-14, 3.5-27, 3.10-17)`

### P3.11 Sign-in methods and device lists

- **Files:** `features/auth/screens/two-factor-screen.tsx:113`, `features/auth/sign-in-methods.tsx:110,197,207`,
  `features/auth/screens/settings-screen.tsx:199,210`, `features/accounts/user-settings.tsx:115`,
  `features/auth/two-factor-policy.tsx:92`, moved rules (graphite :1019 `.settings-block h3` 13.5px, :1448, :1485).
- **Steps:** `TwoFactorEnroll` shared (cards stack at 375; `MethodField` not merged); `DeviceList` / `DeviceRow` for
  sessions and passkeys with one action pattern: «إنهاء الجلسة» and passkey delete as RowMenu danger items (B10);
  `PolicyBlock` for the role dialog and the account tab (keep the −8px pull as a token calc).
- **Closes:** 3.6-18, 3.6-19, 3.6-20, 3.5-10.
- **Verify:** `/settings`, `/two-factor` (enrol state), `/users/[login]` settings tab, role dialog, at 375/1280.
  E2E: `sign-in-methods.spec.ts`, `session-rules.spec.ts`, `logout.spec.ts`.
- **Commit:** `feat(web): shared two-step enrolment, device list and policy block (UI maintenance P3.11; closes 3.6-18, 3.6-19, 3.6-20, 3.5-10)`

### P3.12 Small shared pieces

- **Files:** `components/seg.tsx` (new; from `ModeSeg` `components/desk.tsx:72`, `components/mode-cards.tsx:59`,
  `features/accounts/screens/account-screen.tsx:219`, `features/auth/two-factor-policy.tsx:47`),
  `components/days-left.tsx` (new; `line-card-screen.tsx:70`, `numbers-screen.tsx:228`), `lib/status-tone.ts`
  (`onOffTone` + one mapper for Facts good/warn ↔ Badge success/warning; `company-packages.tsx:77`,
  `package-sheet-screen.tsx:420`, `provider-accounts-screen.tsx:38`, `matching-pane.tsx:40`),
  `features/wallets/wallet-head.tsx:77` + `features/reports/report-kit.tsx:18` (`Period` `options`, typed so the wallet
  cannot offer "today"), `features/providers/reconciliation.tsx:137` (`<DataTable bare>`, unique column keys),
  `components/ui/badge.tsx` (`size` sm/md; `ui.css:61`, moved graphite :56/:642), `components/desk.tsx:70`
  (`OutcomePick` inline `style={{ gap: 4 }}` → `.outcome-pick { gap: var(--rd-space-1) }`, 4px, the value that
  renders today — the inline style beats graphite :526's 8px), `components/donut.tsx:62` (the inline
  `animationDelay: index * 70ms` → `--i: index` on the slice and `animation-delay: calc(var(--rd-stagger) * 1.75 *
  var(--i))` in the donut rule, which keeps 70ms per slice; no timing change).
- **Steps:** as listed; `Seg` supports `radiogroup` and `group/aria-pressed` semantics explicitly (`role` prop).
- **Closes:** 3.6-22, 3.6-28, 3.6-16, 3.6-33, 3.6-29, 3.7-10, 3.1-23, 3.4-15.
- **Verify:** each component on its pages (CHK-LOOK set); badge row heights stay 38px; the outcome pick's gap reads
  4px and each donut slice's computed `animation-delay` reads `0s, 0.07s, 0.14s…`, as before. E2E: `inherited-modes.spec.ts`,
  `expiring.spec.ts`, `reconciliation.spec.ts`, `finance-head.spec.ts`, `numbers-desk.spec.ts`.
- **Commit:** `feat(web): Seg, DaysLeft, one on/off tone, period options, badge sizes (UI maintenance P3.12; closes 3.6-22, 3.6-28, 3.6-16, 3.6-33, 3.6-29, 3.7-10, 3.1-23, 3.4-15)`

### P3.13 ESLint rule for feature markup

- **Goal:** stop feature screens from bringing back raw buttons, ad-hoc icon buttons and hand-made tiles once P3 has replaced them, by a lint rule that fails CI.
- **Files:** `eslint.config.mjs`.
- **Steps:** (0) **dry run first:** run the selectors below before adding them to the config, with a scratch config
  outside the repo tree's committed files: copy `eslint.config.*` to the scratchpad, add the
  `no-restricted-syntax` selectors there, and run `npx eslint -c <scratch config> features` (or one selector at a time
  with `npx eslint --rule '{"no-restricted-syntax": ["error", {"selector": "…"}]}' features`); keep the scratch
  config out of the commit, and list every remaining hit with the slice that owns it; expected 0 (the four auth/settings glyphs went in
  P3.4, the usage ring in P3.8, `.icon-btn` in P3.3, `<dl>` in P3.8, empties in P3.9). A hit that no earlier slice
  owns stops the slice and goes to the orchestrator (escalation; the executor does not fix another slice's work).
  (1) `no-restricted-syntax` for `files: ['features/**/*.tsx']`: `JSXAttribute[name.name='className'][value.value=/\bicon-btn\b/]`,
  `JSXOpeningElement[name.name='dl']`, `JSXOpeningElement[name.name='svg']`,
  `JSXOpeningElement[name.name='p']:has(JSXAttribute[name.name='className'][value.value=/\bempty\b/])`, each with a
  message naming the component to use. Template-literal classNames: also restrict `TemplateElement[value.raw=/\bicon-btn\b/]`.
- **Closes:** none (guard for س5); must report 0 hits. (P4.10 adds the hand-written pane selectors to this rule once
  the last pane is migrated; adding them here would fail lint while P4 is still migrating.)
- **Verify:** CHK-LOCAL; a scratch violation fails lint (then revert).
- **Commit:** `feat(web): lint stops hand-written icon buttons, dl, svg and empty lines in features (UI maintenance P3.13)`

### P3.14 Shell popovers, menus and the folded rail

- **Goal:** put the shell's popovers, menus, notices and folded rail on the shared popup, icon and type tokens, so their offsets, fonts and sizes match the rest of the system.
- **Files:** `shell.css` (`.shell-panel` :342–352, `.menu` :612–623, notices :558–572, search desk popup :727/:750,
  `.side-flyout`, offsets :345, :348, :377, :561, :568, :575, :615, :618, :630, :214–216, nav rows :53, :109, :123,
  :177, :194, menu fonts :128, :155, :216, :221, :382, :633, group titles :112, :213, :215, :574), notice title rules
  (moved graphite :1069–1071; `shell.css:402,432–435,476–477`), `components/app-shell.tsx:550`.
- **Steps:** one popover frame base (`--rd-radius-lg`, offset `--rd-popup-offset`, frame padding `--rd-popup-pad`,
  item padding `--rd-popup-item-pad`; notice rows change only their inline padding, S5 note); menu item type
  `--rd-text-base` / 600 for popups (nav links keep their own role); one small group-title style (`--rd-text-xs` / 700,
  no letter-spacing — Y13 also); notice title 600 unread 700 / `-sm` / `-xs`, one line with ellipsis; folded rail icon
  centred: `.sidebar.collapsed .nav-link { padding-inline: calc((100% - var(--rd-icon-nav)) / 2) }` (S4; check
  `.holds::before`, `.nav-count`). Sidebar row edges (S4's other half: 9/12/6/8px today) **stay as they render**,
  each on its P1.7 named token per D6 a — unifying them is D6 b, out of scope; DESIGN.md says so. Last slice of P3: run `node docs/architecture/generate.mjs` and commit the
  regenerated boards with this slice (G5).
- **Closes:** 3.3-27, 3.4-05, 3.4-04, 3.7-11, 3.7-12, 3.7-15.
- **Verify:** open every topbar/sidebar popup (search, notices, account, language, flyout) at 390/1280 and folded rail at
  1280, ar-dark/en-light/he-light; measure frame radius/padding. E2E: `shell-a11y.spec.ts`, `topbar-narrow.spec.ts`,
  `transfer-notices.spec.ts`, `crumbs.spec.ts`.
- **Commit:** `fix(web): one popover frame, one menu type, a centred folded rail (UI maintenance P3.14; closes 3.3-27, 3.4-05, 3.4-04, 3.7-11, 3.7-12, 3.7-15)`

---

## P4 — Page templates and screens

### P4.1 Desk API

- **Files:** `components/desk.tsx`, `desk/frame.css` (`.desk > .page-head` :28–41), `lib/page-title.ts` (read only),
  DESIGN.md (Page templates), `docs/architecture/frontend.md`, `.cursor/rules/content-ui.mdc` (Page title bullet :12:
  "`Desk` renders the head: one `h1`, an optional lede node in the title column, actions at the inline end").
- **Visible:** today the head is h1, then the action, then a full-width lede row; after this slice the lede sits under
  the h1 in the title column and the actions sit at the inline end. This is in the spec's "What changes for users" and
  in the commit body.
- **Steps:** `Desk` props: `className?: string` (added to the root `div.desk`, e.g. `settings-page desk` for P4.2),
  `title: ReactNode`, `pageTitle?: string` (tab title; defaults to `title` when a string —
  conflict 9), `lede?: ReactNode`, `actions?: ReactNode` (wrapped in `.page-actions`), `actionsClassName?: string`
  (added to that wrapper, e.g. `sheet-head-actions` for the package sheet). Keep `action` as a deprecated alias
  until P4.10: **the alias renders unwrapped, exactly as today** (`{action}` in the head, no `.page-actions` added),
  so the callers that already pass their own `<div className="page-actions">` (on 2026-11-13: `offers-screen.tsx:116`,
  `wallet-screen.tsx:45`, `finance-screen.tsx:143`, `account-screen.tsx:149`, `provider-account-screen.tsx:107`,
  `package-sheet-screen.tsx:418`) get no double wrapper; only `actions` is wrapped. **P4.10 deletes the alias** and
  updates `tests/desk-head.spec.ts:12`, which asserts the source contains `action?:`. The source must keep the
  literal `{lede ?` (asserted by `tests/desk-head.spec.ts:13` today and again after P4.10): write the lede as
  `{lede ? <p className="lede">…` or an equivalent expression that keeps that text, not `lede &&`. `error?: string | string[]`, `note?: string`,
  `state?: 'ready' | 'loading' | 'notFound' | 'blocked'` (loading → `PageSkeleton`; notFound → Pane + EmptyState +
  back link; blocked → `Alert` with the permission sentence, never `note`, L17 note). Head markup:
  `<header class="page-head"><div class="page-head-text"><h1/>{lede}</div><div class="page-actions">…</div></header>`;
  CSS: the lede sits in the title column (no full-row `flex-basis: 100%`), actions at the inline end, wrapping under
  the title on narrow widths. `sheet-head-actions` stays an extra class where used (no double wrapper, L25 note).
- **Closes:** 3.3-25.
- **Risks:** moving the lede into the title column changes every head — check heads with long buttons at 375
  (`/users/[login]`, `/companies/[code]/packages/[pkg]`, `/tasks/[id]`), and that `.settings-grid` rules still apply.
- **Verify:** every route's head at 375/768/1280, ar/en/he; measure the first pane's top before/after on every page.
  E2E: `desk-head.spec.ts`, `detail-desk.spec.ts` (pane box), `account-head.spec.ts`, `finance-head.spec.ts`,
  `numbers-desk.spec.ts` (lede text).
- **Commit:** `feat(web): Desk takes a lede node, an actions slot and a page state (UI maintenance P4.1; closes 3.3-25)`

### P4.2 Home, settings and number card through Desk

- **Files:** `features/desk/screens/home-screen.tsx:55–75`, `features/auth/screens/settings-screen.tsx:117–125` (+ its
  toast copy, outage bypass), `features/lines/screens/line-card-screen.tsx:174–186` (`lede=""`, `.line-hero`), moved
  `.line-hero` rules, `.home-head`.
- **Steps:** home → `<Desk title lede actions={period + buttons}>`; settings → `<Desk className="settings-page" error={[error,
  profile.error, sessionList.error, methods.error]}>` (one alert line; outage handled by Desk); number card → `lede`
  node (company · package · point-of-sale link), delete `.line-hero`. `PageAlert` renders its children directly (its
  wrapper is a context provider, no DOM node), so `.settings-page > .settings-grid` (`responsive.css:31`,
  `settings.css:5`) keeps its direct-child relation — check it in the DOM. Settings shows its error with
  `<Alert banner>` today and `Desk`/`PageAlert` uses a plain `<Alert>`: a small visible change (listed in the spec).
- **Closes:** 3.3-01, 3.6-34, 3.3-02.
- **Verify:** the three pages at 375/768/1280 ar/en/he; errors injected with the browser's offline mode or a request
  interception (`page.route` → 500) — never by stopping the API on 3001 (machine-limits.mdc) — show one line. E2E:
  `home-overview.spec.ts`, `detail-desk.spec.ts`, `sign-in-methods.spec.ts`, `numbers-desk.spec.ts`.
- **Commit:** `refactor(web): home, settings and the number card use the Desk head (UI maintenance P4.2; closes 3.3-01, 3.6-34, 3.3-02)`

### P4.3 Loading, not-found and blocked states

- **Files:** `features/catalog/screens/packages-screen.tsx:364,380`, `line-card-screen.tsx:180`,
  `features/tasks/screens/task-ticket-screen.tsx:151,336`, `features/catalog/screens/companies-screen.tsx:87`,
  `features/accounts/screens/account-screen.tsx:128,189,192`, `features/offers/screens/offers-screen.tsx:111,127`,
  `features/accounts/screens/users-screen.tsx:144`, `features/wallets/screens/wallet-screen.tsx:39`,
  `features/branding/screens/branding-screen.tsx:52`, `features/catalog/screens/add-company-screen.tsx:97,102`,
  `features/catalog/screens/add-package-screen.tsx:132,138`, `features/reports/screens/report-pages.tsx:51`,
  `features/reports/screens/report-screen.tsx:88`; `components/data-table.tsx` / `PagedTable` (loading prop);
  `desk/components.css:153` (skeleton row height).
- **Steps:** lists → `DataTable loading`; details → `Desk state="loading"`; records not found → `state="notFound"`;
  guarded → `state="blocked"`; delete empty `<header className="pane-head" />` (keep `.pane-head { min-height: 52px }`);
  skeleton row `min-block-size: var(--rd-row-h)` (S19; match touch heights).
- **Closes:** 3.3-03, 3.3-10, 3.3-17, 3.4-19.
- **Verify:** slow each screen's main endpoint (the built-in browser has no network throttle: a fetch wrapper
  injected before load that delays `/api/<endpoint>` by 3 s, or `page.route` with a 3 s delay as P8.1's loading state
  does; never a change to the API): no table jump (measure table top during and after load). E2E:
  `list-cache.spec.ts`, `not-found.spec.ts`, `tasks-desk.spec.ts`, `users-desk.spec.ts`.
- **Commit:** `fix(web): one loading, not-found and blocked frame (UI maintenance P4.3; closes 3.3-03, 3.3-10, 3.3-17, 3.4-19)`

### P4.4 FormActions — one save placement

- **Files:** `components/form-actions.tsx` (new), `features/catalog/screens/company-screen.tsx:210`,
  `features/accounts/user-settings.tsx:148`, `account-screen.tsx:269`, `features/catalog/package-details-form.tsx:128`,
  `settings-screen.tsx:169,187`, `features/catalog/screens/provider-packages-screen.tsx:182,195`,
  `features/providers/matching-pane.tsx:43`, `package-sheet-screen.tsx:402,475`, `features/auth/session-rules.tsx:153`,
  `features/branding/screens/branding-screen.tsx:177–181`, `features/catalog/package-addons.tsx:100`,
  `features/auth/sign-in-methods.tsx:130,150,221`, `add-package-screen.tsx:249`; rules `.form-save`, `.brand-foot`,
  `.add-actions` (moved graphite :848), `dialog.css` foot (read); DESIGN.md ("Page templates → create").
- **Steps:** `FormActions` (`align` = start for in-pane edit forms, `end` + stretch under 767 for multi-step create
  pages = `.add-actions`; a hairline only for forms with ≥3 fields — check each small inline form); order per D8
  (cancel/discard then save, cluster at the inline end in dialogs; in `.brand-foot` the discard joins the slot); single-field
  rows keep their inline button. Package price tab: move «حفظ» after the eSIM card (L12/B11/H20; ChainBoard children order
  in this screen only). H20's second half (two equal-weight cards after the save): the re-pricing card is **left as
  it is on purpose** — its button is already `secondary` (P3.2), and with «حفظ» moved after the eSIM card the price
  form reads as one block that ends in the only primary; no card is demoted. Recorded in the commit body.
- **Closes:** 3.3-04, 3.5-08, 3.6-30, 3.5-25, 3.3-12, 3.5-11, 3.9-20.
- **Create template (root cause س4):** this slice also writes DESIGN.md "Page templates → create": numbered
  `StepPane`s (P3.10) in reading order, one `FormActions` (`align="end"`, stretched under 767) after the last step,
  the single primary per D2; cite `add-package-screen.tsx` and `/companies/new` as the reference pages (as P4.5 and
  P4.6 do for list, detail and settings).
- **Verify:** every form listed (CHK-LOOK set); measure the save's x/y relative to the last field. E2E:
  `package-sheet-drafts.spec.ts`, `session-rules.spec.ts`, `sign-in-methods.spec.ts`, `user-terms.spec.ts`,
  `packages-roles-desk.spec.ts`.
- **Commit:** `feat(web): FormActions — the save after the fields it saves, one order (UI maintenance P4.4; closes 3.3-04, 3.5-08, 3.6-30, 3.5-25, 3.3-12, 3.5-11, 3.9-20)`

### P4.5 List template

- **Files:** `DESIGN.md:126` and `:255` (they say finance uses `WalletHead`; it does not — correct both to what
  finance renders after this slice, H27), `features/wallets/screens/finance-screen.tsx:151`, `features/tasks/screens/tasks-screen.tsx:165,170`,
  `users-screen.tsx:159–160,175`, `features/notices/screens/notices-screen.tsx:103`,
  `features/wallets/screens/profits-screen.tsx:42–45`, `features/wallets/screens/wallet-screen.tsx:53`,
  `features/audit/screens/audit-screen.tsx`, `features/wallets/screens/provider-operations-screen.tsx`,
  `features/reports/screens/report-pages.tsx:56`, `components/table-search.tsx`, new `components/filter-search.tsx`,
  `features/accounts/screens/packages-terms.tsx:148,166`, `features/reports/screens/report-screen.tsx:59–62,88`,
  `features/catalog/screens/packages-screen.tsx:390`, `features/offers/screens/offers-screen.tsx:122`, copy
  `lib/copy/{ar,en,he}.ts` (new ledes), moved filter/card-edge rules (were graphite :14, :157, :506).
- **Steps:** every pane this slice edits becomes `<Pane>` / `<PaneHead>` (P3.6) in the same change;
  document per page "separate" vs "attached" FilterBar (D16) in DESIGN.md; table titles = `PaneHead` (with
  count) or none — remove `.section-head` from list pages (`.ld-section-head` stays) and its lg/800 weight (H27);
  `FilterSearch` from the five icon-search copies (not `TableSearch`, L7 note; keep the width rule); tasks' search →
  `FilterSearch` (C26); packages-terms → `<FilterBar onClear clearLabel>` with the hint outside (L8, B7);
  `/reports/[kind]`: lede per kind, report-kit layout, `EmptyState`/`LoadFailed` instead of `null`, status as
  `<Badge dot>` (no CSV unless an export path exists); agent packages list lede (new copy key ×3); offers: the table
  first, the preview below in a Pane with a head (OfferHero shared with home — no change to it); one card edge token
  for filter chips, pane head and first/last cell (S3; do not widen every cell; under 1100 `table.css` keeps narrow
  cells).
- **Closes:** 3.3-05, 3.3-06, 3.9-27, 3.3-07, 3.6-26, 3.3-08, 3.5-07, 3.3-09, 3.9-14, 3.3-20, 3.3-23, 3.9-23, 3.4-03.
- **Verify:** every list route at 375/768/1280, ar/en/he; the filter drawer at 375; `npm run check:copy`. E2E:
  `lists-desk.spec.ts`, `tasks-desk.spec.ts`, `users-desk.spec.ts`, `packages-terms.spec.ts`, `reports-hub.spec.ts`,
  `profits.spec.ts`, `finance-head.spec.ts`, `offers.spec.ts`, `url-filters.spec.ts`.
- **Commit:** `fix(web): one list template — pane-head titles, one filter search, report kinds complete (UI maintenance P4.5; closes 3.3-05, 3.3-06, 3.3-07, 3.3-08, 3.3-09, 3.3-20, 3.3-23, 3.4-03, 3.5-07, 3.6-26, 3.9-14, 3.9-23, 3.9-27; D16)`

### P4.6 Detail and settings templates

- **Files:** `features/catalog/screens/package-sheet-screen.tsx:376,413–451`, `features/catalog/screens/company-screen.tsx:159`,
  `features/catalog/screens/provider-packages-screen.tsx:156,168`, `features/catalog/screens/packages-screen.tsx:142,407–414`,
  `features/tasks/screens/task-ticket-screen.tsx:162–187`, `features/accounts/screens/account-screen.tsx:137–142`,
  `desk/packages.css:32–36`, `desk/packages.css:137–140` (`.sheet-meta` label/value weights, H2).
- **Steps:** every pane this slice edits becomes `<Pane>` / `<PaneHead>` (P3.6) in the same change (the POS
  subscribe form below included); tabs render during loading (package sheet, like company); one detail wrapper
  (`.stack`) for all detail pages; facts not repeated from the head (package overview: one badge, provider once, counts via StatRow/Facts;
  ticket facts drop the 5 repeats; account lede drops the layer); provider «الإعدادات» tab = the company settings
  template (`.settings-block` inside a framed pane; change the class on this screen only — `.line-pane` stays for the
  number card); POS subscribe form: `section.pane > header.pane-head > h2` + `form.pane-body`; provider balance as
  `Money` in the head (H8); `.sheet-meta` labels 500 / `--rd-muted` and values 600 (700 only for a key value), per
  H2 (the number-card half of H2 is P4.7); provider group head: a scoped modifier with its mark (H7; do not change `.pane-head h2` /
  `.company-mark` globally); package sheet tabs show counts where a count exists (H19; no merge).
- **Closes:** 3.3-19, 3.3-18, 3.9-18, 3.9-24, 3.9-26, 3.3-11, 3.3-21, 3.9-08, 3.9-07, 3.9-19.
- **Verify:** the listed pages at 375/1280 ar/en/he incl. loading. E2E: `detail-desk.spec.ts`, `package-sheet-drafts.spec.ts`,
  `account-head.spec.ts`, `task-notes.spec.ts`, `branch-packages.spec.ts`, `tabs.spec.ts`.
- **Commit:** `fix(web): detail pages show tabs at once and each fact once (UI maintenance P4.6; closes 3.3-11, 3.3-18, 3.3-19, 3.3-21, 3.9-07, 3.9-08, 3.9-18, 3.9-19, 3.9-24, 3.9-26)`

### P4.7 Number card and line details hierarchy

- **Files:** `features/lines/line-details.tsx:34,74–136`, `features/lines/screens/line-card-screen.tsx:60,74,198–200`,
  `components/line-actions.ts:42` (read only), `features/lines/screens/numbers-screen.tsx:260,372`, `desk/numbers.css`
  (:82–116), `lib/` (new `EXPIRING_DAYS` constant beside the existing expiring window — reuse it if it exists:
  `grep -rn "EXPIR" lib features`).
- **Steps:** usage meters without data → "awaiting" modifier (muted, `-md`, 600; new class, H1); weights: 600 normal
  values, 700 key values, larger `.ld-title`, label 500/600 (H2); expiring: one colour (`--rd-accent` = crimson as the
  numbers table) from one constant, "انتهى" in `--rd-danger` for ≤0 days (H3; `.days.soon` not amber); operation grid:
  render danger items last after a divider in the screen (do not reorder `lineActions()`), extend first (H4);
  `OutcomePick` after the filters / at the grid's foot in the callers only (H5); section marks neutral like
  `.ld-item-mark`, crimson only for the period and the end (H17).
- **Closes:** 3.9-01, 3.9-02, 3.9-03, 3.9-04, 3.9-05, 3.9-17. (3.9-02's `.sheet-meta` part, `packages.css:138,140`,
  is done in P4.6, which edits that pane; this slice closes the finding.)
- **Verify:** `/numbers/[id]` (active, expiring in 2 days, expired, disconnected) and `/numbers` at 375/1280 ar/en/he.
  E2E: `expiring.spec.ts`, `numbers-desk.spec.ts`, `numbers-esim-code.spec.ts`, `activation-result.spec.ts`.
- **Commit:** `fix(web): the number card leads with what matters (UI maintenance P4.7; closes 3.9-01, 3.9-02, 3.9-03, 3.9-04, 3.9-05, 3.9-17)`

### P4.8 AuthFrame covers sign-in

- **Files:** `components/auth-frame.tsx`, `features/auth/screens/login-screen.tsx:60–125`,
  `features/auth/screens/password-screen.tsx:35–41`, `features/auth/screens/two-factor-screen.tsx:113–127`,
  `features/accounts/screens/enter-screen.tsx:33`, `auth.css:27–30`, moved `.gauth-head` rule (was graphite :330).
- **Steps:** `AuthFrame` gains an optional `head` slot and optional `lede` (rendered only when non-empty, L34);
  login renders through it (`<main>` on the card, `auth-card` class); export `AuthField` (icon + inset box; height
  per **D20**: (a, recommended) 44px, the `.gauth-box` look, so password and two-factor fields grow from 42 to 44 —
  visible, listed in the spec; (b) 42px) and `AuthSubmit`; password and two-factor use them instead of
  `<label><input>` + `Button size="lg"`; `.gauth-head` top margin → token (`--rd-space-4` or named; S18): the
  stacked 32px becomes one margin of the same rendered total (±0px; measured before/after at 375 and 1280). Keep `login-enter` animation classes.
- **Closes:** 3.3-14, 3.6-07, 3.3-34, 3.4-18.
- **Verify:** `/login`, `/password`, `/two-factor`, `/enter` at 375/390/860/861/1280, ar-dark/en-light/he-light;
  1:1 screenshot compare with today for the login page. E2E: `login.spec.ts`, `sign-in-methods.spec.ts`,
  `session-outage.spec.ts`.
- **Commit:** `refactor(web): the sign-in page renders through AuthFrame with shared fields (UI maintenance P4.8; closes 3.3-14, 3.6-07, 3.3-34, 3.4-18)`

### P4.9 Wallet, account, tasks and home hierarchy

- **Files:** `features/tasks/screens/task-ticket-screen.tsx:203`, `features/wallets/wallet-head.tsx:51,75` (+ dead
  `.wallet-…` rule moved from graphite :828; keep the :1170 rule), `features/tasks/screens/provider-decisions-screen.tsx:71`,
  `features/desk/home-top.tsx:85–88`, `features/providers/screens/provider-accounts-screen.tsx:22`.
- **Steps:** ticket close form before the facts list (H11); wallet: one element per figure, "available" in ink and
  larger, delete the dead :828 rule (H12); decision row amount in `.po-row-head` in ink (H15); sales card: the amount
  is the figure and the count the meta (H16; DESIGN.md:253 already says so); provider accounts: `<Money muted />` for
  purchases, paid and credit (H22); wallet chart tip: a coloured change chip beside the title (H25).
- **Closes:** 3.9-11, 3.9-12, 3.9-15, 3.9-16, 3.9-22, 3.9-25.
- **Verify:** listed pages at 375/1280 ar/en/he. E2E: `finance-head.spec.ts`, `home-overview.spec.ts`,
  `provider-operation.spec.ts`, `provider-accounts.spec.ts`, `topbar-balance.spec.ts`.
- **Commit:** `fix(web): wallet, ticket, decisions and home cards lead with their key figure (UI maintenance P4.9; closes 3.9-11, 3.9-12, 3.9-15, 3.9-16, 3.9-22, 3.9-25)`

### P4.10 Every pane through Pane; the `action` alias removed

- **Goal:** finish C17 — no hand-written `section.pane > header.pane-head` left in `features/`; `Desk` has one actions
  prop.
- **Files:** every file still hit by `grep -rln 'className="pane-head' features` and
  `grep -rlnE 'className="pane( |")' features` after P4.9. On 2026-11-13 the `pane-head` list was:
  `branding/screens/branding-screen.tsx`, `tasks/screens/task-ticket-screen.tsx`, `desk/home-top.tsx`,
  `desk/overview.tsx`, `auth/session-rules.tsx`, `providers/reconciliation.tsx`, `auth/sign-in-methods.tsx`,
  `auth/screens/settings-screen.tsx`, `catalog/screens/packages-screen.tsx`, `providers/matching-pane.tsx`,
  `catalog/screens/add-package-screen.tsx`, `catalog/screens/add-company-screen.tsx`,
  `accounts/screens/users-screen.tsx`, `wallets/wallet-head.tsx`, `lines/screens/line-card-screen.tsx` (paths under
  `features/`); the `className="pane…"` list covers 38 files (re-grep; P3.6, P4.5 and P4.6 will have moved some).
  Also `components/desk.tsx` (alias), `tests/desk-head.spec.ts`, `eslint.config.mjs` (P3.13 rule), DESIGN.md
  (Components: Pane; the exception list), `docs/architecture/frontend.md`, and **every Desk caller still passing
  `action={…}`** after P4.9 — on 2026-11-13 the files with both `<Desk` and `action={` were the offers, tasks,
  task-ticket, provider-account, companies, provider-packages, package-sheet, company, notices, roles, audit,
  account, users, profits, wallet, finance, numbers and report-pages screens (`features/**/screens/*.tsx`; re-grep:
  `grep -rln 'action={' features | xargs grep -l '<Desk'`, and read each hit, since a file may pass `action=` to
  another component). `roles-screen.tsx` (:142) is touched by no earlier P4 slice and is migrated here.
- **Steps:** (1) migrate each remaining pane to `<Pane>` with `<PaneHead title count hint placement actions>` (D17;
  no visible change — CHK-ZERO on the snapshot cases that render these panes, markup differences allowed only in the
  wrapper classes). A pane that cannot use `Pane` (e.g. a `<form>` that is itself the pane, a sticky preview) is
  listed in DESIGN.md under "Pane exceptions" with file and reason; it still uses the `Pane` CSS classes. (2) Extend
  the P3.13 `no-restricted-syntax` rule with `JSXAttribute[name.name='className'][value.value=/\bpane-head\b/]` and
  `JSXAttribute[name.name='className'][value.value=/^pane( |$)/]` (message: "use Pane / PaneHead"), with an
  `eslint-disable-next-line` + reason comment only on the documented exceptions. (3) Delete the `action` alias from
  `Desk`: each remaining caller passes `actions={…}` instead, and a caller that wrapped its own
  `<div className="page-actions">` drops that div (keeping any extra class through `actionsClassName`, e.g.
  `sheet-head-actions` on the package sheet), so the head has exactly one `.page-actions`; `tsc` reports any caller
  left. Update `tests/desk-head.spec.ts` to assert `actions?:` and `{lede ?`. (4) Last slice of P4: run
  `node docs/architecture/generate.mjs` and commit the regenerated boards with this slice (G5).
- **Closes:** 3.6-17.
- **Verify:** CHK-LOCAL (the extended lint rule reports 0); the two greps return only documented exceptions;
  `grep -rn 'action={' features` shows no hit on a `<Desk` element (read each remaining hit: it belongs to another
  component); on each migrated head `document.querySelectorAll('.page-head .page-actions').length === 1` and no
  `.page-actions .page-actions` exists (script on every route at 1280);
  CHK-ZERO on every case whose screen changed (styles unchanged); CHK-LOOK spot check of five migrated pages at
  375/1280 ar-dark/en-light. E2E: `desk-head.spec.ts` (updated), `detail-desk.spec.ts`, `home-overview.spec.ts`,
  `sign-in-methods.spec.ts`, `session-rules.spec.ts`, `reconciliation.spec.ts`.
- **Commit:** `refactor(web): every pane renders through Pane, Desk keeps one actions prop (UI maintenance P4.10; closes 3.6-17; D17)`

---

## P5 — Responsive, mobile first, one breakpoint scale

### P5.1 Breakpoint scale for inner pages

- **Files:** DESIGN.md (new "Breakpoints" section with the exception list), `scripts/check-css.mjs` (rule (h) becomes
  failing, with the allowlist),
  `dialog.css:49`, `desk/frame.css:51`, `desk/home.css:200`, `desk/numbers.css:121`, `desk/packages.css:187`,
  `desk/users.css:11,50`, `desk/branding.css`, every other `@media` width (`grep -rn "@media" app/styles`).
- **Steps:** scale: `max-width: 640px / min-width: 641px` (table cards, two-up cards), `767px / min-width: 768px` (phone layout, touch
  per D5), `899px / 900px` (drawer, compact topbar), `1099px / 1100px` (wide). Every off-scale `@media` width in the
  tree is in the table below with its target, decided by **D26** (recommended column shown; if the owner chose D26 b,
  every "exception" row maps to the nearest step instead and its visible effect is checked). `.grant-list` →
  `repeat(auto-fit, minmax(min(100%, 26rem), 1fr))` and delete its 1100/1101 query (R17). Container queries stay
  (conflict 5). Then write the **named-exception allowlist** into `scripts/check-css.mjs` (rule (h): width, file,
  selector, reason) and into DESIGN.md "Breakpoints"; make rule (h) failing.

  Off-scale widths (verified 2026-11-13 with `grep -rnoE '@media[^{]*' app/styles`; graphite rows are found by selector
  in their P2 owner):

  | Width | Where today → owner after P2 | Rule | Target (D26 a) | Visible effect |
  |---|---|---|---|---|
  | 991 / 992 / 700–991 | `auth.css:246–357` | legacy `.login-*` | — | none: deleted in P2.1a |
  | 860 (×2) | graphite :430, :443 → `auth.css` | `.gauth` split to one column; `.gauth-art-mark` inset | **exception** `860` (approved sign-in split, spec "must not change") | none |
  | 1200 | graphite :459 → `shell.css` | `.shell-search { width: 260px }`, `kbd` shown | **exception** `1200` (P5.2 may move it into the topbar container query instead, which removes the row) | none |
  | 1000 | graphite :1098 → `home.css` | `.home-top-row` two columns | **exception** `1000` (approved home layout) | none |
  | 960 (min ×2, max ×1) | `responsive.css:30`, `home.css:15`, `branding.css:131` | `.settings-grid` / `.overview-grid` two columns; `.brand-layout` one column | **exception** `960` (one shared content threshold) | none |
  | 560 (×2) | `doors.css:26`, `dialog.css:167` | `.door-grid` / `.perm-grid, .op-fields` one column | **exception** `560` | none |
  | 520 | graphite :1086 → `settings.css` | `.settings-page .method-cards` one column | **exception** `520` | none |
  | 420 | `numbers.css:74` | `.detail-rows dt` narrower | **exception** `420` | none |
  | 760 | `home.css:200` | `.offer-slide` one column | 767 | switch point moves 7px (761–767 stacks) |
  | 639 | `home.css:297` | `.figure-band` lead full row | 640 | 1px |
  | 720 (layout) | `pane.css:155` (`.switch-row`), `packages.css:187` + graphite :850 (`.sheet-stats`, `.price-board`, merged in P2.6), `components.css:283` (`.wallet-figures`), `frame.css:51` (`.back-link` after P2.1c) | phone stacking | 767 (phone layout step, D5) | in 721–767 these blocks stack as on phones (listed in the spec) |
  | 720 (touch) | `dialog.css:170`, `responsive.css:36`, `pane.css:177`, `components.css:231` | 40/44px touch sizes | replaced by P6.5's 767 primitives; until then 767 | 721–767 gets the touch sizes (D5) |
  | max 900 | `numbers.css:121` | number-card rows | max 899 | 1px: the 900px viewport keeps the wide layout |
  | max 1100 | `table.css:132`, `users.css:50`, graphite :279 (`min-width: 768px and max-width: 1100px`, `.stat-row`) → `components.css` | table / users / stat-row columns | max 1099 | 1px: the 1100px viewport takes the wide layout |
  | min 640 | `home.css:274` (`min-width: 640px and max-width: 1099px`) | figure band columns | min 641 | 1px: the 640px viewport keeps the phone layout (agrees with the `max-width: 640px` card step) |
  | 1100 / 1101 | `.grant-list` | grant tiles | query deleted (auto-fit, above) | none at today's widths (measure 1100/1101) |

  The exact list is re-grepped by the executor; a width not in the table stops the slice until it is added (with a
  D26 answer if it moves a switch point).
- **Closes:** 3.2-15, 3.2-17.
- **Verify:** guard (h) = 0 with the allowlist; each page with a moved query at the old and new switch points ±1px
  (`/` offers at 760/761/767/768, figure band at 639/640/641, every 720-row page at 720/721/767/768), ar-dark/en-light;
  every exception page unchanged (CHK-ZERO at the exception width ±1).
- **Commit:** `fix(web): inner pages use the four-step breakpoint scale (UI maintenance P5.1; closes 3.2-15, 3.2-17)`

### P5.2 Shell breakpoints

- **Goal:** bind the shell's compact sizes and search widths to the breakpoint scale, so the topbar and search stay inside the screen from 375 to 899.
- **Files:** `shell.css` (767 block :697–736, container 720 block :738–762, comment :694), the moved topbar icon rule
  (was graphite :450–457: 36px from 768), search widths (were :455, :460), `responsive.css`.
- **Steps:** compact topbar **sizes** bound to 899 (drawer), not 767 (L16): only the size declarations of the 767
  block (`min-width` / `height` / `width: 2.75rem` on `.shell-icon`, `.wallet-btn` height and
  min-width, `.shell-search-toggle`; the `.avatar-btn` member is gone — P2.1b deleted it as dead, and no topbar avatar
  is rendered: the account sits in the sidebar `.side-user`, `app-shell.tsx:436`) move into a `max-width: 899px` block; the rest of the 767 block (wallet money
  hidden and `.wallet-btn` width 2.75rem / padding 0, search collapsed to its toggle, topbar padding and gaps) stays at
  767. The moved topbar icon rule's 36px sizes start at `min-width: 900px` (R21). **Visible on tablets, listed in
  the spec:** at 768–899 every topbar icon, the search toggle and the wallet chip's height go 36px → 44px
  (the sidebar is a drawer there, so the bar is a touch bar; this is the one exception to D27 a's "no growth above
  767"). **Fit check before committing:** at 768 and 899, sidebar closed (drawer), ar and en, on each door (admin,
  main, agent, pos — the wallet chip and notice set differ), the topbar row holds every control on one row with
  `scrollWidth ≤ clientWidth` and no control under 44px; if 768 does not fit, the slice stops and reports to the
  orchestrator (fallback per the report's note on L16: keep 36px at 768–899 and change only the breakpoint link and
  the comment, recorded in the Status table and the spec) — it does not shrink other controls to make room; the
  search box width rules move into `@container topbar (min-width: 721px)` or get `.topbar .shell-search { width: auto }`
  inside the container query so no empty 164px box remains at 768–899 (R4); fold the search collapse into the
  container query **only after** checking it covers 721–767 viewport widths (topbar width ≈ viewport there, so the
  container query does not apply — keep the media rule if not; L29); correct the comments.
- **Closes:** 3.3-16, 3.2-21, 3.2-04, 3.3-29.
- **Verify:** 320, 375, 720, 721, 767, 768, 899, 900, 1100, 1199, 1200, 1280 with the sidebar open and folded, search open
  and closed; at 768 and 899 measure every topbar control at 44px and at 900 at 36px (computed `height`), ar-dark and
  en-light, on all four doors, with full-size screenshots of the topbar row; at 768 and 899 re-run P0.6's popup
  measurements after the 44px change (search popup and notice panel open: each panel's `getBoundingClientRect()`
  inside the viewport, inline start ≥ 0 and inline end ≤ viewport width, ar and en). E2E: `topbar-narrow.spec.ts`, `topbar-balance.spec.ts`, `shell-a11y.spec.ts`.
- **Commit:** `fix(web): the topbar follows the drawer breakpoint and the search leaves no empty box (UI maintenance P5.2; closes 3.3-16, 3.2-21, 3.2-04, 3.3-29)`

### P5.3 One gutter

- **Files:** `desk/frame.css` (`.canvas-inner` :10, `.canvas-inner.wide` :11–19), `responsive.css:14–16`
  (`.canvas-inner { padding: 22px 28px 56px }`), `shell.css` topbar padding (P0.8 values), `components/app-shell.tsx:574` (read).
- **Steps:** `--rd-gutter` 16px base, `--rd-gutter-wide` 28px from 768 (D9) for `.canvas-inner`, `.wide` and
  `.topbar`; canvas top padding → `--rd-canvas-pad-top` (22px named, D6); one padding rule in `frame.css` (the
  responsive.css one deleted).
- **Closes:** 3.2-13, 3.4-11, 3.1-12 (responsive part; doors/forms/desk parts done in P1.5/P1.8 → closed here),
  3.3-32 **padding part** (page padding split across `frame.css` and `responsive.css` → one rule; the reading-width
  part stays with D12).
- **Risks:** data pages lose 2–12px of table width on tablets (accepted, D9).
- **Verify:** content edge x equal for topbar and canvas at 375/768/1024/1280/1440 on 5 pages.
- **Commit:** `fix(web): one gutter for the topbar and the page (UI maintenance P5.3; closes 3.2-13, 3.4-11, 3.1-12, 3.3-32 padding part; D9)`

### P5.4 Fixed sizes inside shrinking boxes

- **Files:** `desk/branding.css:16` (`.brand-drops`), `desk/packages.css:39` (`.company-grid, .pack-grid`),
  `features/catalog/screens/packages-screen.tsx:118,131`, `desk/numbers.css:108` (`.ld-group dl`), `desk/users.css:132`
  (`.terms-name`), `features/catalog/company-packages.tsx:46`, `features/catalog/screens/providers-screen.tsx:40`,
  `features/providers/screens/provider-account-screen.tsx:98`.
- **Steps:** brand drops `repeat(auto-fit, minmax(min(100%, 16rem), 1fr))`; company/pack grid per **D24**:
  (a, recommended) `repeat(auto-fill, minmax(min(100%, 160px), 1fr))` under `max-width: 640px` and today's 180px track
  above it (desktop unchanged; two a row on phones, DESIGN.md:106); (b) 160px at every width (more cards a row on
  desktop — visible); `.ld-group dl` per D15; `.terms-name` `white-space: normal` in the card block only
  (`.terms-rows` keeps nowrap); providers' companies column and the note column `cell: 'wrap'`.
- **Closes:** 3.2-11, 3.2-12, 3.2-16, 3.2-18, 3.2-19.
- **Verify:** audit runner `past-edge` / `cell-overflow` = 0 on `/branding`, `/packages`, `/numbers/[id]`,
  `/users/[login]`, `/providers`, `/provider-accounts/[code]` at 375/640/641/768/961/990/1280.
- **Commit:** `fix(web): fixed widths yield inside shrinking boxes (UI maintenance P5.4; closes 3.2-11, 3.2-12, 3.2-16, 3.2-18, 3.2-19)`

### P5.5 Phone figures shrink (revival, D10)

- **Files:** `desk/components.css` (Stat, after P2.4).
- **Steps:** `@media (max-width: 767px) { .stat-row .stat-value { font-size: var(--rd-text-figure-sm); } .stat-row
  .stat.lead .stat-value, .stat-row .stat.highlight .stat-value { font-size: var(--rd-text-figure); } }` after the base
  and the P3.8 `lead` rules in the same file — the lead rule (`.stat.lead .stat-value`, `--rd-text-figure-lg` 1.9rem)
  is more specific than the plain phone rule and would otherwise keep 1.9rem on phones, the clipping 3.2-06 reports;
  under 767 the lead drops one step to `--rd-text-figure` (1.45rem) and the others to `-sm` (1.2rem). Check long
  amounts at 375 in ar and en (no clipping, `scrollWidth ≤ clientWidth` on every `.stat`).
- **Closes:** 3.1-03, 3.2-06, 3.7-04.
- **Verify:** `/`, `/finance`, `/users/[login]`, report pages at 375/390/767/768. E2E: `home-overview.spec.ts`.
- **Commit:** `fix(web): figure values shrink on phones as intended (UI maintenance P5.5; closes 3.1-03, 3.2-06, 3.7-04; D10)`

### P5.6 Viewport height, toast position, task board order

- **Files:** `dialog.css:68`, `doors.css:7`, `shell.css:449` (`.notice-toast { top: 4.5rem }`), `components/app-shell.tsx`
  (topbar height variable), `desk/tasks.css:22` + moved board order block.
- **Steps:** `max-height: calc(100vh - …)` in the base rule and the `100dvh` value in an `@supports (height: 100dvh)`
  block (R10) — not two `max-height` declarations in one rule, which guard (a) would count as a duplicate key; toast `top: calc(var(--shell-topbar-h,
  64px) + var(--rd-space-2))`, the variable set from a `ResizeObserver` on `.topbar` in the shell (R20); task board:
  make the ≥900 order and widths the base, delete the 900 override, keep the 36rem container block after it (R14).
  The container block then wins wherever the ticket pane is ≤36rem; it must reset `order` there (rail above thread),
  since the base order would otherwise put the rail under the thread in the narrow column. *(Amended in P0.5: the first
  text stated a visible change, the board stacking at viewport 900 to about 916 with the sidebar open. Measured in
  P0.5, the ticket pane is wider than 36rem at every viewport ≥ 900, sidebar open (596px at 900, 615 at 920) or folded,
  so no stacking happens there and nothing on the board changes at 900–920; re-measure before relying on it. The
  visible change is the base change itself: from viewport 609 to 899 (drawer mode, the ticket wider than 36rem) the
  board shows the ≥900 order and widths, the thread first and the rail `minmax(18rem, 22rem)` at the inline end, where
  today the rail is first at 320px (P0.5 `widths.log`: 880 `320px 510.812px`, 899 `320px 529.062px`). That is R14's
  intended change. Amended again in P0.5 fix round 2, which corrected "880–920".)*
  **Before you start (amendment carried from P0.5):** the spec's "What changes for users" P5.6 line ("Task ticket
  (P5.6): the board stacks (rail above thread) whenever the ticket pane is 36rem or narrower, including viewport 900
  to about 916 with the sidebar open, …") still holds its first text. P0.5 measured it untrue and did not edit the
  spec. Re-measure the ticket width at 600/608/610 in drawer mode and at 900/910/920 with the sidebar open; if the
  P0.5 figures hold, replace that bullet in the spec, as this slice's amendment (`docs(plan): amend P5.6`, files: the
  plan and the spec), with: "Task ticket (P5.6): one task-board order in the base rule. From viewport 609 to 899
  (drawer mode, the ticket pane wider than 36rem) the board shows the order and widths it has from 900 today: the log
  first and the details at the inline end, 18–22rem wide, where today the details come first at 320px. The board
  stacks (details above log) whenever the ticket pane is 36rem or narrower. Measured in P0.5, that happens only in
  drawer mode up to a viewport of about 608px: at 900 and wider the ticket pane is wider than 36rem (596px at 900
  with the sidebar open, 615px at 920), so the stacking at 900 to about 916 this line first named does not occur, and
  nothing on the board changes there." If the figures differ, write the measured ones in its place. The 609–899
  change this text names is a visible change: if the spec's list does not already cover it, the amendment rules apply
  (an owner question, or parking under the autonomous run).
- **Closes:** 3.2-10, 3.2-20, 3.2-14.
- **Verify:** dialog on a 375×667 phone with the browser bar; notice toast at 375/768/899/900; `/tasks/[id]` at
  600/608 (stacked, the board scrolling, rail above thread); 610, 768, 880, 899 in drawer mode (two columns, thread
  first, rail 18–22rem: the stated change); 900/910/920 with the sidebar open and folded (two columns, as today).
  (Amended in P0.5: the first text expected stacking at 900–916; fix round 2 split the drawer widths out.) E2E: `transfer-notices.spec.ts`, `dialog-focus.spec.ts`, `task-notes.spec.ts`.
- **Commit:** `fix(web): dynamic viewport height, the toast under a wrapped topbar, one task-board order (UI maintenance P5.6; closes 3.2-10, 3.2-20, 3.2-14)`

---

## P6 — RTL and accessibility

### P6.1 Direction helpers and directional motion

- **Files:** `ui.css:162–164` (`.only-*`, `.flip-ltr`), `shell.css:31,34,99–100,190–191`,
  `components/app-shell.tsx:377`, `components/ui/pagination.tsx:107`, `components/date-field.tsx:54,107`,
  `features/tasks/screens/task-ticket-screen.tsx:101` (`Undo2`), moved `.line-op-go` rules (were graphite :676–677),
  `filter-slide` keyframes (was graphite :261), `.gauth-art-tag` (was :420–441), shimmer `desk/components.css:127,140`,
  `base.css:106`; `components/row-menu.tsx:56`, `components/offer-hero.tsx:33`, `components/tabs.tsx:29`; new
  `lib/direction.ts` (`isRtl(el)`).
- **Steps:** `.flip-ltr:dir(ltr) { scale: -1 1 }`, add `.flip-rtl:dir(rtl) { scale: -1 1 }`; delete manual
  `scaleX(-1)` pairs that double-flip (:677) in the same change; side handle: drop `flip-ltr`, use `rotate` only in
  the folded state with a `[dir='ltr']` reset; pagination/date-field: one icon + `flip-ltr` (C27; check `only-*`
  users for text); `Undo2` gets `flip-rtl`; keyframes per direction via `--rd-dir` (`translateX(calc(var(--rd-dir) *
  24px))`) for filter drawer, gauth tag (polygon + rotate pair written next to it), shimmer (`animation-name` only);
  sidebar fold group chevron and labels slide the same way in RTL (D6 finding); JS reads direction through `isRtl`.
- **Closes:** 3.8-01, 3.8-04, 3.8-13, 3.6-27, 3.8-05, 3.8-06, 3.8-07, 3.8-09, 3.8-14.
- **Verify:** en-light and ar-dark and he-light at 390/1280: fold/unfold the sidebar, hover a line-op, open the filter
  drawer, page through a table, open the date picker, loading shimmer; screenshots of arrow directions.
  E2E: `shell-a11y.spec.ts`, `numbers-paging.spec.ts`.
- **Commit:** `fix(web): direction helpers with scale, flip-rtl and directional motion (UI maintenance P6.1; closes 3.8-01, 3.8-04, 3.8-05, 3.8-06, 3.8-07, 3.8-09, 3.8-13, 3.8-14, 3.6-27)`

### P6.2 Latin isolation and alignment

- **Files:** `.cursor/rules/direction-theme.mdc` (:11), `features/accounts/screens/users-screen.tsx:107,196,204`, `features/auth/sign-in-methods.tsx:123,148`,
  `features/desk/home-top.tsx:149` + moved `.op-list-end` (was graphite :1103), `desk/users.css:157`
  (`.terms-price input`), `features/accounts/screens/packages-terms.tsx:299`, `desk/settings.css:44–45`,
  field wrappers for codes/money/credentials (`two-factor-screen.tsx:127`, `account-actions.tsx:218,229`,
  `settings-screen.tsx:180,184`, `password-screen.tsx:37,41`, `login-screen.tsx:77`), letter-spacing rules
  (`shell.css:114` `.nav-label`, `frame.css:8` `.eyebrow`, `.data th`, moved graphite :95/:502).
- **Steps:** block `dir="ltr"` → inner `<bdi dir="ltr">`; `.op-list-end > * { justify-self: end }`;
  `[dir='rtl'] .terms-price input { text-align: end }`; one rule: codes, money and credential inputs carry
  `dir="ltr"` through the shared field (`AuthField`, `RangeField`, `PriceField`) **on the `<input>` element only, never
  on `.gauth-box` or another wrapper that also holds an icon** (direction-theme.mdc: no `dir` / `unicode-bidi` on a
  field with an icon beside it — the icon order must follow the page; check it in ar and he at 390 and 1280). Because
  that rule's sentence can be read as covering the `<input>` too, this slice amends `.cursor/rules/direction-theme.mdc:11`
  to "Do not set `dir` or `unicode-bidi` on the row or wrapper that holds a field and its icon; a code, money or
  credential `<input dir=\"ltr\">` inside it is allowed" and DESIGN.md says the same (P7 requires the rules and DESIGN.md
  to agree; working-tree precondition and the P0.1 rule-file answer apply) with
  `[dir='rtl'] input[dir='ltr'] { text-align: end }` where the design aligns them to the reading end; letter-spacing
  only under `:lang(en)` or on Latin identifiers.
- **Closes:** 3.8-02, 3.8-03, 3.8-10, 3.8-11, 3.8-12, 3.7-13.
- **Verify:** the listed fields and lists in ar and he at 390/1280. E2E: `users-desk.spec.ts`, `login.spec.ts`,
  `user-terms.spec.ts`.
- **Commit:** `fix(web): Latin isolated inline, aligned fields, no tracking on Arabic and Hebrew (UI maintenance P6.2; closes 3.8-02, 3.8-03, 3.8-10, 3.8-11, 3.8-12, 3.7-13)`

### P6.3 Logical properties everywhere

- **Files:** every sheet with guard (i) hits (`desk/components.css:70,81,83,145,154,161,217,266`, `table.css`,
  `settings.css:40–41`, `users.css`, …).
- **Steps:** physical block-axis → `*-block-*`, inline → `*-inline-*`; pairs that rely on order convert together; guard
  (i) baseline → 0 and failing from now on.
- **Closes:** 3.8-16.
- **Verify:** CHK-LOCAL; CHK-ZERO (pure refactor) at 390/1280 ar/en.
- **Commit:** `refactor(web): logical properties on both axes, enforced (UI maintenance P6.3; closes 3.8-16)`

### P6.4 Contrast

- **Files:** `tokens.css` (`--rd-field` light, `--rd-muted` light, `--rd-success`/`--rd-warning` light or `-text`
  tokens, new `--rd-accent-text`, `--rd-focus-danger`), field border rule (moved from graphite :44, 70% mix; also :355,
  :1452 equivalents), `controls.css:16` (checkbox border 32%), crimson small text (moved graphite :16, :34, :191, :341,
  :893, :1265, :1283; `shell.css:168,218`), success/warning small text (`ui.css:66–67`, moved :56, :1031–1032, :1127),
  `--rd-faint` on active icons (`dialog.css:40,116,223`, `ui.css:120`, `shell.css:549,555`, `desk/numbers.css:119`) and
  labels (`shell.css:111`, moved :1457), role-field focus halo (moved :1453, :1459), DESIGN.md token table (:168–175),
  `scripts/contrast.mjs` (extend to every text/background and boundary pair), `package.json` (`lint` also runs
  `node scripts/contrast.mjs`, so the result cannot drift after this slice — spec goal 5; `docs/architecture/frontend.md`
  scripts row updated).
- **Steps:** field and checkbox borders `var(--rd-field)` unmixed; light `--rd-field` darkened until ≥3:1 on
  `--rd-sunken` and `--rd-surface` (≈ `#7a7a7a`); `--rd-accent-text` light ≈ `#c0283f` for small crimson text (do not
  darken `--rd-accent`); success/warning text tokens ≥4.5:1 (recompute `-soft`); resting icon glyphs `--rd-muted`
  (`--rd-faint` itself unchanged); light `--rd-muted` per **D22**: (a, recommended) darken to the value the contrast
  script picks ≥4.5:1 on `--rd-surface-3` (≈ `#636363`), DESIGN.md:171 updated; (b) keep the value and move muted text
  off `--rd-surface-3` where it sits today (list every such rule);
  focus halos `var(--rd-focus)` and a new `--rd-focus-danger`.
- **Closes:** 3.10-04, 3.10-08, 3.1-24, 3.10-06, 3.10-07, 3.10-09, 3.10-23, 3.1-25. (3.10-05's colour part is done
  here; its hit-area part — the 20px search clear — closes it in P6.5.)
- **Verify:** `node scripts/contrast.mjs` (all text ≥4.5, boundaries/icons ≥3); CHK-LOOK fields, checkboxes, badges,
  chips on 8 routes in both themes (fields must not look heavy). E2E: `desk-system.spec.ts` (if field colours asserted).
- **Commit:** `fix(web): text, boundaries and icons meet WCAG AA contrast in both themes (UI maintenance P6.4; closes 3.10-04, 3.10-06, 3.10-07, 3.10-08, 3.10-09, 3.10-23, 3.1-24, 3.1-25)`

### P6.5 Touch targets on the primitives

- **Files:** `responsive.css:35–50` (touch block), `dialog.css:111` (close), `dialog.css:170–175`, `dialog.css:217,230`
  (row-menu trigger), moved date picker rules (were graphite :1396, :1408–1420), filter list rows (:878), `.gauth`
  fields/buttons/reveal (moved :372; `ui.css:45`), `buttonClass` links/labels, phone 640 block 40px rules (moved
  :1360–1372), NameField clear (moved :1184, :943, :1233, :1177), `.chip-x`, topbar search clear `.shell-search-clear`
  (`shell.css:545`, 20×20 today), `features/catalog/package-addons.tsx:79` and `add-package-screen.tsx:214` (delete
  buttons, 3.10-29), `ui.css` (`.ui-btn-icon*`), shell
  (`shell.css:252,261,377,416`, moved :451, :590; `app-shell.tsx:362`), fold handle `shell.css:94,96`.
- **Steps (after P0.6, conflict 4; breakpoint per D5):** replace the container-bound block with primitive rules under
  `@media (max-width: 767px)` **only** — not `(pointer: coarse)`, which would also match tablets and touch laptops at
  any width and change the approved desk density there (that is **D27**; recommended "no"; if the owner answers yes,
  add the `(pointer: coarse)` query and verify with `hover: none` / `pointer: coarse` emulation at 1024 and 1280): `.ui-btn` (incl. links/labels with the class) min-height 44px,
  `.ui-btn-icon, .ui-btn-icon-sm` 44×44, fields 44px (incl. `.gauth .gauth-box` — size the box, not the input),
  `.gauth-reveal` 44×44, dialog close 44×44, `.dialog .date-field-open` 44×44, `.date-pop` widened to
  `min(330px, calc(100vw - 16px))` with step/link buttons 44 and days `min-height: 44px` (no `min-width`), filter list
  rows 44, row-menu trigger `min-width: 44px`, tabs, pager items (the shared `--rd-pager-item` from P3.1 →
  44px under 767, page numbers and arrows together) and compact select 44 (replacing the 40px rules of the moved
  graphite 640 block, :1360–1372 — **all six of them**: `.steps button` min-height, `.ui-pager-page`, the compact
  select, `.line-pos` min-height, `.mode-card .seg button` height and `.donut-legend a/button` min-height each become
  44 under 767; the table below lists them), name-field clear
  `.chip-x` and the topbar search clear `.shell-search-clear` with a transparent 44px `::before` hit area that does
  not cover the field (3.10-05's hit-area part); the icon delete buttons (now `size="iconSm"` from P3.3) reach 44×44
  through `.ui-btn-icon-sm` — measure them on `/companies/[code]/packages/new` (add-ons) and the package add-ons pane
  (3.10-29); drop the dead `.auth`
  selectors (R24). Shell per D11: drawer close 44, mark-all and notice rows 44, path links 44 under 767, fold handle
  `@media (hover: none) { opacity: 1 }` with a 44px hit area (checked by emulating the media feature: a Playwright
  context with `hasTouch: true` / `isMobile: true`, or CDP `Emulation.setEmulatedMedia` with
  `features: [{ name: 'hover', value: 'none' }]`, at 1280 with the sidebar open; the handle's opacity reads 1 and its
  hit box 44px; without the emulation it stays hover-revealed). Update DESIGN.md (:247, :279, :297) to 767 / D5.
  **Every member of today's block carries over** (`responsive.css:35–50`, `@media (max-width: 720px)`); the block is
  deleted only when each row below has its replacement under `max-width: 767px`:

  | Today's member | Replacement |
  |---|---|
  | graphite 640 block (moved): `.steps button`, `.ui-pager-page`, `.ui-select-compact` / pager select, `.line-pos`, `.mode-card .seg button`, `.donut-legend a, button` (40px) | the same selectors at 44px (min-height; `height` for `.mode-card .seg button` and the compact select) under `max-width: 767px` |
  | `frame.css:51–55` `@media (max-width: 720px)` `.back-link`, `.desk input:not(…)`, `.desk select` (height 44) | the field primitives under 767 plus `.back-link` 44 |
  | `.auth input…`, `.auth select`, `.auth .ui-btn` (height 44) | dead (`.auth` removed in P2.1a); `.gauth .gauth-box` 44, `.gauth .ui-btn` / `.gauth-go` / `.gauth-passkey` min-height 44 |
  | `.canvas input:not(checkbox/radio/file)`, `.canvas select` (height 44) | field primitives (`.ui-select-field`, `forms.css` input rules, NameField, DateField) height 44 — **also inside `.dialog`** (portal, outside `.canvas`). **Specificity:** the 44px rule must win over the 34px base `.desk input:not([type='checkbox']):not([type='file'])` (`frame.css:49`, (0,3,1)) for a bare `input` inside `.canvas > .desk`, which `tests/desk-system.spec.ts` probes at 390 (fieldHeight 44px): give the replacement at least (0,3,1) and a later position, or delete/fold the 34px base into the same primitive rule; read the winning rule in the evidence note |
  | `.canvas button` (min-height 44: every raw button in the canvas, incl. chips, `.line-op`, tabs, `.seg`, `.link-btn`, `.esim-open`) | `.ui-btn` 44 plus explicit rules for each raw-button class still in the canvas (`grep -rn "<button" features components --include='*.tsx' \| grep -v "<Button"` → list in the evidence note, each given 44 or shown to be ≥44 already) |
  | `.canvas .check`, `.dialog .check` (min-height 44) | `.check` min-height 44 (one rule, canvas and dialog) |
  | `.canvas .shortcut` (min-height 44) | `.shortcut` min-height 44 |
  | `.dialog .seg button` (min-height 44) | `.seg button` min-height 44 (canvas and dialog) |
  | `.row-menu-panel button` (min-height 44: the menu **items**) | `.row-menu-panel button` min-height 44, plus the trigger's `min-width: 44px` above |
  | `.toast button` (min-height and min-width 44) | `.toast button` 44×44 |

  The Verify script measures each of these, including the toast close and an open row menu's items. The toast is
  raised in the built-in browser by stubbing the notice stream the shell listens to (`lib/use-notices.ts:13`,
  `/api/v1/notices/stream`, `notice` event): a `page.route` (or, in the built-in browser, a fetch/EventSource
  override set before load) answers it with `text/event-stream` body `event: notice\ndata: <one NoticeRow JSON>\n\n`;
  the close is measured while the toast is visible (it hides after `TOAST_MS`).
- **Closes:** 3.2-07, 3.2-08, 3.2-09, 3.10-10, 3.10-11, 3.10-12, 3.10-13, 3.10-14, 3.10-15, 3.10-16, 3.3-15, 3.2-24,
  3.10-21, 3.10-22, 3.10-05, 3.10-29.
- **Risks:** the calendar grows ≈70px — check its placement at 375×667; the actions column of non-card tables grows 16px.
- **Verify:** script: smallest target under 767 per route (all routes, all doors) ≥44 at 375/390/767; date picker,
  row menu (trigger and every item), filter list, name field open, a dialog's fields and `.check` / `.seg` rows, and
  the toast close while a toast is shown (screenshot it); and at 768, 1024 and 1280 every `.ui-btn` / field height equals the P5
  baseline (no growth above the breakpoint unless D27 = b). E2E: `desk-system.spec.ts` (44px under the breakpoint), `transfer.spec.ts`,
  `name-field.spec.ts`, `topbar-narrow.spec.ts`, `login.spec.ts`.
- **Commit:** `fix(web): 44px touch targets on the primitives, popups and sign-in (UI maintenance P6.5; closes 3.2-07, 3.2-08, 3.2-09, 3.2-24, 3.3-15, 3.10-05, 3.10-10, 3.10-11, 3.10-12, 3.10-13, 3.10-14, 3.10-15, 3.10-16, 3.10-21, 3.10-22, 3.10-29; D5, D11)`

### P6.6 One focus ring

- **Files:** `base.css:39–42`, `ui.css:26–30` (and the moved graphite :26 rule), `controls.css:35`, `dialog.css:31,213,282`,
  every `:focus-visible` rule (`grep -rn "focus-visible" app/styles`).
- **Steps:** one rule set: `outline: var(--rd-ring-width) solid var(--rd-ring-color); outline-offset: var(--rd-ring-offset)`
  for interactive elements; clipped / cut shapes use the inset variant (`box-shadow: inset 0 0 0 var(--rd-ring-width)
  var(--rd-ring-color)`); text fields keep border + `--rd-focus` halo (DESIGN.md:299); **rewrite DESIGN.md:299's second sentence** ("Page-level
  buttons and links use a 2px solid `--rd-ink` outline" — contradicts the crimson ring and D25) to the one ring rule;
  ring colour per **D25**
  (recommended: unchanged, `--rd-ring-color: var(--rd-accent)`; the `.line-op` ring from P0.4 switches to
  `var(--rd-ring-width)`); guard (e) = 0.
- **Closes:** 3.6-05.
- **Verify:** Tab walk on 10 routes (home, numbers, number card, users, user page, tasks, ticket, companies, package
  sheet, settings) + a dialog + the filter drawer, ar-dark/en-light: screenshot every stop. E2E: `dialog-focus.spec.ts`,
  `shell-a11y.spec.ts`.
- **Commit:** `fix(web): one focus ring for every control (UI maintenance P6.6; closes 3.6-05)`

### P6.7 Accessible names and live regions

- **Files:** `components/app-shell.tsx:524,532,550,590`, moved notice dot (was graphite :595), `components/toast.tsx:24,32–34`,
  `components/shell-search.tsx:157`, `components/chrome.tsx:64`, `features/lines/screens/line-card-screen.tsx:60`,
  `features/catalog/package-addons.tsx:66`, `features/lines/line-details.tsx:113` (copy announce), `lib/copy/{ar,en,he}.ts`.
- **Steps:** bell `aria-label` includes the unread count (dot `aria-hidden`); toast close translated `aria-label`, ×
  `aria-hidden`; notice-toast close and search clear get their own keys (A24); language button
  `` `${t.language}: ${langLabel[locale]}` ``; notices panel: `role="menuitem"` items or a labelled region (pick one,
  check usePopover's keyboard behaviour); operation card: drop the `aria-label` that hides the description; addon switch
  passes its state word; copy button announces via `aria-live="polite"`; toast host permanent `role="status"
  aria-live="polite"`, error toasts pause on hover/focus.
- **Closes:** 3.10-19, 3.10-20, 3.10-24, 3.10-25, 3.10-26, 3.10-27, 3.10-28, 3.10-32, 3.10-33.
- **Verify:** `npm run check:copy`; **binding:** the accessibility tree via `read_page` on bell, toast, language,
  search, notices, a line-op and the line-details copy button (name, role, live region present); a VoiceOver pass is an
  **optional owner check** (agents cannot run it), offered to the owner at the P6 gate. E2E: `shell-a11y.spec.ts`, `transfer-notices.spec.ts`, `addons.spec.ts`.
- **Commit:** `fix(web): correct accessible names, counts and live regions (UI maintenance P6.7; closes 3.10-19, 3.10-20, 3.10-24, 3.10-25, 3.10-26, 3.10-27, 3.10-28, 3.10-32, 3.10-33)`

### P6.8 Popup engine: filter drawer and placement

- **Files:** `components/filter-bar.tsx:54,138–150`, `components/row-menu.tsx:69`, `lib/use-popover.ts`,
  `components/dialog.tsx` (`ModalFrame` extraction), `dialog.css:53`, `shell.css:36`, moved drawer scrim rule (was
  graphite :234), tokens (`--rd-scrim`, blur).
- **Steps:** extract scrim + focus trap + scroll lock into `ModalFrame` used by `Dialog` and the filter drawer (z layers
  stay separate); one scrim token and blur; filter chip list uses `usePopover` and a shared `placePopover` helper with
  RowMenu (trigger is the native select's chip: check the trigger and focus return). Last slice of P6: run
  `node docs/architecture/generate.mjs` (P6.1 added `lib/direction.ts`, this slice adds `ModalFrame`) and commit the
  regenerated boards with this slice (G5).
- **Closes:** 3.6-06, 3.6-21.
- **Verify:** filter drawer at 375: Tab stays inside, Escape closes and returns focus, page does not scroll behind;
  chip list and RowMenu placement at viewport edges in ar/en. E2E: `dialog-focus.spec.ts`, `url-filters.spec.ts`,
  `lists-desk.spec.ts`.
- **Commit:** `fix(web): the filter drawer is a real modal and popups share one placement (UI maintenance P6.8; closes 3.6-06, 3.6-21)`

---

## P7 — Docs final

### P7.1 DESIGN.md final

- **Goal:** leave DESIGN.md and the rule files saying exactly what the code now does, with the final "Fixed rules" section and no old contradictions.
- **Files:** `DESIGN.md`, `.cursor/rules/smilesim-ui.mdc`, `.cursor/rules/content-ui.mdc`, `.cursor/rules/direction-theme.mdc`
  (working-tree precondition and the P0.1 rule-file answer apply).
- **Steps:** add the final "Fixed rules" section (`docs/reviews/2026-11-13-ui-audit.md` §6 adapted to ADR 0021 and to what P1–P6 built);
  remove every superseded sentence (grep: "Primary action is ink", "ink fill", "the action first", "720px", `.notice-pop`,
  `.pack-pick` exception, `Sparkline`, "rem values stay literal", "2px solid `--rd-ink` outline" (DESIGN.md:299,
  rewritten in P6.6), "uses WalletHead" for finance (P4.5)); shadow rows corrected to the token values (T21);
  stylesheet table without graphite; component list with the new components; breakpoints; "Known gaps" refreshed.
  **Rule files:** every sentence of the three rule files is checked against the final DESIGN.md and rewritten where it
  names a removed class or model — at least `content-ui.mdc:13` ("Section: `.pane` and `.pane-head`" → "Section:
  `Pane` / `PaneHead`", which P4.10's lint rule now requires in features) and `content-ui.mdc:19` ("Line operations …
  `.command-list` / `.command-forms` … not a card grid" → what P4.7 / the number card renders after P3–P4); the
  interim "ADR 0021 wins" sentence in ADR 0021 is marked as expired.
- **Closes:** 3.1-21.
- **Verify:** two reviewers read DESIGN.md against the code (each rule has a matching implementation or guard), and
  each rule-file sentence against DESIGN.md (the P7 gate greps).
- **Commit:** `docs: DESIGN.md fixed rules, one source for every visual decision (UI maintenance P7.1; closes 3.1-21)`

### P7.2 Maps, ADRs, handover, graph

- **Files:** `docs/architecture/frontend.md` (components, Design system section, Known defects, "Last verified"),
  `node docs/architecture/generate.mjs` (Excalidraw boards — file roles changed), ADR 0021 (final state), this plan
  (all hashes), `docs/handover/*-ar.md` (any screen description or button colour the guides mention — currently only
  `technical-operations-ar.md` mentions the web app; check all four), `CLAUDE.md` table if a file moved; then
  `graphify update .` and `/graphify . --update` for the core docs.
- **Closes:** none (keeps maps current).
- **Verify:** two reviewers check each map against the code: every component, hook, script and stylesheet in
  `frontend.md` exists (`ls`) and every file under `components/`, `app/styles/` and `scripts/` is listed; the
  regenerated boards differ from the committed ones only where file roles changed (`git diff --stat docs/architecture`);
  every "Last verified" line carries the P7.2 date; ADR 0021 lists every D# with its answer; each handover guide's
  web-app sentences match the screens (`grep -n` for button colours and screen names in `docs/handover/*-ar.md`).
- **Commit:** `docs: maps, ADR and handover current after the UI maintenance (UI maintenance P7.2)`

---

## VISUAL AUDIT (P8, after P7's gate)

### P8.1 Capture runner

- **Files:** `visual-audit/audit.visual.ts`, `visual-audit/audit.config.ts`, `visual-audit/completeness.mjs` (new),
  `visual-audit/diff-runs.mjs` (new, the run-to-run diff P8.5 and P8.6 depend on),
  `docs/architecture/frontend.md` (the runner, the completion script and the diff script, in its scripts row),
  `docs/reviews/2026-11-13-visual-audit.md` (new record, written at P8.4). No new dependency: the pixel diff uses the
  Chromium that `@playwright/test` already installs (`apps/web/package.json` has no `pixelmatch` / `pngjs`, and none is
  added).
- **Steps:** extend the runner (it drives port 3000, one worker, starts no server):
  - doors and logins: `DOOR` × `USER_LOGIN` from the trial seed (`admin`/`branch`, `main`/`main`, `agent`/`agent`,
    `pos`/`pos`); widths `375,390,700,768,1024,1280,1440,1920` (700 sits inside the 641–767 band that D5, D26 and P5.1
    change; **1920** is the wide monitor: about 1650px of content beside the 268px sidebar, `.canvas-inner.wide` has no
    max width — screen-size.mdc asks for a check on large monitors); combos `ar-dark, ar-light, en-dark, en-light, he-dark, he-light`;
  - the route list per door (below); every tab of a page (as today), plus **states** scripted per route (below);
  - per capture: **tiles** — the canvas (or the document when there is no `.canvas`) scrolled in steps at a fixed
    viewport of the capture's width × 1200px (DPR 1), 100px overlap, one PNG per step until the end of the scroll
    height (no cap: pages taller than any limit are captured in full), each tile listed in `manifest.json` with its id
    (`<capture>-t<n>`), its scroll offset and its size; the sticky topbar repeats on every tile (expected, not a
    finding). Plus one **overview** PNG as today (viewport height = scroll height, capped at 6000px; when the page is
    taller the manifest row carries `overviewTruncated: true` — the tiles still cover it). Inspectors read tiles at
    full size; the overview is for overall layout only (verify-before-reply.mdc §2: full-size screenshots, not
    thumbnails). And a JSON with: `inspect()` findings (as today), the viewport, every interactive
    element's box and computed height/width, font-size/weight/family of text nodes, contrast of each text node against
    its resolved background, focus-ring presence after a scripted Tab on the first 15 stops, `scrollWidth` vs
    `clientWidth` of `.app-shell`, `.canvas`, `.pane`, `.dialog`;
  - output `audit-output/visual-audit/<RUN>/<door>/<route-slug>/<view>/<locale>-<theme>-<width>.{png,json}` (overview),
    `…-t<n>.png` (tiles) and a `manifest.json` (one row per capture: **id**, door, route, view, state, locale, theme,
    width, tier, path, tiles, scrollHeight, overviewTruncated, status, reason);
  - **expected set first:** before capturing anything, the runner expands the route matrix (below) × the capture tiers
    × the D28 answer (and the active filters) into `audit-output/visual-audit/<RUN>/expected.json` — one row per
    planned capture with a stable **id** (`<door>/<route-slug>/<view>/<state>/<locale>-<theme>-<width>`), door, route,
    view, state, locale, theme, width and tier. Tabs that exist only after the page loads are expanded by a first
    discovery pass per door × route at 1280 ar-dark, which writes the view list into `expected.json` before the
    captures of that cell start. Every manifest row carries its expected id. A capture that cannot be taken is
    written to the manifest as `failed` (with the error) or `n/a` (with a reason, e.g. a state the route does not
    have), **never omitted**;
  - **completion script:** `node visual-audit/completeness.mjs <RUN>` (new, in this slice) compares
    `expected.json` with `manifest.json` and prints the missing ids, the ids present but not expected, and every row
    whose status is not `ok` and not `n/a` with a reason; it exits non-zero unless manifest ids = expected ids and
    every status is `ok` or `n/a`+reason. P8.2, the P8 gate and P8.6 run this script instead of reading the matrix
    by eye;
  - **diff script:** `node visual-audit/diff-runs.mjs <NEW_RUN> --inspected audit-output/visual-audit/inspected.json
    [--exclude <blast.json>]` (new, in this slice). Inputs: the new run's manifest and capture JSON/PNGs; the
    **inspected map** `audit-output/visual-audit/inspected.json` (`{ "<capture id>": "<RUN it was last inspected in>" }`,
    written by the consolidation agent, P8.3–P8.5), so each capture is compared with the run its last inspection
    read, not with one fixed run; an optional exclusion file (`{ "captures": [ids], "routes": [{door, route}] }`, the
    union of the declared blast radii of the round's fixed `V.nn` slices, written by the consolidation agent).
    Per capture id present in both: (1) **metric diff** — elements matched by their stable key, comparing box
    (x, y, w, h), computed height/width, font-size/weight/family, text colour, background, contrast ratio, plus the
    capture-level `scrollWidth`/`clientWidth` pairs, `scrollHeight`, tile count and the `inspect()` findings list;
    elements flagged `volatile` are skipped; any difference (boxes: > 0.5px; contrast: > 0.05) marks the capture
    changed; (2) **pixel diff** — tiles paired by tile id; a tile-count difference marks the capture changed; each pair
    is loaded into two canvases in a headless Chromium launched by the script (`chromium` from `@playwright/test`; no
    page on port 3000 is opened, so it needs no browser token and starts no server), the boxes listed as masks in
    either run's JSON are painted over in both, and a pixel counts as different when any RGBA channel differs by more
    than 8/255; a tile whose share of different unmasked pixels exceeds **0.1%** marks the capture changed. Captures in
    the exclusion file are reported as `inBlastRadius` and not listed as unexplained. Output
    `<NEW_RUN>/review/unexplained.json` (`[{ id, comparedWith, metricDiffs, tilesOver: [{tile, share}] }]`) and
    `<NEW_RUN>/review/diff-summary.json` (counts: compared, unchanged, changed, in blast radius, missing on either
    side); a capture missing from the inspected map or from the new run is listed under `missing`, never silently
    skipped. Exit code non-zero when `unexplained.json` or `missing` is non-empty;
  - **frozen clock:** the runner fixes the page clock (as `tests/dom-snapshot.mjs` does from P1.1) so relative times,
    the offer countdown and "expiring in N days" render the same across runs (P8.6 diffs depend on it);
  - resumable **only when `RUN` is set explicitly to a name other than `latest`**: it then skips captures whose id is
    already in that RUN's manifest with status `ok` or `n/a` (a `failed` row is retried and replaced). With `RUN`
    unset or `RUN=latest` (CHK-AUDIT) the runner **always re-captures and overwrites** — it empties
    `latest/` at start, so `latest/findings-*.json` never holds a previous run's results. A re-capture after a fix
    always goes to a **new** RUN id (P8.5), never into a run that was already inspected; `ONLY`, `DOOR`, `WIDTHS`,
    `COMBOS`, `STATES` filters;
  - **defaults stay today's:** with no filter the runner still captures `DOOR=admin`, widths `390,768,1280`, combos
    `ar-dark,en-light`, default views only (no states, no tiles beyond the overview) — exactly what CHK-AUDIT reads
    today. The full matrix (all doors, eight widths, six combos, states, tiles, `expected.json`) runs only with
    `FULL=1` (P8.2, P8.5, P8.6) or with explicit filters; CHK-AUDIT for `V.nn` slices keeps the short default;
  - **masks recorded per tile:** for every tile the capture JSON lists the boxes (`{x, y, w, h}`, tile coordinates)
    of the elements matching the manifest's known-volatile selectors (below), and every element in the metric part of
    the JSON carries a stable key (tag + classes + `nth-of-type` path from `.app-shell`, the same shape as the
    dom-snapshot key from P1.1) and a `volatile: true` flag when it sits inside a known-volatile region;
  - **one login per door per run:** the runner logs in once per door and reuses the saved storage state for every
    test of that door (re-logging only if a capture lands on the sign-in screen), because each login adds a session
    and audit rows and revokes sessions over the account's limit (`auth.service.ts` `makeRoom`). The regions that
    still change with time or with the runner's own logins — the sessions list on `/settings` and `/users/[login]`'s
    sessions dialog, the newest rows of `/audit`, "last seen" times — are listed in the manifest header as
    **known-volatile** (selectors) and masked in P8.6's pixel diff and excluded from its metric diff;
  - **CHK-AUDIT compatibility:** besides the per-run tree, the runner keeps writing
    `audit-output/visual-audit/latest/findings-*.json` as today, so CHK-AUDIT reads the same path;
  - **structure:** one Playwright test per door × route (not one per combo), each looping widths × combos × states and
    appending to `manifest.json` after **every** capture (so a timeout loses one capture, not a run); the per-test
    timeout (the config's existing `timeout: 3_600_000`, `audit.config.ts:11`, which *is* the per-test timeout — the
    config sets no global one) stays at 60 minutes or is raised to the largest cell's measured time (a heavy cell such
    as `/numbers/[id]` is a few hundred captures at several seconds each); a cell that still times out simply resumes
    from the manifest on the next run, and the completion script shows what is left. The run is split by `DOOR=` — the
    capture agent runs the four doors one after the other;
  - **where each state comes from** (nothing is invented by hand):
    | State | Source |
    |---|---|
    | empty list | `page.route` on the list endpoint → `{ items: [], total: 0 }` (shape from the existing fixture answers in `tests/dom-snapshot.mjs`) |
    | loading | `page.route` that delays the endpoint 3 s; capture at 500 ms |
    | error / LoadFailed | `page.route` → HTTP 500 for the page's main endpoint |
    | outage banner ("API down") | `page.route('**/api/**')` → `route.abort('connectionrefused')` after the shell loads — the API on 3001 is **never** stopped (machine-limits.mdc: one copy, always running) |
    | unknown report kind | navigate to `/reports/no-such-kind` |
    | expiring / expired line, long thread, one proposal, disconnected line | named trial-seed records (the capture agent lists their ids in the manifest header); if the seed lacks one, a `page.route` answer built from that record's real shape with only the date/status field changed, marked `synthetic: true` in the manifest |
    | per-row save dirty, dirty branding, picked picture | typing into the field / choosing a file from `visual-audit/fixtures/` — no save |
    | dialogs, menus, drawers, popovers | click the opener |
    | impersonation return bar | admin «دخول إلى الحساب» on one trial account, captured last for that door, then «رجوع» |
    | `/password` (forced change) | sign in with a fixture session whose answer requires a password change (`page.route` on the session endpoint, real shape, `synthetic: true`) — no real password change |
    | `/two-factor` check | `addInitScript` sets `sessionStorage[TWO_FACTOR_STEP_KEY]` (`lib/api`) to the check step, with the pending-session answer stubbed |
    | `/two-factor` enrol | same with `'enroll'`; `POST /auth/two-factor/setup` (fired on mount, `two-factor-screen.tsx:53`) answered by the guard with a fixture `{ otpauth: "otpauth://totp/SmileSim:fixture?secret=JBSWY3DPEHPK3PXP" }` so the QR and secret render |
    | `/enter` | the impersonation hand-off page, captured during the impersonation state above (or with its query answered by `page.route`, `synthetic: true`) |
    | sign-in error / busy | `page.route` on the login call → 401 with the real error shape (error), or an answer delayed 3 s and captured at 500 ms (busy) — never real failed logins (they count toward lockout) |
    | notice toast | `page.route` on the notice stream (`/api/v1/notices/stream`, `lib/use-notices.ts:13`) answering `text/event-stream` with one `event: notice` whose data is a fixture `NoticeRow`, captured while the toast shows |
    | wallet chip | rendered by default on main / agent / pos; captured in the shell states |
    | chart hover tip (`/wallet`) | `page.hover` on the middle point of the trend chart |
    | error boundary (`app/error.tsx`) | `page.route` → a malformed 200 answer for one page's main endpoint that makes the screen throw (the capture agent names the endpoint), or `n/a` with a reason if no such answer exists |
  - **no mutation rule:** the runner opens dialogs and types into fields but **never** clicks a submit / save /
    confirm / delete control and never calls a non-GET endpoint: a `page.route('**/api/**')` guard aborts every
    `POST|PUT|PATCH|DELETE` except the login and the impersonation enter/return calls, and records any aborted call in
    the manifest as a runner defect. Known calls made by opening something rather than by a submit:
    `POST /auth/two-factor/setup` on `/two-factor` in the enrol state (`features/auth/api.ts:27`, called from a mount
    effect, `two-factor-screen.tsx:53`) — answered with the fixture `otpauth` above; `/v1/notices/read`
    (`features/notices/api.ts:11`) fires only on a notice click or «mark all», which the runner does not click. Any other
    call the guard aborts while opening a view is answered `{ ok: true }` by the guard (so the view
    renders as for a user) and listed in the manifest as `stubbed`, not as a runner defect — the capture agent reports
    the list.
- **Verify:** runs under the EXECUTION PROTOCOL steps 1–6 like every slice. The **executor** runs it with
  `ONLY=/numbers WIDTHS=390 COMBOS=ar-dark` once and runs the canaries below (including the temporary CSS edit and its
  `git status --short` proof, which reviewers may not make: they never edit); reviewers read those outputs, re-run
  canary (a) and the kill-and-resume check themselves (sequentially, no edit), and confirm the mutation
  guard aborted nothing it should have allowed and allowed nothing else, that a killed run resumes from the
  manifest, and that `completeness.mjs` reports the killed run's missing ids and exits 0 only after the resume.
  `RUN=latest` (and `RUN` unset) re-captures instead of resuming: a second default run rewrites
  `latest/findings-*.json` (file mtimes newer than the run start). With no filter the runner captures only today's
  default set (admin, 390/768/1280, ar-dark/en-light). **Diff-script canaries** (each run sequentially, the runner
  holding the browser token): (a) two runs `RUN=canary-1` and `RUN=canary-2` of `ONLY=/numbers WIDTHS=390
  COMBOS=ar-dark FULL=1` with no change in between, an `inspected.json` mapping canary-2's ids to canary-1 →
  `diff-runs.mjs canary-2` exits 0 with every capture `unchanged`; (b) a temporary one-value CSS edit (e.g. the
  `.pane` padding, never staged, reverted at once and confirmed by `git status --short`) captured into `canary-3` →
  the script exits non-zero and lists the affected `/numbers` capture with a metric diff and a tile over 0.1%; the
  same with that capture id in `--exclude` → reported `inBlastRadius`, exit 0; (c) two runs of `ONLY=/settings` (the
  second login adds a row to the sessions list, a known-volatile region) → the masked list is ignored and the script
  exits 0. The canary runs' outputs go in the slice's evidence folder.
- **Commit:** `test(web): the visual audit covers every door, route, width, locale, theme and open state (UI maintenance P8.1)`

**Route matrix** (from `apps/web/app/**/page.tsx`; ✓ = captured on that door; R = redirect, capture only that it lands):

| Route | admin | main | agent | pos | States to script (besides each tab) |
|---|---|---|---|---|---|
| `/` | ✓ | ✓ | ✓ | ✓ | period day/month/all; offers hero; outage banner (API down) |
| `/numbers` | ✓ | ✓ | ✓ | ✓ | filter drawer (≤767), chip list open, «تفعيل رقم» dialog, row menu, empty, loading |
| `/numbers/[id]` | ✓ | ✓ | ✓ | ✓ | each tab; one operation dialog each kind (QR, swap, eSIM, change, transfer, disconnect, result); expiring / expired line |
| `/tasks` | ✓ | ✓ | ✓ | ✓ | each status tab, filter drawer, empty |
| `/tasks/[id]` | ✓ | ✓ | ✓ | ✓ | complete form open, reject form open, internal note, long thread, provider-operation panel, decision dialog |
| `/tasks/decisions` | ✓ | – | – | – | empty, one proposal |
| `/notices` | ✓ | ✓ | ✓ | – | all / unread, empty |
| `/users` | ✓ | ✓ | ✓ | – | new-account dialog, wallet menu, row menu, transfer dialog, empty |
| `/users/[login]` | ✓ | ✓ | ✓ | – | each of four tabs, price dialog, sessions dialog, policy block open |
| `/packages` | R→`/companies` | ✓ | ✓ | ✓ | company groups folded/open, per-row save dirty, POS subscribe form |
| `/companies` | ✓ | – | – | – | empty |
| `/companies/new` | ✓ | – | – | – | each step, lookup result, picked card |
| `/companies/[code]` | ✓ | – | – | – | each tab, `?provider=` filter |
| `/companies/[code]/packages/new` | ✓ | – | – | – | each step, add-on rows, chain board |
| `/companies/[code]/packages/[packageCode]` | ✓ | – | – | – | each of the tabs, line-prices dialog, drafts |
| `/companies/[code]/[provider]`, `/companies/[code]/packages` | R | – | – | – | — |
| `/providers` | ✓ | – | – | – | empty |
| `/providers/[code]` | ✓ | – | – | – | each tab |
| `/providers/[code]/[packageCode]` | ✓ (PackageMoved) | – | – | – | — |
| `/provider-accounts` | ✓ | – | – | – | empty |
| `/provider-accounts/[code]` | ✓ | – | – | – | ledger, matching, record-payment dialog, edit-credit dialog |
| `/finance` | ✓ | ✓ | ✓ | ✓ | scope all / money / operations, filter drawer, empty |
| `/profits` | ✓ | ✓ | ✓ | ✓ | each period, empty |
| `/wallet` | – | ✓ | ✓ | ✓ | 7/30/90 switch, chart hover tip |
| `/reports/balances` | ✓ | ✓ | ✓ | – | — |
| `/reports/supply` | ✓ | – | – | – | period, empty |
| `/reports/[kind]` (providers, tasks, numbers, operations) | ✓ | – | – | – | each kind, empty, unknown kind |
| `/provider-operations` | ✓ | – | – | – | period, empty |
| `/audit` | ✓ | ✓ | ✓ | ✓ | filter drawer, empty |
| `/roles` | ✓ | – | – | – | role dialog (grants, session fields, two-step policy) |
| `/offers` | ✓ | – | – | – | add-offer form, picture picked |
| `/branding` | ✓ | – | – | – | preview, dirty state |
| `/settings` | ✓ | ✓ | ✓ | ✓ | two-step method cards, passkey list, sessions list |
| `/reports`, `/reports/sales`, `/reports/orders`, `/operations`, `/settings/access` | R | R | R | R | — |
| `/login`, `/password`, `/two-factor`, `/enter` | ✓ (each door once: admin and pos) | 1280 ar-dark only | 1280 ar-dark only | | error message, busy, method choice (main and agent render the same sign-in screens; one capture each confirms the door label and nothing else differs) |
| bare host `http://localhost:3000` (door picker) | ✓ (no door) | | | | — |
| not-found (`/no-such-page`) and error boundary | ✓ | | | ✓ | — |

**Shell states** captured once per door on `/`, at the Tier 3 widths and combos below (all 8 widths × ar-dark,
en-light, he-dark): sidebar open, sidebar folded + flyout, drawer
open (≤899), search open, notices open, account menu, language menu, wallet chip, notice toast, impersonation
return bar (admin → enter an account).

**Capture tiers** (to keep the run finite on one machine):

- Tier 1 — every ✓ cell's default view and every tab: all 8 widths × all 6 combos.
- Tier 2 — open states (dialogs, popovers, drawers, menus, empty/loading/error): **one width per band** — 375, 700,
  768, 1024, 1280, 1440, 1920 (390 dropped: same band as 375) × combos per **D28** (a, recommended: ar-dark, en-light,
  he-light, ar-light; en-dark and he-dark open states are not captured, their colours being covered by Tier 1 and by
  the contrast JSON; (b) all six combos, ≈ +50% Tier-2 time). The reduction is the owner's decision, not the runner's.
- Tier 3 — shell states: all 8 widths × ar-dark, en-light, he-dark.
- Estimated size: ≈ 75 route-door cells × ~1.6 views × 48 ≈ 5,800 Tier-1 captures, ≈ 3,150 Tier 2 (D28 a), ≈ 700
  Tier 3 — about 9,650 captures; ≈ 2.5 tiles per capture on average (phone list pages are the tallest). At several
  seconds a capture (tiles, Tab walk, per-text-node contrast) this is several nights of sequential running, one door
  after another; there is **no deadline** — the run continues from the manifest on each later night until every row
  is `ok` or explained.

### P8.2 Capture run (one capture agent, sequential; non-commit step)

- **Before the run** the orchestrator asks the owner (in Arabic) for two things and records the answers in the
  Status table: the **no-data-change window** (no saves in CHK-LOOK, no owner edits on the local database, from this
  step to the end of P8.6), and a **local database snapshot** (P8.6 restores from it if data changed). `scripts/backup/`
  is the server procedure (it encrypts to a key this machine does not hold) and is **not** used; the local snapshot is
  `docker compose exec -T postgres pg_dump -U smilesim -Fc smilesim > audit-output/visual-audit/<RUN>/db.dump`
  (the dev database `scripts/dev-local.sh` uses), run by the owner or, with the owner's yes, by the orchestrator; the
  restore runs only on the owner's yes, from the repo root, in this order (`preview_stop` ends `scripts/dev-local.sh`,
  whose EXIT trap, :35, runs `docker compose stop postgres redis`, so the database must be started again before the
  restore): (1) `preview_stop` the `smilesim` server; (2) `docker compose up -d --no-build postgres`; (3) wait until
  `docker compose ps postgres` reports `healthy`; (4) `docker compose exec -T postgres pg_restore -U smilesim -d
  smilesim --clean --if-exists < apps/web/audit-output/visual-audit/<RUN>/db.dump`; (5) `preview_start` `smilesim`.
  The dump command above is run from `apps/web` (its path is relative to it); from the repo root use the
  `apps/web/audit-output/…` path. **Third item in the same message** (already asked in P0.1 question (iv); here it is
  only confirmed, or asked if the owner deferred it then): under the no-data-change window,
  verify-before-reply.mdc §4's click checks of `V.nn` slices are deferred to one `V.click` pass after P8.6's final
  capture (P8.5) — a deviation from an always-applied rule that the owner must agree to; on "no", every `V.nn` slice
  clicks its saves and the data-driven captures it touched are re-inspected after the restore. **CI before the run:**
  in the same message the orchestrator recommends a branch push and Actions run before the capture starts (if the
  owner declined every earlier push, the production build and ≈60 updated e2e specs have not yet run, and a code fix
  found after a multi-night capture forces a blast-radius re-capture). **Merges of `main` in the window:** the same
  message tells the owner that a `git merge main` carrying a Prisma migration or a seed change counts as a data change
  (`scripts/dev-local.sh` applies migrations with `prisma migrate deploy` on the next start), so such merges wait
  until after P8.6; if one is needed earlier, the data-driven captures are re-inspected (or the snapshot is restored
  and re-taken after the merge, on the owner's yes). The orchestrator checks `git diff --stat HEAD main --
  apps/api/prisma apps/api/src/modules/auth/trial-seed.ts` before any merge in the window. The capture does not start
  without the window and snapshot answers and the §4 answer.
- One agent runs the capture (`FULL=1 RUN=<id>`, one `DOOR=` at a time) with the app on 3000 and nothing else using
  the browser. It does not judge. It runs
  `node visual-audit/completeness.mjs <RUN>` after each night, re-runs the missing and `failed` ids, and the step is
  **done only when the script exits 0** (manifest ids = expected ids, every status `ok` or `n/a`+reason); it hands
  back the script's output, the manifest and counts per door/route. At the end of P8.2 the orchestrator appoints the
  **consolidation agent** (one agent, not a capture agent or inspector; the same agent does P8.4), which writes
  `units.json` for P8.3.

### P8.3 Inspection (parallel, on saved captures; non-commit step)

**Batches** group routes; the work unit is an **inspection unit** of at most **120 tiles** (about 40 captures) — one
door × route × view (or one state) across its widths and the combos below — so one agent can open every tile at full
size (verify-before-reply.mdc §2). The cap is also a **pixel budget**: a unit holds at most about 100 megapixels of
tiles (120 tiles at 390 × 1200 ≈ 56 MP; at 1440 and 1920 a tile is 1.7–2.3 MP, so a wide-width unit holds about
45–60 tiles). The consolidation agent sizes units by that budget, splitting a door × route × view across more units
at the wide widths; the viewed-record rule below is unchanged. Budgets, `assigned`, `viewed` and the sweep subsets are counted in **tiles**, not
captures. The consolidation agent (appointed at the end of P8.2) writes the unit list into
`audit-output/visual-audit/<RUN>/review/units.json` (`{ unit, batch, assigned: [tile ids] }`) before inspection
starts. Human-viewed set per **D28**: (a, recommended) Tier 1 at all eight widths (700 and 1920 included) in ar-dark,
en-light and he-light **plus 375, 700, 1280 and 1920 in ar-light, en-dark and he-dark**, every Tier-2/3 capture, and any
capture whose JSON flags a problem; (b) every Tier-1 combo at every width (with Tier 2 in all six combos); (c) the
first set without the extra three combos (they stay machine-checked only). Batches:

| Batch | Contents |
|---|---|
| V01 | Shell states (all doors) |
| V02 | `/` all doors |
| V03 | `/numbers`, `/numbers/[id]` admin + pos |
| V04 | `/numbers`, `/numbers/[id]` main + agent |
| V05 | `/tasks`, `/tasks/[id]`, `/tasks/decisions` |
| V06 | `/users`, `/users/[login]`, `/notices` |
| V07 | `/companies`, `/companies/new`, `/companies/[code]` |
| V08 | package sheet, package create, PackageMoved |
| V09 | `/packages` main, agent, pos |
| V10 | `/providers`, `/providers/[code]`, `/provider-accounts`, `/provider-accounts/[code]` |
| V11 | `/finance`, `/wallet`, `/profits` |
| V12 | reports: balances, supply, `[kind]`, provider-operations, audit |
| V13 | `/roles`, `/offers`, `/branding`, `/settings` |
| V14 | sign-in pages, door picker, not-found, error, redirects |

**Per inspection unit: one inspector + two confirmers.** Browser-free (they read saved PNG and JSON), so units run in
parallel; only split checks need the browser token.

- *Inspector* (model A) reads the JSON flags first, then every assigned tile at full size (the overview PNG only to
  judge overall layout), and checks: horizontal overflow and content
  past the edge; clipping (text, rings, cards, popups); alignment (shared edges, baselines, the gutter, numbers to the
  reading end); spacing (tokens and the template's rhythm); contrast (JSON ratios; text ≥4.5, boundaries/icons ≥3);
  touch size (<767 ≥44px); RTL mirroring (arrows, slide directions, cut corners, Latin isolation) comparing ar/he with
  en; hierarchy (one primary per view, the lead figure, head facts not repeated); consistency with DESIGN.md (the same
  element looks the same on every page of the batch and matches the rule); dark/light parity; states (empty, loading,
  error) present and centred. Output per finding: `{ id: "V03-07", door, route, view, state, locale, theme, width,
  capture: "<path>", selector or box, rule broken (DESIGN.md line or WCAG criterion), what, severity }`.
- *Confirmers* (models B and C, independently, without seeing each other's verdicts) do two things:
  1. **clean sweep first, before seeing the inspector's findings:** each opens every tile of a fixed subset of the
     unit's captures the inspector marked clean — at least 375, 700, 1280 and 1920 of every view in ar-dark and en-light,
     plus three captures of its own choosing — and records its own findings ("missed"); this checks the inspector's
     *clean* verdicts, not only its positive ones;
  2. then opens each inspector finding's capture (and its neighbours at the other widths/combos) and answers
     `confirm | reject` with a reason.
  A "missed" finding from a confirmer then needs the inspector's and the other confirmer's confirmation.
- **Viewed record:** every verdict file (inspector and both confirmers) carries `"viewed": [tile ids]`. The P8 gate
  checks `viewed ⊇ assigned` for the inspector and `viewed ⊇ sweep subset` for each confirmer; a unit whose record
  falls short is re-assigned.
- A finding is **confirmed** when both confirmers confirm it. **Rejected** when both reject. A split goes to one live
  check on 3000 by a fourth agent (built-in browser, holding the browser token; split checks run **one at a time**);
  if still unclear, it goes to the owner's list.
- Output per unit: `audit-output/visual-audit/<RUN>/review/<unit>-{inspector,confirmer-B,confirmer-C}.json`, merged
  per batch into `review/V03.json` (findings with verdicts).
- **Inspected map:** when a unit's three verdict files pass the viewed-record check, the consolidation agent writes
  each of its capture ids into `audit-output/visual-audit/inspected.json` with the RUN they were read in (P8.2's RUN
  here; later RUNs in P8.5 and P8.6). This file is the only record of "the run each capture was last inspected in"
  that `diff-runs.mjs` reads (P8.1).

### P8.4 Consolidation

- One agent merges the batch outputs, removes duplicates across batches (same selector + rule = one defect with all
  its captures), groups confirmed defects by root (token, component, template, page) and writes
  `docs/reviews/2026-11-13-visual-audit.md` (what was captured, counts per batch, confirmed / rejected / disputed, the
  defect list with ids and the fix slice each goes to). Two reviewers check the record against the batch files
  (EXECUTION PROTOCOL steps 3–4). The consolidation agent stages the record only; after both reviewers approve the
  orchestrator commits it (step 5) as `docs(web): visual audit record (UI maintenance P8.4)` (step 6's shape); the
  batch files stay in the run folder.

### P8.5 Fix loop

- Confirmed defects become fix slices `V.01`, `V.02`, … (grouped by shared cause, one slice each), each with the same
  fields as a plan slice, run under the **EXECUTION PROTOCOL** (1 executor + 2 reviewers, fixer loop, round limit,
  escalation). Each fix slice declares its **blast radius** in a `Blast radius:` field: the class (page / template /
  component / token) and, for template, component or token fixes, the grep-derived list of every route that renders
  the changed template, component, class or token (e.g. `grep -rln "<Pane" features` → routes; a token → every sheet
  rule using it → every route rendering those selectors, via the capture JSON's selector lists). Reviewers check the
  list. After the fix: re-capture **the blast-radius set** (page fixes: the defect's routes) × all widths × all combos
  for Tier 1, Tier 2 sizes for states, and re-inspect with **1 inspector + 2 confirmers** in units as in P8.3, looking
  for the defect and for regressions anywhere in the set. A defect closes only when both confirmers agree it is gone.
  **Run mechanics:** every blast-radius re-capture goes to a **new** RUN id (`RUN=<P8.2 RUN>-v<nn>-<k>`, `FULL=1`),
  never into the inspected run (the runner would skip ids already `ok` there and the re-inspection would read pre-fix
  PNGs). The capture agent narrows it with `ONLY` / `DOOR` / `WIDTHS` / `COMBOS` / `STATES`; the runner writes that
  RUN's own `expected.json` from the same filters, and `completeness.mjs <that RUN>` must exit 0 before inspection
  starts. After the 1+2 re-inspection passes the viewed-record check, the consolidation agent updates
  `inspected.json` for every re-captured id to the new RUN (P8.3 "Inspected map") and appends the slice's blast
  radius to the round's `blast.json` exclusion file that P8.6 passes to `diff-runs.mjs`.
  `Pn.fix-k` slices created by a phase gate declare a blast radius the same way. The text of every `V.nn` slice is
  written, checked and committed as the protocol's "Fix slices" rule says before its executor starts.
- **Saves inside the no-data-change window:** a `V.nn` slice runs CHK-LOOK without clicking any save, submit or delete
  (verify-before-reply.mdc §4's click step is deferred): it checks the control's look, focus and disabled state, and
  lists the click checks it owes in its evidence note. Those clicks run once, after P8.6's final capture has been taken
  and inspected (or after the owner's restore of the snapshot), in one `V.click` pass by one agent holding the browser
  token, checked by two reviewers; a failure there becomes a `V.nn` slice and re-enters the loop.

### P8.6 Final gate (non-commit step, except the final merge)

- **Final full re-capture:** after the last fix slice, the capture agent runs Tier 1–3 again in full (new `<RUN>`,
  `FULL=1`; `completeness.mjs` exits 0 on it), and `node visual-audit/diff-runs.mjs <RUN> --inspected
  audit-output/visual-audit/inspected.json --exclude <blast.json>` (P8.1) diffs every capture's JSON metrics (boxes,
  computed sizes, colours, contrast, overflow) and pixels (threshold 0.1%) against the run each capture was last
  inspected in, as recorded in `inspected.json`; `blast.json` is the union of the blast radii already re-inspected in
  P8.5. The script is run by the consolidation agent (browser-free: it opens no page on 3000). To keep that diff
  meaningful: the clock is
  frozen in the runner (P8.1), and between the inspected runs and the final run there is a **no-data-change window**
  — no CHK-LOOK clicks that save, no owner edits on the local database — agreed with the owner in Arabic before
  P8.2; if data did change, the orchestrator asks the owner to restore the local database from the snapshot taken
  at the start of P8.2 (the `pg_restore` command in P8.2, on the owner's yes) or accepts that the data-driven captures are re-inspected. Every capture that changed **outside** a fixed
  defect's declared blast radius is listed in `review/unexplained.json` and goes back through 1 inspector + 2
  confirmers; entries confirmed harmless are re-inspected 1+2 and their ids move to the final RUN in `inspected.json`;
  confirmed regressions become `V.nn` slices and the loop repeats. **Bound:** only the first final run is a
  full Tier 1–3 capture; each later round re-captures the blast-radius set of that round's `V.nn` slices into a new
  RUN and runs the diff script on that set against `inspected.json` (which by then points at the previous final run
  for every capture not re-inspected since). After **three** such rounds with a confirmed regression still
  open, the orchestrator stops and escalates to the owner with the open list and the options.
- Two gate agents confirm: every matrix cell captured or n/a with a reason — `node visual-audit/completeness.mjs
  <RUN>` exits 0 on the final run (its `expected.json` re-expanded from the same matrix and D28 answer), output
  attached; every inspection unit inspected 1+2 with the
  viewed records complete; every confirmed defect closed or answered by the owner; the final run's manifest exists and
  `unexplained.json` is empty (or every entry confirmed harmless by 1+2); `docs/reviews/2026-11-13-visual-audit.md`
  complete; CHK-LOCAL clean; the plan Status table complete; **after the last `V.nn` / `Pn.fix-k` slice**, every
  map's "Last verified" line still matches (re-bumped if a fix slice edited the map), `graphify update .` has been run
  once more, and the Status table lists every fix slice with its hash; **CI on the branch:** a GitHub Actions run on
  the `ui-maintenance` branch at the final HEAD has the `verify`, `db` and `e2e` jobs each concluded `success`
  (job conclusions and the e2e failed-spec list read as in G6; the production build and the ~60 updated e2e specs are
  checked nowhere else), **or** the owner has waived it in writing in this conversation, recorded in the Status table
  with the date. To get that run, the orchestrator first asks the owner to push the branch (it never pushes on its
  own); every untested spec carried forward from earlier gates ("CI not run") is covered by this run. Then the
  orchestrator tells the owner the work is ready; only on «ادمج في المين», and only after that branch run has been
  read (or waived), it merges `ui-maintenance` into `main` (a fast-forward when possible, otherwise a merge commit, never a rebase —
  machine-limits.mdc), pushes, and watches the GitHub
  Actions run (protocol step 5).

---

## Fix slices

`Pn.fix-k` and `V.nn` slices are appended here by their named author (EXECUTION PROTOCOL, "Fix slices"), each with
Goal, Files, Steps, Closes, Risks, Verify, Blast radius and Commit, checked by two agents and committed as
`docs(plan): add <slice>` before its executor starts. None yet.

---

## Review notes

Round 1 (three reviewers; 13 blocking items, all verified against the tree on 2026-11-13 and applied). Items applied
only in part, or not changed, and why:

- P0.9 (reviewer: move `.notice-count`'s background and colour to the fill pair): **not moved.** graphite :595 makes
  `.notice-count` an 8px dot with `font-size: 0`, so it carries no content; it stays on `--rd-accent` as decoration
  (listed under "stay" in the P0.9 table). The reviewer's `.gauth-art-mark` at :325 is `.gauth-mark` (:318–327) — that
  one is in the table; `.gauth-art-mark` (:443) is a position rule with no fill.
- P1.2 / P1.8 visible items (reviewer: split into their own slices): **kept in their slices, made explicit.** P1.2's
  four visible lines are the direct result of defining the tokens the slice exists to define; splitting would create a
  slice that re-edits the same four lines. Instead they are listed in the spec's visible changes and in the P1 gate,
  CHK-ZERO differences must be attributed to the named elements only, and P1.2 runs CHK-LOOK + CHK-AUDIT. P1.8's zebra
  and 1px gaps are now zero-diff by default (D23 a, D6 a) and become visible only on the owner's other answer.
- P0.6 (reviewer: scope the notice change or state it): **scoped further than asked.** Both popups change only under
  `@media (max-width: 767px)`; the `@container topbar (max-width: 720px)` block is left as it is, because on desktop
  viewports where it fires the button-anchored popups fit. (Round 2 corrected the mechanism: the anchoring rules now
  sit in a second 767 block placed after the container block, because the container block wins for search on phones.)
- 3.3-32 (reviewer: needs a conditional slice for D12 = now): **no slice added inside this plan.** D12 = now means a
  page-width feature with its own layout decisions per template; the spec and G2 now say that answer triggers a
  separate spec and plan before P4, checked by the P4 gate.

Round 2 (three reviewers; 3 blocking items, 2 coverage gaps, 37 minor items). Every blocking item and gap was verified
against the tree on 2026-11-13 and applied: the 641–767 width (700) and one-width-per-band Tier 2 in P8.1 with the
reduction put to the owner in D28; tiled captures with budgets and viewed records in tiles (P8.1, P8.3; checked
against `visual-audit/audit.visual.ts:96–100`); the usage-ring `<svg>` (`line-details.tsx:87`) given to P3.8 and a dry
run added to P3.13; 3.10-32 → P6.7 and 3.10-29 → P6.5. Minor items verified and applied, including two the reviewers
found in the code: P0.6's container block overriding the phone search rule (`shell.css:745–756`), and `.wallet-word`
being a live hide rule over a rendered span (`app-shell.tsx:514`). Not changed, and why:

- Guard (k) is a ratchet counted from P1.1 and failing-at-zero only at the P2 gate, not a new phase gate earlier:
  P1.5–P1.8 tokenise the surviving sheets and graphite's literals are tokenised as they move in P2, so earlier zero
  would force a second rewrite of graphite rules.
- The reviewer's option "edit both blocks" for P0.6 was not taken: editing the container block would change the
  desktop 900–1000px popups (unlisted); a later 767 block reaches phones only.
- P2.1b `.wallet-word`: the reviewer's first option (delete the span with all three rules) was taken over "keep
  graphite :479", because a hidden element kept alive by a patch rule is exactly the drift this plan removes; it stays
  zero-diff (the span is `display: none` at every width today).
- `.user-btn` also has a rule at `responsive.css:8` (the reviewer listed `base.css` only); it is included.

Round 3 (three reviewers; 5 blocking items, 2 coverage gaps — the same C24 gap from two reviewers — and 26 minor
items). Every blocking item was verified against the tree on 2026-11-13 and applied:

- C24 / 3.6-24: all ten disabled-opacity rules found by grep (`ui.css:31,101`, `controls.css:36–37`, `dialog.css:180`,
  `desk/pane.css:132`, graphite :401, :681, :1284, `desk/components.css:52,229`) are listed in P3.1 step 4 and set to
  the token; guard (l) added in P1.1 and required at 0 by the P3 gate; the spec lists 0.6 → 0.5 for the Select and
  the outage bar; the P3.7 reference dropped from P1.4 and the spec (no disabled work lives in P3.7).
- P5.2 tablet topbar: confirmed (graphite :450–451 gives 36px from 768; `shell.css:697–713` gives 2.75rem only to
  767). Option (1) taken, because R21 and L16 both ask for it: the 44px drawer-mode topbar at 768–899 is a listed
  visible change with a fit check on all four doors and a recorded fallback to 36px (the report's own L16 note); D27,
  the P5 and P6 gates name the exception. No new owner decision was added, so D1–D28 stay as numbered.
- Length line-heights: confirmed (`ui.css:44,45,104`, `shell.css:593`, graphite :183, :253, :923). `--rd-leading-control`
  (1.25rem) added; the four fixed-box centring values go to the guard's named one-off allowlist, now covering (j).
- Wide monitor: 1920 added to P8.1 Tier 1–3, D28, the viewed set and confirmer sweeps, CHK-LOOK for layout slices,
  and a P5 gate measurement (screen-size.mdc; `.canvas-inner.wide` has no max width).
- CI: G6 reads each job's conclusion and the e2e failed specs (the e2e job is `continue-on-error`); P8.6 requires a
  branch run with `verify`, `db` and `e2e` passing at the final HEAD, or a written waiver, before the merge.

Minor items applied: P2.1a keeps the three live `--rd-login-*` tokens; P2.2 includes `roles-screen.tsx:146` and keeps
the `frame.css :has(.stack)` rules unless CHK-ZERO proves them inert; P1.8's `.stat-value` line-height called live;
P0.9 moves the checked-box border to the fill and scans `color-mix` hover recipes; DESIGN.md:299 in P6.6 and P7;
P0.8 risk wording; CHK-ZERO reuse rule (tree equality, not HEAD), `git stash push -- <paths>`; `ONLY` substring note;
P0.7 Done by CHK-LOOK; P8.2 asks for the snapshot and the no-data-change window; P8.6 re-checks maps, Status table
and graphify after the last fix slice; graphify deferral stated once in the protocol; P3.13 dry-run command; P8
auto-POST stub rule; capture estimate without a deadline; main/agent sign-in captured once; scripts named in the
doc-sync rule; P3.14 row edges kept per D6 a; P4.4 re-pricing card left as is with a reason; P4.5 fixes
DESIGN.md:126/255; tokens introduced by later slices documented in the slice that adds them; no letter-spacing token
(recorded in P1.4). Not changed, and why:

- The reviewer suggested placing the field and checkbox part of C24 in P3.7; it stays in P3.1 so one slice owns the
  whole token switch and the guard can reach 0 in a single commit; the appendix row names P3.1 step 4.
- No auto-POST endpoint was found to allowlist (`/v1/notices/read` fires only on a click); the guard instead
  stubs any call made while opening a view, so the runner does not misreport it as a defect.


Round 4 (three reviewers; 3 blocking items, no coverage gaps, 36 minor items). Every blocking item was verified
against the tree at HEAD `626f61b` and applied:

- Snapshot determinism (CHK-ZERO): confirmed — `tests/dom-snapshot.mjs:177` waits a fixed 400ms, emulates no reduced
  motion, and `rd-rise 420ms both` staggers, `rd-drop`, `filter-slide` and infinite `spin` / `shell-bell` / `shimmer` /
  `trend-breathe` run during the hash. P1.1 now settles every animation (`finish()`, else `cancel()`) before each hash
  and after each forced state, hashes the forced element's subtree, keys rows by a stable key, and requires two
  byte-identical runs before P1.2; CHK-ZERO and the P1 gate say so.
- P2.10 token-use check: confirmed — the ring, icon, dir, gutter, disabled-opacity, popup, row-h, form/field-gap and
  figure-lg/-sm tokens are first applied in P3–P6. P1.4 now has a first-use table; P2.10 checks only its first row;
  the P6 gate checks every token in `tokens.css`.
- Fix-slice authorship: confirmed — no role wrote `Pn.fix-k` / `V.nn` text. The protocol now names the author, the two
  checkers, the `docs(plan): add <slice>` commit and the "Fix slices" section above; every orchestrator Status edit
  goes through a Status-only `docs(plan)` commit.

Minor items applied: header hash; P6.5 member-by-member replacement table and toast / row-menu measurement; G2 lists
the findings closed by an accepted decision (3.4-17, 3.4-04's row edges, 3.1-13's zebra recipes, 3.1-08 / 3.1-12);
graphite's 19 `ink) 11%` mixes → `--rd-line-strong` in P2.10 with a grep in its Verify and the P2 gate (3 more in
`desk/` are P1.8's — 22 in all); P3.7 framed-field recipe keeps both heights; P5.5 lead size under 767; P2.2 deletes
only `flex: 1` and `.pane.fit`, keeps `.desk .sheet`'s `overflow: auto`; P2.1c names the dead `td.when` declarations;
P5.6 `@supports` instead of a repeated declaration; P0.9 hover rule scoped to `:not(:checked)`; P3.1 removes the
`.ui-btn-outline` selectors and keeps dimming for raw dialog buttons; P3.2 e2e list (+`packages-terms`,
`activation-request-key`) and the add-on delete given to P3.3; P6.2 `dir` on the `<input>` only, with
`direction-theme.mdc:11` amended; `--ui-btn-shadow` raw colour in P1.5; P7.1 aligns the three rule files; P0.1 asks
the rule-file, graphify and D28-cost questions and limits the interim precedence sentence to quoted answers; P8.1
state sources for the sign-in pages, two-factor setup stub, toast, wallet chip, chart tip and error boundary, one
login per door, known-volatile regions, CHK-AUDIT's `latest/` path kept; P8.2 local `pg_dump` / `pg_restore` instead
of `scripts/backup/`; P8.5 save clicks deferred to a `V.click` pass; P8.6 loop bound; shell-state widths aligned with
Tier 3; branch answer (b) wording; P1.1 exempt from the P1 gate's diff; P5.2 drops `.avatar-btn`; P3.6 tick space
named as a token; `contrast.mjs` wired into lint in P6.4. Not changed, and why:

- P1.1 guard (a) is not given a same-rule exemption (sonnet's first option): the one place that would need it (P5.6)
  now uses `@supports`, and an exemption would hide real same-rule duplicates.
- Reduced motion is not emulated in the snapshot (it would hide the stagger and motion rules P2.4, P2.7, P2.9 and P6.1
  move); settling the animations is used instead, as the reviewer proposed.

Round 5 (three reviewers; 3 blocking items, all verified against the tree on 2026-11-13 and applied):

- P0.6 / P0.8 used CHK-ZERO before P1.1 makes it deterministic (`dom-snapshot.mjs:177`, fixed 400ms, `rd-rise` with
  staggered delays): CHK-ZERO is now defined as usable only from P1.1 on, and P0 "unchanged" proofs use the new
  **CHK-READ** (scripted computed styles and boxes of the named elements, animations finished, before/after JSON diff).
- CHK-LOOK vs narrower Verify lines: CHK-LOOK now carries a binding sentence (every visible slice runs CHK-LOCAL +
  CHK-LOOK + CHK-AUDIT; a slice's listed widths and pages are additions, never a narrower set), so no per-phase header
  is needed for P4–P6.
- P8 capture completeness: P8.1 writes `expected.json` before capturing, every manifest row carries its expected id,
  failures are rows (`failed` / `n/a` + reason), and `visual-audit/completeness.mjs` decides P8.2's done, the P8 gate
  and P8.6; the timeout wording is corrected (`audit.config.ts:11` is the per-test timeout).

Minor items applied: P3.12 keeps 4px (`--rd-space-1`) and 70ms (`calc(var(--rd-stagger) * 1.75 * var(--i))`); P6.5
names all six graphite-640 40px members and the `frame.css:51–55` 720 rule, states the (0,3,1) specificity the 44px
field rule needs for `desk-system.spec.ts`, and raises the toast through the notice **stream** (`use-notices.ts:13`;
the shell has no toast-raising poll); P1.2 removes the `.grant` (:1078) and `.trend-tip` (:1143) fallbacks; P2.8 places
the 900 media block after the 36rem container block, and P5.6 states the 900–~916 stacking as a visible change (added
to the spec; amended in P0.5: measured, no viewport ≥ 900 has a ticket ≤ 36rem, so that stacking does not occur — see
P0.5 Verify, P2.8 and P5.6; the spec's P5.6 line still holds the first text, and P5.6's executor corrects it as its
own amendment, with the text written in P5.6's "Before you start"); P0.5 fallback caps the rail in `dvh`/`rem`; P0.4 makes the `::before` ring the primary approach; P0.9
records the new `primaryBg` and lists `smilesim-ui.mdc`; appendix 3.7-03 points at P2.11/P3.8 for weights; P4.4 writes
the create template in DESIGN.md; branch precondition and owner wording (plan and spec); P8.2 restore order and path,
§4 deferral and pre-capture CI recommendation asked of the owner, consolidation agent appointed at the end of P8.2;
phase-gate round bound; P7-gate CI warning; P2.10 regenerates the boards (they list every stylesheet); CHK-ZERO stash
uses `--include-untracked` / `pop --index`; P1.1 records one CHK-ZERO side's wall time. Not changed, and why:

- P0.6 "1000 is outside the container range" (sonnet): not changed in substance. The container query measures the
  topbar's **content box**, inside its 28px padding (graphite :447), so with the 268px sidebar it fires up to a viewport
  of about 1044 (1000 − 268 − 56 = 676 ≤ 720); the Verify line now says so and adds 1024.

Round 6 (three reviewers; 1 blocking item, no coverage gaps). The blocking item was verified against the tree on
2026-11-13 (`apps/web/package.json` has no pixel library; `audit.visual.ts:8` defaults `RUN` to `latest`; P8.1 made
the runner resumable; no slice owned the P8.6 diff script) and applied: P8.1 adds `visual-audit/diff-runs.mjs`
(inputs, metric keys, a Chromium-canvas pixel diff with masks and no new dependency, blast-radius exclusion, output
`review/unexplained.json`, non-zero exit) with three canaries; resume applies only to an explicit non-`latest` RUN,
and `RUN=latest` always re-captures; the runner's defaults stay today's and the full matrix is `FULL=1`; P8.5 sends
every re-capture to a new RUN with its own `expected.json` and completeness check; the consolidation agent keeps
`inspected.json` (capture id → RUN last inspected), which P8.6's diff reads.

Minor items applied: the P8.6 merge is a fast-forward when possible (machine-limits.mdc); G5 runs the board generator
in any phase that adds, removes or renames a listed file; CHK-AUDIT names unlisted routes ("not covered by the
runner", carried by CHK-LOOK), sets `DOOR`/`USER_LOGIN` per door and clears `latest/` before P8.1; `contrast.mjs`
joins CHK-LOCAL from P0.9; a mid-phase amendment path in the protocol; a 45-minute CHK-ZERO threshold with an owner
question; CHK-ZERO's Verify-line sets are additions (P4.10, P6.3 named); CHK-LOOK checks verify-before-reply.mdc §5
data states; P4.3 delays endpoints instead of throttling; P6.5 names the `hover: none` emulation; P7.2 has a Verify
line and P1.6–P1.8 / P2.5–P2.9 a Goal line; P8.2 holds merges of `main` that carry migrations or seed changes; Reviewer
A checks the unstaged diff is empty before the CHK-ZERO re-run; P8.3 sizes units by a pixel budget; P4.1 keeps the
`action` alias unwrapped (no double `.page-actions`), adds `actionsClassName`, and keeps the `{lede ?` literal; P4.10
names every remaining `action={…}` Desk caller (roles-screen included) with greps and a one-wrapper check; P2.4 names
the third stagger shape (`.figure-band` / `.home-main`, children 2–4 only, `home.css:330–334`); P3.3 says the add-on
delete is already an outline `Button`; P0.9 line references corrected (`controls.css:24–25`, `:28–29`, `:32–33`);
the spec drops "avatar" from the 768–899 topbar bullet (no topbar avatar is rendered; `.avatar-btn` is in no `.tsx`)
and cites the appendix as the full finding list; the P7 and P8 gate rows say that under D6 a / D23 a / D12 later the
decision-kept differences stay visible. Not changed, and why:

- P0.6 / P5.2 popup anchoring at 768–899 (sonnet): no change needed, as the reviewer says; the P0.6 Verify list
  already includes 768 and 899, and P5.2's executor re-measures the popups after the 44px change under CHK-LOOK.
- H20's second half (opus): kept as the reasoned "left as is" note in P4.4's commit body; after P3.2 the re-pricing
  button is already secondary, which is the report's suggested fix. Reviewers of P4.4 confirm it against the report.

Round 7 (three reviewers; 1 blocking item, no coverage gaps). The blocking item was verified on 2026-11-13
(`docs/architecture/decisions/0020-modular-monolith-and-the-end-of-office.md` exists, accepted, cited by
`docs/architecture/backend.md`, `docs/architecture/README.md` and the office-retirement plan) and applied: the UI
decisions ADR is **0021** (`0021-ui-maintenance-decisions.md`) everywhere in the plan and spec, and P0.1 step 2 checks
`ls docs/architecture/decisions/` first and renumbers every reference in the same commit if 0021 is taken; the
working-tree note no longer lists a dated `git status`; the header records HEAD `82fb84c` (docs-only).

Minor items applied: a "Concurrent plan: office retirement" paragraph in the protocol (W.1/W.2, R.11b/R.11c merges
only at a phase boundary, followed by a `docs(plan): amend`, held in the P8.2–P8.6 window); P0.1 step 5 amends slice
text for non-recommended answers before P0.2 (D2 = b stops for a re-plan) and P0.9 no longer says "adapt"; P0.1
question (ii) also asks the board-generator deferral and question (iv) pre-asks the §4 `V.click` deferral (P8.2 only
confirms); P8.1's canaries and the temporary CSS edit are run by the executor, reviewers read the outputs and re-run
the no-edit checks; CHK-LOOK makes the §4 click/jump check and §6 "Not checked" list mandatory; the D28 row says no
option is a literal full matrix and offers (d); P8.4 is staged by the consolidation agent and committed by the
orchestrator under the protocol; P6.8 runs the generator as the last slice of P6; the appendix ends six multi-slice
cells with one "closed in Px.y", marks 3.6-25 as a duplicate of 3.5-15, and the س2 root-cause row points at D6 for
rounding; the P7 gate row and the spec's out-of-scope list say D6 b / D23 b / a D12 width need a follow-up spec;
P0.9's `.notice-dot` / `.login-seam` lines corrected to shell.css:657 / auth.css:115; P0.5 adds 900 and 960 with the
sidebar open (graphite's 900 column rule); P0.6's evidence note states the topbar's sticky, container-type and
backdrop-filter. Not changed, and why:

- P8.4 commit type (fable): kept `docs(web): …`; protocol step 6's shape is `<type>(web): …`, so `docs(web)` already
  matches it (the reviewer's "`docs`, not `docs(web)`" reads the shape the other way round).

---
## COVERAGE APPENDIX (mandatory)

Every confirmed finding of the audit (`docs/reviews/2026-11-13-ui-audit.md`) §3, by table and row order. "Report #" is the report's own row id. File paths are relative to `apps/web/`; the line is the report's first location (checked 2026-11-13). "A → B" means the tokens or first part land in A and the finding is closed (and checked by the gate) in B.


### Table 3.1 — 3.1 Design Tokens (29)

| Id | Report # | File:line | Summary | Closing slice |
|---|---|---|---|---|
| 3.1-01 | T1 | `app/styles/graphite.css:523` | Two on-crimson tokens; white on crimson fails in dark | P0.9 (D1) |
| 3.1-02 | T2 | `app/styles/graphite.css:514` | Chosen page number ink while the doc says crimson | P2.3 (D3) |
| 3.1-03 | T3 | `app/styles/responsive.css:5` | Phone `.stat-value` shrink overridden by graphite | P5.5 (D10) |
| 3.1-04 | T4 | `app/styles/desk/frame.css:91` | Page title size defined three times, 20px wins | P2.2 (D4) |
| 3.1-05 | T5 | `app/styles/forms.css:4` | Type scale stops at 18px; display sizes are literals | P1.4 → P2.10 |
| 3.1-06 | T6 | `app/styles/base.css:22` | Global svg reset beats lucide size and stroke props | P3.4 |
| 3.1-07 | T7 | `app/styles/graphite.css:1044` | Undefined `--rd-text` used in four rules | P1.2 |
| 3.1-08 | T8 | `app/styles/graphite.css:56` | Half-pixel font sizes outside the scale | P1.4, P1.5, P1.7, P1.8 → P2.10 (D6; guard (f) = 0 at the P2 gate) |
| 3.1-09 | T9 | `app/styles/shell.css:312` | rem font sizes falling between scale steps | P1.7 → P1.8 |
| 3.1-10 | T10 | `app/styles/graphite.css:181` | Literal font sizes that equal existing tokens | P2.10 |
| 3.1-11 | T11 | `app/styles/ui.css:43` | Literal spacing equal to space tokens; pane 18px unnamed | P1.5–P1.8 → P2.10 (guard (k) = 0) |
| 3.1-12 | T12 | `app/styles/doors.css:6` | Spacing values off the 4px step | P1.5, P1.8 → P5.3 (D6) |
| 3.1-13 | T13 | `app/styles/graphite.css:29` | Strong hairline unnamed; `--rd-line-strong` undefined; two zebra recipes | P1.2 → P1.8 (zebra per D23) → P2.10 |
| 3.1-14 | T14 | `app/styles/tokens.css:51` | `--rd-primary-bg` named for buttons, serves ink fills | P1.3 |
| 3.1-15 | T15 | `features/lines/screens/numbers-screen.tsx:251` | `ui-btn-accent` duplicates the primary button class | P2.1c |
| 3.1-16 | T16 | `app/styles/tokens.css:70` | Radius aliases with equal values; doc mismatch | P1.3 |
| 3.1-17 | T17 | `app/styles/graphite.css:1126` | Literal radii remain (999px, 4px, 1–2px) | P1.4 (radius tokens), P1.7 → P2.10 (guard (k) = 0) |
| 3.1-18 | T18 | `app/styles/tokens.css:28` | Theme-independent tokens repeated inside `.dark` | P1.3 |
| 3.1-19 | T19 | `app/styles/auth.css:33` | Dead `.login-*` rules and 17 unused login tokens | P2.1a |
| 3.1-20 | T20 | `app/styles/tokens.css:60` | Light warning-soft not derived from the warning colour | P1.2 |
| 3.1-21 | T21 | `app/styles/tokens.css:109` | DESIGN.md shadow values differ from the tokens | P7.1 |
| 3.1-22 | T22 | `app/styles/base.css:98` | Literal motion values and four copied staggers | P1.5–P1.8, P2.4 (one stagger block) → P2.10 |
| 3.1-23 | T23 | `components/desk.tsx:70` | Inline gap and donut delay literals in components | P3.12 |
| 3.1-24 | T24 | `app/styles/controls.css:16` | Checkbox border 32% ink instead of field token | P6.4 |
| 3.1-25 | T25 | `app/styles/graphite.css:1453` | Hand-built role-field focus halo weaker in dark | P6.4 |
| 3.1-26 | T26 | `app/styles/shell.css:581` | `.notice-count` defined in four places | P2.1b |
| 3.1-27 | T27 | `app/styles/desk/home.css:358` | Fallback values contradict their tokens | P1.2 |
| 3.1-28 | T28 | `app/styles/desk/pane.css:50` | Desk declarations dead under graphite overrides | P2.1c |
| 3.1-29 | T29 | `features/auth/screens/login-screen.tsx:136` | Hand-drawn SVG icons outside lucide | P3.4 |

### Table 3.2 — 3.2 Responsive / Mobile (26)

| Id | Report # | File:line | Summary | Closing slice |
|---|---|---|---|---|
| 3.2-01 | R1 | `app/styles/shell.css:722` | Search and notice popups clipped off-screen at 375 | P0.6 |
| 3.2-02 | R2 | `app/styles/desk/users.css:146` | Price fields overflow their phone card cells | P0.7 |
| 3.2-03 | R3 | `app/styles/desk/tasks.css:229` | Task ticket clips the thread and compose bar | P0.5 |
| 3.2-04 | R4 | `app/styles/graphite.css:455` | Empty 164px search box between 768 and 899 | P5.2 |
| 3.2-05 | R5 | `app/styles/graphite.css:447` | Topbar 28px padding cancels the phone padding | P0.8 (+P5.3 re-checks the phone gutter; D9); **closed in P0.8** |
| 3.2-06 | R6 | `app/styles/responsive.css:5` | Phone figure values too large and clipped | P5.5 (D10) |
| 3.2-07 | R7 | `app/styles/responsive.css:42` | 44px touch block misses portalled popups | P6.5 |
| 3.2-08 | R8 | `app/styles/dialog.css:171` | Dialog date button 34px beside 44px field | P6.5 |
| 3.2-09 | R9 | `app/styles/dialog.css:217` | Row-menu trigger only 28px wide | P6.5 |
| 3.2-10 | R10 | `app/styles/dialog.css:68` | Dialog and doors use 100vh, not dvh | P5.6 |
| 3.2-11 | R11 | `app/styles/desk/branding.css:16` | Brand drop tracks overflow at 961–990px | P5.4 |
| 3.2-12 | R12 | `app/styles/desk/packages.css:39` | 180px grid tracks leave one card on phones | P5.4 |
| 3.2-13 | R13 | `app/styles/desk/frame.css:18` | Page content edge shifts between page kinds | P5.3 (D9) |
| 3.2-14 | R14 | `app/styles/desk/tasks.css:22` | Task board columns jump when crossing 900px | P5.6 |
| 3.2-15 | R15 | `app/styles/dialog.css:49` | No breakpoint scale; 24 different widths | P5.1 |
| 3.2-16 | R16 | `app/styles/desk/numbers.css:108` | Two-column facts break words mid-word on phones | P5.4 (D15) |
| 3.2-17 | R17 | `app/styles/desk/users.css:11` | Grant list squeezes names from 1101px | P5.1 |
| 3.2-18 | R18 | `app/styles/desk/users.css:132` | Nowrap terms name overflows the phone card | P5.4 |
| 3.2-19 | R19 | `features/catalog/screens/providers-screen.tsx:40` | Long text columns without wrap force scrolling | P5.4 |
| 3.2-20 | R20 | `app/styles/shell.css:449` | Notice toast covers the wrapped topbar path | P5.6 |
| 3.2-21 | R21 | `app/styles/graphite.css:451` | 36px topbar icons start at 768, not 900 | P5.2 |
| 3.2-22 | R22 | `app/styles/desk/table.css:132` | Dead time-cell wrap rule under 1100 | P2.1c |
| 3.2-23 | R23 | `app/styles/desk/frame.css:53` | 720 block duplicates the touch field heights | P2.1c |
| 3.2-24 | R24 | `app/styles/auth.css:246` | Dead login responsive blocks; `.auth` touch selectors | P2.1a + P6.5 |
| 3.2-25 | R25 | `app/styles/shell.css:654` | `.wallet-word` rule and 16rem search width dead | P2.1b |
| 3.2-26 | R26 | `app/styles/graphite.css:1288` | Pick tick overlaps long names in cards | P3.6 |

### Table 3.3 — 3.3 Layout and Grid (34)

| Id | Report # | File:line | Summary | Closing slice |
|---|---|---|---|---|
| 3.3-01 | L1 | `components/desk.tsx:37` | Desk head has no title block; pages build own | P4.2 (API in P4.1); **closed in P4.2** |
| 3.3-02 | L2 | `features/lines/screens/line-card-screen.tsx:176` | Number card passes empty lede, draws second head | P4.2 |
| 3.3-03 | L3 | `features/catalog/screens/packages-screen.tsx:364` | Hand-built loading states with empty pane heads | P4.3 |
| 3.3-04 | L4 | `features/catalog/screens/company-screen.tsx:210` | Save button placed six different ways | P4.4 |
| 3.3-05 | L5 | `features/wallets/screens/finance-screen.tsx:151` | List toolbars come in four shapes | P4.5 (D16) |
| 3.3-06 | L6 | `features/wallets/screens/wallet-screen.tsx:53` | Table titles drawn three different ways | P4.5 |
| 3.3-07 | L7 | `features/wallets/screens/profits-screen.tsx:45` | Filter search field written three ways | P4.5 |
| 3.3-08 | L8 | `features/accounts/screens/packages-terms.tsx:148` | Hand-written filter bar loses the phone drawer | P4.5 |
| 3.3-09 | L9 | `features/reports/screens/report-screen.tsx:88` | Generic report page breaks the report template | P4.5 |
| 3.3-10 | L10 | `features/tasks/screens/task-ticket-screen.tsx:336` | Missing record shown inconsistently between pages | P4.3 |
| 3.3-11 | L11 | `features/catalog/screens/provider-packages-screen.tsx:168` | Provider settings tab frame differs from company | P4.6 |
| 3.3-12 | L12 | `features/catalog/screens/package-sheet-screen.tsx:475` | Price tab save appears before the eSIM field | P4.4 |
| 3.3-13 | L13 | `features/catalog/screens/packages-screen.tsx:183` | Grouped packages use the old company mark | P3.5 |
| 3.3-14 | L14 | `features/auth/screens/login-screen.tsx:60` | Login page copies AuthFrame with drift | P4.8 |
| 3.3-15 | L15 | `app/styles/responsive.css:37` | Touch block targets the dead `.auth` class | P6.5 |
| 3.3-16 | L16 | `app/styles/shell.css:697` | Compact topbar tied to 767, drawer to 899 | P5.2 |
| 3.3-17 | L17 | `features/accounts/screens/users-screen.tsx:144` | Guarded page frames in four shapes | P4.3 |
| 3.3-18 | L18 | `features/catalog/screens/package-sheet-screen.tsx:451` | Overview tab repeats the page head | P4.6 |
| 3.3-19 | L19 | `features/catalog/screens/package-sheet-screen.tsx:429` | Package tabs appear only after loading | P4.6 |
| 3.3-20 | L20 | `features/catalog/screens/packages-screen.tsx:390` | Agent packages list has an empty lede | P4.5 |
| 3.3-21 | L21 | `features/catalog/screens/packages-screen.tsx:142` | POS subscribe form puts pane and body together | P4.6 |
| 3.3-22 | L22 | `features/catalog/screens/add-company-screen.tsx:166` | eSIM checkbox at create, switch in settings | P3.10 (D18) |
| 3.3-23 | L23 | `features/offers/screens/offers-screen.tsx:122` | Offers preview titled outside any pane | P4.5 |
| 3.3-24 | L24 | `app/styles/graphite.css:1263` | Create steps spaced twice (gap plus margin) | P3.10 |
| 3.3-25 | L25 | `components/desk.tsx:39` | Desk lacks a container for head actions | P4.1 |
| 3.3-26 | L26 | `app/styles/auth.css:33` | Legacy sign-in frame never rendered | P2.1a |
| 3.3-27 | L27 | `app/styles/shell.css:350` | Topbar popovers framed differently from each other | P3.14 |
| 3.3-28 | L28 | `app/styles/shell.css:317` | Dead legacy topbar styles remain | P2.1b |
| 3.3-29 | L29 | `app/styles/shell.css:738` | Container query duplicates the 767 search block | P5.2 |
| 3.3-30 | L30 | `app/styles/graphite.css:146` | `flex: none` kills the documented pane fill model | P2.2 (D10) |
| 3.3-31 | L31 | `app/styles/graphite.css:586` | Sticky topbar and narrow path layout duplicated | P2.5 |
| 3.3-32 | L32 | `components/app-shell.tsx:574` | Every route forced onto the wide canvas; page padding split across two sheets | P5.3 (padding part); width part: owner decision D12 — deferred to its own spec (stays open by decision, G2) |
| 3.3-33 | L33 | `app/styles/graphite.css:9` | Three rules for the page title size | P2.2 (D4) |
| 3.3-34 | L34 | `components/auth-frame.tsx:31` | AuthFrame always renders an empty lede paragraph | P4.8 |

### Table 3.4 — 3.4 Spacing Scale (24)

| Id | Report # | File:line | Summary | Closing slice |
|---|---|---|---|---|
| 3.4-01 | S1 | `app/styles/graphite.css:447` | Topbar padding 28px on phones wastes width | P0.8 (D9) |
| 3.4-02 | S2 | `app/styles/graphite.css:14` | Pane padding 18px repeated without a token | P2.2 |
| 3.4-03 | S3 | `app/styles/graphite.css:157` | Three different edges inside the attached filter card | P4.5 |
| 3.4-04 | S4 | `app/styles/shell.css:53` | Sidebar row edges differ; folded icon off-centre | P3.14 |
| 3.4-05 | S5 | `app/styles/shell.css:348` | Popover offsets and paddings differ per menu | P3.14 |
| 3.4-06 | S6 | `app/styles/dialog.css:176` | Three different field rhythms | P3.7 |
| 3.4-07 | S7 | `app/styles/graphite.css:165` | On-scale spacing written as literals | P1.8 → P2.10 (guard (k) = 0) |
| 3.4-08 | S8 | `app/styles/ui.css:43` | Primitives use Tailwind rem and physical padding | P1.5 |
| 3.4-09 | S9 | `app/styles/ui.css:131` | Earlier-sheet spacing dead or half-live under graphite | P2.3 → P2.6 |
| 3.4-10 | S10 | `app/styles/auth.css:47` | Dead legacy sign-in spacing looks live | P2.1a |
| 3.4-11 | S11 | `app/styles/responsive.css:15` | Canvas padding replaces token base; 22px off-scale | P5.3 (D6) |
| 3.4-12 | S12 | `app/styles/doors.css:6` | Door picker 22px gap and 18px padding | P1.5 (D6) |
| 3.4-13 | S13 | `app/styles/forms.css:9` | Lede 18px margin off the scale | P1.5 (D6) |
| 3.4-14 | S14 | `app/styles/dialog.css:18` | Toast 11px block padding and literals | P1.6 (D6) |
| 3.4-15 | S15 | `components/desk.tsx:70` | Inline gap overrides the OutcomePick rule | P3.12 |
| 3.4-16 | S16 | `app/styles/shell.css:50` | Small off-scale shell spacing values | P1.7 (D6) |
| 3.4-17 | S17 | `app/styles/graphite.css:1126` | 3/5/7/9px gaps; tag and counter insets differ | P2.10 (D6 a: each value named at today's size — `--rd-tag-inset-tight` 7px, `--rd-counter-pad` 5px, donut key; the 7/8, 5/6, 3/6px differences are accepted by D6, not unified) |
| 3.4-18 | S18 | `app/styles/graphite.css:330` | Sign-in head margin stacks to 32px | P4.8 |
| 3.4-19 | S19 | `app/styles/desk/components.css:153` | Skeleton row shorter than the real row | P4.3 |
| 3.4-20 | S20 | `app/styles/desk/branding.css:102` | Branding preview spacing 18 and 22px | P1.8 (D6) |
| 3.4-21 | S21 | `app/styles/desk/tasks.css:142` | Timeline dots spaced in rem beside px | P1.8 |
| 3.4-22 | S22 | `app/styles/desk/home.css:357` | Fallbacks on always-defined tokens | P1.2 |
| 3.4-23 | S23 | `app/styles/desk/settings.css:46` | Label and value gaps of 1 or 2px | P1.8 (D6) |
| 3.4-24 | S24 | `app/styles/dialog.css:240` | Row-menu panel literal spacing beside tokens | P1.6 |

### Table 3.5 — 3.5 Button Hierarchy (28)

| Id | Report # | File:line | Summary | Closing slice |
|---|---|---|---|---|
| 3.5-01 | B1 | `app/styles/graphite.css:514` | Chosen page number is the only ink selection | P2.3 (D3) |
| 3.5-02 | B2 | `features/catalog/screens/packages-screen.tsx:349` | Primary save button on every package row | P3.2 (D14) |
| 3.5-03 | B3 | `features/providers/screens/provider-account-screen.tsx:110` | Three primary buttons in the matching tab | P3.2 |
| 3.5-04 | B4 | `features/catalog/screens/add-package-screen.tsx:151` | Lookup and save both primary in create flows | P3.2 |
| 3.5-05 | B5 | `features/tasks/screens/task-ticket-screen.tsx:106` | Variant used as pressed state; two primaries | P3.2 (D13) |
| 3.5-06 | B6 | `features/desk/screens/home-screen.tsx:71` | Fund account outline on home, primary on finance | P3.2 |
| 3.5-07 | B7 | `features/accounts/screens/packages-terms.tsx:166` | Hand-written filter clear is secondary, not ghost | P4.5 |
| 3.5-08 | B8 | `features/catalog/screens/company-screen.tsx:210` | Submit wrappers differ from pane to pane | P4.4 |
| 3.5-09 | B9 | `features/catalog/screens/company-screen.tsx:171` | Remove and delete drawn four different ways | P3.2 (icon deletes in P3.3; checked at the P3 gate); **closed in P3.2** |
| 3.5-10 | B10 | `features/auth/screens/settings-screen.tsx:210` | End session ghost beside a RowMenu list | P3.11 |
| 3.5-11 | B11 | `features/catalog/screens/package-sheet-screen.tsx:475` | Save sits before the eSIM field it saves | P4.4 |
| 3.5-12 | B12 | `app/styles/graphite.css:519` | `.ui-btn-accent` identical to the primary rule | P2.1c |
| 3.5-13 | B13 | `app/styles/ui.css:33` | Primary variant defined in three places | P2.3 |
| 3.5-14 | B14 | `app/styles/ui.css:18` | Button radius 6px while the doc says 8px | P3.1 |
| 3.5-15 | B15 | `app/styles/graphite.css:23` | Secondary and outline variants are identical | P3.1 |
| 3.5-16 | B16 | `app/styles/base.css:27` | Two icon-button systems side by side | P3.3 |
| 3.5-17 | B17 | `app/styles/desk/components.css:13` | Impersonation return button is crimson | P3.2 |
| 3.5-18 | B18 | `app/styles/dialog.css:180` | Context rule sets disabled opacity 0.45 | P3.1 |
| 3.5-19 | B19 | `app/styles/dialog.css:133` | Dead dialog button selectors | P2.1c |
| 3.5-20 | B20 | `app/styles/graphite.css:515` | External rules resize buttons (30px, 28px) | P3.1 |
| 3.5-21 | B21 | `app/styles/graphite.css:216` | Filter clear text in the primary crimson | P3.1 |
| 3.5-22 | B22 | `features/tasks/screens/task-ticket-screen.tsx:313` | Note submit small and forced to 32px | P3.1 |
| 3.5-23 | B23 | `features/auth/sign-in-methods.tsx:132` | Turning off two-step is not a danger button | P3.2 |
| 3.5-24 | B24 | `features/auth/sign-in-methods.tsx:153` | Cancel is ghost here, secondary in dialogs | P3.2 |
| 3.5-25 | B25 | `features/branding/screens/branding-screen.tsx:178` | Foot order differs from dialogs and the doc | P4.4 (D8) |
| 3.5-26 | B26 | `features/providers/reconciliation.tsx:95` | Row actions change variant with their state | P3.2 |
| 3.5-27 | B27 | `features/offers/screens/offers-screen.tsx:157` | File chooser drawn in three shapes | P3.10 |
| 3.5-28 | B28 | `components/mode-cards.tsx:54` | `.link-btn` reads like label text, no states | P3.2 |

### Table 3.6 — 3.6 Components (35)

| Id | Report # | File:line | Summary | Closing slice |
|---|---|---|---|---|
| 3.6-01 | C1 | `components/ui/button.tsx:12` | Icon sizes unused; parallel icon-button classes | P3.3 |
| 3.6-02 | C2 | `components/facts.tsx:11` | Four different figure-card patterns | P3.8 |
| 3.6-03 | C3 | `app/styles/graphite.css:672` | Soft-tile mark redefined per feature | P3.5 |
| 3.6-04 | C4 | `components/row-menu.tsx:17` | Parallel hand-drawn icon sets beside lucide | P3.4 |
| 3.6-05 | C5 | `app/styles/base.css:39` | Focus drawn several ways without a shared rule | P6.6 |
| 3.6-06 | C6 | `components/filter-bar.tsx:138` | Phone filter drawer is a hand-built modal | P6.8 |
| 3.6-07 | C7 | `features/auth/screens/login-screen.tsx:60` | Two field and two submit styles on sign-in | P4.8 |
| 3.6-08 | C8 | `features/catalog/screens/packages-screen.tsx:123` | Company mark hand-written in about nine places | P3.5 |
| 3.6-09 | C9 | `features/catalog/screens/companies-screen.tsx:50` | Clickable cards built three ways | P3.6 |
| 3.6-10 | C10 | `features/lines/screens/line-card-screen.tsx:407` | Two pick-a-card tools, one without radio role | P3.6 |
| 3.6-11 | C11 | `features/lines/line-details.tsx:103` | Hand-written dl, error paragraph, ellipsis loading | P3.8 |
| 3.6-12 | C12 | `features/catalog/screens/package-sheet-screen.tsx:391` | Empty results shown as plain text lines | P3.9 |
| 3.6-13 | C13 | `features/catalog/screens/package-sheet-screen.tsx:476` | Fields-plus-button row in four classes | P3.7 |
| 3.6-14 | C14 | `features/catalog/screens/add-package-screen.tsx:208` | Package add-ons with two different interfaces | P3.10 |
| 3.6-15 | C15 | `features/catalog/screens/add-company-screen.tsx:166` | SIM rules block copied and drifted | P3.10 (D18) |
| 3.6-16 | C16 | `features/catalog/company-packages.tsx:77` | Badge tone picked inline and inconsistently | P3.12 |
| 3.6-17 | C17 | `features/desk/overview.tsx:19` | Pane template hand-written about 29 times | P3.6 → P4.10 (D17) |
| 3.6-18 | C18 | `features/auth/screens/two-factor-screen.tsx:113` | Two-step enrolment built two different ways | P3.11 |
| 3.6-19 | C19 | `features/auth/sign-in-methods.tsx:197` | Passkey list copies the sessions list markup | P3.11 |
| 3.6-20 | C20 | `features/accounts/user-settings.tsx:115` | Same policy blocks with different wrappers | P3.11 |
| 3.6-21 | C21 | `components/filter-bar.tsx:54` | Chip list manages its own listeners and placement | P6.8 |
| 3.6-22 | C22 | `components/desk.tsx:72` | Segmented control hand-written with mixed semantics | P3.12 |
| 3.6-23 | C23 | `components/empty-state.tsx:14` | EmptyState lacks tone, role and actions | P3.9 |
| 3.6-24 | C24 | `app/styles/dialog.css:180` | Parallel disabled opacity values | P1.4 (token), P1.1 (guard (l)) → P3.1 step 4 (every disabled rule) |
| 3.6-25 | C25 | `app/styles/ui.css:35` | Secondary and outline identical (**duplicate of 3.5-15**: one fix, counted once) | P3.1 |
| 3.6-26 | C26 | `components/sparkline.tsx:7` | Dead Sparkline and shell branch; second search shape | P4.5 (dead parts in P2.1b) |
| 3.6-27 | C27 | `app/styles/ui.css:162` | Two tools for direction-aware arrows | P6.1 |
| 3.6-28 | C28 | `features/lines/screens/line-card-screen.tsx:70` | Days-left chip written twice | P3.12 |
| 3.6-29 | C29 | `features/providers/reconciliation.tsx:137` | Statement sample is a hand-written table | P3.12 |
| 3.6-30 | C30 | `features/catalog/screens/company-screen.tsx:210` | Save in four places across catalog tabs | P4.4 |
| 3.6-31 | C31 | `features/catalog/screens/add-package-screen.tsx:141` | Numbered step head copied seven times | P3.10 |
| 3.6-32 | C32 | `app/styles/desk/packages.css:68` | Dead context button rules | P2.1c |
| 3.6-33 | C33 | `features/wallets/wallet-head.tsx:77` | Period switch copied from Period | P3.12 |
| 3.6-34 | C34 | `features/auth/screens/settings-screen.tsx:119` | Settings rebuilds the Desk frame by hand | P4.2 |
| 3.6-35 | C35 | `features/auth/session-rules.tsx:82` | Range field copied; two field heights | P3.7 |

### Table 3.7 — 3.7 Typography (23)

| Id | Report # | File:line | Summary | Closing slice |
|---|---|---|---|---|
| 3.7-01 | Y1 | `app/styles/base.css:19` | Textarea does not inherit the font (monospace) | P0.2 |
| 3.7-02 | Y2 | `app/styles/desk/frame.css:91` | Title rule wins by specificity; four definitions | P2.2 (D4) |
| 3.7-03 | Y3 | `app/styles/tokens.css:83` | No display steps; heading literals 18–30px | P1.4 → P2.10 (sizes); P2.11 (800→700) and P3.8 (figure 700 / compact 600) (weights); **closed in P2.10** (sizes; the weight steps are follow-through) |
| 3.7-04 | Y4 | `app/styles/graphite.css:74` | Phone figure shrink cancelled by graphite | P5.5 (D10) |
| 3.7-05 | Y5 | `app/styles/desk/pane.css:50` | Section titles in many sizes and weights | P3.6 |
| 3.7-06 | Y6 | `app/styles/dialog.css:178` | Field label style changes with the container | P3.7 (labels and one dt style) |
| 3.7-07 | Y7 | `app/styles/dialog.css:179` | Required note larger than its own label | P3.7 |
| 3.7-08 | Y8 | `app/styles/graphite.css:95` | Half-pixel font sizes, 28 uses | P1.4, P1.5, P1.7, P1.8 → P2.10 (D6; guard (f) = 0 at the P2 gate) |
| 3.7-09 | Y9 | `app/styles/shell.css:382` | rem font sizes outside the px scale | P1.7 → P1.8 |
| 3.7-10 | Y10 | `app/styles/ui.css:61` | Badge drawn in three sizes via context rules | P3.12 |
| 3.7-11 | Y11 | `app/styles/shell.css:382` | Menu item fonts differ between menus | P3.14 |
| 3.7-12 | Y12 | `app/styles/shell.css:112` | Small group title in three forms | P3.14 |
| 3.7-13 | Y13 | `app/styles/shell.css:114` | Positive letter-spacing on Arabic and Hebrew | P6.2 |
| 3.7-14 | Y14 | `app/styles/desk/components.css:281` | Weight 800 used; Hebrew face stops at 700 | P2.11 (D7) |
| 3.7-15 | Y15 | `app/styles/graphite.css:1069` | Notice title differs; no unread weight difference | P3.14 |
| 3.7-16 | Y16 | `app/styles/graphite.css:1083` | Literal font sizes equal to tokens | P1.6 → P2.10 |
| 3.7-17 | Y17 | `app/styles/auth.css:102` | Dead type rules suggest competing sizes | P2.1b (auth part P2.1a); **closed in P2.1b** |
| 3.7-18 | Y18 | `app/styles/desk/tasks.css:201` | Task message 15px, larger than its meta | P2.11 |
| 3.7-19 | Y19 | `app/styles/dialog.css:108` | No line-height tokens; eight different values | P1.4, P1.5–P1.8 → P2.10 (guard (j) = 0 at the P2 gate; `home.css:377` value change in P2.11); **closed in P2.10** |
| 3.7-20 | Y20 | `app/styles/graphite.css:33` | Selected tab turns bold, widens, pushes neighbours | P2.11 |
| 3.7-21 | Y21 | `app/styles/desk/pane.css:62` | Counters in two different weights | P2.11 |
| 3.7-22 | Y22 | `app/styles/dialog.css:153` | Two different fieldset legend styles in dialogs | P3.7 |
| 3.7-23 | Y23 | `app/styles/desk/home.css:377` | Contradicting fallback, weight 800, line-height 1 | P2.11 (fallback in P1.2) |

### Table 3.8 — 3.8 RTL (16)

| Id | Report # | File:line | Summary | Closing slice |
|---|---|---|---|---|
| 3.8-01 | D1 | `app/styles/shell.css:99` | Sidebar fold arrow points the wrong way in English | P6.1 |
| 3.8-02 | D2 | `features/accounts/screens/users-screen.tsx:107` | Block `dir="ltr"` misaligns login under name | P6.2 |
| 3.8-03 | D3 | `features/auth/sign-in-methods.tsx:123` | `<small dir="ltr">` misaligned in method card | P6.2 |
| 3.8-04 | D4 | `app/styles/ui.css:164` | `.flip-ltr` at zero specificity loses to transforms | P6.1 |
| 3.8-05 | D5 | `app/styles/graphite.css:261` | Filter drawer slides in the wrong way in English | P6.1 |
| 3.8-06 | D6 | `app/styles/shell.css:190` | Folded group chevron and labels diverge in RTL | P6.1 |
| 3.8-07 | D7 | `app/styles/graphite.css:426` | Sign-in art tag lacks the RTL clip and rotate | P6.1 |
| 3.8-08 | D8 | `app/styles/auth.css:119` | `.login-seam` grows from the physical right | P2.1a (dead rule deleted) |
| 3.8-09 | D9 | `app/styles/desk/components.css:127` | Loading shimmer always runs left to right | P6.1 |
| 3.8-10 | D10 | `app/styles/desk/users.css:157` | Price input text at the far edge in Arabic | P6.2 |
| 3.8-11 | D11 | `features/desk/home-top.tsx:149` | Amounts hug the inner edge, ragged list end | P6.2 |
| 3.8-12 | D12 | `features/auth/screens/two-factor-screen.tsx:127` | Direction of code and number fields inconsistent | P6.2 |
| 3.8-13 | D13 | `features/tasks/screens/task-ticket-screen.tsx:101` | Undo arrow not mirrored; no `.flip-rtl` helper | P6.1 |
| 3.8-14 | D14 | `app/styles/shell.css:31` | Direction handled by manual pairs and three JS reads | P6.1 |
| 3.8-15 | D15 | `app/styles/ui.css:43` | Physical inline padding in the primitives | P1.5 |
| 3.8-16 | D16 | `app/styles/desk/components.css:70` | Physical block-axis properties across sheets | P6.3 |

### Table 3.9 — 3.9 Visual Hierarchy (29)

| Id | Report # | File:line | Summary | Closing slice |
|---|---|---|---|---|
| 3.9-01 | H1 | `features/lines/line-details.tsx:92` | Empty usage dashes as large as real figures | P4.7 |
| 3.9-02 | H2 | `app/styles/desk/numbers.css:115` | Every fact weight 700; labels as heavy as values | P4.6 (`.sheet-meta`) → P4.7 |
| 3.9-03 | H3 | `features/lines/line-details.tsx:34` | Expiring state in two colours; literal 3 days | P4.7 |
| 3.9-04 | H4 | `features/lines/screens/line-card-screen.tsx:200` | Disconnect tile sits among routine operations | P4.7 |
| 3.9-05 | H5 | `features/lines/screens/numbers-screen.tsx:260` | Outcome simulator first in the filter bar | P4.7 |
| 3.9-06 | H6 | `features/catalog/screens/packages-screen.tsx:349` | Crimson save button on every price row | P3.2 (D14) |
| 3.9-07 | H7 | `features/catalog/screens/packages-screen.tsx:407` | Provider head lighter than company rows under it | P4.6 |
| 3.9-08 | H8 | `features/catalog/screens/provider-packages-screen.tsx:156` | Provider balance buried in the faint lede | P4.6 |
| 3.9-09 | H9 | `features/providers/reconciliation.tsx:168` | Twelve equal cards; the key difference last | P3.8 |
| 3.9-10 | H10 | `features/tasks/screens/task-ticket-screen.tsx:108` | No primary action in the ticket head | P3.2 (D13) |
| 3.9-11 | H11 | `features/tasks/screens/task-ticket-screen.tsx:203` | Close form below thirteen facts, out of view | P4.9 |
| 3.9-12 | H12 | `features/wallets/wallet-head.tsx:51` | Three key figures in one faint sentence | P4.9 |
| 3.9-13 | H13 | `features/accounts/screens/account-screen.tsx:305` | Five equal cards; the lead figure last | P3.8 |
| 3.9-14 | H14 | `features/reports/screens/report-screen.tsx:59` | Report statuses as plain text; no lede | P4.5 |
| 3.9-15 | H15 | `features/tasks/screens/provider-decisions-screen.tsx:71` | Pending amount lost in a faint line | P4.9 |
| 3.9-16 | H16 | `features/desk/home-top.tsx:86` | Sales card's big number is the count | P4.9 |
| 3.9-17 | H17 | `app/styles/desk/numbers.css:83` | Crimson spread across the details tab | P4.7 |
| 3.9-18 | H18 | `features/catalog/screens/package-sheet-screen.tsx:451` | Overview repeats the head; two badges side by side | P4.6 |
| 3.9-19 | H19 | `features/catalog/screens/package-sheet-screen.tsx:376` | Nine equal tabs without counts | P4.6 |
| 3.9-20 | H20 | `features/catalog/screens/package-sheet-screen.tsx:475` | Save above eSIM; two equal-weight cards after | P4.4 |
| 3.9-21 | H21 | `features/providers/matching-pane.tsx:57` | Secondary steps in crimson beside the real action | P3.2 |
| 3.9-22 | H22 | `features/providers/screens/provider-accounts-screen.tsx:22` | Six money columns of equal weight | P4.9 |
| 3.9-23 | H23 | `features/offers/screens/offers-screen.tsx:122` | Animated preview placed before the table | P4.5 |
| 3.9-24 | H24 | `features/tasks/screens/task-ticket-screen.tsx:166` | Ticket facts repeat the head | P4.6 |
| 3.9-25 | H25 | `features/wallets/wallet-head.tsx:75` | Chart tip repeats balance and hides the change | P4.9 |
| 3.9-26 | H26 | `features/accounts/screens/account-screen.tsx:142` | Account layer shown twice in the head | P4.6 |
| 3.9-27 | H27 | `features/wallets/screens/finance-screen.tsx:151` | Section head heavier than pane heads | P4.5 |
| 3.9-28 | H28 | `features/reports/screens/report-pages.tsx:75` | Report pages lead with different figures | P3.8 |
| 3.9-29 | H29 | `features/wallets/screens/provider-operations-screen.tsx:115` | Matched always green; tone has no effect | P3.8 |

### Table 3.10 — 3.10 Accessibility (33)

| Id | Report # | File:line | Summary | Closing slice |
|---|---|---|---|---|
| 3.10-01 | A1 | `app/styles/graphite.css:523` | White on crimson 3.23:1 in dark mode | P0.9 (D1) |
| 3.10-02 | A2 | `app/styles/graphite.css:892` | Filter list removes the focus outline | P0.3 |
| 3.10-03 | A3 | `app/styles/graphite.css:680` | `clip-path` hides line-op focus ring | P0.4 |
| 3.10-04 | A4 | `app/styles/graphite.css:44` | Field borders below 3:1 contrast | P6.4 |
| 3.10-05 | A5 | `app/styles/dialog.css:223` | Active control icons in the faint colour | P6.4 (colour) → P6.5 (search-clear hit area) |
| 3.10-06 | A6 | `app/styles/graphite.css:16` | Small crimson text below 4.5:1 in light | P6.4 |
| 3.10-07 | A7 | `app/styles/ui.css:66` | Small success and warning text below 4.5:1 | P6.4 |
| 3.10-08 | A8 | `app/styles/controls.css:16` | Unchecked checkbox border below 3:1 | P6.4 |
| 3.10-09 | A9 | `app/styles/shell.css:111` | Meaningful text drawn in the faint colour | P6.4 |
| 3.10-10 | A10 | `app/styles/responsive.css:37` | Password/two-step buttons 40px, reveal 32px | P6.5 |
| 3.10-11 | A11 | `app/styles/responsive.css:42` | `buttonClass` links and labels stay 32–34px | P6.5 |
| 3.10-12 | A12 | `app/styles/graphite.css:1360` | 640 block lowers controls to 40px | P6.5 |
| 3.10-13 | A13 | `app/styles/graphite.css:1408` | Portalled calendar targets 30–40px | P6.5 |
| 3.10-14 | A14 | `app/styles/dialog.css:111` | Dialog close button 36px on phones | P6.5 |
| 3.10-15 | A15 | `app/styles/graphite.css:1396` | Dialog date button 34px beside a 44px field | P6.5 |
| 3.10-16 | A16 | `app/styles/graphite.css:1184` | Name-field clear 24px, chip close 26px | P6.5 |
| 3.10-17 | A17 | `features/offers/screens/offers-screen.tsx:157` | Offer picture picker shows no focus | P3.10 |
| 3.10-18 | A18 | `features/lines/screens/line-card-screen.tsx:407` | Package switch picker lacks a state attribute | P3.6 |
| 3.10-19 | A19 | `app/styles/graphite.css:595` | Unread count missing from the accessible name | P6.7 |
| 3.10-20 | A20 | `components/toast.tsx:34` | Toast close button named by the × symbol | P6.7 |
| 3.10-21 | A21 | `app/styles/shell.css:416` | Shell targets under 44px on touch widths | P6.5 (D11) |
| 3.10-22 | A22 | `app/styles/shell.css:94` | Fold handle invisible on touch screens | P6.5 (D11) |
| 3.10-23 | A23 | `app/styles/tokens.css:21` | Light muted text 4.33:1 on surface-3 | P6.4 |
| 3.10-24 | A24 | `components/app-shell.tsx:590` | Reused, wrong accessible names (close, clear) | P6.7 |
| 3.10-25 | A25 | `components/chrome.tsx:64` | `aria-label` hides the visible language name | P6.7 |
| 3.10-26 | A26 | `components/app-shell.tsx:532` | `role="menu"` panel without menuitems | P6.7 |
| 3.10-27 | A27 | `features/lines/screens/line-card-screen.tsx:60` | `aria-label` hides the card's visible description | P6.7 |
| 3.10-28 | A28 | `features/catalog/package-addons.tsx:66` | Add-on switch state shown by colour only | P6.7 |
| 3.10-29 | A29 | `features/catalog/package-addons.tsx:79` | Icon delete buttons 32–34px on touch | P3.3 → P6.5 |
| 3.10-30 | A30 | `features/catalog/chain-board.tsx:66` | Price row labels in two styles; div aria-label | P3.7 |
| 3.10-31 | A31 | `features/catalog/screens/add-company-screen.tsx:125` | Radio cards without roving tabindex or arrows | P3.6 |
| 3.10-32 | A32 | `features/lines/line-details.tsx:113` | Invalid dt/dd inside span; silent copy button | P3.8 (dt/dd) → P6.7 (copy announce) |
| 3.10-33 | A33 | `components/toast.tsx:32` | A live region per toast; errors auto-close | P6.7 |

**Count check:** 3.1 = 29, 3.2 = 26, 3.3 = 34, 3.4 = 24, 3.5 = 28, 3.6 = 35, 3.7 = 23, 3.8 = 16, 3.9 = 29, 3.10 = 33 → **277** (report: 29, 26, 34, 24, 28, 35, 23, 16, 29, 33 = 277). Owner decision only: 3.3-32's width part (D12, deferred; its padding part closes in P5.3). Won't fix: none.

### Root causes → slices

This table maps each root cause to the slices that address it; the per-finding list above (tables 3.1–3.10) is the
full record of which slice closes which finding.

| Cause | Slices |
|---|---|
| س1 graphite.css patches instead of replacing | P1.1 (guard), P2.1a–P2.10 (fold and delete), gate P2 (duplicates = 0) |
| س2 tokens without roles; type scale stops at 18px | P1.2, P1.3, P1.4, P1.5–P1.8, P2.10, P2.11, P5.3 (the report's "round to the scale" fix is deliberately left out: D6 a, rounding = D6 b, its own spec; Conflicts row 6) |
| س3 contradictory primary-button rules; two on-crimson tokens | P0.1 (D1, D2, D3, D8, D13; DESIGN.md button section), P0.9, P2.1c, P2.3, P3.1, P3.2, P7.1 |
| س4 Desk and AuthFrame too weak to be templates | P4.1–P4.6, P4.8, P4.10 (and D12 deferred) |
| س5 shared patterns hand-copied; components bypassed | P3.3–P3.12, P3.13 (lint guard), P4.4, P4.5, P4.10 (last panes; lint extended) |
| س6 access rules bound to containers | P0.3, P0.4, P6.4, P6.5, P6.6 |
| س7 no breakpoint scale | P5.1, P5.2 (guard rule (h) from P1.1) |
| س8 fixed sizes in shrinking containers; popovers on their button | P0.6, P0.7, P5.4 |
| س9 direction by hand | P6.1, P6.2, P6.3 (guard rule (i)) |
| س10 global SVG reset | P3.4 |
| س11 Stat cannot lead | P3.8 |
| Single issue: textarea font (`base.css:19`) | P0.2 |

### Conflicts between fixes ("تعارضات بين الحلول") → resolution

| # | Conflict | Resolution in this plan |
|---|---|---|
| 1 | Text on crimson in dark: dark text vs darker fill | D1 (recommend `--rd-accent-fill` + white); implemented in P0.9; `--rd-on-mark` and `--rd-accent` untouched |
| 2 | Merging graphite vs "same UI" (reviving dead rules) | P2 rule: today's winning value is kept; every revival is a named visible slice by D10 (P5.5 figures, P0.8 topbar, P2.2 title per D4); P2.4 deletes `responsive.css:5` so the move does not revive it |
| 3 | Pane fill model `flex: 1` | Deleted, not revived (D10), P2.2 |
| 4 | 44px on components vs popover geometry | P0.6 anchors topbar popups first; P6.5 (touch) comes after; P3.14 frames popups |
| 5 | Breakpoint scale vs container queries | Scale for `@media` only; container queries stay; L29 merge only if it covers 721–767 (P5.1, P5.2) |
| 6 | Rounding literal values to the scale | D6: named role tokens holding today's values (P1.4); rounding out of scope |
| 7 | Enabling `size=` on icons changes ~15 places | P3.4 removes dead props first and adds per-context CSS sizes, page by page |
| 8 | Merging secondary and outline | P3.1 keeps `variant="danger"` as the red outline; the pager context rule is deleted and the arrows become `ghost` `sm` at one shared pager-item size |
| 9 | `lede: ReactNode` empties the tab title | P4.1 keeps a string `pageTitle` (defaults to a string `title`) |
| 10 | "One primary per view" vs DESIGN.md:88 "submit is primary" | P0.1 writes the precedence rule into DESIGN.md before P3.2 demotes any button |

