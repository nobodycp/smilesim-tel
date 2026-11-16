# Current identity — gap inventory (Tailwind migration T6.1)

Status: **open** (T6.1, 2026-11-16). T6.2 fills the component and state gaps, T6.3 folds the one-offs, T6.4 closes
this file. Plan: `docs/superpowers/plans/2026-11-15-tailwind-radix-migration.md` § T6. Owner, 2026-11-15: the
current identity (`DESIGN.md`, the `--rd-*` tokens, ADR 0021 D1–D28) is the target; nothing is redesigned.

Paths are relative to `apps/web/` unless they start with `docs/`. Counts are from the tree at `dee0e77` (after T5.2).

## 1. Method

Read only; no browser, no screenshots (owner, 2026-11-15: no visual verification). Sources:

- `DESIGN.md` (whole file) for what is defined; `components/ui/*.tsx`, `components/*.tsx` and the screens for what
  is drawn; `app/tailwind.css` for the tokens and the base rules left by T5.1.
- One-offs: a node script listed every arbitrary-value utility (`<utility>-[<value>]`) in `app/`, `components/`,
  `features/`, `lib/` (`.ts`/`.tsx`) with its files: **541 uses, 273 distinct values, in 97 files**. The full list is
  in the slice evidence (`apps/web/audit-output/tailwind/T6.1/arbitrary-values.txt`, git-ignored). Colour alpha
  modifiers (`border-ink/11`, `bg-surface-2/55`…) were counted with `rg -o '<colour>/<n>'`; legacy class hooks with
  `rg 'className=…\b<class>\b'`; token readers with `rg '(bg|text|border|…)-<token>\b|rd-<token>'`.
- Audit: `docs/reviews/2026-11-13-ui-audit.md` §3 (277 findings) through the id map of the superseded plan
  (`docs/superpowers/plans/2026-11-13-ui-maintenance.md`, Coverage appendix). Done there: P0.1–P0.9, P1.1, P1.2; every
  later slice was superseded. Each finding was then checked against the post-T5 tree where an `rg` or a read could
  settle it; the rest are marked *not re-checked* and treated as open.

Legend for the "DESIGN.md" column: **yes** = the element and its look are written down; **part** = named, look or
states incomplete; **no** = not described.

## 2. Element inventory

