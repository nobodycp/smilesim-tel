# Smile Sim — Pearl

This is the visual source of truth, carried from account manager's Pearl system into this Next.js office. Calm, warm, RTL-first: off-white paper, ink-black primary actions, one logo-red accent, numbers that line up. `.cursor/rules/pearl-ui.mdc` points here.

All CSS reads `--rd-*` tokens. The old blue set (`--bg`, `--accent`, `--ink-3`, ...) is gone. Do not bring it back and do not add another blue.

## Identity

- Paper and ink. Warm off-white page, white surfaces, near-black text. Dark mode is the same system on warm blacks, never pure `#000`.
- Primary action is ink, not blue and not red.
- Logo red is the accent: dots, the brand rule, and at most one special action on a screen. Errors are danger red, separate from the accent.
- Dense and quiet. Hairline borders, light shadows, compact tables.
- RTL first. Logical properties only.
- The brand is data, not a drawing. A saved site identity (`/branding`, owner only) replaces the `SimMark` in the sidebar brand block, the drawer, and the sign-in lockup with `BrandLogo`, and sets the tab title and icon. Without one, the Smile Sim mark and name stay. The logo keeps a browser-derived dark copy (`.brand-logo-light` / `.brand-logo-dark`), so black lettering still reads on dark surfaces and on ink.
- The sidebar nav may hold one collapsible group (`.nav-group`: a `.nav-group-head` button with a chevron, then indented `.nav-group-body` links). It opens without motion and holds the page that is current. The collapsed sidebar flattens it to icon links.

## Stylesheets

`apps/web/app/globals.css` is the only file `layout.tsx` imports. It `@import`s `apps/web/app/styles/*.css` in cascade order. Do not reorder the imports: several rules rely on coming later at equal specificity.

| Order | File | Holds |
|---|---|---|
| 1 | `tokens.css` | every `--rd-*` token, light and dark |
| 2 | `base.css` | reset, element defaults, default SVG `stroke-width: 2.2`, `.icon-btn`, language switch, brand mark, motion opt-in |
| 3 | `doors.css` | door picker on the bare host |
| 4 | `auth.css` | sign-in frame |
| 5 | `forms.css` | page type, fields, `.error` / `.note` |
| 6 | `shell.css` | sidebar, drawer, topbar, shell panels, search, notices, wallet chip |
| 7 | `desk/*.css` | inner pages, one file per owner, imported in this order: `frame` (canvas, desk layout and scroll model, page head, back link, `.stack`, banners, `.sr-only`), `pane` (pane, sheet, `.steps`, `.seg`, field and switch rows, `.check`), `table` (`.data`, sort header, row actions, money, account and kind cells, pager), `filters` (filter bar, table search, period chips), `components` (EmptyState, skeletons, spinner, Stat, LiveSwitch, operation cards, outage and return bars), then the pages: `numbers`, `tasks`, `users`, `packages`, `home`, `settings`, `branding`. Shared files come first, so a page file can refine them at equal specificity; a rule belongs in the file of the class its selector is about. |
| 8 | `dialog.css` | toast, `Dialog`, `.perm-grid`, `.op-blocks`, `RowMenu` |
| 9 | `controls.css` | checkbox and radio size, last so it beats every `input` height rule |
| 10 | `responsive.css` | shell and layout breakpoints, the 44px touch-target block |
| 11 | `ui.css` | the `components/ui` primitives (`.ui-btn*`, `.ui-badge*`, `.ui-select*`, `.ui-pager*`) and the direction helpers `.only-rtl`, `.only-ltr`, `.flip-ltr` |

## Tokens

