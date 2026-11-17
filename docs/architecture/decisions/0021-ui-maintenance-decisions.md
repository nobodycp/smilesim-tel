# 0021 — UI maintenance decisions (D1–D28, branch, audit file, rule files, graphify, click deferral)

Date: 2026-11-14. Status: **accepted**. D1–D28 and the branch are the owner's own answers of 2026-11-13; the audit-file,
rule-file, graphify and click-deferral answers are the recommended answers, taken by the orchestrator under the
owner's instruction of 2026-11-14 and **to be confirmed by the owner**; the three named exceptions under D2 are
P0.1's own reading, not an owner answer, and are **to be confirmed by the owner**. Spec:
`docs/superpowers/specs/2026-11-13-ui-maintenance.md` (its plan removed 2026-11-17; in git history). Findings: `docs/reviews/2026-11-13-ui-audit.md`
(the UI audit, 277 findings; Arabic). Recorded by plan slice P0.1.

> **Superseded in part (2026-11-15, ADR 0022):** the styling plan this ADR served, the 2026-11-13 maintenance plan from
> slice P1.3 on (repairing the legacy stylesheets in place, with per-slice visual verification), is superseded by
> ADR 0022 and the Tailwind migration (spec `docs/superpowers/specs/2026-11-15-tailwind-radix-migration.md`): the
> stylesheets are replaced by Tailwind CSS v4 utilities and owned Radix components, without visual verification
> (owner, 2026-11-15). The decisions D1–D28 stay in force and the migration slices apply them. The slice names below
> (P1.4 … P8) refer to the superseded plan; a decision's content still holds where its slice never ran. The migration
> rewrote the UI rule files (`smilesim-ui.mdc`, `content-ui.mdc`, `direction-theme.mdc`, `screen-size.mdc`) for
> utilities and components; P7.1 never ran, so the interim precedence below still holds (a quoted owner answer wins
> over a rule-file sentence that disagrees). The visual-audit runner of the notice below is not run by the migration
> (`.cursor/rules/verify-before-reply.mdc`, the exception of 2026-11-15).

## Context

The UI audit found one system drawn several ways: a patch stylesheet (`graphite.css`) restating every owner, tokens
without roles, contradictory button rules in `DESIGN.md` (ink primary at :15 and :264, crimson primary at :88 and
:249, white on crimson at :108), no page templates, no breakpoint scale, direction and access fixed by hand. The
spec lists 28 questions (D1–D28) whose answers change what later slices write, plus four questions about how the
work is run (branch, audit file, rule files, graphify) and one about the visual audit's click checks. This ADR records
every answer, so each slice's executor reads one source.

## How the answers were given

- **D1–D28:** the owner, 2026-11-13 — accept every recommendation in the spec's table; D28 = (a).
- **Branch:** the owner, 2026-11-13 — a work branch, `ui-maintenance`. The orchestrator created it from `a84484f`
  on 2026-11-14, after the backend office-retirement work (ADR 0020) had landed on `main`.
- **Audit file, rule files (question i), graphify (question ii), click deferral (question iv):** the owner wrote on
  2026-11-14, before leaving the run unattended, «ابدأ العمل علي كل قسم بقسمه ينتهي واحد تبدأ الثاني لوحدك بدون
  مراجعه واعطيني تقرير بالنهايه» (run phase after phase alone, without asking, and report at the end). Under that
  instruction the orchestrator took the recommended answer for each of these four: **recommended answer taken by the
  orchestrator under the owner's instruction of 2026-11-14; to be confirmed by the owner.** The P0 gate accepts this
  record in place of an owner answer for these four.