| Element | Built by | DESIGN.md | States drawn today | Missing or inconsistent (→ T6.2 unless noted) |
|---|---|---|---|---|
| Button | `ui/button.tsx`, `ui/button-variants.ts` | yes | hover, pressed (`active:scale-97`), focus-visible (2px page + 2px accent ring), disabled (50%) | **loading/busy** (no spinner or `aria-busy` look; screens only disable); `aria-pressed` look (D13: the ticket still swaps variant instead, see 3.5-05); disabled opacity differs from every other control (§3) |
| Icon button | `ui/icon-button.tsx` | yes | hover per tone, focus-visible (ink outline) | **disabled**, **pressed**, a **danger** tone (icon deletes in `features/catalog/package-addons.tsx`); 44px touch only for `sm` (`max-sm:size-10`, 40px) |
| Topbar icon | `components/chrome.tsx` `topbarIcon` | yes | hover, focus (ink outline) | a second icon-button recipe beside `IconButton` (→ T6.3) |
| Text field | `ui/input.tsx` | part | focus (accent border + `--rd-focus` ring), invalid (inset danger line) | **disabled**, **read-only** (DESIGN.md itself: "gap for T6.1"; the base `input[readonly]` rule loses to the utilities); invalid keeps the field border colour |
| Textarea | `ui/textarea.tsx` | yes | focus, invalid | **disabled**, **read-only** |
| Number / price | `components/price-field.tsx`, base `input[type=number]` | yes | focus, disabled (`--rd-surface-2`, muted), out-of-range red line | **saving / saved** feedback (saves on blur, no state); **invalid** beyond the range hint |
| Search | `components/table-search.tsx`, `label.filter-search` (base rule; 4 screens), `components/shell-search.tsx`, the packages list box | part | focus-within (accent inset line), holds-value (accent line) | **one Search primitive** (three shapes: 3.3-07); a **clear** control on the table search; empty-result state of the table search |
| Select | `ui/select.tsx` | yes | focus, open, disabled (60%), chosen row, row hover and keyboard focus | **invalid** (no `aria-invalid` look); empty list; loading list |
| Combobox (name picker) | `components/name-field.tsx` | yes | focus, matched text, picked «×» | **disabled**, **invalid**, **no match** row, loading; «×» is 24px (3.10-16) |
| Date picker | `components/date-field.tsx` on `ui/popover.tsx` | yes | today ring, chosen day, open button, hover | **disabled** field and **disabled days** (min/max), **invalid** text; the button is 34px beside a 44px field at 641–720px (3.2-08) |
| Checkbox | `ui/checkbox.tsx`, base `input[type=checkbox]` | yes | hover, focus-visible, checked, disabled (45%) | **indeterminate**; **invalid**; the unchecked border is ink at 32%, under 3:1 (3.10-08); two implementations (Radix and the base rule) |
| Radio | `ui/radio-group.tsx`, base `input[type=radio]` | yes | as the checkbox | **invalid**; two implementations |
| Radio card (pick a card) | hand-built `role="radio"` in `features/catalog/screens/add-package-screen.tsx`, `add-company-screen.tsx`, `features/auth/sign-in-methods.tsx` | part ("cards to choose") | chosen (crimson outline) | **a primitive** with roving focus and arrows (3.10-31), focus-visible, disabled |
| Switch | `ui/switch.tsx`, `components/live-switch.tsx` | yes | on/off colours, focus ring, disabled (45%) | **pending** (a switch that saves has no busy look) |
| Segmented | `ui/segmented.tsx` | part | chosen (surface-2 + crimson thread) | **hover**, **focus-visible** (browser default only), **disabled** (DESIGN.md notes the last two as not carried) |
| Period switch | hand-built `aria-pressed` buttons in `features/reports/report-kit.tsx` and `features/wallets/wallet-head.tsx` | yes (as `.period`) | hover, pressed | a copy of `Segmented`'s look with toggle semantics, twice (3.6-33) |
| Tabs | `ui/tabs.tsx`, `components/tabs.tsx` | yes | hover, selected, disabled (40%) | **focus-visible** (no mark of its own); the selected tab turns bold and widens (3.7-20) |
| Pagination | `ui/pagination.tsx` | yes | hover, current (ink), disabled arrows | **focus-visible** on the page numbers (browser default) |
| Table | `ui/table.tsx`, `components/data-table.tsx` | yes | head, zebra, row hover, sort chevrons, phone cards, empty block under the head | **loading rows** (skeleton row height differs from a real row, 3.4-19); **selected row**; **error** inside the table (screens use `LoadFailed` above it); focus-within on a row whose link has focus |
| Filters | `components/filter-bar.tsx`, base `[data-slot=filter-panel]` rules | yes | holds-value (crimson chip), toggle chip, focus (2px ring), clear | **disabled chip**; the phone drawer is hand-built, not `Sheet` (3.6-06) |
| Badge | `ui/badge.tsx` | yes | five tones, dot form | **`info` and `violet` have no colour**: the provider-operation phase badges (`features/tasks/components/provider-operation-panel.tsx`, `provider-decisions-screen.tsx`, `tasks-screen.tsx`) draw the waiting and the failed-to-settle phases in the inherited text colour, while DESIGN.md (Task ticket) names them `info` and `violet` |
| Stat tile | `components/stat.tsx`, `FigureBand` in `features/desk/overview.tsx`, `features/desk/home-top.tsx`, `features/wallets/wallet-head.tsx` | yes | icon tone, `highlight` (green value), progress, hover glow | **loading** and **empty value**; a **lead** figure (3.9-09, -13, -28): only the home band has a lead tile; the glow is copied in five files (§5.4) |
| Card / pane | `Pane` in `components/desk.tsx`, legacy `.pane` / `.pane-head` / `.pane-body` (base rules) | yes | — | **clickable card** states (hover, focus-visible, pressed) are per screen: `.line-op` has the documented focus ring, company cards, operation cards and package cards each draw their own (3.6-09) |
| Donut | `components/donut.tsx` | yes | slice focus/hover, draw-in | **empty** (all zero) |
| Alert | `components/alert.tsx` | yes | danger, success | **warning**, **info** tones (the outage bar draws its own) |
| Toast | `ui/toast.tsx`, `components/toast.tsx` | yes | success, error edge, close hover | **warning / info**; the close is named «×» (3.10-20) |
| Dialog | `components/dialog.tsx`, `ui/dialog.tsx` | yes | sizes, mark tones, drop-in | **busy** (submit pending) look; `max-h` uses `100vh`, not `dvh` (3.2-10) |
| Sheet | `ui/sheet.tsx` | part | start, end | **bottom sheet** (DESIGN.md: "no bottom sheet yet (T6)") |
| Popover | `ui/popover.tsx` | yes | open | — |
| Menu | `ui/dropdown-menu.tsx`, `components/row-menu.tsx` | yes | hover, keyboard focus, danger item | **disabled item**; the ⋯ trigger stays 28px on touch (3.2-09); its icon set is hand-drawn (3.6-04) |
| Tooltip | `ui/tooltip.tsx` | yes | open | **no caller**: the rail flyout in `components/app-shell.tsx` draws its own look (→ T6.3) |
| Sidebar | `components/app-shell.tsx` | yes | current, hover, folded rail, flyout, count | — (spacing one-offs in §5) |
| Topbar | `components/app-shell.tsx`, `chrome.tsx`, `shell-search.tsx` | yes | — | — (spacing one-offs in §5) |
| Crumbs | `components/crumbs.tsx` | yes | link, current | — |
| Empty | `components/empty-state.tsx` | yes | default, danger, actions | — |
| Loading skeleton | `ui/skeleton.tsx`, `components/loading.tsx` | yes | shimmer, spinner | the shimmer runs **under reduced motion** and always sweeps left to right (`ui/skeleton.tsx` notes it, 3.8-09) |
| Avatar / marks | `ui/avatar.tsx`, `components/company-mark.tsx`, layer tags | part | — | company marks are still hand-written beside `CompanyMark` (`features/accounts/screens/packages-terms.tsx:250`, `features/catalog/screens/packages-screen.tsx:170, 236`; 3.6-08); several soft-tile mark recipes (3.6-03) |
| File drop / chooser | `components/branding-drop.tsx`, file inputs in `esim-qr.tsx`, `company-screen.tsx`, `offers-screen.tsx`, `reconciliation.tsx` | part ("a system button over a hidden input") | — | **drag-over**, **error**, **focus-visible** on the offers picker (3.10-17); three shapes (3.5-27) |
| QR | `components/esim-qr.tsx` | yes | hover lift | loading (the QR is drawn client-side) |
| Auth screens | `components/auth-frame.tsx`, `auth-art.tsx`, `features/auth/screens/login-screen.tsx` | yes | — | `AuthFrame` always renders the lede paragraph, empty or not (3.3-34) |
| Return bar / outage bar | `components/app-shell.tsx`, `components/outage.tsx` | part | — | its own warning look (no `Alert` tone for it) |
| Offer hero | `components/offer-hero.tsx` | yes | timer, pause, hover arrows | — |
| Sparkline | `components/sparkline.tsx` | yes | — | **no caller**: DESIGN.md says the figure band's lead tile draws it (→ T6.4 doc or T6.3 delete) |