Both themes are defined in `apps/web/app/styles/tokens.css`. Use the token, never the value. No hex or `rgba()` outside that file.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--rd-bg` | `#fafaf8` | `#0b0b0a` | page |
| `--rd-surface` | `#ffffff` | `#151514` | cards, inputs, menus |
| `--rd-surface-2` | `#f4f4f2` | `#1f1f1d` | headers, chips, hover rows, active nav |
| `--rd-surface-3` | `#ececea` | `#2a2a27` | skeletons, pressed or hovered icon buttons |
| `--rd-line` | `#ececea` | `#2a2a27` | hairline borders |
| `--rd-line-soft` | `#f3f3f1` | `#222220` | dividers inside a card |
| `--rd-qr-tile` | `#ffffff` | `#ffffff` | the tile behind a QR picture; stays white in dark mode so the code scans |
| `--rd-field` | `#8a8a86` | `#74746e` | input borders (3:1 against the surface) |
| `--rd-ink` | `#0a0a0a` | `#f5f5f2` | text, links, active state, focus ring |
| `--rd-ink-2` | `#3a3a38` | `#c8c8c2` | labels and nav text |
| `--rd-muted` | `#6b6b68` | `#9a9a94` | secondary text. Passes 4.5:1 on bg, surface, surface-2 and surface-3 |
| `--rd-faint` | `#a3a39e` | `#6b6b66` | decoration and locked or disabled items only. **Fails 4.5:1: never body text** |
| `--rd-accent` | `#d00000` | `#ff3b3b` | the one accent |
| `--rd-accent-soft` | `rgba(208,0,0,.10)` | `rgba(255,59,59,.15)` | accent tint |
| `--rd-on-accent` | `#ffffff` | `#0a0a0a` | text on accent |
| `--rd-on-mark` | `#ffffff` | `#ffffff` | text over a coloured company mark (an inline hue) |
| `--rd-primary-bg` | `#0a0a0a` | `#f5f5f2` | primary button fill |
| `--rd-primary-hover` | `#242422` | `#ffffff` | primary button hover |
| `--rd-primary-fg` | `#ffffff` | `#0a0a0a` | text and icons on the primary fill |
| `--rd-success` / `--rd-success-soft` | `#0a7a3e` / `#e8f6ee` | `#4ade80` / `rgba(74,222,128,.12)` | active, paid |
| `--rd-warning` / `--rd-warning-soft` | `#c2410c` / `#fff0e9` | `#fbbf24` / `rgba(251,191,36,.12)` | pending |
| `--rd-danger` / `--rd-danger-soft` | `#b91c1c` / `#fdecec` | `#f87171` / `rgba(248,113,113,.12)` | failed, destructive |
| `--rd-focus` | `rgba(10,10,10,.16)` | `rgba(245,245,242,.20)` | focus halo around a field |
| `--rd-scrim` | `rgba(10,10,10,.48)` | `rgba(0,0,0,.72)` | dialog backdrop |
| `--rd-scrim-strong` | `rgba(0,0,0,.50)` | same | drawer backdrop |
| `--rd-radius-lg` | `1.125rem` | same | cards, panes, filter bars, primary and secondary buttons |

### Scales

Theme-independent, in `:root`. They name the values the stylesheets already used (Phase 5.3b); a new rule uses a step, not a literal.

| Token | Value | Token | Value |
|---|---|---|---|
| `--rd-radius-xs` | 6px | `--rd-text-2xs` | 10px |
| `--rd-radius-sm` | 8px | `--rd-text-xs` | 11px |
| `--rd-radius-md` | 10px | `--rd-text-sm` | 12px |
| `--rd-radius-card` | 12px | `--rd-text-md` | 13px |
| `--rd-radius-panel` | 16px | `--rd-text-base` | 14px |
| `--rd-radius-pill` | 999px | `--rd-text-lg` / `-xl` / `-2xl` | 15 / 16 / 18px |

Spacing, layers and motion are tokens too (5.3d), named from the values the sheets already used:

- Spacing `--rd-space-*` on a 4px step: `0-5` 2px, `1` 4px, `1-5` 6px, `2` 8px, `2-5` 10px, `3` 12px, `3-5` 14px, `4` 16px, `5` 20px, `6` 24px. Gaps, padding and margins use them; hairlines (1px), negative pulls, larger one-off sizes and the shell's rem values stay literal.
- Layers `--rd-z-*`, low to high: `raised` 1 (sticky table head, tree dots), `topbar` 20, `popover` 30 (shell menus, wallet pop), `overlay` 40 (drawer backdrop, search results), `drawer` 50, `shell-toast` 60, `dialog` 70, `top` 80 (toasts and the row menu, which open over a dialog). The sign-in frame's local 3 and 5 stay literal.
- Motion `--rd-dur-fast` 150ms, `--rd-dur-base` 180ms, `--rd-ease-standard` (0.4, 0, 0.2, 1), `--rd-ease-out` (0.2, 0.8, 0.2, 1). One-off timings (the sign-in choreography, the bell, the spinner, the shimmer) stay where they are used.
| `--rd-shadow-card` | `0 1px 2px` ink at 4% | inset 1px hairline | cards |
| `--rd-shadow-frame` | `0 1px 2px` slate at 5% | `0 1px 2px` black at 40% | the outer frame of a data table |
| `--rd-shadow-sm` | `0 1px 2px` black at 5% | `0 1px 2px` black at 5% | page actions |
| `--rd-shadow-pop` | `0 24px 64px` ink at 16% | `0 24px 64px` black at 50% | menus, dialogs, toasts, auth card |