- **Named exceptions under D2 (the tasks list row's own `sm` take; the task ticket — take beside «إكمال» in its head
  on an unassigned task, and its in-page form submits; a tab's main form beside the page-head action):** not an owner answer. P0.1 recorded them as its own reading, so
  that D2, D13, the owner's rule of 2026-11-11 and the plan's own P3.2 steps do not contradict each other with no
  visible change; **to be confirmed by the owner**, and listed in the run's final
  report with the four answers above.

## Interim precedence (rule files answer (a))

Until P7.1 aligns them, where a `.cursor/rules/*.mdc` sentence and an owner answer quoted in this ADR disagree, the
quoted answer wins. This covers only the quoted answers (D1–D28 and the branch), not the rest of this ADR's text (in particular not the
named exceptions under D2, which are P0.1's reading).

## Notice for the owner (final report)

The visual-audit runner (CHK-AUDIT in every visible slice, and the P8 capture) signs in as the trial-seed accounts.
Each sign-in adds a session and may revoke the oldest one beyond the account's session limit
(`auth.service.ts` `makeRoom`), so the owner's own oldest `branch` sessions on the local app can be signed out while
the run is going. This goes into the run's final report.

## Decisions

Each section: the question, the options, the answer and its date, and the slices that follow it (an executor of a
listed slice reads the section first).

### D1 — Text on a crimson fill in dark

- **Question:** dark mode draws white on `#ff4d63` (≈ 3.2:1) on crimson fills (conflict 1).
- **Options:** (a) near-black text `#111213` on today's crimson; (b) a separate fill token `--rd-accent-fill` (dark ≈
  `#d93049`, the light accent; white ≈ 4.7:1) with white text, `--rd-accent` (thread, focus, links) unchanged;
  (c) darken `--rd-accent` itself in dark (~120 rules, the thread and the focus ring change).
- **Answer:** **(b)**, owner 2026-11-13. Hover darkens the fill (mix toward black), never toward ink. Exact values are
  measured by a contrast script, ≥ 4.5:1 in both themes, text and hover.
- **Slices:** P0.9 (tokens, every crimson-fill rule, the contrast script, `tests/desk-system.spec.ts`), P6.4 (may pick
  another dark fill value and update the spec again).

### D2 — Primary button model

- **Question:** `DESIGN.md` said ink primary (:15, :264) and crimson primary (:88, :249) (conflict 10).
- **Options:** (a) every primary crimson (owner 2026-11-11, what the code does) **plus** one primary per view with a
  precedence rule; (b) ink primary, crimson for one special action.
- **Answer:** **(a)**, owner 2026-11-13. Precedence: the page-head action, else the submit of the view's main form; a
  save in a secondary pane, a lookup step and a per-row save are secondary. A dialog is its own view.
- **Named exceptions (recorded in P0.1, no visible change):** three cases that today's code draws as more than one
  primary in a view and that no answer demotes stay as they are, written in `DESIGN.md` Components → Primary button
  so the rule does not contradict itself: (1) a takeable row's own `sm` «أخذ المهمة» in the tasks list (the owner's
  rule of 2026-11-11, "at most one primary button of its own"); (2) the task ticket: its head's take beside «إكمال»
  on an unassigned task (take as today, «إكمال» primary per D13), and its in-page forms' submits beside the head's
  primaries — the open complete form's «إكمال» (`task-ticket-screen.tsx:231`) and the note composer's «إضافة ملاحظة»
  (`:313`, shown while the task takes notes; P3.1 gives it the default size, B22); the reject form's submit is the
  danger outline; (3) a tab's main form beside the page-head action — on a
  page whose head carries a primary action, the open tab's main form keeps its primary submit: today only the
  company page's «الإعدادات» tab («حفظ», `company-screen.tsx:210`, beside the head's «إضافة رزمة», `:153`) and the
  provider account's «المطابقة» tab («مقارنة», `reconciliation.tsx:142`, beside the head's «تسجيل دفعة»,
  `provider-account-screen.tsx:110`; the plan's P3.2 steps keep this pair and make the matching save secondary). A
  tab is not otherwise its own view, and under a primary head action any other main form's submit is secondary. P0.1's
  grep survey (`apps/web/audit-output/maintenance/P0.1/primary-head-form-survey.txt`, local evidence, not tracked) found no other view with a
  primary head action beside an in-page primary main-form submit; it is a grep, not a render, so P3.2's per-view count
  is the check, and a further view it finds goes through the plan's mid-phase amendment path (not covered by these
  exceptions and left to that count: the proposal card's `sm` approve, one per card, on `/tasks/decisions` and in the
  ticket's provider panel; that panel's primary `sm` decision buttons; `/settings`' several submits). P3.2's per-view count of crimson buttons excludes these as it excludes dialogs. This is the
  reading P0.1 recorded to keep D2, D13, the 2026-11-11 rule and the plan's P3.2 steps consistent; **to be confirmed
  by the owner** — a demotion of any of them is a visible change for a later spec.
