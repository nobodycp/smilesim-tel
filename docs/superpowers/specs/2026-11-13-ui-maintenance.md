# UI maintenance — spec

Date: 2026-11-13. Source: `docs/reviews/2026-11-13-ui-audit.md` (moved from the untracked root `AUDIT_REPORT.md` in plan slice P0.1, content unchanged; Arabic; 277 confirmed findings in section 3, root causes and
"تعارضات بين الحلول" in section 2, a draft plan in section 5, a draft rules section for `DESIGN.md` in section 6).
Plan: `docs/superpowers/plans/2026-11-13-ui-maintenance.md`. Owner request (2026-11-13): a complete, very detailed
maintenance plan, checked by more than one model; every step done by one executor and reviewed by two; phases entered
only after two agents confirm the previous one is ready; then a visual audit by several models on every screen size,
with the same one-finds / two-confirm method.

## Goal

Make the desk's look **one system with one definition per thing**, and keep it that way:

1. Every selector has one definition in the sheet that owns it; `graphite.css` (the last-loaded patch layer, 1486
   lines, 44 `@media` blocks) is folded into its owners and deleted, and dead rules go in the same change.
2. Every value is a token; tokens carry roles (title, figure, pane padding, gutter, form gap, icon size, focus ring,
   disabled), not only raw steps.
3. One component per pattern (Button sizes and variants, IconButton, Pane, Mark, CompanyMark, FigureTile, PickCard,
   FieldRow, FormActions, EmptyState, Stat with a lead), and one page template per page kind (list, detail,
   settings, create) built by an extended `Desk` and `AuthFrame`.
4. Phones are first-class (no clipping at 375px, one breakpoint scale), RTL is correct by construction, and the
   desk passes WCAG 2.1 AA for text contrast, control boundaries, focus visibility, touch size and names.
5. Guards (a CSS check in `npm run lint`, an ESLint rule for feature markup) stop the same drift from coming back.

## The problems, by root cause (audit §2)

Counts below are approximate and the ids are samples. The **complete** list — all 277 findings, each with its
location and the slice(s) that close it — is the plan's coverage appendix
(`docs/superpowers/plans/2026-11-13-ui-maintenance.md`, "Coverage appendix"); completeness is checked there, not here.