Where the ink fills a button, use `--rd-primary-bg`. Where ink is a text, border, or link colour, use `--rd-ink`. They hold the same value today but mean different things.

## Hotspot-store identity

List chrome that has moved (`/users`, plus the shared dialog, row menu, filter bar, empty state, and skeleton) follows hotspot-store's layout. Colours stay the Pearl tokens above. `--rd-accent` (logo red) is not part of this and stays one accent per screen.

There is no Tailwind (removed in Phase 5.4a, ADR 0003); `base.css` is the reset. Icons are `lucide-react`. New controls are `apps/web/components/ui/` (`Button`, `Select`, `Badge`, `Pagination`), styled by `ui.css` with one `ui-` class per part and a modifier class per variant or size (`ui-btn ui-btn-outline ui-btn-sm`). A component joins its classes with `[...].filter(Boolean).join(' ')`; a `className` from the caller comes last and wins only by the cascade, so give it a class from a sheet, not a one-off utility. `Button` sizes: `sm` 32px, `default` 34px (the pane control height), `lg` 40px (sign-in-sized screens: password, two-factor), `icon` 36px square, `iconSm` 28px square; corners are 8px everywhere. Every action button is `Button` (5.4b-4d): no `.btn`, `.btn-sm`, `button.primary` / `.secondary` / `.danger`, and no context rule (`form > button`, `.pane form > button`, `.field-row > button`, `.dialog button.*`) restyles a button by where it sits. A button that is a `form`'s or `.pane-body`'s own child sits at the reading start. A link that must look like a button takes `buttonClass({ variant, size })`. Controls with their own look stay plain `<button>`s with their own class: tabs (`.steps`), the segmented pick (`.seg`), period chips, tiles and cards (`.op-tile`, `.op-card`, `.pack-card`, `.company-card`, `.pack-pick`, `.task-op`), the switch, menu items, shell icons, the sort header, the toast close, and the outage and return bars. `Select` takes `compact` for the 28px pager field. A `Button` never draws the browser's default border (5.4b-4a); `variant="danger"` is the danger outline (border and text, `--rd-danger-soft` on hover), like every destructive button. Every dropdown is `Select` (5.4b-4c: no bare `<select>` in a page); its `className` lands on the wrapper, which carries the layout (width, grid place), and in a `.data` cell the wrapper is inline-block so it follows the cell's centring. A `Select` keeps 2.25rem at its inline end for the chevron in every context, including the 28px filter bar where `.desk .filter-panel select` resets the padding.

The ported classes and the primitives read `--rd-*` tokens directly (Phase 5.3a; the hotspot alias names `--bg`, `--surface*`, `--line*`, `--ink*`, `--accent*`, `--good*`, `--warn*`, `--bad*`, `--focus-ring`, `--shadow-*` are gone). The ink primary's 10% tint is `--rd-primary-soft`. A badge's inset ring is its text colour at 15% (`color-mix`), the muted badge's is `--rd-line`; until 5.4a every badge drew Tailwind's default blue ring because the `/15` colours were never generated.

Status → tone lives in one file, `apps/web/lib/status-tone.ts` (Phase 5.4b-2): line active → `success`, frozen → `warning`, disconnected → `danger`, else `muted`; task done → `success`, cancelled → `danger`, else `warning`; account frozen → `warning`, open → `success`; notice unread → `warning`, read → `muted`; on/off (for sale, enabled, grant) → `success` / `danger`; package terms stopped → `danger`, custom price → `success`, inherited → `muted`. `<Badge variant={tone} dot>` draws it; there is no plain `.badge` class any more (5.4b-4b), and a page never picks a tone inline. `info` and `violet` are typed and unused until their tokens exist. Shell chrome uses `lucide-react` (nav, wallet, bell, theme).

The filter bar is its own card, one row, controls at 28px. It does not share a border with the table. `postcss.config.js` loads Autoprefixer from this file on disk, because the dev worker cannot see packages hoisted to the repo root.

## Type

Fonts come from `next/font` in `apps/web/app/layout.tsx`. No Google stylesheet link, no new family.