- **Slices:** P0.1 (`DESIGN.md`, `smilesim-ui.mdc`), P0.9, P3.1, P3.2, P4.4.

### D3 — Chosen page number

- **Question:** the pager's chosen number is ink in the CSS (graphite `:514`) and crimson in `DESIGN.md` (:88, :249).
- **Options:** (a) ink, as rendered and as `DESIGN.md:50` says; (b) crimson.
- **Answer:** **(a)**, owner 2026-11-13 — it is a state, not an action. `DESIGN.md` corrected in P0.1.
- **Slices:** P0.1, P2.3.

### D4 — Page title size

- **Question:** the title renders 20px (`frame.css:91`); 22px and 24px rules are dead.
- **Options:** 20px; 24px.
- **Answer:** **20px**, owner 2026-11-13 (no visible change; 24px wraps head buttons at 375).
- **Slices:** P1.4 (`--rd-text-title`), P2.2.

### D5 — Touch breakpoint

- **Question:** the 44px touch rule switches at 720px while the phone layout switches at 767px.
- **Options:** 720 (today); 767.
- **Answer:** **767**, owner 2026-11-13 (closes the 721–767 band with 34px controls).
- **Slices:** P5.1, P6.5, P8.1.

### D6 — Off-scale values

- **Question:** 12.5 / 11.5 / 13.5 / 14.5px, 18px pane padding, 22px / 28px gutters and other off-scale values
  (conflict 6).
- **Options:** (a) named role tokens holding today's value; (b) round to the scale.
- **Answer:** **(a)**, owner 2026-11-13. Rounding is out of scope (its own spec later). The differences stay on screen,
  each on its own named token and documented in `DESIGN.md` (3.1-08, 3.1-12 close that way).
- **Slices:** P1.4, P1.5, P1.6, P1.7, P1.8, P2.10, P3.14, P5.3, P6.1; the P2 gate (G2) and the P7 gate.

### D7 — Weight 800

- **Question:** 21 uses of weight 800 while the Hebrew face stops at 700.
- **Options:** (a) cap at 700, emphasis by size; (b) keep 800 for ar/en.
- **Answer:** **(a)**, owner 2026-11-13 (a small visible change in ar/en; Hebrew already renders 700).
- **Slices:** P2.11.

### D8 — Dialog and form foot order

- **Question:** the code draws cancel then the action; `DESIGN.md:247` said the action first.
- **Options:** (a) today's order: cancel then the action, the cluster at the inline end (the action at the far end);
  (b) the action first.
- **Answer:** **(a)**, owner 2026-11-13. `DESIGN.md` and `content-ui.mdc` corrected in P0.1; `.brand-foot` follows (a).
  The order is cancel then the action everywhere; the cluster sits at the inline end in a dialog's foot and a
  multi-step create page's last step, while an in-pane edit form's own buttons stay at the reading start (P4.4's
  `FormActions` `align`).
- **Slices:** P0.1, P4.4.

### D9 — One gutter for topbar and canvas

- **Question:** the topbar and the canvas use different side gutters.
- **Options:** phone 16px and ≥ 768 28px for both; keep `clamp(16px, 2vw, 28px)`.
- **Answer:** **16 / 28**, owner 2026-11-13 (the content edge moves ≤ 12px on tablets; topbar and canvas align).
- **Slices:** P0.8, P5.3.

### D10 — Reviving dead rules

- **Question:** some dead rules were meant to apply (conflict 2).
- **Options:** decide per rule.
- **Answer:** owner 2026-11-13, as recommended: **revive** `.stat-value` 1.2rem on phones (fixes clipping) and the
  topbar phone padding per D9; **do not revive** the pane `flex: 1` fill model (delete it, conflict 3); the title per
  D4.
- **Slices:** P0.8 (the topbar phone padding), P2.2, P2.4, P5.5.

