# Smile Sim — Pearl

This is the visual source of truth, carried from account manager's Pearl system into this Next.js office. Calm, warm, RTL-first: off-white paper, ink-black primary actions, one logo-red accent, numbers that line up. `.cursor/rules/pearl-ui.mdc` points here.

All CSS reads `--rd-*` tokens. The old blue set (`--bg`, `--accent`, `--ink-3`, ...) is gone. Do not bring it back and do not add another blue.

## Identity

- Paper and ink. Warm off-white page, white surfaces, near-black text. Dark mode is the same system on warm blacks, never pure `#000`.
- Primary action is ink, not blue and not red.
- Logo red is the accent: dots, the brand rule, and at most one special action on a screen. Errors are danger red, separate from the accent.
- Dense and quiet. Hairline borders, light shadows, compact tables.
- RTL first. Logical properties only.

## Stylesheets

`apps/web/app/globals.css` is the only file `layout.tsx` imports. It `@import`s `apps/web/app/styles/*.css` in cascade order. Do not reorder the imports: several rules rely on coming later at equal specificity.

| Order | File | Holds |
|---|---|---|
| 1 | `tokens.css` | every `--rd-*` token, light and dark |
| 2 | `base.css` | reset, element defaults, default SVG `stroke-width: 2.2`, `.icon-btn`, language switch, brand mark, motion opt-in |
| 3 | `doors.css` | door picker on the bare host |
| 4 | `auth.css` | sign-in frame |
| 5 | `forms.css` | page type, fields, buttons, `.error` / `.note` |
| 6 | `shell.css` | sidebar, drawer, topbar, shell panels, search, notices, wallet chip |
| 7 | `desk.css` | canvas, `.page-head`, `.filter-bar`, `.pane`, `.steps`, `.data`, `.badge`, `.empty`, `.stat`, skeletons, page compositions |
| 8 | `dialog.css` | toast, `Dialog`, `.perm-grid`, `.op-blocks`, `RowMenu` |
| 9 | `controls.css` | checkbox and radio size, last so it beats every `input` height rule |
| 10 | `responsive.css` | shell and layout breakpoints, the 44px touch-target block |

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
| `--rd-scrim` | `rgba(10,10,10,.32)` | same | dialog backdrop |
| `--rd-scrim-strong` | `rgba(0,0,0,.50)` | same | drawer backdrop |
| `--rd-radius-lg` | `1.125rem` | same | cards, panes, filter bars, primary and secondary buttons |
| `--rd-shadow-card` | `0 1px 2px` ink at 4% | inset 1px hairline | cards |
| `--rd-shadow-pop` | `0 24px 64px` ink at 16% | `0 24px 64px` black at 50% | menus, dialogs, toasts, auth card |

Where the ink fills a button, use `--rd-primary-bg`. Where ink is a text, border, or link colour, use `--rd-ink`. They hold the same value today but mean different things.

## Hotspot-store identity

List chrome that has moved (`/users`, plus the shared dialog, row menu, filter bar, empty state, and skeleton) follows hotspot-store's layout. Colours stay the Pearl tokens above. `--rd-accent` (logo red) is not part of this and stays one accent per screen.

Tailwind is on, with `darkMode: "class"` and `preflight` off, so `base.css` remains the reset. Icons are `lucide-react`. `cn` lives in `apps/web/lib/utils.ts`. New controls are `apps/web/components/ui/` (`Button`, `Select`, `Card`, `Badge`, `Table`, `Pagination`).

Alias tokens in both `:root` and `.dark` let the ported classes read hotspot names:

| Alias | Resolves to |
|---|---|
| `--bg` | `--rd-bg` |
| `--surface`, `--surface-2`, `--surface-3` | `--rd-surface`, `--rd-surface-2`, `--rd-surface-3` |
| `--line`, `--line-soft` | `--rd-line`, `--rd-line-soft` |
| `--ink`, `--ink-2` | `--rd-ink`, `--rd-ink-2` |
| `--ink-3`, `--ink-4` | `--rd-muted`, `--rd-faint` |
| `--accent`, `--accent-2`, `--accent-fg` | `--rd-primary-bg`, `--rd-primary-hover`, `--rd-primary-fg` |
| `--accent-soft` | `color-mix(in srgb, var(--rd-primary-bg) 10%, transparent)` |
| `--good`, `--good-bg` | `--rd-success`, `--rd-success-soft` |
| `--warn`, `--warn-bg` | `--rd-warning`, `--rd-warning-soft` |
| `--bad`, `--bad-bg` | `--rd-danger`, `--rd-danger-soft` |
| `--focus-ring` | `--rd-focus` |
| `--shadow-card`, `--shadow-pop` | `--rd-shadow-card`, `--rd-shadow-pop` |

`--accent` is the ink primary, not the logo red. Ported corners use `0.5rem` and `0.625rem`. `--rd-radius-lg` stays for controls that have not moved yet.

`Badge` on an account: frozen is `warning`, open is `success`. That is the status mapping for later pages. `info` and `violet` are typed and unused until their tokens exist.

The filter bar is its own card, one row, controls at 28px. It does not share a border with the table. PostCSS loads Tailwind and Autoprefixer from this file on disk, because the dev worker cannot see packages hoisted to the repo root.

## Type

Fonts come from `next/font` in `apps/web/app/layout.tsx`. No Google stylesheet link, no new family.