- Arabic and Latin text: **Tajawal** (`--font-sans`, weights 400, 500, 700, 800).
- Hebrew: **IBM Plex Sans Hebrew** (`--font-he`, weights 400 to 700).
- Stack: `var(--font-sans), var(--font-he), Tahoma, sans-serif`. Headings use the same stack at weight 700.
- Numbers, money, dates, phone numbers: Latin digits in that same face with `font-variant-numeric: tabular-nums` (`.money`, `.num`, `.when`, `.line-number`, `td.msisdn`). There is no separate numeric family.

## Inner pages

New screens compose `.page-head`, `.filter-bar`, `.pane`, `.steps`, `.data`, `Badge` (`components/ui/badge.tsx`), `Stat` / `StatRow` (`components/stat.tsx`), `EmptyState` (`components/empty-state.tsx`), `Dialog` (`components/dialog.tsx`), and `RowMenu` (`components/row-menu.tsx`). Spacing comes from `--rd-space-*`; the common steps are 4, 8, 12 and 14. Control height inside a pane or filter is 34px. Under 720px every control on the canvas, in a dialog, in a row menu, and on the sign-in screen is at least 44px (sign-in fields and buttons are 42px and 40px above that). Tables keep text and status at the start and numeric columns at the end, with `class="num"` on both the header and the cell. Identifiers that are Latin digits stay in `<bdi dir="ltr">`. The actions column is `class="row-actions"`: it stays at the inline end, sized to its label, and does not grow with the table. Contextual row actions are only the 28px horizontal ellipsis in `RowMenu`. Its menu is 13px medium type, at least 160px wide, and opens from the trigger's inline end. Every popup next to a button (row menu, account menu, wallet pop, notices, language) opens and closes through `usePopover` (`lib/use-popover.ts`): a press outside or Escape closes it and Escape returns the focus to the button; a `role="menu"` opens on its first item and ArrowUp/ArrowDown, Home and End move between items. A new popup uses the hook, not its own listeners. Dialogs use a header, a scrolling body, and a footer; `size` is `confirm`, `form`, or `wide`. A dialog carries a hairline, sits on `--rd-scrim` with an 8px blur, and names its action with a round mark and a one-line lede. A confirm dialog centres that mark and stretches its two actions across the foot. Checkboxes stay 16px inside `label.check` and never inherit text-field height. `.empty` inside a pane or sheet already carries 14px padding, so a page never sets it inline.

## Components

One of each. A new page uses these, it does not invent a sibling.