### D11 — Frozen shell areas

- **Question:** `responsive.css:35` marks parts of the shell as frozen (A21, A22).
- **Options:** approve changes; keep frozen.
- **Answer:** **approve**, owner 2026-11-13: 44px under the touch breakpoint for the drawer close, «تعليم الكل
  مقروءًا», notice rows and path links; the fold handle visible on `hover: none`.
- **Slices:** P6.5.

### D12 — Page width per template

- **Question:** forms at reading width (L32).
- **Options:** now; its own spec later.
- **Answer:** **later**, owner 2026-11-13 — its own spec, not in this plan. 3.3-32's width part stays open by this
  decision; L32's other part (page padding split across two sheets) is fixed in P5.3.
- **Slices:** P5.3; the P7 and P8 gates check this record.

### D13 — Task ticket head

- **Question:** the ticket head used a variant change as its pressed state and had two primaries (B5, H10).
- **Options:** (a) «إكمال» always primary with an `aria-pressed` style, «رفض» / «إلغاء» the danger outline
  (documented); (b) also move «إلغاء» into a RowMenu.
- **Answer:** **(a)**, owner 2026-11-13.
- **P0.1 reading (not part of the owner's answer; to be confirmed by the owner):** on an unassigned task, take stays
  primary beside «إكمال», as today, and the ticket's in-page form submits (the open complete form's «إكمال», the note
  composer's «إضافة ملاحظة») stay primary beside the head — one named exception under D2 (2).
- **Slices:** P0.1 (`DESIGN.md`), P3.2.

### D14 — Per-row save on the packages price table

- **Question:** every row of the packages price table has its own crimson save (B2, H6).
- **Options:** (a) secondary `sm`, enabled only when the row changed; (b) one bulk save.
- **Answer:** **(a)**, owner 2026-11-13; (b) changes behaviour (partial failure) and is out of scope.
- **Slices:** P3.2.

### D15 — Line details facts on phones

- **Question:** the line details facts sit two a row at 375 (R16).
- **Options:** two columns (today); `auto-fit, minmax(min(100%, 11rem), 1fr)`.
- **Answer:** **auto-fit**, owner 2026-11-13 (one column at 375, two when there is room).
- **Slices:** P5.4.

### D16 — Filter bar attached to its table or separate

- **Question:** some filter bars join their table, others stand alone (L5).
- **Options:** force one shape; document per page.
- **Answer:** **document per page**, owner 2026-11-13 (both shapes are approved designs).
- **Slices:** P0.6, P4.5.

### D17 — Pane hint position

- **Question:** two pages place the pane hint differently on purpose (C17).
- **Options:** one position; a `PaneHead hint` slot with `placement`.
- **Answer:** **slot with placement**, owner 2026-11-13, no visible change.
- **Slices:** P3.6, P4.10.

### D18 — SIM rules / eSIM in the create path

- **Question:** the create path uses a checkbox where the company page uses a switch (L22, C15).
- **Options:** checkbox (today); `LiveSwitch` that does not save on toggle.
- **Answer:** **`LiveSwitch`, no save on toggle** (the form saves), owner 2026-11-13.
- **Slices:** P3.10.

### D19 — Button radius

- **Question:** buttons render 6px; `DESIGN.md` said 8px (B14).
- **Options:** (a) keep 6px, fix the doc; (b) 8px.
- **Answer:** **(a)**, owner 2026-11-13 — no visible change; `tests/desk-system.spec.ts` keeps its 6px assertion.
- **Slices:** P0.1 (`DESIGN.md`), P3.1.

### D20 — Sign-in field height

- **Question:** `.gauth-box` is 44px; the password and two-step fields are 42px (C7).
- **Options:** (a) 44px everywhere; (b) 42px.
- **Answer:** **(a)**, owner 2026-11-13.
- **Slices:** P4.8.

### D21 — Field gap in pane forms

- **Question:** 8px between fields in panes, 14px in dialogs and forms (S6).
- **Options:** (a) keep 8px as a named pane role `--rd-form-gap-pane`; (b) unify to 14px.
- **Answer:** **(a)**, owner 2026-11-13 — no visible change; two documented roles.
- **Slices:** P3.7.

### D22 — Light `--rd-muted`

- **Question:** light `--rd-muted` reaches 4.33:1 on `--rd-surface-3` (A23).
- **Options:** (a) darken until ≥ 4.5:1 (≈ `#636363`) and update `DESIGN.md:171`; (b) keep it and move muted text off
  surface-3.
- **Answer:** **(a)**, owner 2026-11-13.
- **Slices:** P6.4.

### D23 — Zebra rows

- **Question:** two zebra recipes (T13).
- **Options:** (a) two named tokens at today's values; (b) one recipe (a tiny visible change).
- **Answer:** **(a)**, owner 2026-11-13 — keeps P1 zero-diff; unifying belongs with rounding (D6 b).
- **Slices:** P1.8, P2.10; the P2 gate (G2) and the P7 gate.

### D24 — Company / package grid track

- **Question:** the 180px grid track shows one card a row on phones (R12).
- **Options:** (a) `min(100%, 160px)` under 640, today's 180px above; (b) 160px at every width.
- **Answer:** **(a)**, owner 2026-11-13 — two a row on phones, desktop unchanged.
- **Slices:** P5.4.

### D25 — Focus ring colour

- **Question:** which colour the one focus ring takes once focus is unified (the spec's access rule: one focus ring).
- **Options:** (a) unchanged crimson `--rd-accent`; (b) another colour.
- **Answer:** **(a)**, owner 2026-11-13.
- **Slices:** P6.6.

### D26 — Off-scale `@media` widths

- **Question:** 860 (sign-in split), 960 (settings, overview, branding), 1000 (home top row), 1200 (search), 560
  (doors, dialog grids), 520 (method cards), 420 (detail rows) would move a switch point if mapped to the scale.
- **Options:** (a) named exceptions at today's widths, listed in `DESIGN.md` "Breakpoints" and allowed by
  `check-css`; 720 → 767, 760 → 767, 639 → 640 mapped; (b) map every width to the nearest step.
- **Answer:** **(a)**, owner 2026-11-13 — no approved layout moves.
- **Slices:** P1.1 (the guard's allowlist), P5.1, P8.1.

### D27 — Touch sizing on coarse pointers at ≥ 768px

- **Question:** do tablets and touch laptops (a coarse pointer at 768px and wider) also get the 44px touch sizes?
- **Options:** (a) no — 44px only under 767 (D5); (b) also `(pointer: coarse)` at any width.
- **Answer:** **(a)**, owner 2026-11-13. One exception that is not a coarse-pointer rule: the topbar in drawer mode
  (768–899) uses the phone 44px sizes because the shell is a drawer there (P5.2).
- **Slices:** P5.2, P6.5.

### D28 — Visual audit scope

- **Question:** which captures are taken for open states and which an inspector views (widths 375, 390, 700, 768,
  1024, 1280, 1440, 1920).
- **Options:** (a) Tier 2 open states at one width per band (375, 700, 768, 1024, 1280, 1440, 1920) in ar-dark,
  en-light, he-light, ar-light; inspectors view Tier 1 at all eight widths in ar-dark, en-light, he-light plus 375,
  700, 1280 and 1920 in ar-light, en-dark, he-dark, and every Tier-2/3 capture; (b) as (a) with Tier 2 in all six
  combos and every Tier-1 combo viewed at every width; (c) as (a) with the first three combos viewed only; (d) a
  literal full matrix (not recommended).
- **Cost (question iii, as stated in the spec beside the options):** (a) ≈ 9,650 captures (≈ 24,000 tiles), ≈ 20,000
  tiles viewed in ≈ 170 inspection units × 3 agents (≈ 510 agent runs), several nights of sequential capture; (b)
  ≈ +50% Tier-2 captures and more viewed tiles; (c) ≈ a fifth fewer inspection runs. None of (a)–(c) is a literal full
  matrix: Tier 2 skips 390, Tier 3 shell states use three fixed combos, the main/agent sign-in pages are captured at
  1280 ar-dark only.
- **Answer:** **(a)**, owner 2026-11-13.
- **Slices:** P8.1, P8.2, P8.3, P8.6.

### Branch

- **Question:** where the slices are committed.
- **Options:** (a) a work branch `ui-maintenance`; (b) local `main`.
- **Answer:** **(a)**, owner 2026-11-13. Created from `a84484f` on 2026-11-14 by the orchestrator, before P0.1. The
  branch reaches `main` only at P8.6 on the owner's «ادمج في المين». While a slice is open (first evidence run to
  commit) and during P8.2–P8.6, no backend file in this tree is edited: backend work pauses or runs in a separate
  worktree with no server (one working tree, one app copy).
- **Slices:** every slice (protocol step 5, branch precondition).

### Audit file

- **Question:** `AUDIT_REPORT.md` was untracked while the committed spec and plan cite it.
- **Options:** (a) commit it as `docs/reviews/2026-11-13-ui-audit.md` (content unchanged) and point every reference
  there; (b) keep it local and untracked.
- **Answer:** **(a)** — recommended answer taken by the orchestrator under the owner's instruction of 2026-11-14; to
  be confirmed by the owner. P0.1 copied the file byte for byte and removed the root copy; the spec and plan cite the
  new path.
- **Slices:** P0.1, P7.1.

### Rule files (question i)

- **Question:** may the slices edit the always-applied `.cursor/rules/smilesim-ui.mdc`, `content-ui.mdc`,
  `direction-theme.mdc` (in P0.1, P2.2, P3.9, P4.1, P6.2 and P7.1), and may this ADR carry the interim precedence
  sentence?
- **Options:** (a) yes; (b) no — each rule edit asked for separately.
- **Answer:** **(a)** — recommended answer taken by the orchestrator under the owner's instruction of 2026-11-14; to
  be confirmed by the owner. The sentence is under "Interim precedence" above.
- **Slices:** P0.1, P0.9 (removes "(defined in P0.9)" from `smilesim-ui.mdc`), P2.2, P3.9, P4.1, P6.2, P7.1.

### graphify and board regeneration (question ii)

- **Question:** re-extract core docs (`/graphify . --update`) after every core-doc edit (CLAUDE.md), or once at the
  end of each phase; and regenerate the Excalidraw boards (`node docs/architecture/generate.mjs`) in the last slice of
  each phase in which a listed file changed, instead of in every such slice.
- **Options:** (a) end of each phase, P7.2 and P8.6 (boards: the phase's last slice); (b) after every slice that
  edits a core doc or a listed file.
- **Answer:** **(a)** — recommended answer taken by the orchestrator under the owner's instruction of 2026-11-14; to
  be confirmed by the owner. Both are deviations from CLAUDE.md's "in the same change"; the code graph still rebuilds
  on every commit (git hooks).
- **Slices:** protocol step 2.3, G5, P3.14, P4.10, P7.2, P8.6.

### Click checks of `V.nn` slices (question iv)

- **Question:** may verify-before-reply.mdc §4's click checks of `V.nn` fix slices be deferred to one `V.click` pass
  under P8.2's no-data-change window?
- **Options:** yes; no (each `V.nn` slice clicks its own change).
- **Answer:** **yes** — recommended answer taken by the orchestrator under the owner's instruction of 2026-11-14; to
  be confirmed by the owner. Every other visible slice still clicks what it changed (CHK-LOOK).
- **Slices:** P8.2, P8.5.

## Consequences

- `DESIGN.md` states one button model from P0.1 on: every primary crimson, one per view by the precedence above, the
  chosen page number ink, cancel then the action in a foot, «إكمال» primary with a pressed state, 6px corners; the
  three named exceptions under D2 are written there.
  `smilesim-ui.mdc` and `content-ui.mdc` say the same. Later demotions of extra crimson buttons (P3.2) follow a
  written rule and are not regressions.
- An answer that differed from a recommendation would have needed a `docs(plan): amend` of the affected slices
  before P0.2; every D# answer here is the recommendation, so no slice text changes.
- The four orchestrator-taken answers, and the three named exceptions under D2 (P0.1's reading), stand until the owner
  confirms or changes them; a change is recorded here and in the plan's Status, and the affected slices are amended.