- Arabic and Latin text: **Tajawal** (`--font-sans`, weights 400, 500, 700, 800).
- Hebrew: **IBM Plex Sans Hebrew** (`--font-he`, weights 400 to 700).
- Stack: `var(--font-sans), var(--font-he), Tahoma, sans-serif`. Headings use the same stack at weight 700.
- Numbers, money, dates, phone numbers: Latin digits in that same face with `font-variant-numeric: tabular-nums` (`.money`, `.num`, `.when`, `.line-number`, `td.msisdn`). There is no separate numeric family.

## Inner pages

New screens compose `.page-head`, `.filter-bar`, `.pane`, `.steps`, `.data`, `.badge`, `Stat` / `StatRow` (`components/stat.tsx`), `EmptyState` (`components/empty-state.tsx`), `Dialog` (`components/dialog.tsx`), and `RowMenu` (`components/row-menu.tsx`). Spacing steps are 4, 8, 12, and 14. Control height inside a pane or filter is 34px. Under 720px every control on the canvas, in a dialog, in a row menu, and on the sign-in screen is at least 44px (sign-in fields and buttons are 42px and 40px above that). Tables keep text and status at the start and numeric columns at the end, with `class="num"` on both the header and the cell. Identifiers that are Latin digits stay in `<bdi dir="ltr">`. The operations column is `class="row-actions"`. Contextual row actions are only the horizontal ellipsis in `RowMenu`. Dialogs use a header, a scrolling body, and a footer; `size` is `confirm`, `form`, or `wide`. Checkboxes stay 16px inside `label.check` and never inherit text-field height. `.empty` inside a pane or sheet already carries 14px padding, so a page never sets it inline.

## Components

One of each. A new page uses these, it does not invent a sibling.

- Page: title, one muted lede, then the content. No second heading that repeats the title.
- Card: white surface, hairline, `--rd-radius-lg` radius, `--rd-shadow-card`.
- Table: quiet header, hairline rows, text at the reading start, numbers tabular and aligned to the reading end.
- Primary button: ink fill. One per group. The single special action may be accent. Destructive is an outline in danger (border and text), not a filled red.
- Badge: label plus a dot. Active, pending, danger, neutral.
- KPI: `StatRow` wraps a row of `Stat` items. Each `Stat` takes an `icon` (`IconName` from `components/icon.tsx`), `tone` (`success`, `warning`, `danger`, or `muted`), `label`, a large tabular `value`, and optional `meta` below a hairline divider. The icon sits in `.stat-icon` with a tone tint. This is the only KPI pattern; do not use ad-hoc `.stat-card` markup.
- Filter: `FilterBar` wraps `.filter-bar`/`.filter-panel` — a card of `<label>` fields above the table, with an optional trailing clear button (`onClear`/`clearLabel`). This is the only filter pattern; do not write a bare `.filter-line` or inline filter markup on a new page.
- Facts: `.facts` — a `<dl>` grid of label/value pairs (`dt`/`dd`). Columns auto-fit to the available width and collapse to one without a breakpoint. Latin identifiers inside a value stay in `<bdi dir="ltr">`. This is the only key/value detail pattern; do not write a parallel grid (for example `.account-facts`) for the same purpose.
- Empty: `EmptyState` inside `.empty` — muted icon in a small circle on `--rd-surface-2`, title (`children`), optional secondary `text`. Not a lone italic line.
- Feedback: one alert line for an error, one for a success. No browser `alert` for success.

## Motion and access

- Motion is 150–450ms, transform and opacity only, and exists only on the sidebar width, the drawer slide, the notification bell, the spinner, and the skeleton shimmer. All of it sits under `@media (prefers-reduced-motion: no-preference)` in `styles/base.css`, so there is no reduced-motion override and no `!important`. Dialogs, menus, and toasts appear without motion.
- Targets at least 44px on touch widths.
- Text contrast at least 4.5:1 in both themes. `--rd-faint` is the one token below that; it is never used for body text on the canvas.
- Visible focus. Text inputs show an ink border plus the `--rd-focus` halo. Page-level buttons and links use a 2px solid `--rd-ink` outline.
- Check light and dark.

## Known gaps

Shell gaps (Pearl rebuild phase 1 landed the header, sidebar, and drawer; four items remain):

- `.sidebar` animates `width` (180ms), which is not transform or opacity.
- At widths near 390px, the topbar's control row (search toggle, wallet chip, bell, theme, language, avatar) can approach the viewport width; not yet stress-tested below 390px.
- `.nav-link.locked` still uses `--rd-faint` for text (about 2.5:1 light, 3.4:1 dark); phase 1 fixed `.nav-label`'s contrast but not this selector.
- Focus rings on shell controls are faint two ways: `.shell-icon`, `.avatar-btn`, `.wallet-btn`, and `.shell-search-toggle` are not in the shared `:focus-visible` rule in `base.css` at all, and the controls that are (`.icon-btn`, `.lang button`, `.nav-link`, `.user-btn`, `.menu a`/`.menu button`) still get the 16–20% `--rd-focus` halo there, not the solid `--rd-ink` outline `.btn` and the dialog header icons use.

Outside the shell, left as is to keep the screens identical:

- `.auth-card`, `.door-card`, `.dialog`, `.toast`, `.notice-pop`, `.hero`, `.company-card`, and `.pack-card` use a 16px radius, and `.command-list` and `.menu` use 12px, instead of `--rd-radius-lg`.
- The company mark text is white over an inline `hsl(... 42% 42%)` set in `app/packages/page.tsx`; some hues sit under 4.5:1.