## 3. Cross-cutting state gaps (→ T6.2)

- **Disabled**: five opacities — Tabs 40%, Checkbox / Radio / Switch / dialog buttons (base rule) 45%, Button 50%,
  Select 60%; Input, Textarea, IconButton, Segmented, NameField, DateField and menu items draw none. One disabled
  treatment (one value, a token) for every control.
- **Focus**: five marks — Button (2px page + 2px accent ring), IconButton / topbar / language / link button (2px ink
  outline 1px out), Checkbox / filter toggle (2px accent outline 2px out), Switch (3px `--rd-focus` ring), fields
  and Select (accent border + 3px `--rd-focus`), Select rows (2px accent inset). **None** on Tabs, Segmented, the
  pager's page numbers, the hand-built radio cards. DESIGN.md "Motion and access" says page-level buttons use the ink
  outline, which `Button` no longer does: one rule per control family, written down.
- **Loading / busy**: no busy look on Button, Dialog submit, Switch or a saving price field; no loading rows for a
  table; no loading for Select, NameField, Donut, Stat.
- **Read-only**: no look on Input or Textarea (the base `input[readonly]` rule never wins).
- **Invalid**: Input and Textarea only; Select, NameField, DateField, Checkbox, Radio and the radio cards have none.
- **Pressed**: `aria-pressed` is drawn by the period switches and the account grant chips
  (`features/accounts/screens/account-screen.tsx:89`); `Button` has no pressed look (the ticket swaps variants).
- **Empty / no match**: NameField and Select have no "no match" row; Donut has no empty ring.
- **Touch (44px under 720px)**: missing on the ⋯ trigger (28px), the dialog close (36px), NameField «×» (24px),
  the date button (34px, 40px under 641px), the pager and phone tabs (40px), sign-in `lg` buttons (40px), and
  `<Button asChild>` links (the base `.canvas button` rule reaches `button` elements only).

## 4. Tokens the inventory proves are missing (→ T6.2, both themes where they differ)

- **`info` and `violet` tones** (colour + soft fill, contrast-checked): `Badge` types them and the task screens use
  them; they render uncoloured today. The only new colours this inventory asks for.
- **Disabled opacity** (one value; §3).
- **Touch breakpoint**: `max-[721px]:` is written 36 times in 27 files (the 720px touch rule); it is not on the width
  scale (641 / 768 / 900 / 1100). A named breakpoint (`touch`) instead of the literal.
- **Display type steps** above `--rd-text-2xl` (18px): page title (22px base rule, 24px base override, 1.25rem in
  `Desk` and `home-screen.tsx`, 26px in `auth-frame.tsx` and the number card), figure values (1.45rem / 1.2rem in three
  files, 1.9rem / 1.6rem in two), 20px (three files), 22px (three files). Named at today's sizes (ADR 0021 D6 a).
- **Half-pixel text steps** at today's sizes: 11.5px (23 uses, 21 files), 12.5px (16 uses, 16 files), 13.5px (4),
  14.5px (4) — D6 a: name them, do not round.
- **Line heights**: 12 literal values (`leading-[1.3]` in 9 files, `1.6` in 6, `1.35` in 5, `1.25`, `1.2`, `1.55` in
  3 each, `1.4`, `1.5` in 2…); no token.
- **Letter spacing**: `0.02em` (6 files), `-0.01em` (3), `0.03em` (3), `0.06em`, `-0.015em`, `0.12em`; no token.
- **The crimson thread** `inset 0 -2px 0 var(--rd-accent)`: one shadow written in five files (Segmented, Select,
  Tabs, the two period switches) → a shadow token.