| Cause | What is wrong | Findings (ids as in the plan's coverage appendix) |
|---|---|---|
| س1 Patch layer | `graphite.css` restates selectors at equal specificity and silently beats earlier sheets (kills the phone `.stat-value`, the phone topbar padding, the pane fill model); where it is weaker its own value is dead; dead legacy blocks remain (`auth.css` 33–326, `.notice-pop`, `.user-menu`…). | ~75; e.g. 3.1-03, 3.1-04, 3.2-05, 3.3-30, 3.3-26 |
| س2 Tokens without roles | No display/figure type steps (scale stops at 18px), no line-height, weight, icon, ring, disabled, pane, gutter, form-gap tokens; `--rd-text` and `--rd-line-strong` used but undefined; half-pixel sizes; weight 800 while Hebrew loads to 700. | ~60; 3.1-05…3.1-29, 3.4-*, 3.7-03/08/14/19 |
| س3 Primary button contradictions | `DESIGN.md` says ink primary (:15, :264), crimson primary (:88, :249) and white on crimson (:108); CSS does all of it; two "on crimson" tokens differ in dark; white on `#ff4d63` ≈ 3.2:1. | ~30; 3.1-01/02/14/15, 3.5-*, 3.10-01 |
| س4 Weak page templates | `Desk` takes `lede: string`, no actions slot, no loading / not-found / blocked state; pages build their own heads (home, settings, number card); the sign-in page copies `AuthFrame`. | ~45; 3.3-*, 3.6-07/34 |
| س5 Hand-copied patterns | `.figure-tile` ×9, company mark ×9 in three families, `.pack-pick` beside `.pick-card`, raw `.icon-btn`, hand-drawn SVG beside lucide, six save placements. | ~40; 3.6-*, 3.5-08/16/27 |
| س6 Access bound to containers | 44px rule on `.canvas` / `.dialog` / dead `.auth`, so portals and `.gauth` miss it; five focus styles, one removed (`.filter-pop`), one clipped (`.line-op`); field borders below 3:1; `--rd-faint` on active icons. | ~35; 3.10-*, 3.2-07/08/09 |
| س7 No breakpoint scale | 20+ widths: phone 767, touch 720, cards 640, drawer 899, topbar icons from 768. | ~15; 3.2-15/21, 3.3-16 |
| س8 Fixed sizes in shrinking boxes | 6.5rem price fields, 180px grid tracks, 16rem brand tracks, popovers anchored to their button under `overflow: hidden`. | ~10; 3.2-01/02/11/12 |
| س9 Direction by hand | `.flip-ltr` at zero specificity loses to any `transform`; no `.flip-rtl`; physical keyframes; `dir="ltr"` on blocks. | ~15; 3.8-* |
| س10 Global SVG reset | `svg { width:16px; height:16px; stroke-width:1.9 }` beats lucide's `size` / `strokeWidth`. | 10; 3.1-06, 3.6-04 |
| س11 Stat cannot lead | `highlight` only greens the value, `tone` only colours the icon, report tiles have no icon. | ~10; 3.9-09/13/28/29 |
| Single issue | `textarea` missing from `base.css:19` → monospace text in every textarea. | 3.7-01 |

Corrections to the report found while writing the plan (verified 2026-11-13 against the code):

- R1: the phone search popup is `width: min(18rem, 72vw)` (`shell.css:722–731` and again `:745–756`), not a fixed
  270px; at 375px it is 270px, so the report's overflow arithmetic holds.
- T19 / L26: `.login-enter` (and its `login-in` keyframes, `auth.css:333–336`) are live; `login-name` / `login-tag`
  appear only as an element id and as `bp-login-*` classes, so the `.login-*` rules other than `.login-enter` are dead.
- B15: 11 outline call sites = 8 `variant="outline"` + 3 `buttonClass({ variant: 'outline' })`.
- `tests/desk-system.spec.ts` asserts the primary fill `rgb(255, 77, 99)` and a 6px radius: decisions D1 and D19 (B14)
  decide that spec.
- `apps/web/visual-audit/audit.visual.ts` covers 28 routes, one door, 390/768/1280 and ar-dark/en-light only.
- All other spot-checked line references (≈60) matched the code within ±2 lines. Line numbers move as slices land, so
  every plan step names the selector first and the line second.

## Target rules (to adopt in `DESIGN.md`, final wording in plan slice P7.1)

Adopt the audit's §6 ("Fixed rules", `docs/reviews/2026-11-13-ui-audit.md`) with these resolutions of its open points:

- **Tokens.** No literal colour, size, space, radius, shadow, duration or easing in a sheet (allowed: `0`, 1px
  hairlines, `50%`, negative pulls as `calc(-1 * var(--rd-space-*))`, named one-offs listed in `DESIGN.md`). A value
  used twice gets a role token. A referenced token exists. Theme-independent tokens live once in `:root`. Type steps add
  `--rd-text-title` (page h1), `--rd-text-display-*` (sign-in, doors, figures) and `--rd-text-figure` /
  `--rd-text-figure-sm`; off-scale values in use today become **named role tokens with today's value** (D6).
  Weights 400–700 (D7). Line heights `--rd-leading-tight / -snug / -body`. Icons `--rd-icon-sm/md/lg` set in CSS.
- **Colour.** One crimson model (D2): every primary is crimson, secondary is the soft track, destructive is the danger
  outline, ink fills are not actions. Content on a crimson fill uses `--rd-on-accent` on `--rd-accent-fill` and passes
  4.5:1 in both themes (D1); `--rd-on-mark` is for company marks only. Small crimson text uses `--rd-accent-text`.
  `--rd-faint` is decoration and disabled only. Control boundaries use `--rd-field` unmixed and reach 3:1.
- **Buttons.** One primary per view. Precedence: the page-head action, else the submit of the view's main form; a save
  in a secondary pane, a lookup step and a per-row save are secondary. Sizes sm 32 / md 34 / lg 40 / icon 36 /
  iconSm 28, one radius, set only in `ui.css`; no context rule resizes or recolours a Button. Icon-only actions are
  `<Button size="icon|iconSm">`; raw `.icon-btn` is for shell icons only. A variant is not a state (`aria-pressed`).
  One foot order (D8).
- **Components.** One of each in `components/`; ESLint flags `className="icon-btn"`, `<dl>`, `<p className="empty">`
  and raw `<svg>` under `features/`. Icons are lucide; custom glyphs live in `components/icons.tsx`. Stat has one lead
  per row and `tone` colours the value.
- **Page templates.** Every desk page renders through `Desk` (title string, lede node, actions slot, state
  loading / notFound / blocked). Four templates (list, detail, settings, create). A table's title is its pane head or
  nothing. The save sits after every field it saves. A head fact is not repeated below.
- **Responsive.** Breakpoints 640–641 / 767–768 / 899–900 / 1099–1100 only for `@media` (`max-width` takes the
  lower number, `min-width` the higher; container queries allowed),
  plus the named exceptions D26 records, each listed in `DESIGN.md` and in the `check-css` allowlist.
  New rules mobile first. Fixed widths in shrinking boxes use `min(100%, X)`. Popovers anchor to the bar or the
  viewport. Full height uses `vh` in the base rule and `dvh` inside `@supports (height: 100dvh)`.
- **RTL.** Logical properties on both axes (checked). Direction helpers use `scale` (`.flip-ltr`, `.flip-rtl`).
  Horizontal motion uses `--rd-dir`. Latin content is isolated inline with `<bdi dir="ltr">`.
- **Access.** Touch targets ≥44px under the touch breakpoint (D5), on the primitive. One focus ring
  (`--rd-ring-width`, `--rd-ring-color`, inset variant for clipped shapes); `outline: none` only with a replacement.
  One disabled look (`--rd-disabled-opacity`). An `aria-label` never hides visible text; counts are in the name.
- **Cascade.** One selector, one definition, one owning sheet; a dead rule is deleted in the change that kills it;
  `apps/web/scripts/check-css.mjs` enforces it inside `npm run lint`.

## What changes for users (visible)

These classes of change, each in a named slice of the plan; a visible change outside these classes is a regression.
Reviewers read the slice text for the exact items:

- Crimson buttons and every other crimson fill with content (marks, avatar, counts, chosen day, checked boxes, the
  sign-in art's tag under its heading and line) in dark mode get legible white text on a deeper crimson (D1); hover
  darkens instead of lightening. The sign-in art's line, drawn over the tag, turns from 72% to the art's full ink in
  both themes (the art is dark in both, and the line is under 4.5:1 on the tag in light too).
- Token fixes in P1.2: the period chip, chart tip and task ref turn ink (they used an undefined token); `/roles` grant
  tiles get their intended stronger hairline; light warning tint derives from the warning colour (slight). Under
  D6 b / D23 b only: 1px label gaps become 2px and one zebra recipe (P1.8).
- The page head (P4.1): the lede moves under the title in the title column and the actions sit at the inline end
  (today: title, action, then a full-width lede row).
- Pager: page numbers and arrows share one size (32px; 30px today) (P3.1).
- Between 721 and 767px, the blocks that stack at 720 today stack as on phones (D5, D26); the offer slide stacks from
  767 instead of 760 (P5.1).
- Sign-in password and two-step fields 44px like the sign-in page (D20 a).
- Phone fixes: search and notice menus stay on screen; price editors stop spilling; the task ticket's conversation
  and compose bar scroll into view; topbar edge matches the page edge (D9); `.stat-value` shrinks on phones (D10);
  company/package grids show two cards a row; long names wrap instead of being cut.
- Focus is visible on the filter list, the number-card operations and every control; touch targets reach 44px under
  the touch breakpoint, including popups, the date picker, dialogs' close and the sign-in pages.
- Textareas use the interface font.
- Fewer competing crimson buttons: per-row saves, lookups and secondary-pane saves become secondary; the task ticket's
  «إكمال» stays primary with a pressed state (D13); destructive actions use the danger outline or a danger menu item.
- One save placement per form kind; the package price tab's «حفظ» moves after the eSIM field.
- Repeated head facts disappear from first tabs and rails; key figures lead (reconciliation difference, available to
  sell, the expiring state in one colour).
- Contrast: field and checkbox borders darken, small crimson/green/amber text in light mode darkens, resting icon
  glyphs use `--rd-muted`.
- RTL: arrows and slide-ins face the reading direction in English; Latin logins align with their names.
- Weight 800 becomes 700 (D7). Selected tab no longer widens. Task message text 15→14px.
- Screen readers: unread count, toast close, language name, search clear and operation cards are named correctly; the
  line-details copy button announces success.
- One disabled look: every disabled control at `--rd-disabled-opacity` 0.5 (P3.1 step 4). Today: 0.4 on the steps
  strip; 0.45 in dialogs, on checkboxes and radios, number-card operations and the live switch; 0.55 on pick cards;
  0.6 on the Select field and the outage bar's button (these get fainter, the others clearer); Button and the sign-in
  buttons already 0.5. A guard (`check-css` (l)) keeps any new literal disabled opacity out.
- One figure scale (P3.8): package-sheet stats 1.5rem/800 → 1.45rem/700; fact-card values 18px → 1.2rem; one lead
  figure per stat row.
- Settings shows its error line as the page alert every other page uses (plain `Alert`, not the banner) (P4.2).
- Layout re-orders named in P3/P4 slices: the offers preview sits below its table; session-end, passkey-delete,
  offer-delete and reconciliation row actions become RowMenu items; number-card danger operations come last after a
  divider; section marks on the number card turn neutral (crimson only for the period and the end); the folded rail's
  icons are centred.
- Tablets 768–899 (drawer mode): the topbar icons, search toggle and wallet chip height go 36px → 44px, like
  phones; 36px from 900 (P5.2; 3.3-16, 3.2-21). The wallet amount and the search box stay as today at those widths.
  If the 768 topbar row does not fit on one row, P5.2 falls back to today's 36px and this line is removed.
- Task ticket (P5.6): the board stacks (rail above thread) whenever the ticket pane is 36rem or narrower, including
  viewport 900 to about 916 with the sidebar open, where today the 900px media rule forces two cramped columns.
- Breakpoint edges move by 1px where a query overlapped its twin (900 → 899, 1100 → 1099, min 640 → 641) (P5.1).

## What must NOT change

- Endpoint calls, payloads, money handling, status logic, navigation and routes (no page added, removed or merged;
  `/reports/[kind]` stays; tabs are not merged).
- Response shapes (`response-shape.spec.ts`), copy keys' meaning (new keys only for new accessible names / ledes,
  in ar, en and he).
- Layouts approved by the owner unless a decision below says otherwise: the Graphite identity, the sign-in split, the
  home layout, the roles matrix, the numbers table columns, the page title size (D4 default keeps 20px), the
  chosen page number (D3 default keeps ink), the dialog foot order (D8 default keeps today's order).
- Behaviour-preserving slices (all of P1 and P2.1–P2.10, marked "zero-diff" in the plan) must leave every element's
  computed style unchanged — at rest, in `::before`/`::after`, and in forced hover / focus-visible / active states, at
  one width inside every breakpoint band (measured with `apps/web/tests/dom-snapshot.mjs STYLES=1 STATES=1`).
  **The only exceptions** are the visible changes named in P1.2 (and in P1.8 only if D6 = b or D23 = b), listed
  above.
- One running copy on port 3000; no local build / Docker build / e2e / full `test:api`; no push without the owner.

## Owner decisions needed before work starts (recorded in ADR 0021 by plan slice P0.1)

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | Text on a crimson fill in dark (today white on `#ff4d63`, ≈3.2:1; conflict 1) | (a) near-black text `#111213` on today's crimson — passes, changes the look, contradicts `DESIGN.md:108`; (b) a separate fill token `--rd-accent-fill` (dark ≈ `#d93049`, the light accent; white ≈ 4.7:1) with white text, `--rd-accent` (thread, focus, links) unchanged; (c) darken `--rd-accent` itself in dark — changes ~120 rules, the thread and the focus ring | **(b)**. Hover darkens the fill (mix toward black), never toward ink. Exact values measured with a contrast script ≥4.5:1 in both themes, text and hover. |
| D2 | Primary button model (`DESIGN.md` :15/:264 vs :88/:249; conflict 10) | (a) every primary crimson (owner 2026-11-11, what the code does) **plus** "one primary per view" with the precedence above; (b) ink primary, crimson for one special action | **(a)**. `DESIGN.md` :15, :109, :264 rewritten in P0.1 before any button is demoted. |
| D3 | Chosen page number (graphite `:514` ink vs `DESIGN.md` :88/:249 crimson) | (a) ink, as rendered and as `DESIGN.md:50` says; (b) crimson | **(a)** — it is a state, not an action; keeps one crimson per screen. Doc :88/:249 corrected. |
| D4 | Page title size (rendered 20px from `frame.css:91`; 22px and 24px are dead) | 20px / 24px | **20px** (no visible change; 24px wraps head buttons at 375). |
| D5 | Touch breakpoint | 720 (today) / 767 (phone layout) | **767** (closes the 721–767 band with 34px controls). One `DESIGN.md` line changes. |
| D6 | Off-scale values (12.5 / 11.5 / 13.5 / 14.5px, 18px pane padding, 22px / 28px gutters…) (conflict 6) | (a) named role tokens holding today's value; (b) round to the scale | **(a)** now; rounding is out of scope (its own spec later). |
| D7 | Weight 800 (21 uses; Hebrew face stops at 700) | (a) cap at 700, emphasis by size; (b) keep 800 for ar/en | **(a)**. Small visible change in ar/en; Hebrew already renders 700. |
| D8 | Dialog / form foot order | (a) today's order: cancel then action, the cluster at the inline end (action at the far end); (b) action first as `DESIGN.md:247` says | **(a)**; correct the doc; `.brand-foot` follows (a). |
| D9 | One gutter for topbar and canvas | phone 16px and ≥768 28px for both / keep clamp(16px, 2vw, 28px) | **16 / 28** (content edge moves ≤12px on tablets; topbar and canvas align). |
| D10 | Reviving dead rules (conflict 2) | per rule | **Revive** `.stat-value` 1.2rem on phones (fixes clipping); topbar phone padding per D9; **do not revive** the pane `flex: 1` fill model (delete it, conflict 3); title per D4. |
| D11 | Frozen shell areas (A21, A22; `responsive.css:35` says frozen) | approve / keep frozen | **Approve**: 44px under the touch breakpoint for drawer close, «تعليم الكل مقروءًا», notice rows and path links; the fold handle visible on `hover: none`. |
| D12 | Page width per template (L32: forms at reading width) | now / own spec later | **Later** (its own spec; not in this plan). If the owner answers "now", a separate spec and plan are written and approved before plan phase P4 starts. L32's other part (page padding split across two sheets) is fixed in P5.3 either way. |
| D13 | Task ticket head (B5, H10) | (a) «إكمال» always primary with an `aria-pressed` style, «رفض» / «إلغاء» danger outline (documented); (b) also move «إلغاء» into a RowMenu | **(a)**. |
| D14 | Per-row save on the packages price table (B2, H6) | (a) secondary `sm`, enabled only when the row changed; (b) one bulk save | **(a)**; (b) changes behaviour (partial failure) and is out of scope. |
| D15 | Line details facts on phones (R16) | two columns (today) / `auto-fit, minmax(min(100%, 11rem), 1fr)` | **auto-fit** (one column at 375, two when room). |
| D16 | Filter bar attached to its table vs separate (L5) | force one / document per page | **Document per page** (both shapes are approved designs). |
| D17 | Pane hint position (C17: two pages differ on purpose) | one position / `PaneHead hint` slot with `placement` | **Slot with placement**, no visible change. |
| D18 | SIM rules / eSIM in the create path (L22, C15) | checkbox (today) / `LiveSwitch` that does not save on toggle | **`LiveSwitch`, no save on toggle** (the form saves). |
| D19 | Button radius (B14: 6px rendered, `DESIGN.md` says 8px) | (a) keep 6px, fix the doc; (b) 8px | **(a)** — no visible change; `desk-system.spec.ts` keeps its 6px assertion. |
| D20 | Sign-in field height (C7: `.gauth-box` 44px vs password / two-step fields 42px) | (a) 44px everywhere; (b) 42px | **(a)** — matches the approved sign-in page and the 44px touch rule. |
| D21 | Field gap in pane forms (S6: 8px in panes vs 14px in dialogs/forms) | (a) keep 8px as a named pane role `--rd-form-gap-pane`; (b) unify to 14px | **(a)** — no visible change; two documented roles. |
| D22 | Light `--rd-muted` (A23: 4.33:1 on surface-3) | (a) darken until ≥4.5:1 (≈ `#636363`) and update `DESIGN.md:171`; (b) keep it and move muted text off surface-3 | **(a)** — one token change, AA everywhere. |
| D23 | Zebra rows (T13: two recipes) | (a) two named tokens at today's values; (b) one recipe (tiny visible change) | **(a)** — keeps P1 zero-diff; unifying belongs with rounding (D6 b). |
| D24 | Company / package grid track (R12) | (a) `min(100%, 160px)` under 640, today's 180px above; (b) 160px at every width | **(a)** — two a row on phones, desktop unchanged. |
| D25 | Focus ring colour | (a) unchanged crimson `--rd-accent`; (b) another colour | **(a)**. |
| D26 | Off-scale `@media` widths that would move a switch point (860 sign-in split, 960 settings / overview / branding, 1000 home top row, 1200 search, 560 doors / dialog grids, 520 method cards, 420 detail rows) | (a) named exceptions at today's widths, listed in `DESIGN.md` "Breakpoints" and allowed by `check-css`; 720 → 767, 760 → 767, 639 → 640 mapped; (b) map every width to the nearest step (moves those switch points) | **(a)** — no approved layout moves; the scale holds for everything else. |
| D27 | Touch sizing on coarse pointers at ≥768px (tablets, touch laptops) | (a) no — 44px only under 767 (D5); (b) also `(pointer: coarse)` at any width | **(a)** — (b) changes the approved desk density on tablets. One exception, not a coarse-pointer rule: the topbar in drawer mode (768–899) uses the phone 44px sizes because the shell is a drawer there (P5.2). |
| D28 | Visual audit scope: which captures are taken for open states, and which an inspector views (widths 375, 390, 700, 768, 1024, 1280, 1440, 1920; 700 covers the 641–767 band, 1920 the wide monitor) | (a) Tier 2 open states at one width per band (375, 700, 768, 1024, 1280, 1440, 1920) in ar-dark, en-light, he-light, ar-light; inspectors view Tier 1 at all eight widths in ar-dark, en-light, he-light **plus 375, 700, 1280 and 1920 in ar-light, en-dark, he-dark**, and every Tier-2/3 capture; (b) as (a) but Tier 2 in all six combos (≈ +50% Tier-2 time) and inspectors view every Tier-1 combo at every width; (c) as (a) but inspectors view the first three combos only (the other three machine-checked only) | **(a)** — every band and every combo is seen by an agent at a phone, a tablet and a desktop width; dark en/he open states are covered by Tier 1 colours and the contrast data. **Cost (shown to the owner with the options):** (a) ≈ 9,650 captures (≈ 24,000 tiles), ≈ 20,000 tiles viewed in ≈ 170 inspection units × 3 agents (≈ 510 agent runs), several nights of capture; (b) ≈ +50% Tier-2 captures and more viewed tiles; (c) ≈ a fifth fewer inspection runs. **None of (a)–(c) is a literal full matrix**, and the owner is told so: Tier 2 open states skip width 390 (375 stands for phones) in all three; Tier 3 shell states use three fixed combos (ar-dark, en-light, he-dark) at all eight widths; the main/agent sign-in pages are captured at 1280 ar-dark only (same screens as admin/pos, captured in full). Option **(d)**, offered for completeness: a literal full matrix (every view and state at all eight widths, in all six combos, on every door) — a multiple of (a) that the orchestrator estimates from P8.1's case counts before the owner decides; not recommended. |
| Audit file | `AUDIT_REPORT.md` is untracked; the committed spec and plan cite it | (a) commit it as `docs/reviews/2026-11-13-ui-audit.md` (content unchanged) in P0.1 and point every reference there; (b) keep it local and untracked | **(a)** — a committed plan should cite a committed source. |
| Rule files | May the slices edit the always-applied `.cursor/rules/smilesim-ui.mdc`, `content-ui.mdc`, `direction-theme.mdc` (P0.1, P2.2, P3.9, P4.1, P6.2, P7.1), and may ADR 0021 say that an owner answer quoted in it wins over a rule sentence until P7.1 aligns them | (a) yes; (b) no — each rule edit is asked for separately | **(a)** — the rules must end up matching DESIGN.md (P7 gate). |
| graphify | Re-extract core docs (`/graphify . --update`) after every core-doc edit (CLAUDE.md) or once at the end of each phase | (a) end of each phase, P7.2 and P8.6; (b) after every slice that edits a core doc | **(a)** — the code graph still rebuilds on every commit. |
| Branch | Where the slices are committed | (a) a work branch `ui-maintenance`; (b) local `main` | **(a)** — the owner pushes `main` for backend work; a work branch keeps half-finished phases off it. Under (b) any push of `main` also ships a half-finished UI phase. Under (a) there is one working tree and one app copy, so backend commits reach `main` only by pausing during a slice, committing on `main` at a slice boundary, or a separate no-server worktree (plan, branch precondition). |

No slice after P0.1 starts until D1–D28, the branch, the audit-file, the rule-file and the graphify questions are answered and recorded (P0.2–P0.9
already depend on them, e.g. P0.8 on D9 and P0.9 on D1). If the owner answers differently from a
recommendation, the plan slice named in the ADR follows the answer; slices that depend on it say so.

## Out of scope

- Rounding off-scale values to the scale (D6 b), one zebra recipe (D23 b), reading width for forms (D12), bulk save (D14 b), merging tabs or
  removing pages (`/reports/[kind]`, package sheet's nine tabs), any API or behaviour change, the `design/` prototype
  files, copy rewrites beyond new accessible names and the missing ledes, performance work, a new font or colour.
  If the owner answers D6 b, D23 b or sets a D12 width, that answer is recorded in ADR 0021 and carried out by a
  follow-up spec and plan, not by this one.
- Visual parity with the prototype page by page beyond what the findings name.