- Page: title, one muted lede, then the content. No second heading that repeats the title.
- Card: white surface, hairline, `--rd-radius-lg` radius, `--rd-shadow-card`.
- Table: quiet header, hairline rows, text at the reading start, numbers tabular and aligned to the reading end.
- Primary button: ink fill. One per group. The single special action may be accent. Destructive is an outline in danger (border and text), not a filled red.
- Badge: label plus a dot. Active, pending, danger, neutral.
- KPI: `StatRow` wraps a row of `Stat` items. Each `Stat` takes an `icon` (`IconName` from `components/icon.tsx`), `tone` (`success`, `warning`, `danger`, or `muted`), `label`, a large tabular `value`, and optional `meta` below a hairline divider. The icon sits in `.stat-icon` with a tone tint. This is the only KPI pattern; do not use ad-hoc `.stat-card` markup.
- Filter: `FilterBar` wraps `.filter-bar`/`.filter-panel` — a card of `<label>` fields above the table, with an optional trailing clear button (`onClear`/`clearLabel`). This is the only filter pattern; do not write a bare `.filter-line` or inline filter markup on a new page.
- Facts: label/value pairs (`dt`/`dd`) in a `<dl>`. Latin identifiers inside a value stay in `<bdi dir="ltr">`. Three shapes exist today and a new page reuses one of them: `.fact-grid` of `.fact-card` (the user page head), `.detail-rows` (the number card), `.task-facts` (a task). The `.facts` grid this line once named was never used and went in 5.6.
- Empty: `EmptyState` inside `.empty` — muted icon in a small circle on `--rd-surface-2`, title (`children`), optional secondary `text`, centered (both axes) in the available `.pane`/`.sheet` space, not pinned to the start edge. Not a lone italic line.
- Feedback: one alert line for an error, one for a success, always through `Alert` (`components/alert.tsx`): `<Alert>{error}</Alert>` draws `.error` with `role="alert"`, `<Alert tone="success">` draws `.note` with `role="status"`, `banner` adds the page-top card, and an empty message draws nothing. Pages inside `Desk` get theirs from `PageAlert`, which uses `Alert`. No hand-written `<p className="error">` and no browser `alert` for success. An image whose source is a `data:` or `blob:` URL (logos, company marks, the eSIM QR) is `DataImage` (`components/data-image.tsx`); there is no bare `<img>`.
- Switch: `LiveSwitch` (`components/live-switch.tsx`) — `role="switch"` button with a `.track` and a knob; `checked` is `true`, `false`, or `'mixed'` (half knob, blended track) for a group. The label and the state word sit beside it as `children`. This is the only on/off control; do not draw a second toggle.
- Price field: `PriceField` (`components/price-field.tsx`) — a short inline shekel input (`.terms-price`, 6.5rem, tabular, LTR) that saves on blur or Enter when the text changed; empty means back to the default, Escape drops the draft. The default sits beside it as a muted `Money`.
- Terms list: `.terms-sheet` → `.terms-group` (sticky `.terms-group-head` with a group `LiveSwitch`) → `.terms-row` grid of switch · name · figures (`.terms-figure` label/value pairs) · state badge. `.off` mutes and strikes the name; `.locked` adds the `Lock` glyph and «stopped above». Under 1100px the figures move under the name.
- Operation cards: `.op-grid` of `.op-card` (hairline by `box-shadow`, `--rd-surface-2` when `.off`): a round `.op-mark` glyph, title and one-line description, an inherited-stop badge, and a `LiveSwitch` with the state word under it.
- **Line prices dialog** (`components/line-prices-dialog.tsx`): Dialog `size="form"` that groups a package's renewable numbers by the renewal price they carry and lets the operator set a new flat price per group or «follow current»; table `.data` with `num` columns, `PriceField` for the new price, secondary follow button, footer cancel/save. Mounted from the user packages tab and the package sheet.
- **Transfer dialog** (`components/transfer-dialog.tsx`): Dialog `size="form" mark="transfer"` that moves a point of sale or an agent: destination select, live preview (balances, line count, below-floor badge), radio pairs on `label.check` for own/child terms (keep / follow → `reset`) and for moved-number prices (keep / recapture), no defaults, submit disabled until every choice is made. Mounted from the users page; the number detail page asks the same line-price choice inline.

### Error and not-found screens

`app/error.tsx` and `app/not-found.tsx` draw the empty state (`.empty.empty-state`, `.load-failed` for the error) in a `.pane` inside the shell, with the way out in `.empty-actions`: one row, centered; a primary `Button` (or `buttonClass()` on the not-found `Link`) for the main way and `.back-link` for the second.

## Motion and access

- Motion is 150–450ms, transform and opacity only, and exists only on the sidebar width, the drawer slide, the notification bell, the spinner, and the skeleton shimmer. All of it sits under `@media (prefers-reduced-motion: no-preference)` in `styles/base.css`, so there is no reduced-motion override and no `!important`. Dialogs, menus, and toasts appear without motion.
- Targets at least 44px on touch widths.
- Text contrast at least 4.5:1 in both themes. `--rd-faint` is the one token below that; it is never used for body text on the canvas.
- Visible focus. Text inputs show an ink border plus the `--rd-focus` halo. Page-level buttons and links use a 2px solid `--rd-ink` outline.
- Check light and dark.

## Known gaps

- Key/value pairs have three shapes (`.fact-grid`, `.detail-rows`, `.task-facts`); one would do.

Shell gaps (Pearl rebuild phase 1 landed the header, sidebar, and drawer; two items remain — focus rings and `.nav-link.locked` contrast were closed in Phase 5.3c: every keyboard-reachable control draws a 2px solid `--rd-ink` outline, the avatar with a 3px gap, and locked links use `--rd-muted`):

- `.sidebar` animates `width` (180ms), which is not transform or opacity.
- At widths near 390px, the topbar's control row (search toggle, wallet chip, bell, theme, language, avatar) can approach the viewport width; not yet stress-tested below 390px.


Outside the shell, left as is to keep the screens identical:

- `.auth-card`, `.door-card`, `.dialog`, `.toast`, `.notice-pop`, `.hero`, `.company-card`, and `.pack-card` use a 16px radius, and `.command-list` and `.menu` use 12px, instead of `--rd-radius-lg`.
- The company mark text is white over an inline `hsl(... 42% 42%)` set in `features/catalog/screens/packages-screen.tsx` and `companies-screen.tsx`; some hues sit under 4.5:1.