- **Glow**: `0 0 8px currentColor` / `var(--rd-accent)` (Badge dot, notices dot, sidebar) → a shadow token.
- **Field border** `--rd-field` at 70% (7 uses in Input, Textarea, Select, `login-screen.tsx` and `session-rules.tsx`, and the base field rule) → a token; it is also the
  contrast finding 3.10-04.
- **Layers over a dialog**: `z-[calc(var(--rd-z-dialog)+1|+2|+3)]` and `z-[calc(var(--rd-z-topbar)+1)]` (6 uses) → named layers.

Already a token, written as a literal (→ T6.3, not T6.2): `--rd-line-strong` = ink at 11% (`inset-ring-ink/11`,
`border-ink/11`, `border-s-ink/11`: 17 uses in 13 files, and two `color-mix(… ink 11% …)` base rules);
`inset-ring-line` = `shadow-[inset_0_0_0_1px_var(--rd-line)]` (2 uses); `--rd-ease-standard` vs `ease-[ease]`
(9 uses, 6 files); `--rd-dur-base` 180ms vs `duration-[180ms]`.

## 5. One-offs (→ T6.3)

### 5.1 Values in two or more screens with no token (become a token or a variant)

The type, line-height, tracking, thread, glow, field-border, breakpoint and layer values of §4, and:

| Value | Uses | Where |
|---|---|---|
| `grid-cols-[minmax(0,1fr)_auto]` | 7 files | app-shell, offer-hero, stat, account, package-sheet, home-top, task-ticket (title + end slot row) |
| `bg-radial-[180px_circle_at_var(--mx,50%)_var(--my,0%)]` (figure glow) | 5 files | stat, line-ops, packages-screen, home-top, wallet-head → one figure-tile variant |
| `rounded-[1px]` / `rounded-[2px]` | 5 / 3 files | badge dot, bars and meters, switch knob, sidebar count, ticket dots — below the scale's 3px |
| `flex-[1_1_16rem]` | 3 files | package-addons, provider-packages, matching-pane (a field in a wrapping row) |
| `top-[calc(100%+6px)]` vs `top-[calc(100%+0.6rem)]` | 3 + 1 | chrome, shell-search, app-shell notices: popover offsets differ (3.4-05) |
| `w-[min(380px,92vw)]` | 2 | filter-bar's own drawer and `ui/sheet.tsx` `end`: the same panel twice |
| `grid-cols-[1fr]` / `grid-cols-[1fr_1fr]` | 5 / 4 files | user-settings, branding, numbers, offers, account — equal to `grid-cols-1` / `grid-cols-2` |
| `repeat(auto-fit,minmax(min(100%,16rem),1fr))` | 2 | facts, task-ticket |
| `transition-[background-color]` + `duration-[140ms]`, `duration-[160ms]` | 3 | companies, line-details, overview |
| `max-[640px]:` | 7 uses, 2 files | home-top, wallet-head: under 640px, one pixel off the scale's `max-sm:` (under 641px) |

### 5.2 One screen only (fold to the nearest token, or keep as a named layout value)

- Shell (`components/app-shell.tsx`, `shell-search.tsx`, `chrome.tsx`): rem spacing off the scale — `py-[0.55rem]`,
  `[0.6rem]`, `[0.7rem]`, `[0.12rem]`, `[0.4rem]`, `px-[0.6rem]`, `[0.7rem]`, `[0.85rem]`, `[0.4rem]`, `p-[0.45rem]`,
  `[0.7rem]`, `[0.35rem]`, `[0.8rem]`, `gap-[0.65rem]`, `[0.6rem]`, `pt-[0.35rem]`, `pb-[0.15rem]`, `me-[0.4rem]`,
  `my-[0.35rem]`; rem text `0.9rem`, `0.85rem`, `0.8rem`, `0.78rem`, `0.72rem`, `0.7rem`; `backdrop-blur-[14px]`;
  `-start-[2.5px]`, `inset-ring-[1.5px]`, `origin-[50%_4px]`; `min-[1200px]:` (twice); `min-w-[1.45rem]`.
- Task ticket (`features/tasks/screens/task-ticket-screen.tsx`): `size-[0.45rem]`, `top-[0.95rem]`, `mt-[0.4rem]`,
  `grid-cols-[1.25rem_minmax(0,1fr)]`, `text-[0.95rem]` (also `package-sheet-screen.tsx`), its two board templates.
- Sign-in (`auth-art.tsx`, `auth-frame.tsx`, `doors.tsx`): `text-[30px]`, `text-[28px]`, `max-w-[12em]`, `[26em]`,
  `max-[861px]:` (10 uses), `max-[561px]:`, `bg-radial-[90%_70%_at_30%_70%]`, `w-[min(520px,100%)]`, `[min(380px,100%)]`.
- Data visuals: `donut.tsx` (`text-[calc(var(--rd-text-2xl)*1.25|1.5)]`, `min-w-[3.5ch]`, `[2ch]`, a 4-column
  legend template), `trend-line.tsx` (`h-[55%]`, `blur-[3px]`, `shadow-[0_6px_16px]`, `bottom-[calc(100%+4px)]`),
  `sparkline.tsx` (`stroke-[1.75]`), `outage.tsx` (`size-[1.6rem]`, `stroke-[1.8]`, `max-w-[28rem]`, `text-[20px]`).
- Widths and breakpoints used once: `max-w-[22rem]` (matching-pane), `[32rem]` (reconciliation), `[36rem]`
  (home-screen), `[720px]` (chain-board), `[280px]` (tooltip); `max-[761px]:` (offer-hero, 9 uses), `max-[421px]:`
  (facts), `max-[1101px]:` (table), `max-[901px]:` (line-details), `max-[961px]:` (branding-preview), `max-[521px]:`
  (sign-in-methods), `min-[960px]:` (settings), `min-[640px]:` (home-screen).
- Grid templates: 50 distinct `grid-cols-[…]` values, 43 of them used once. Most are a screen's own layout and stay
  layout (not tokens); T6.3 folds only the ones equal to a utility (`[1fr]`, `[1fr_1fr]`) or repeated (§5.1).
- Animations: 31 distinct `animate-[…]` values (each names a keyframe with its own duration and curve); the stagger
  delays and the sheet's `cubic-bezier(0.32,0.72,0,1)` are not tokens (3.1-22).
- Single alpha tints: `bg-surface-2/55` and `/45`, `/30`, `bg-ink/3`, `bg-bg/88`, `bg-layer-main/16`,
  `border-accent/55` and `/45`, `border-danger/45`, `inset-ring-accent/35`, `ring-accent/18`, `ring-danger/18`,
  `from-accent/22` and `/55`, `stroke-ink/12`, `shadow-scrim-strong/50`, `border-ink/32` (checkbox).
- Font weight 800 (`font-extrabold`): 14 uses; the Hebrew face stops at 700 (3.7-14, D7).

### 5.3 Base-layer one-offs in `app/tailwind.css` (the legacy hooks T5.1 kept)

- The page title is defined four times: `h1` 22px, `.page-head h1` 22px, `.canvas .page-head h1` 1.25rem, and the
  graphite `.page-head h1` 24px — while `Desk` draws its own `text-[1.25rem]` (3.1-04, 3.3-33, 3.7-02; D4).
- The pane: `.pane-head` padding `0.9rem 0.85rem` then `14px 18px`, `.pane-body` `14px 18px 18px`, the pane's tabs
  `18px` sides — 18px is off the scale (3.4-02); `.desk > .pane` is `flex: 1` and then `flex: none` (3.3-30, D10).
- Literals: `.lede` `18px` bottom margin (3.4-13), `.canvas-inner` `22px 28px 56px` and `48px` (3.4-11),
  `clamp(…, 2vw, 28px)` (3.2-13, D9), filter chips `10px`, `12px`, `12.5px`, `8px`, `30px`, `32px`, `36px`, `280px`,
  `12rem` then `10rem`, `11rem`; `color-mix(… ink 11% …)` twice (= `--rd-line-strong`), `ink 32%` (checkbox),
  `accent 55%` (chip border).
- The 44px touch heights at 720px are written in three blocks (`.desk`, `[data-slot=dialog]`, `.canvas`) beside
  the components' own `max-[721px]:` utilities (3.2-23).
- Legacy class hooks still written in markup (each a reason a base rule survives): `pane` (8 uses in 5 files),
  `pane-head` (18 in 7), `pane-body` (21 in 11), `hint` (8 in 4), `filter-search` (4 in 4), `canvas` (3 in 2),
  `canvas-inner`, `desk`, `page-head` (2 each), `stack`, `lede`, `stat-row`, `price-pair` (1 each).

### 5.4 Hand-built copies of an existing component

- Period switch ×2 (`report-kit.tsx`, `wallet-head.tsx`) — Segmented's look with toggle semantics (3.6-33).
- Radio cards ×3 (`add-package-screen.tsx`, `add-company-screen.tsx`, `sign-in-methods.tsx`) (3.6-10, 3.10-31).
- Search ×3 shapes (`TableSearch`, `label.filter-search`, the packages box) (3.3-07).
- Company marks written by hand ×3 beside `CompanyMark` (§2).
- Hand-drawn `<svg>` icons beside lucide: `row-menu.tsx`, `shell-search.tsx` (×2), `table-search.tsx`, `icon.tsx`,
  `sign-in-methods.tsx`, `settings-screen.tsx`, `login-screen.tsx` (×2) (3.1-29, 3.6-04).
- Hand-written `<dl>` beside `Facts`: `features/lines/line-details.tsx:152`,
  `features/tasks/components/provider-operation-panel.tsx:74` (3.6-11).
- The filter drawer beside `Sheet end` (3.6-06); the rail flyout beside `Tooltip`; the figure glow ×5 (§5.1).

### 5.5 Unused or duplicated tokens

- No reader: `--rd-primary-hover`; 17 of the 19 `--rd-login-*` tokens (only `login-room` and `login-ink` are read,
  by `components/auth-art.tsx`) (3.1-19).
- Equal aliases: `--rd-radius-sm` = `--rd-radius-md` (6px), `--rd-radius-lg` = `--rd-radius-card` =
  `--rd-radius-tile` (8px) (3.1-16).
- Repeated unchanged in `.dark`: `--rd-radius-lg`, `--rd-scrim-strong`, `--rd-qr-tile`, `--rd-on-accent`,
  `--rd-on-mark`, `--rd-accent-fill-hover`, `--rd-shadow-sm`, all 19 `--rd-login-*` (3.1-18).
- `--rd-primary-bg` still names a button although no button reads it (P1.3's rename to `--rd-ink-fill` never ran;
  3.1-14).
- DESIGN.md's shadow table does not match the tokens (`--rd-shadow-card` is `0 1px 0` black at 3%, not `0 1px 2px`
  ink at 4%; `--rd-shadow-pop` is `0 24px 50px -20px` black at 28% / `0 24px 60px -20px` black at 70%) (3.1-21, → T6.4).

## 6. Audit findings after T5

Status per finding id (`3.T-NN`, the superseded plan's Coverage appendix). **Closed** = no longer true of the tree.
**T6.2 / T6.3 / T6.4** = open, inside this phase. **Out** = open, but closing it changes the look, the layout or
behaviour beyond completing the identity: it needs its own spec and an owner choice (owner, 2026-11-15: no
redesign); listed so nothing is lost. **n/c** = not re-checked in this read (a width, a contrast measure or a closer
read is needed); treated as open, in the column given.

### Closed (53)

- By the P0 and P1 slices: 3.1-01, 3.10-01 (P0.9 `--rd-accent-fill`), 3.10-02 (P0.3), 3.10-03 (P0.4), 3.2-01 (P0.6),
  3.2-02 (P0.7), 3.2-03 (P0.5), 3.2-05 and 3.4-01 (P0.8), 3.7-01 (P0.2), 3.1-07, 3.1-20, 3.1-27, 3.4-22 (P1.2).
- By owner decision written into DESIGN.md (P0.1, ADR 0021): 3.1-02 and 3.5-01 (D3: the chosen page is a state,
  ink), 3.5-14 (D19: 6px button corners).
- By construction — the legacy sheet, its dead rule or its override no longer exists (T1–T5): 3.1-03, 3.1-15,
  3.1-26, 3.1-28, 3.2-06, 3.2-24, 3.2-25, 3.3-15, 3.3-26, 3.3-28, 3.3-29, 3.3-31, 3.4-08, 3.4-09, 3.4-10, 3.4-15,
  3.4-24, 3.5-12, 3.5-13, 3.5-15, 3.5-19, 3.5-28, 3.6-01, 3.6-21, 3.6-22, 3.6-23, 3.6-25, 3.6-32, 3.7-04, 3.7-10,
  3.7-17, 3.8-04, 3.8-08, 3.8-15, 3.1-23 (inline styles carry only computed values now).
- By the component ports (T2–T4): 3.3-25 (`Desk` has an `action` slot).

The remaining 224 findings are open: 118 inside T6, 106 outside. (3.6-25 is the duplicate of 3.5-15; both are
closed and counted once each, as the audit counts them.)

### Open, inside T6

| Id | What is still true | → |
|---|---|---|
| 3.1-04, 3.3-33, 3.7-02 | page title in four base rules plus `Desk`'s own size (§5.3) | T6.3 |
| 3.1-05, 3.7-03 | no display steps; titles and figures are literals | T6.2 tokens, T6.3 |
| 3.1-06, 3.6-04, 3.1-29 | global `svg` reset in `@layer base`; hand-drawn icon sets | T6.3 |
| 3.1-08, 3.7-08 | half-pixel text sizes (§4) | T6.2, T6.3 |
| 3.1-09, 3.7-09 | rem text sizes between steps (shell) | T6.3 |
| 3.1-10, 3.7-16 | literals equal to text tokens (base `12px` in the chips) | T6.3 |
| 3.1-11, 3.4-07 | literals equal to space tokens (base rules) | T6.3 |
| 3.1-12, 3.4-16 | spacing off the 4px step (18px, 22px, shell rem values) | T6.3 |
| 3.1-13 | `--rd-line-strong` exists; ink 11% still literal ×19; two zebra recipes (`surface-2/55` rows, `ink/3` cards) | T6.3 |
| 3.1-14 | `--rd-primary-bg` name | T6.3 |
| 3.1-16 | equal radius aliases | T6.3 |
| 3.1-17 | `rounded-[1px]`, `[2px]` | T6.3 |
| 3.1-18 | theme-independent tokens repeated in `.dark` | T6.3 |
| 3.1-19 | 17 unused `--rd-login-*` tokens (the dead rules are gone) | T6.3 |
| 3.1-21 | DESIGN.md shadow values | T6.4 |
| 3.1-22 | 31 animate literals, stagger delays, 140/160/180ms, `ease-[ease]` | T6.3 |
| 3.1-24, 3.10-08 | checkbox border ink 32% (< 3:1) | T6.2 |
| 3.2-09 | ⋯ trigger 28px on touch | T6.2 |
| 3.2-15 | the scale exists, but `max-[721px]` ×36 and 13 other literal widths (§5.2) | T6.2 token, T6.3 |
| 3.2-23 | 44px touch heights in three base blocks | T6.3 |
| 3.3-30 | `flex: 1` then `flex: none` on `.desk > .pane` | T6.3 |
| 3.4-02 | pane padding 18px | T6.3 |
| 3.4-05 | popover offsets differ (6px, 0.6rem) | T6.3 |
| 3.4-11 | canvas padding 22px / 28px / 56px literals | T6.3 |
| 3.4-13 | `.lede` 18px | T6.3 |
| 3.4-17 | 5px / 7px insets (`px-1.25`, `gap-1.75`) | T6.3 (D6 a: name, do not unify) |
| 3.4-21 | ticket timeline in rem beside px | T6.3 |
| 3.5-16 | `IconButton` and `topbarIcon` are two icon-button recipes | T6.3 |
| 3.5-18, 3.6-24 | disabled opacity 40 / 45 / 50 / 60% | T6.2 |
| 3.5-20 | callers resize `Button` by class (pager arrows `h-7.5`) | T6.3 |
| 3.6-02, 3.9-09, 3.9-13, 3.9-28 | figure tiles in several recipes; `Stat` has no lead variant | T6.2 (variant), T6.3 |
| 3.6-03, 3.6-08, 3.3-13 | soft-tile marks per feature; company marks by hand | T6.3 |
| 3.6-05 | focus drawn five ways, none on tabs / segments / pager numbers | T6.2 |
| 3.6-06 | filter drawer hand-built beside `Sheet` | T6.3 |
| 3.6-09 | clickable cards built several ways | T6.2 (states), T6.3 |
| 3.6-10, 3.10-31 | radio cards ×3 without roving focus | T6.2 |
| 3.6-11 | hand-written `<dl>` ×2 | T6.3 |
| 3.6-17 | legacy `.pane` markup in 5 files beside `Pane` | T6.3 |
| 3.6-26 | `Sparkline` has no caller; DESIGN.md says it has one | T6.3 / T6.4 |
| 3.6-33 | period switch copied twice | T6.2 (variant), T6.3 |
| 3.7-13 | positive tracking on Arabic and Hebrew text (sidebar titles 0.03em, table head 0.02em, language 0.06em) | T6.3 |
| 3.7-14, 3.7-23 | weight 800 ×14; the Hebrew face stops at 700 (D7) | T6.3 |
| 3.7-19 | no line-height tokens (12 values) | T6.2, T6.3 |
| 3.7-20 | the selected tab turns bold and widens | T6.2 |
| 3.8-09 | shimmer left to right, and under reduced motion | T6.2 |
| 3.10-04 | field borders `--rd-field` at 70% (< 3:1) | T6.2 |
| 3.10-05 | active icons in `--rd-faint` (Select chevron, `IconButton` faint tones) | T6.2 |
| 3.10-16 | NameField «×» 24px | T6.2 |
| 3.10-20 | toast close named «×» | T6.2 |
| 3.2-08, 3.10-15 | date button 34px beside a 44px field | T6.2 |
| 3.10-11 | `<Button asChild>` links miss the 44px rule | T6.2 |
| 3.10-14 | dialog close 36px on phones | T6.2 |
| 3.10-12, 3.10-13 | 40px controls under 641px; calendar days 34–40px | T6.2 |
| 3.10-10 | sign-in `lg` buttons 40px | T6.2 |
| 3.2-10 | dialog `max-h` uses `100vh` | T6.2 |
| 3.3-34 | `AuthFrame` renders an empty lede | T6.3 |
| 3.6-27 | `.flip-ltr` is gone; direction-aware icons are `ltr:hidden` / `rtl:hidden` pairs, the sidebar flyout has two keyframes (`side-flyin`, `side-flyin-rtl`) | T6.3 |
| 3.1-25 | the role dialog's fields: whether their focus halo is still hand-built (n/c) | T6.2 |
| 3.6-31 | step heads share `features/catalog/add-steps.ts` now; the head markup is still per screen (n/c) | T6.3 |
| 3.6-16 | badge tone picked inline (n/c) | T6.3 |
| 3.7-05, 3.7-11, 3.7-12, 3.7-15, 3.7-21, 3.7-22, 3.7-06, 3.7-07, 3.7-18 | section titles, menu items, group titles, notice titles, counters, legends, labels and the task message in several sizes / weights (n/c one by one; the half-pixel and rem counts above say they persist) | T6.3 |
| 3.4-03, 3.4-04, 3.4-06, 3.4-12, 3.4-14, 3.4-18, 3.4-19, 3.4-20, 3.4-23 | spacing rhythms (filter card edges, sidebar rows, field rhythms, door picker, toast, sign-in head, skeleton row, branding preview, 1–2px gaps) (n/c) | T6.3 |
| 3.10-06, 3.10-07, 3.10-09, 3.10-23 | small crimson / success / warning / faint text and light muted on surface-3 under 4.5:1 (n/c: needs `scripts/contrast.mjs` run on each pair) | T6.2 |
| 3.10-19, 3.10-24, 3.10-25, 3.10-26, 3.10-27, 3.10-28, 3.10-32, 3.10-33 | accessible names and live regions (unread count, reused names, language name, the notices `role="menu"` panel, line-op labels, add-on switch, dt/dd, toast region) (n/c) | T6.2 |
| 3.10-17, 3.10-18, 3.10-29, 3.10-30, 3.10-21, 3.10-22 | offer picker focus, package picker state, icon deletes and shell targets under 44px, chain labels, fold handle on touch (n/c) | T6.2 |
| 3.5-27 | file chooser in three shapes | T6.2 (one file chooser), T6.3 |

### Open, outside T6 (needs its own spec and an owner choice)

These change what a screen shows, where a control sits, which button is primary, or behaviour. Several have an
owner decision already (ADR 0021, named); they are still not built.

- **Button hierarchy** (ADR 0021 D2, D13, D14 decided; code not aligned): 3.5-02 and 3.9-06 (per-row package save is
  `primary` `sm`, D14 says `secondary` `sm`: `features/catalog/screens/packages-screen.tsx:405`), 3.5-03 (matching
  save primary beside «مقارنة» and the head's primary), 3.5-04 (provider lookups are primary:
  `features/catalog/add-steps.ts` `queryButtonClass` on a default `Button`), 3.5-05 (the ticket's «إكمال» swaps
  `primary` / `secondary` with its state: `task-ticket-screen.tsx:174`, D13), 3.5-22 (the note composer's submit is
  `sm`; DESIGN.md says default size), 3.5-26 (reconciliation row actions change variant with state), 3.9-21; and,
  n/c: 3.5-06, 3.5-07, 3.5-08, 3.5-09, 3.5-10, 3.5-11, 3.5-17 (the return bar's crimson button is in DESIGN.md's D1
  list), 3.5-21 (the crimson «مسح» is written in DESIGN.md), 3.5-23, 3.5-24, 3.5-25.
- **Page templates and layout** (spec 2026-11-13 P4, superseded): 3.3-01 (in part: `Desk` takes a string lede
  only and has no not-found / blocked state), 3.3-02 … 3.3-12, 3.3-14, 3.3-16 … 3.3-21, 3.3-22 (eSIM is a `Checkbox`
  on create, a `LiveSwitch` in settings, D18), 3.3-23, 3.3-24, 3.3-27, 3.3-32 (D12 deferred by the owner), 3.6-07,
  3.6-12, 3.6-13, 3.6-14, 3.6-15, 3.6-18, 3.6-19, 3.6-20, 3.6-28, 3.6-29, 3.6-30, 3.6-34, 3.6-35.
- **Responsive** (need a width check; no browser in this run): 3.2-04, 3.2-07 (in part: the components carry their
  own touch sizes now; the gaps are in §3), 3.2-11, 3.2-12 (`repeat(auto-fill,180px)` still in
  `packages-screen.tsx:58`), 3.2-13 (D9), 3.2-14, 3.2-16 … 3.2-22, 3.2-26.
- **Direction** (behaviour of motion and text direction): 3.8-01, 3.8-02 (a block `dir="ltr"` login line:
  `features/accounts/screens/users-screen.tsx:129`), 3.8-03, 3.8-05 (`@keyframes filter-slide` moves on the
  physical axis), 3.8-06, 3.8-07, 3.8-10 … 3.8-14, 3.8-16.
- **Visual hierarchy**: 3.9-01 … 3.9-05, 3.9-07, 3.9-08, 3.9-10 (in part: take and «إكمال» are primary now; the
  variant swap is 3.5-05), 3.9-11, 3.9-12, 3.9-14 … 3.9-20, 3.9-22 … 3.9-27, 3.9-29.

## 7. Inputs for the next slices

- **T6.2** builds, from the existing anatomy: the missing states of §3 (one disabled treatment, one focus rule per
  control family and a mark on Tabs / Segmented / pager / radio cards, a busy Button, read-only and disabled fields,
  invalid on Select / NameField / DateField, pressed on Button, no-match rows, an empty Donut), a radio-card
  primitive, a Segmented toggle variant for the period switches, a `Stat` lead variant, a bottom `Sheet`, warning
  and info tones for `Alert` and `Toast`, the touch sizes of §3, and the tokens of §4 (only those). New colour: the
  `info` and `violet` pairs only, each with its contrast pair in both themes.
- **T6.3** folds §4's "already a token" list and §5 into tokens, variants and existing components.
- **T6.4** writes DESIGN.md as the one identity (every `components/ui` component with its variants and states),
  corrects its shadow table and the Sparkline line, and closes this file.
