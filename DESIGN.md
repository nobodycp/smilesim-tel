# Smile Sim — Graphite, the one identity

**Graphite is the system's one visual identity (owner, 2026-11-15).** There is no second look and no new identity:
the separate identity session and `docs/design/identity-2026-11-15/` were cancelled and are not used. Work on the UI
ports this look faithfully, folds a random one-off into the system, and fills a gap in the same style (Tailwind
migration T6, ADR 0022, spec `docs/superpowers/specs/2026-11-15-tailwind-radix-migration.md`); it never redesigns. A change that
would alter the look needs its own spec and the owner's choice (`.cursor/rules/work-plan.mdc`).

This file is the visual source of truth. `.cursor/rules/smilesim-ui.mdc` points here. Origin: spec
`docs/superpowers/specs/2026-11-09-graphite-identity.md`, direction 08 "Night Desk · Graphite" in `design/`; decisions
ADR 0021 (D1–D28) and ADR 0022 (Tailwind v4 and owned Radix components). The operations desk after hours: neutral
graphite surfaces, one crimson thread, sharp tag-cut corners, dense rows, Latin digits.

The gap inventory that completed it (Tailwind migration T6.1; removed 2026-11-17, in git history) is closed; what
is still open is under [Known gaps](#known-gaps).

Last verified: 2026-11-17 (clean-up CL.6: the plan pointers checked). The history of each change is in git.
`app/tailwind.css`).

Contents: [Foundations](#foundations) (identity, stylesheet, tokens, scales, breakpoints, shadows, type, motion and
access) · [Controls and primitives](#controls-and-primitives) (every `components/ui` component with its variants and
states, and the [Component API](#component-api) they share) · [Components](#components) (the shared ones in
`components/`) · [Page templates](#page-templates) · [Screens](#screens) · [Known gaps](#known-gaps).

## Foundations

### Identity

- **Dark is the default** (a browser with no saved choice); light is the same system on cool paper. The theme toggle and
  its cookie work as before.
- Graphite surfaces, never pure `#000`. Lines are white or ink at 5–8% alpha.
- Primary action is crimson, in both themes, and there is one per view (precedence and named exceptions under
  [Primary button](#primary-button); ADR 0021 D2). Ink fills are not actions. Beyond the primary button the crimson
  accent (`--rd-accent`) is the thread: the current nav item's bar and icon, the lead figure tile, the trend lines,
  focus rings. Errors are `--rd-danger`, separate from the accent; logo red is never an error.
- White on crimson: every crimson fill that carries content — the primary and accent buttons, the sign-in «دخول»,
  the sidebar count, the brand tile and the sign-in mark, the side account avatar, the user page and settings marks,
  the offer action, the branding preview button, the return bar's button, the date picker's chosen day and a checked
  box or radio — is `--rd-accent-fill` (hover `--rd-accent-fill-hover`, darker) under `--rd-on-accent`; text ≥4.5:1
  and a glyph-only mark ≥3:1 in both themes, checked by `apps/web/scripts/contrast.mjs` (ADR 0021 D1, slice P0.9).
  The sign-in art's tag is a fill too: its heading and line are drawn over it, so the tag is `--rd-accent-fill` (at
  0.88 over the dark room) and both are in `--rd-login-ink`, ≥4.5:1 on the tag in both themes. The chosen day that is
  also today keeps its ring in the fill colour (no lighter ring inside the fill). The notice dot carries no text and
  stays on `--rd-accent`.
- The tag's **cut corner** (`--rd-cut`, 12px, clip-path on the inline-end top corner) marks figure tiles, the
  company marks, the operation cards and the brand tile.
- Dense and quiet. Hairlines, almost no shadow on dark, compact zebra tables.
- RTL first. Logical properties only.
- Status is a badge with a label (paid / pending / danger / neutral), never colour alone.
- The brand is data, not a drawing. A saved site identity (`/branding`, owner only) replaces the brand tile in the
  sidebar, the drawer, and the sign-in lockup with `BrandLogo`, and sets the tab title and icon. Without one, the
  crimson tile with the signal glyph and the name stay. The logo keeps a browser-derived dark copy
  (`components/brand-logo.tsx`: the two copies swap by `dark:` utilities, the other way round on an ink panel).
- Copy: every Arabic string uses Latin digits (no ٠–٩).
- Money: the shekel sign small and quiet after the figure (`Money`'s `<small>` ₪ at 0.8em, `components/desk.tsx`);
  the text still reads «12.50 ₪».

### Stylesheet

`apps/web/app/tailwind.css` is the only stylesheet and the only style source (ADR 0022, Tailwind migration T5.2);
`app/layout.tsx` imports it. In order it holds: the cascade layers (`theme`, `base`, `components`, `utilities`; a
utility always wins over a base rule), Tailwind's theme and utilities (no preflight: the element defaults below are
the reset), the `@source` folders (`app`, `components`, `features`, `lib`), the `@theme inline` block that gives every
`--rd-*` token its Tailwind name (`text-ink-2`, `bg-surface`, `rounded-card`, `text-sm`, `gap-3`, `shadow-pop`,
`z-dialog`, the `sm:` … `xl:` width scale; Tailwind's own palette, radii, type, shadows, easings, fonts and
breakpoints are cleared), the `dark:` variant on the `.dark` class of `<html>`, the tokens of both themes (`:root` and
`.dark` in `@layer base`; `.dark` holds only the values that differ), the global rules still in use (`@layer base`:
element defaults, fields, the checkbox and radio, and the rules that style content through a component's `data-slot`
handle or the few legacy classes the markup still writes) and the keyframes the utilities name.

Every other style is a Tailwind utility in the markup or a `cva` variant in `apps/web/components/ui/*`, joined with
`cn()` (`apps/web/lib/cn.ts`, `tailwind-merge` taught the token names). There is no other `.css` file and no
stylesheet ownership table: `npm run check:styles` (`apps/web/scripts/check-styles.mjs`) fails on any `.css`, `.scss`,
`.sass` or `.less` file under `apps/web` but `app/tailwind.css`, and on physical-direction utilities, arbitrary colour
values and literal inline colours in the markup. A new colour, radius, size, layer or timing is a token in
`tailwind.css` (both themes when it differs), mapped in its `@theme` block, and listed below; a look two screens need
is a component variant, not a new rule. The legacy sheets (`app/styles/*.css`, `app/globals.css`) and their guard
(`scripts/check-css.mjs`) are deleted since Tailwind migration T5.1. `apps/web/postcss.config.js` loads
`@tailwindcss/postcss` and then Autoprefixer from that file on disk (the dev worker cannot see packages hoisted to the
repo root), so the `@layer base` rules keep their prefixes.

### Colour tokens

Both themes are defined in `apps/web/app/tailwind.css` (`:root` and `.dark` in `@layer base`); its `@theme inline` block gives each token its Tailwind name (`--rd-ink-2` → `text-ink-2`, `--rd-surface` → `bg-surface`). Use the token, never the value. No hex or `rgba()` outside those two blocks; in the markup no arbitrary colour (`bg-[#…]`) and no literal colour in `style={{}}` (`npm run check:styles`). Do not add another accent colour or another blue.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--rd-bg` | `#f5f5f4` | `#111213` | page |
| `--rd-surface` | `#ffffff` | `#18191b` | cards, inputs, menus |
| `--rd-surface-2` | `#efefee` | `#1f2023` | headers, chips, hover rows, active nav |
| `--rd-surface-3` | `#e6e6e4` | `#27282b` | skeletons, pressed or hovered icon buttons |
| `--rd-surface-hover` | ink at 8% into the surface | the same | a line under the pointer in a topbar panel (the notices) and in the search results; one `:root` definition (`color-mix(in srgb, var(--rd-ink) 8%, var(--rd-surface))`) that follows the theme; `bg-surface-hover` (Tailwind migration T3.1) |
| `--rd-sunken` | `#ebebea` | `#0c0d0e` | fields and search boxes, a step below the surface |
| `--rd-line` | ink at 8% | white at 7% | hairline borders |
| `--rd-line-soft` | ink at 5% | white at 4.5% | dividers inside a card |
| `--rd-line-strong` | ink at 11% | ink at 11% | a stronger hairline; one `:root` definition (`color-mix(in srgb, var(--rd-ink) 11%, transparent)`) that follows the theme's ink: the edge of tabs, segments, dialogs, the `Select` list, the secondary button, the table head's rule, fact tiles, the filter chips (`border-line-strong`, `inset-ring-line-strong`; Tailwind migration T6.3 folded the `ink/11` literals and the chips' two `color-mix` base rules onto it) |
| `--rd-panel-line` | ink at 14% into `--rd-line` | the same | the border of a topbar panel (the notices) and of the live notice card; one `:root` definition (`color-mix(in srgb, var(--rd-ink) 14%, var(--rd-line))`); `border-panel-line` (Tailwind migration T3.1) |
| `--rd-qr-tile` | `#ffffff` | `#ffffff` | the tile behind a QR picture; stays white in dark mode so the code scans |
| `--rd-field` | `#8a8a8a` | `#6e6e72` | input borders (3:1 against the surface); the empty checkbox's and radio's border (`border-field`, Tailwind migration T6.2: ink at 32% was under 3:1, audit 3.10-08) |
| `--rd-field-line` | `--rd-field` at 70% | the same | the border every text field, text area and select draws (`border-field-line`; Graphite's fields, named in Tailwind migration T6.2 at today's value). Under 3:1 on the sunken fill (audit 3.10-04, open: a stronger edge changes every field and is the owner's call) |
| `--rd-ink` | `#161616` | `#ececec` | text, links, active state, focus ring |
| `--rd-ink-2` | `#474747` | `#b9b9b9` | labels and nav text |
| `--rd-muted` | `#6a6a6a` | `#8e8e91` | secondary text. Passes 4.5:1 on bg, surface, surface-2 and surface-3 |
| `--rd-faint` | `#a8a8a8` | `#545457` | decoration and locked or disabled items only. **Fails 4.5:1: never body text, never an icon that acts** |
| `--rd-accent` | `#d93049` | `#ff4d63` | the one accent |
| `--rd-accent-soft` | accent at 9% | accent at 12% | accent tint |
| `--rd-accent-fill` | `#d93049` (the accent) | `#d93049` | a crimson fill that carries content (buttons, marks, counts, the chosen day, a checked box); darker than the dark thread so white passes 4.70:1 in both themes (ADR 0021 D1) |
| `--rd-accent-fill-hover` | fill 88% toward `#000` | fill 88% toward `#000` | the fill's hover: always darker, never toward ink (`#bf2a40`, 5.80:1 under white) |
| `--rd-on-accent` | `#ffffff` | `#ffffff` | text and marks on `--rd-accent-fill` |
| `--rd-on-mark` | `#ffffff` | `#ffffff` | text over a coloured company mark (an inline hue); the switch knob |
| `--rd-primary-bg` | `#161616` | `#ececec` | ink fill: the offer timer's fill, the branding preview's mark and tab icon, the default badge's text; not a button colour — every primary is crimson (ADR 0021 D2). The sidebar and drawer tile does not read it: it is crimson (`bg-accent-fill` in `components/app-shell.tsx`, Tailwind migration T3.1). Its name still says "primary" (audit 3.1-14, open: the rename of the `primary-*` family is not done) |
| `--rd-primary-fg` | `#ffffff` | `#111213` | text on an ink fill: the branding preview's mark (the name's first letter on its `--rd-primary-bg` tile, `text-primary-fg` in `components/branding-preview.tsx`). Also the text colour of the sidebar and drawer tile (`text-primary-fg` in `components/app-shell.tsx`, Tailwind migration T3.1), which does not render it: the tile has no text and strokes its icon with `--rd-on-accent` |
| `--rd-primary-soft` | ink fill at 10% | the same | the default badge's fill; one `:root` definition (`color-mix` of `--rd-primary-bg`) |
| `--rd-success` / `--rd-success-soft` | `#0f8a59` / 10% | `#3ddc97` / 12% | active, paid, profit |
| `--rd-warning` / `--rd-warning-soft` | `#a9670a` / 12% (the tint is `color-mix` of `--rd-warning`, UI maintenance P1.2) | `#ffb547` / 12% | pending |
| `--rd-danger` / `--rd-danger-soft` | `#c8291b` / 9% | `#ff6b5b` / 12% | failed, destructive |
| `--rd-info` / `--rd-info-soft` | `#1a5da3` / 10% | `#6cb4ff` / 12% | waiting on someone else (a provider operation's waiting phase); `Badge` `info`, the `info` toast edge. Text ≥4.5:1 on its soft fill over the page, surface, surface-2 and surface-3 in both themes (5.0:1 at the least, light on surface-2 … 4.66 on surface-3). Tailwind migration T6.2 |
| `--rd-violet` / `--rd-violet-soft` | `#5f45b8` / 10% | `#b3a4ff` / 12% | a success that could not be settled (a provider operation's phase); `Badge` `violet`. Text ≥4.5:1 on its soft fill as `info` (4.83:1 at the least). Tailwind migration T6.2 |
| `--rd-layer-branch` / `-main` / `-agent` / `-pos` | `#c22a45` / `#a8306f` / `#8b3aa0` / `#5c46b8` | `#ff7c8e` / `#e36aa8` / `#c47ad8` / `#9a86f0` | each layer's own hue: the layer tag (`features/accounts/layer-tag.tsx`), the users card's tiles (`features/desk/overview.tsx`), the ledger's layer marks; `text-layer-*`, `bg-layer-*` |
| `--rd-chart-frozen` | `#6d5bd0` | `#a89bff` | chart slice for frozen numbers (the home donut); never text |
| `--rd-chart-suspended` | `#8a6d3b` | `#d6b37a` | chart slice for suspended numbers (the home donut); never text |
| `--rd-focus` | accent at 18% | accent at 22% | focus halo around a field |
| `--rd-scrim` | ink at 48% | black at 70% | dialog backdrop |
| `--rd-scrim-strong` | `rgba(0,0,0,.50)` | same | drawer backdrop |
| `--rd-login-room` / `--rd-login-ink` | `#111213` / `#f5f5f2` | same | the sign-in art's dark room and its text (`components/auth-art.tsx`). The other 17 `--rd-login-*` tokens had no reader and are gone (Tailwind migration T6.3, audit 3.1-19) |
| `--rd-cut` | `12px` | same | the tag's cut corner on figure tiles |
| `--rd-glow` | accent at 10% | accent at 14% | the soft light under the pointer on a hovered figure or shortcut tile |

Where ink fills a surface (never an action: ink fills are not actions, ADR 0021 D2), use `--rd-primary-bg`. Where ink is a text, border, or link colour, use `--rd-ink`. They hold the same value today but mean different things. The old alias names (`--bg`, `--surface*`, `--line*`,
`--ink*`, `--accent*`, `--good*`, `--warn*`, `--bad*`, `--focus-ring`, `--shadow-*`) are gone (Phase 5.3a); read the
`--rd-*` tokens directly.

### Scales

Theme-independent, in `:root`. They name the values the legacy stylesheets used (Phase 5.3b); a new rule uses a step, not a literal.

| Token | Value | Token | Value |
|---|---|---|---|
| `--rd-radius-4xs` | 1px | `--rd-text-2xs` | 10px |
| `--rd-radius-3xs` | 2px | `--rd-text-xs` | 11px |
| `--rd-radius-2xs` | 3px | `--rd-text-sm` | 12px |
| `--rd-radius-xs` | 4px | `--rd-text-md` | 13px |
| `--rd-radius-sm` | 6px | `--rd-text-base` | 14px |
| `--rd-radius-card` | 8px | `--rd-text-lg` / `-xl` / `-2xl` | 15 / 16 / 18px |
| `--rd-radius-panel` | 10px | | |
| `--rd-radius-pill` | 999px | | |

One name per radius (Tailwind migration T6.3, audit 3.1-16): `--rd-radius-md` (6px, the same as `sm`) and `--rd-radius-lg` / `--rd-radius-tile` (8px, the same as `card`) are gone; `rounded-md` became `rounded-sm` and `rounded-lg` / `rounded-tile` became `rounded-card`. The hairline corners below 3px (`rounded-4xs` 1px: a badge's diamond, a meter's ticks and bars, the unread mark; `rounded-3xs` 2px: the switch knob, the sidebar's open mark, the ticket's dots) were the literals `rounded-[1px]` / `rounded-[2px]` (audit 3.1-17). A round mark is `rounded-pill` (it was `rounded-[50%]` on square boxes).

Which radius where (as the code draws it, checked in Tailwind migration T6.4): controls, panes (`Pane`, `.pane`), the filter bar, `Stat` cards, dialogs, tabs, segments, toasts and popovers take `--rd-radius-sm` (6px, Graphite's squarer look); a pane that holds a table (the data-table frame, with `--rd-shadow-frame`), the home and wallet figure tiles, menus and panels that hang from the topbar (the row menu, the language menu, the notices), the skeleton tiles and the marks take `--rd-radius-card` (8px); a surface that stands alone on the page or floats over it (the door picker's cards, `rounded-panel` in `components/doors.tsx` since Tailwind migration T3.1; the bottom `Sheet`'s top corners) takes `--rd-radius-panel`; small inner bits `2xs`/`xs`, hairline marks `3xs`/`4xs`, round marks `pill`. There is no `border-radius` literal left in `app/tailwind.css` but `0` and `50%`.

Off-scale and display sizes, named at today's value (ADR 0021 D6 a; Tailwind migration T6.2), mapped as `text-<name>`:
`--rd-text-caption` 11.5px (a table head, a card value's name, the badge pill, small hints), `--rd-text-chip` 12.5px
(a filter chip's value, a period or page button, the badge mark), `--rd-text-block` 13.5px (a settings
block's title, a fact's value, a sidebar item), `--rd-text-item` 14.5px (an operation or mode card's name, a drawer
item); display steps `--rd-text-3xl` 20px, `-4xl` 22px, `-5xl` 24px, `-6xl` 26px, `-7xl` 28px (the door picker's title), `-8xl` 30px (the sign-in art's headline; both Tailwind migration T6.3); `--rd-text-page` 1.25rem (the page
title of `Desk` and the home); the figure values `--rd-text-figure` 1.45rem (`-figure-sm` 1.2rem on a phone) and a lead
tile's `--rd-text-figure-lead` 1.9rem (`-figure-lead-sm` 1.6rem). Line heights besides Tailwind's `leading-none` /
`-tight` / `-normal` (1, 1.25, 1.5): `--rd-leading-1-1` … `--rd-leading-1-6` (1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4,
1.45, 1.5, 1.55, 1.6; `leading-1-3` = 1.3; 1.25 and 1.5 since T6.3, the body's and the `h1` rule's line heights read
them too). Letter spacing: `--rd-tracking-title` -0.015em, `-figure` -0.01em, `-head` 0.02em,
`-number` 0.03em, `-code` 0.06em, `-caps` 0.12em (`tracking-head`). Since Tailwind migration T6.3 the screens write
the names, not the literals: the half-pixel and display sizes, the line heights and the letter spacing. The shell's rem
sizes took the nearest named size (each within 0.4px: 0.9rem and 0.92rem → `item`, 0.85rem → `block`, 0.8rem → `md`,
0.78rem → `chip`, 0.72rem → `caption`, 0.7rem → `xs`, 0.95rem → `lg`, 1.15rem → `2xl`, 1.5rem → `5xl`). Weight 800 is
gone (ADR 0021 D7 a: `font-extrabold` → `font-bold`, the Hebrew face stops at 700). Kept as written, relative to their
parent: `text-[0.92em]` (an account's full name), `text-[0.8em]` (the ₪ after a figure), the donut's two sizes derived
from `--rd-text-2xl`, and `text-[0px]` (the unread dot hides its count).

Spacing, layers and the other scales are tokens too (5.3d), named from the values the legacy sheets used:

- Spacing `--rd-space-*` on a 4px step: `0-5` 2px, `1` 4px, `1-5` 6px, `2` 8px, `2-5` 10px, `3` 12px, `3-5` 14px, `4` 16px, `5` 20px. Gaps, padding and margins use them (the utilities are multiples of `--spacing` = `--rd-space-1`, so quarter steps such as `size-1.75` are the named 7px of ADR 0021 D6 a). The frame's off-step values are named at today's value (D6 a; Tailwind migration T6.3): `--rd-space-pane` 18px (a pane's inline padding and foot, the lede's foot, a pane's tabs' sides), `--rd-space-gutter` 28px (the canvas's inline gutter), `--rd-space-canvas-top` 22px and `--rd-space-canvas-end` 56px (the canvas from 768px), `--rd-space-canvas-end-sm` 48px (its foot under 768px). The shell's rem paddings became the nearest whole pixel on the `--spacing` step (each within 0.4px: `py-[0.55rem]` → `py-2.25`, `0.6rem` → `2.5`, `0.7rem` → `2.75`, `0.85rem` → `3.5`, `0.45rem` → `1.75`, `0.8rem` → `3.25`, `0.35rem` and `0.4rem` → `1.5`, `0.12rem` and `0.15rem` → `0.5`), as did the ticket's timeline (`top-3.75`, `mt-1.5`, `size-1.75`). Hairlines (1px) and negative pulls stay literal. The common steps inside a page are 4, 8, 12 and 14.
- Layers `--rd-z-*`, low to high: `raised` 1 (sticky table head, tree dots), `topbar` 20, `sidebar` 21 (the topbar + 1: the wide screen's sidebar, one step over the topbar), `popover` 30 (shell menus), `overlay` 40 (drawer backdrop, search results), `drawer` 50, `shell-toast` 60, `dialog` 70, `dialog-drawer` 71 (a side or bottom `Sheet` over a dialog, the filter drawer), `dialog-list` 72 (the `Select` list and the name picker's list), `dialog-popover` 73 (the date field's month), `top` 80 (toasts and the row menu, which open over a dialog). The steps over the dialog are named since Tailwind migration T6.2 (they were `calc()` literals). The sign-in frame's local 3 and 5 stay literal.
- Disabled: `--rd-opacity-disabled` 0.45 (`opacity-disabled`) — the one strength every control takes when it cannot be used (Tailwind migration T6.2; it was 40% on tabs, 45% on choices and switches, 50% on buttons, 60% on selects, none on fields).
- Layout values more than one screen uses (Tailwind migration T6.3), each a token mapped in `@theme`: `grid-cols-title-end` (`--rd-cols-title-end`, `minmax(0, 1fr) auto`: a title that shrinks beside an end slot — the shell, the offer hero, `Stat`, the account, the package sheet, the home head, the ticket); `grid-cols-fit-card` (`--rd-cols-fit-card`: cards at least 16rem wide, as many as fit — `Facts` tiles, the ticket's facts); `top-pop` (`--rd-pop-gap` 6px under its trigger: the language menu, the search results, the notices panel — the notices were 0.6rem, audit 3.4-05); `w-drawer` (`--rd-drawer-width`, min(380px, 92vw): the end `Sheet` and the filter drawer). `grid-cols-[1fr]` / `[1fr_1fr]` / `[minmax(0,1fr)]` are `grid-cols-1` / `grid-cols-2`; a field in a wrapping row is `grow basis-64` (it was `flex-[1_1_16rem]`); one-off max widths are `--spacing` multiples (`max-w-88` 22rem, `max-w-112` 28rem, `max-w-128` 32rem, `max-w-144` 36rem, `max-w-180` 720px, `max-w-70` 280px). A screen's own grid template stays its layout.

### Breakpoints

The width scale (`--breakpoint-*` in `@theme`; Tailwind's own are cleared): `sm` 641px, `touch` 721px, `md` 768px,
`auth` 861px, `lg` 900px, `xl` 1100px. `max-touch:` is 720px and under, where every control is at least 44px (the
touch rule; it was the literal `max-[721px]:`, every screen writes the name since Tailwind migration T6.3). `max-auth:`
is under 861px, where the sign-in frame and its art stack (`auth-frame.tsx`, `auth-art.tsx`; T6.3). Literals one pixel
off the scale took the scale's step (T6.3): `max-[640px]:` → `max-sm:`, `min-[640px]:` → `sm:`, `max-[901px]:` →
`max-lg:`, `max-[1101px]:` → `max-xl:`. A one-screen layout keeps its own literal width (a named layout value, not a
token): the offer hero's 761px, the facts' 421px, the branding preview's 961px, the door picker's 561px, the two-step
cards' 521px, the settings page's 960px, the search's 1200px, and the container queries (`@max-[721px]/topbar`, the
ticket's `@max-[449px]`, `@max-[577px]`).

### Shadows

| Token | Light | Dark | Use |
|---|---|---|---|
| `--rd-shadow-card` | `0 1px 0` black at 3% | `0 1px 0` white at 3%, inset | cards |
| `--rd-shadow-frame` | `0 1px 0` black at 3% | `0 1px 0` white at 3%, inset | the outer frame of a data table |
| `--rd-shadow-sm` | `0 1px 2px` black at 5% | the same | page actions, the `Select` trigger |
| `--rd-shadow-pop` | `0 24px 50px -20px` black at 28% | `0 24px 60px -20px` black at 70% | menus, dialogs, toasts, popovers, the auth card |
| `--rd-shadow-thread` | `inset 0 -2px 0 var(--rd-accent)` | the same | the crimson thread under a chosen segment, tab or period and under a focused chip value (`shadow-thread`, T6.2) |
| `--rd-shadow-glow` | `0 0 8px currentColor` | the same | a status mark glowing in its own colour (T6.2) |
| `--rd-shadow-glow-accent` | `0 0 8px var(--rd-accent)` | the same | a crimson mark's glow (T6.2) |
| `--rd-shadow-edge` | `inset 0 0 0 1px var(--rd-line)` | the same | the pane's edge, the filter search's, and the second edge under a lead tile's crimson ring on the home and wallet heads (`shadow-edge`, T6.3) |

The table carried the old values (`0 1px 2px` ink at 4%, `0 24px 64px` ink at 16%) until Tailwind migration T6.4
(audit 3.1-21); the values above are the ones in `tailwind.css`.

### Type

Fonts come from `next/font` in `apps/web/app/layout.tsx`. No Google stylesheet link, no new family.

- Arabic and Latin text: **Noto Kufi Arabic** (`--font-sans`, variable, so 500 and 600 are real weights) — angular like a
  stamp, clear at small sizes.
- Hebrew: **IBM Plex Sans Hebrew** (`--font-he`, weights 400 to 700).
- Stack: `var(--font-sans), var(--font-he), Tahoma, sans-serif`. Headings use the same stack at weight 700, the
  heaviest weight (800 is gone, ADR 0021 D7 a).
- Code (the stack frames on `/system/errors`): `font-mono`, the system's own monospace stack (`ui-monospace,
  SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`), left to right in a `dir="ltr"` block. No family is
  loaded for it; it is for code only, never for interface text or figures.
- Numbers, money, dates, phone numbers: **Latin digits only** (dates use `ar-u-nu-latn`), in that same face with
  `font-variant-numeric: tabular-nums` (`tabular-nums`: `Money`, a table's numeric columns, dates, line numbers).
  Identifiers that are Latin digits stay in `<bdi dir="ltr">`.
- Icons: `lucide-react` at stroke 1.9.

### Motion

- Motion is transform and opacity only, 150–900ms, and all of it sits under `motion-safe:` (`@media
  (prefers-reduced-motion: no-preference)`; keyframes `rd-rise`, `rd-fade`, `rd-draw`, `rd-grow` in
  `app/tailwind.css`): the sidebar's contents fade after a fold; the drawer slides in and out over 340ms
  (`rd-sheet-in` / `rd-sheet-out`, the start `Sheet`); the home's cards and tiles rise in with a 40ms stagger; figure
  and shortcut tiles lift 2px on hover; the trend lines draw in and the meters grow; table rows fade in. Plus the
  bell, the spinner and the skeleton shimmer.
- Timing tokens: `--rd-dur-fast` 150ms, `--rd-dur-base` 180ms, `--rd-ease-standard` (0.4, 0, 0.2, 1), `--rd-ease-out`
  (0.2, 0.8, 0.2, 1), `--rd-ease-sheet` (0.32, 0.72, 0, 1: the sheet's slide, the sidebar's width and flyout, the
  folds' chevrons; Tailwind migration T6.3). The browser's `ease` is gone: what was `ease-[ease]` or `… ease` is
  `ease-standard`; the 140ms and 160ms hovers are `duration-fast`, 180ms `duration-base` (T6.3).
- Entrances more than one component plays are tokens (`--rd-animate-*`, T6.3): `animate-rise` (`rd-rise` 420ms out,
  both: a row of cards, the page head), `animate-flyin` (the sidebar's flyout, 160ms on the sheet's
  curve; RTL swaps the keyframe), `animate-drawer` (`filter-slide` 220ms: the filter drawer),
  `animate-pop-in` (`filter-pop-in` 140ms: the `Select` list, the name picker). One-component timings (the sign-in
  choreography and its 70 / 140 / 210ms steps, the bell, the spinner, the shimmer, the donut, the trend line, the
  toast, the dialog drop, the 40ms row stagger) stay where they are used.

### Access

- Targets at least 44px on touch widths (`max-touch:`, 720px and under): every `components/ui` control carries it.
  Under 720px every control on the canvas, in a dialog, in a row menu, and on the sign-in screen is at least 44px
  (sign-in fields and buttons are 42px and 40px above that).
- Text contrast at least 4.5:1 in both themes, and 3:1 for an icon or a border that marks a control. `--rd-faint` is
  the one token below that; it is never used for body text on the canvas, nor for an icon that acts.
- Visible focus, one mark per control family (Tailwind migration T6.2):
  - an action `Button` — 2px of page colour then 2px of `--rd-accent` (`ring-offset`);
  - an icon or text-link control (`IconButton`, `Button variant="link"`, the topbar icons) — a 2px `--rd-ink`
    outline 1px out;
  - a field (`Input`, `Textarea`, `Select`) — the `--rd-accent` border and the 3px `--rd-focus` halo;
  - a choice (`Checkbox`, `RadioGroupItem`, `RadioCard`, the filter toggle chip) — a 2px `--rd-accent` outline 2px
    out;
  - the `Switch` — the 3px `--rd-focus` ring on a pill;
  - an item in a strip or a list (a tab, a segment, a period, a page number, a `Select` row) — a 2px `--rd-accent`
    outline inside its edge;
  - a clickable card (`data-slot="line-op"`) — a 2px crimson ring inside its edge (see [Screens](#screens), number
    card).
- One disabled look: `opacity-disabled` (45%) and a not-allowed pointer (none on a button, which takes no pointer
  events), on every control.
- Check light and dark (dark is the default), and ar + en.

## Controls and primitives

`apps/web/components/ui/` holds every control. Tailwind utilities on the tokens, variants in `class-variance-authority`
(`cva`), joined by `lib/cn.ts` `cn()`, so a caller's `className` wins over the component's own utility for the same
property. Radix primitives (`radix-ui`) are imported only here. Each component carries a `data-slot` handle (the
base rules and the tests read it, never a styling class). A screen composes these and layout utilities; it does not
draw a control of its own. A look two screens need is a variant here.

### Catalogue

| Component (file) | Parts | Variants | States |
|---|---|---|---|
| `Button` (`button.tsx`, `button-variants.ts`) | `Button`, `buttonVariants`, `buttonClass` | `variant` primary · secondary · ghost · danger · link; `size` sm 32 · md 34 (default) · lg 40; `asChild` | hover, pressed (`aria-pressed`), active press (0.97), focus-visible, disabled, `loading` (busy), touch 44px |
| `IconButton` (`icon-button.tsx`) | `IconButton`, `iconButtonVariants` | `size` sm 28 · md 34 (default) · lg 36 · topbar; `tone` muted (default) · faint · faint-to-ink · danger · topbar | hover, pressed, expanded (topbar), focus-visible, disabled, touch 44 × 44 |
| `Input` (`input.tsx`) | `Input`, `inputVariants` | `size` md 34 (default) · lg 42; `surface` sunken (default) · surface | focus, invalid, read-only, disabled, touch 44px |
| `Textarea` (`textarea.tsx`) | `Textarea`, `textareaVariants` | — | focus, invalid, read-only, disabled |
| `Label` (`label.tsx`) | `Label`, `labelVariants` | `tone` page (default) · pane · dialog | — |
| `Switch` (`switch.tsx`) | `Switch` | — | on, off, focus-visible, disabled, `pending` (busy), touch 44px |
| `Checkbox` (`checkbox.tsx`) | `Checkbox`, `choiceBoxClass`, `choiceMarkClass` | — | unchecked, checked, indeterminate, hover, focus-visible, invalid, disabled |
| `RadioGroup` (`radio-group.tsx`) | `RadioGroup`, `RadioGroupItem` | — | unchosen, chosen, hover, focus-visible, invalid, disabled |
| `RadioCardGroup` (`radio-card.tsx`) | `RadioCardGroup`, `RadioCard` | — | hover, chosen (tick), focus-visible, disabled, invalid (group) |
| `Segmented` (`segmented.tsx`) | `Segmented`, `SegmentedItem`, `SegmentedToggle`, `SegmentedToggleItem` | `fill` (equal segments over the full width) | chosen / pressed, hover, focus-visible, disabled, touch 44px |
| `Select` (`select.tsx`) | `Select`, `SelectItem`, `SelectEmpty`, `SelectChipContext` | `place` field (default) · desk · dialog · pane · pager; the chip look inside a `FilterBar` (from `SelectChipContext`, with its `drawer` width on a phone) | focus, open, chosen row, row hover, row keyboard focus, invalid, disabled, empty list, touch 44px |
| `Dialog` (`dialog.tsx`) | `Dialog`, `DialogContent`, `DialogHeader`, `DialogHeading`, `DialogTitle`, `DialogDescription`, `DialogMark`, `DialogBody`, `DialogFooter` | content `size` confirm 460 · form 560 (default) · wide 760; mark `tone` neutral · danger · success, mark `size` md 40 · lg 56 | open (drops in), focus held inside |
| `Sheet` (`sheet.tsx`) | `Sheet`, `SheetTitle`, `SheetContent` | `side` start (the one side, the default) | open (slides in), closed |
| `Tabs` (`tabs.tsx`) | `Tabs`, `TabsList`, `TabsTrigger`, `TabsCount` | — | selected, hover, focus-visible, disabled, phone grid, touch 44px |
| `DropdownMenu` (`dropdown-menu.tsx`) | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator` | item `danger` | item hover, keyboard focus, disabled, touch 44px |
| `Popover` (`popover.tsx`) | `Popover`, `PopoverTrigger`, `PopoverAnchor`, `PopoverContent` | — | open |
| `Toast` (`toast.tsx`) | `ToastProvider`, `ToastViewport`, `Toast`, `ToastIcon`, `ToastText`, `ToastClose`, `ToastLife` | `tone` success (default) · error · warning · info: the tone's icon, a 3px start edge and the tone's soft wash on the surface | a compact row as wide as its words (32px high with one line, at most 340px; the close button is 24px with a 44px press area on touch), under the top bar at the reading end, centred on a phone (owner 2026-11-17); open (drops in from above), close hover, touch 44px close; a 2px life bar along its foot runs out with its time; a page's own error is held there while the page reports it (no bar); a message shows only on the page it was raised on |
| `Badge` (`badge.tsx`) | `Badge` | `variant` default · success · warning · danger · muted · info · violet; `dot` | — (static) |
| `Pagination` (`pagination.tsx`) | `Pagination`, `shouldShowPagination`, `PAGE_SIZE_OPTIONS` | — | current page, hover, focus-visible, disabled arrows, touch 44 × 44 |
| `Table` (`table.tsx`) | `TableSheet`, `Table`, `THead`, `TBody`, `TRow`, `THeadCell`, `TCell`, `SortButton` | `Table` `cards` · `striped` (default on); head cell `num` · `actions` · `fit`; cell `kind` msisdn · when · wrap · block | zebra, row hover, selected (`aria-selected`), focus-within, sorted asc / desc, phone card, empty block |
| `Skeleton` (`skeleton.tsx`) | `Skeleton` | — | shimmer (motion-safe, mirrored in RTL) |
| `Avatar` (`avatar.tsx`) | `Avatar` | — | — |
| `DirectionProvider` (`direction.tsx`) | `DirectionProvider` | — | the document's `dir` for every Radix part (T1.1) |

### Component API

How every part in `components/ui` is written, so a caller knows what it may pass (Tailwind migration T7.1, read from
the code):

- **Props:** a part takes the props of the element it renders (`React.ButtonHTMLAttributes`, `InputHTMLAttributes`, …)
  or of the Radix part it wraps (`React.ComponentPropsWithoutRef<typeof …Primitive.Root>`), plus its own variant props,
  and spreads the rest onto that element. Radix behaviour props pass through unchanged (`open` / `onOpenChange`,
  `checked` / `onCheckedChange`, `defaultValue`, `side`, `align`). The exceptions are written out: `Select` and
  `Segmented` take a controlled `value: string` and `onValueChange(value)` and nothing uncontrolled;
  `SegmentedToggleItem` takes `pressed` (it sets `aria-pressed`); `Pagination` takes `page`, `pageSize`, `count`, `onPageChange` and, for the
  size choice, `onPageSizeChange` / `pageSizeOptions`.
- **Variants:** the props named in the [Catalogue](#catalogue) (`variant`, `size`, `tone`, `surface`, `place`, `side`,
  `fill`, `danger`, `dot`, the table's `cards` / `striped` / `num` / `actions` / `fit` / `kind`), each from a `cva`
  table with a default. The table is exported where another element needs the same look without the component:
  `buttonVariants` / `buttonClass` (a prop that takes a class name), `iconButtonVariants` (the shell's `topbarIcon`),
  `inputVariants`, `textareaVariants`, `labelVariants`, `choiceBoxClass` / `choiceMarkClass`. The variant types are
  exported for callers that pass them on: `ButtonVariant`, `ButtonSize`, `BadgeVariant`, `LabelTone`, `DialogSize`,
  `DialogMarkSize`, `CellKind`, `SelectChip`.
- **`className`:** joined last through `cn()`, so a caller's utility wins over the part's own for the same property.
  A caller passes layout (width, grid place, outer margin) this way, never a second look; a look two screens need is a
  variant here. `Select`'s `className` lands on the trigger; `SheetContent` also takes `overlayClassName` for its
  overlay, and `DialogContent` takes `onScrimClick` (a click on the scrim, outside the panel).
- **Refs:** the controls and every Radix part forward their ref (`React.forwardRef`). These are plain functions and
  take no ref: `Badge`, `Avatar`, `Skeleton`, `Pagination`, the `Table` parts (`SortButton` included),
  `DialogHeader` / `DialogHeading` / `DialogMark` / `DialogBody` / `DialogFooter`, `TabsCount`, `SelectEmpty`,
  `ToastText`, `SegmentedToggle` and `DirectionProvider`.
- **`asChild`:** `Button asChild` draws its one child (a `Link`, an `<a>`, a file `<label>`) as the button through
  Radix `Slot`, without `disabled` / `loading`; `Tabs` draws its Root onto `TabsList`'s strip, and `DropdownMenuItem`
  renders a `<button>`, both through `asChild` inside the part.
- **States:** read from ARIA and Radix data attributes, never from a class: `aria-invalid`, `aria-pressed`,
  `aria-expanded`, `aria-selected`, `aria-busy` (`Button loading`, `Switch pending`), `disabled`, and Radix's
  `data-state` / `data-disabled` / `data-side`; the utilities name them (`aria-invalid:`, `data-[state=checked]:`).
- **Handles:** each part sets `data-slot="<part>"` (`button`, `icon-button`, `input`, `textarea`, `label`,
  `switch`, `checkbox`, `radio-group`, `radio`, `radio-cards`, `radio-card`, `segmented`, `segmented-item`,
  `segmented-toggle`, `segmented-toggle-item`, `select-trigger`, `select-item`, `select-empty`, `dialog-scrim`,
  `dialog`, `dialog-mark`, `dialog-body`, `sheet`, `sheet-overlay`, `tabs`, `tab`, `dropdown-menu`,
  `dropdown-menu-item`, `popover`, `toast`, `badge`, `table-sheet`, `table`, `table-head`, `table-body`,
  `table-row`, `table-head-cell`, `table-cell`, `table-sort`, `skeleton`, `avatar`); `Badge` also sets
  `data-testid="badge"` (a caller's own wins). The base rules of `app/tailwind.css` and the e2e specs read these
  handles; a styling class is never a handle.
- **Radix:** imported only in these files (`radix-ui`), each primitive wrapped once; screens and shared components
  import the wrapper. `DirectionProvider` gives every primitive the document's `dir`.

### Button

Every action is `Button` (5.4b-4d): no `.btn`, `.btn-sm`, `button.primary` / `.secondary` / `.danger`, and no context
rule (`form > button`, `.pane form > button`, `.field-row > button`, `.dialog button.*`) restyles a button by where it
sits. `Button` is Tailwind utilities on the tokens with its variants in `cva` (`components/ui/button-variants.ts`;
Tailwind migration T2.1).

- Variants: `primary` (the crimson fill `--rd-accent-fill`, hover `--rd-accent-fill-hover`, white text, no shadow),
  `secondary` (the soft track: `--rd-surface-2`, an inset 1px `--rd-line-strong`, hover `--rd-surface-3`; the line
  gives way to the ring on focus), `ghost` (no fill, `--rd-ink-2`, hover `--rd-surface-3` and ink), `danger` (the
  danger outline: border at 45%, text in `--rd-danger`, hover `--rd-danger-soft`; never a red fill), `link` (a button
  that reads as text: no box, the text's own colour and font, underline on hover; it takes no size).
- Sizes: `sm` 32px, `md` 34px (the default, the pane control height), `lg` 40px (sign-in-sized screens: password,
  two-factor); every size at least 44px high at 720px and under (a link drawn as a button too). Corners are 6px
  (`--rd-radius-sm`) everywhere (ADR 0021 D19); weight 600; a colour-only transition.
- States (Tailwind migration T6.2): focus-visible is 2px of page colour then 2px of `--rd-accent`; disabled is the
  one disabled strength (`opacity-disabled`) with no pointer; a 0.97 press while enabled; `loading` is the busy
  state (the spinner before the label, disabled, `aria-busy="true"`) — a screen waiting on a request uses it, not a
  bare `disabled`; pressed (`aria-pressed="true"`) holds the variant's hover look (primary `--rd-accent-fill-hover`,
  secondary and ghost `--rd-surface-3`, danger `--rd-danger-soft`), never a change of variant (D13).
- A link or a file label that must look like a button is `<Button asChild>` around it (Radix `Slot`);
  `buttonClass({ variant, size })` is only for a prop that takes a class name (the `RowMenu` trigger). A `Button`
  never draws the browser's default border (5.4b-4a). A button that is a `form`'s or `.pane-body`'s own child sits
  at the reading start (`form > [data-slot='button']`, until the screens carry it).
- A group of buttons reads cancel then the action (D8); in a dialog's foot (and a multi-step create page's last
  step) the cluster sits at the inline end, so the action is at the far end; an in-pane edit form's own buttons sit
  at the reading start.
- Controls with their own look stay plain `<button>`s (or cards), drawn in place with utilities and found by a
  `data-slot` handle, not a class: the operation cards (`op-card`), the point of sale's company and package cards
  (`pos-company`, `pack-card`), the line's package pick (`pack-pick`), menu items, the sort header, and the outage and
  return bars. The account's grants and the two-step rule are `Segmented` (Tailwind migration T4.2, T3.2); the
  catalog's offer and company picks and the two-step method cards are `RadioCard`s since Tailwind migration T6.3; the
  report period switch and the wallet chart's window are `SegmentedToggle`.
- Which button is primary: [Primary button](#primary-button).

### IconButton

One icon, an `aria-label` required. Sizes `md` 34px (the default), `lg` 36px (a dialog's close), `sm` 28px with 4px
corners (a copy button), every size at least 44 × 44 at 720px and under. Tones `muted` (the icon in `--rd-muted`,
`--rd-surface-3` under the pointer), `faint` (the icon in `--rd-muted`, a lighter `--rd-surface-2` hover),
`faint-to-ink` (the same, ink under the pointer), `danger` (an icon that deletes: `--rd-danger`, hover
`--rd-danger-soft`) — an icon that acts is never `--rd-faint` (3:1, audit 3.10-05). Focus is the ink outline;
disabled the one strength; pressed holds the hover fill in ink. States and `danger` since Tailwind migration T6.2.
Size and tone `topbar` (Tailwind migration T6.3, the shell's `topbarIcon` folded in, audit 3.5-16): 44px under 768px
and 36px from 768px, no padding, an 18px icon, `--rd-ink-2`, the raised fill and ink under the pointer or while its
panel is open (`aria-expanded`) — the menu button, the notices, the theme and the language (`topbarIcon` in
`components/chrome.tsx` is `iconButtonVariants({ size: 'topbar', tone: 'topbar' })`).

### Fields: Input, Textarea, Label

- `Input` (Tailwind migration T2.2) is the one-line text field — full width, a 1px `--rd-field-line` border, 6px
  corners, 12px sides, ink text, the crimson thread on focus (an `--rd-accent` border and the 3px `--rd-focus` ring),
  an inset 1px `--rd-danger` line while `aria-invalid` and not focused; sizes `md` 34px (the default, the desk control
  height) and `lg` 42px, both 44px at 720px and under; surfaces `sunken` (the default, graphite's inset field) and
  `surface` (inside a `.pane`, as the pane's legacy field rule drew it). Its type is inherited from the label, as every
  legacy field's is. Read-only (an enabled field with `readOnly`): a dashed border, no fill, `--rd-muted` text, the
  focus ring kept; disabled: the one disabled strength and a not-allowed pointer (Tailwind migration T6.2).
- `Textarea` is the pane text area (at least 72px, 8px / 12px padding, the same border, fill, focus, invalid,
  read-only and disabled looks, resized in height only).
- `Label` tones: `page` (6px gap, 13px semibold `--rd-ink-2`), `pane` (4px, 11px semibold `--rd-muted`), `dialog`
  (4px, 11px bold `--rd-muted`).
- A count or a duration is typed, not picked from a list: a number field without the browser's spin arrows, its
  range under it (red with the field's edge while out of range), the inherited value as its placeholder — the session
  rules (sessions allowed, idle hours) on a role and on an account (owner 2026-11-11).

### Choice controls: Switch, Checkbox, RadioGroup, RadioCard

On Radix since Tailwind migration T2.3.

- `Switch` is the on/off switch `LiveSwitch` draws: a `role="switch"` button (36 × 32px, 44px under 720px) around a
  square track (38 × 20px, 4px corners) and a square 14px knob (2px corners, `--rd-on-mark`) that slides 18px to the
  end; **green (`--rd-success`) when on, red (`--rd-danger`) when off**, everywhere (owner, 2026-11-08); disabled
  keeps its colour at the one disabled strength; `pending` (a change being saved, Tailwind migration T6.2) sets
  `aria-busy`, a progress pointer and the track at the same strength, its colour and knob kept; keyboard focus is the
  3px `--rd-focus` ring. There is no mixed state.
- `Checkbox` and `RadioGroupItem` are the system's box and dot: 18px on the surface, a 1.5px `--rd-field` border
  (3:1 on the surface; ink at 32% until Tailwind migration T6.2, audit 3.10-08), 4px corners or round; on: the
  `--rd-accent-fill` fill with its light `--rd-on-accent` mark growing in; a checkbox may be indeterminate
  (`checked="indeterminate"`: the fill with a short light bar); an empty box takes the `--rd-accent` border under the
  pointer, and the `--rd-danger` border while `aria-invalid`; the 2px `--rd-accent` outline 2px out on keyboard
  focus; the one disabled strength when disabled. `RadioGroup` sets no layout of its own. A native
  `input[type='checkbox']` / `input[type='radio']` takes the same look from the base rules in `app/tailwind.css`;
  neither ever inherits text-field height.
- `RadioCardGroup` / `RadioCard` (Tailwind migration T6.2, on Radix RadioGroup: Tab enters at the chosen card, the
  arrows move and choose) is a choice drawn as a card: a 1px `--rd-line` border, 6px corners, `--rd-surface-2`, 12px /
  14px inside, rows 4px apart; `--rd-accent` at 45% under the pointer; chosen: an `--rd-accent` border on
  `--rd-accent-soft` with the crimson tick in the top inline-end corner; the choice focus mark (2px `--rd-accent` 2px
  out), the one disabled strength, unchosen cards bordered `--rd-danger` while the group is `aria-invalid`. The
  catalog's offer and company picks (`data-slot="pick-card"`) and the two-step method cards draw it since Tailwind
  migration T6.3 (an added offer is at the one disabled strength).

### Segmented and SegmentedToggle

`Segmented` (Radix ToggleGroup, `role="radiogroup"` of `role="radio"` segments, arrow keys between them, the chosen
one never unset) is the segmented pick: 6px corners and an inset 1px `--rd-line-strong` around square 32px segments
(44px at 720px and under), 10px sides, 12px bold `--rd-muted`, a 1px `--rd-line-strong` between them; the chosen one
on `--rd-surface-2` in ink over the crimson thread (`shadow-thread`); `fill` spreads equal segments over the full
width (each label on one line, an ellipsis when long). An unchosen segment turns ink on `--rd-surface-2` under the
pointer, keyboard focus is the 2px `--rd-accent` outline inside it, and a disabled one takes the one disabled strength
(Tailwind migration T6.2).

`SegmentedToggle` / `SegmentedToggleItem` is its toggle form, the period switch's look: a `role="group"` of
`aria-pressed` buttons, each in the Tab order; 4px corners and an inset 1px `--rd-line`, 34px buttons with 12px
sides, 12.5px semibold `--rd-muted`, ink under the pointer, a 1px `--rd-line` between them, the pressed one on
`--rd-surface-2` in ink over the crimson thread, the whole row under 768px. The report period switch
(`data-slot="period"`) and the wallet chart's window switch draw it since Tailwind migration T6.3.

### Select

Every dropdown is `Select` (5.4b-4c: no bare `<select>` in a page), on Radix Select since Tailwind migration T2.4: a
combobox button (`data-slot="select-trigger"`, `data-value` the chosen value) and its list in a portal, `SelectItem`
rows, `onValueChange(value)`, `''` a value like any other (the «الكل» row). Fixed short lists (status, layer, kind)
are `Select`; picking an account or a package is `NameField`.

- Its `className` lands on the trigger, which carries the layout (width, grid place). `place` says where it sits,
  each the legacy native-select look of that place: `field` (outside the desk, the sign-in screens: 36px, sunken, a
  `--rd-field-line` border, 12px at the start, 14px), `desk` and `dialog` (the same at 34px), `pane` (34px, the
  surface fill, the full `--rd-field` border, 8px at the start, 13px), `pager` (the pane look at 28px); every place
  44px at 720px and under; every place keeps 36px at its inline end for the 16px `--rd-muted` chevron (it was
  `--rd-faint`, under 3:1: audit 3.10-05), `--rd-shadow-sm`, 6px corners, the label's weight. Inside a `FilterBar`
  it is the chip's value (the chip look, from `SelectChipContext`; see [Filters](#filters)).
- States (Tailwind migration T6.2): on focus the `--rd-accent` border and the 3px `--rd-focus` ring; `aria-invalid`:
  `Input`'s inset `--rd-danger` line while not focused; disabled: `--rd-surface-2`, the one disabled strength,
  not-allowed.
- Its list is the chip list's look for every Select: `--rd-surface-2`, an inset 1px `--rd-line-strong`,
  `--rd-shadow-pop`, 6px corners, 4px padding, 34px rows in `--rd-ink-2` 13px medium, the chosen one crimson and bold
  with a tick, a row under the pointer on the surface fill, a row with keyboard focus the same fill and a 2px crimson
  ring inside its edge (so the list's scroll box never clips it); min(320px, 92vw) by min(360px, 60vh) at most, at
  least as wide as its field (under a chip: as the chip, at least 180px, from the chip's start, 6px below).
  `SelectEmpty` is its row for nothing to choose (the row's size, `--rd-muted`, not a choice; the caller's words).

### Overlays: Dialog and Sheet

On Radix Dialog since Tailwind migration T2.5.

- `Dialog` (`components/dialog.tsx`, the one dialog, composed from `components/ui/dialog.tsx`) is a panel centred on
  the `--rd-scrim` with an 8px backdrop blur and 16px around it: min(560px, 100%) wide (`confirm` 460px, `wide`
  760px), at most min(720px, the dynamic viewport less 48px) tall (`dvh` since Tailwind migration T6.2, audit
  3.2-10), 6px corners, the surface fill, an inset 1px `--rd-line-strong` under `--rd-shadow-pop`, the 2px crimson
  thread across its top, dropping in over 200ms when motion is allowed. Its head (16px, 14px below, a hairline under
  it) holds the mark (a 40px `--rd-accent-soft` tile with 6px corners and the tag's cut corner at the reading end, an
  18px crimson glyph; danger and success take their own soft fill and colour; `markSize="lg"` 56px with a 28px glyph
  for the activation result), the 16px bold title with its 13px medium `--rd-muted` lede, and the 36px close (44px at
  720px and under); the body scrolls with 16px padding; the foot is the buttons at the inline end on `--rd-surface-2`
  over a hairline, cancel then the action (ADR 0021 D8). It names itself by its title and is described by its lede;
  Tab wraps inside it; only the scrim or Escape closes it. Every size has the same head and foot; `confirm` is only
  narrower than `form` and `wide` (spec 2026-11-11-ui-consistency-pass, D5).
- `Sheet` (modal) is a full-height side panel with one side, `start`: the shell drawer's look (min(300px, 86vw), the
  page colour, a hairline at its inline end, over `--rd-scrim-strong` with a 2px blur, sliding over 340ms).

### Floating parts: Tabs, DropdownMenu, Popover, Toast

On Radix since Tailwind migration T2.6 (the menu since T2.4). Every popup next to a button opens and closes the same
way: a press outside or Escape closes it and Escape returns the focus to the button; a `role="menu"` opens on its
first item and ArrowUp/ArrowDown (wrapping), Home and End move between items. The row menu and every `Select` list
get it from Radix; the date field's month from Radix Popover; the notices and the language menu still from
`usePopover` (`lib/use-popover.ts`). A new popup uses a `components/ui` primitive, not its own listeners.

- `Tabs` (composed by `components/tabs.tsx`) is the tab strip — square 36px tabs side by side in 6px corners and an
  inset 1px `--rd-line-strong`, 16px sides, 13px semibold `--rd-muted`, a 1px `--rd-line-strong` between them, the
  selected one ink bold on `--rd-surface-2` over the crimson thread, ink on `--rd-surface-2` under the pointer,
  keyboard focus the 2px `--rd-accent` outline inside the tab, a disabled one at the one disabled strength, the count
  (`TabsCount`) a crimson 11px bold figure; at least 44px high at 720px and under; under 641px a grid of equal cells
  (three a row, two for two or four tabs), each label centred on as many lines as it needs (still 44px). Tabs sit
  above their content, never inside its card, on every page; arrow keys move between them.
- `DropdownMenu` (the row menu, `components/row-menu.tsx`, not modal): an 8px-radius (`--rd-radius-card`) card with
  6px padding, at least 13rem wide, opening from the trigger's inline end: each action is a 38px line, 14px semibold,
  its icon on a 27px `--rd-surface-2` tile at the start; hover and keyboard focus fill the line; a destructive action
  (`danger`) is danger red with a `--rd-danger-soft` tile, after a hairline rule (`DropdownMenuSeparator`); a
  disabled action (Radix `disabled`, skipped by the keyboard) takes the one disabled strength with no hover fill
  (Tailwind migration T6.2); 44px lines at 720px and under.
- `Popover` is the calendar panel's look: the surface, 10px padding, 6px corners, an inset 1px `--rd-line` under
  `--rd-shadow-pop`, 6px from its anchor at its reading start, above a dialog (`z-dialog-popover`).
- `Toast` is a row on the surface with 6px corners, an inset 1px `--rd-line` under `--rd-shadow-pop` and a 3px start
  edge (`success` `--rd-success`, `error` `--rd-danger`; `warning` and `info` in `--rd-warning` and `--rd-info` since
  Tailwind migration T6.2), its 13px semibold message (`ToastText`) and a 28px `--rd-muted` × (`ToastClose`, 44px at
  720px and under; `--rd-faint` until T6.2, audit 3.10-05), at most min(420px, the window less 32px) wide, rising in
  over 220ms; the toasts stack 8px apart 20px from the bottom and the reading end (under 641px across the width, 12px
  in). How a screen raises one: [Feedback](#feedback).

### Marks and lists: Badge, Pagination, Table, Skeleton, Avatar

Tailwind migration T2.7 (the table T2.9).

- `Badge` is the status pill — 4px corners, 2px / 8px padding, 11.5px semibold, the tone's soft fill and text under
  an inset 1px ring of the text colour at 15% (`muted`: `--rd-line`); with `dot` it is the Graphite diamond mark
  instead (no fill, ring or side padding, 12.5px, a 7px square turned 45deg with 1px corners glowing 8px in the text
  colour (`shadow-glow`), `muted` without the glow); tones `default` (the ink fill's tint), `success`, `warning`,
  `danger`, `muted`, `info`, `violet` (the last two since Tailwind migration T6.2). Status → tone:
  [Status tones](#status-tones).
- `Pagination` is the hairline row under a table: 12px / 16px padding, 12px `--rd-muted` facts and the 88px per-page
  `Select` (`place="pager"`), quiet 30px previous / next, 30px square page numbers with 4px corners in 12.5px bold
  `--rd-ink-2`, the current one ink on the page colour (a state, not an action: D3), page numbers focused by the strip
  mark, at least 44 × 44 at 720px and under; the gap ellipsis in `--rd-faint` (decoration).
  `shouldShowPagination` draws it only when there is more than one page or a page size to choose.
- The table sits in a `TableSheet` that scrolls sideways: a sticky head on the surface (38px, 11.5px bold
  `--rd-muted` at 0.02em, a 1px `--rd-line-strong` rule under it, no band behind it), 46px rows with 8px / 14px
  padding (8px sides on the canvas up to 1100px), even rows `--rd-surface-2` at 55% (`striped`), the row under the
  pointer `--rd-accent-soft`, centred cells but the first at the reading start, numbers tabular, every cell on one
  line (a long text column is `kind: 'wrap'`, a cell that holds a block `kind: 'block'`, a number `msisdn`, a time
  `when`), the header's sort chevrons (`SortButton`) at 45% until sorted, rows fading in; a selected row
  (`aria-selected="true"`) and a row that holds the keyboard focus take the hover tint (the whole card on a phone;
  Tailwind migration T6.2). A `num` column (head and cell, `data-num`) aligns to the reading end; the `actions`
  column (`data-actions`) stays at the inline end, sized to its label; a `fit` column takes only its content's width.
  Under 641px a `cards` table draws each row as a card (14px / 16px padding, two values a row under their 11.5px
  names — `td[data-label]` —, the title across, ⋯ in the corner, ink at 3% on even cards). An empty table that keeps
  its head shows its empty block at its own height under the head (never cut off).
- `Skeleton` is a 6px-corner `--rd-surface-3` bar with the shimmer sweeping across it in the reading direction, only
  when motion is allowed (T6.2, audit 3.8-09).
- `Avatar` is the sidebar account's 36px crimson tile (`--rd-accent-fill`, 6px corners) with the initial in 14px bold
  `--rd-on-accent`.

### Status tones

Status → tone lives in one file, `apps/web/lib/status-tone.ts` (Phase 5.4b-2): line active → `success`, frozen →
`warning`, disconnected → `danger`, else `muted`; task done → `success`, cancelled → `danger`, else `warning`; account
frozen → `warning`, open → `success`; notice unread → `warning`, read → `muted`; on/off (for sale, enabled, grant) →
`success` / `danger`; package terms stopped → `danger`, custom price → `success`, inherited → `muted`; a provider
operation's phase: waiting `info`, unconfirmed `warning`, failed `danger`, a success that could not be settled
`violet`, applied `success`. `<Badge variant={tone} dot>` draws it; there is no plain `.badge` class any more
(5.4b-4b), and a page never picks a tone inline. A badge's inset ring is its text colour at 15%
(`inset-ring-<tone>/15`), the muted badge's is `--rd-line`.

## Components

The shared components in `apps/web/components/` compose the primitives above. One of each: a new page uses these, it
does not invent a sibling (no new card, button or table style for one page).

### Primary button

Crimson fill (`Button`'s `primary`, `--rd-accent-fill`, hover `--rd-accent-fill-hover`), in both themes, with white
text (`--rd-on-accent`; ADR 0021 D1, D2) — `Button`'s `primary`, the login's «دخول», the package picker's button.
**One primary per view.** Precedence: the page-head action, else the submit of the view's main form; a save in a
secondary pane, a lookup step and a per-row save are secondary (a per-row save is `secondary` `sm`, enabled only when
its row changed, D14). A dialog is its own view: its «حفظ» / «تفعيل» is its primary. A main form's submit is the
view's primary when the head carries no primary action, and then it is at its default size, never a small or
secondary one; under a primary head action it is secondary, except where a named exception keeps it primary. The
other head actions are secondary, the boxed ⋯ drawn the same. A tab is not otherwise its own view.

Named exceptions, kept as they are (no visible change; P0.1's reading, to be confirmed by the owner: ADR 0021 D2):

- a takeable row of the tasks list keeps its own `sm` «أخذ المهمة» (owner 2026-11-11), so a list with several
  takeable rows shows several;
- the task ticket: its head shows take and «إكمال» both as primaries on an unassigned task (take as today, «إكمال»
  per D13), and its in-page forms keep their primary submits beside the head's primaries — the open complete form's
  «إكمال» and the note composer's «إضافة ملاحظة» (at the default size from P3.1); the reject form's submit is the
  danger outline;
- a tab's main form beside the page-head action: on a page whose head carries a primary action, the open tab's main
  form keeps its primary submit — today only the company page's «الإعدادات» tab («حفظ» beside «إضافة رزمة») and the
  provider account's «المطابقة» tab («مقارنة» beside «تسجيل دفعة»; its matching save turns secondary in P3.2).

A pressed state is `aria-pressed`, never a change of variant (D13). Secondary is the soft track; destructive is an
outline in danger (border and text), not a filled red; ink fills are not actions. The chosen page number is a state,
not an action: it stays ink (D3).

### Frame and data

- Page (`Desk`, `components/desk.tsx`): title, one muted lede, then the content. No second heading that repeats the
  title. See [Page templates](#page-templates).
- Card / pane (`Pane`, `components/desk.tsx`): the surface, no border, a 1px inset `--rd-line` edge, 6px corners
  (`rounded-sm`); a pane that holds a table takes 8px corners and `--rd-shadow-frame` instead of the edge. Its head
  and body are still `.pane-head` (52px, 14px / 18px) / `.pane-body` (14px, 18px at the sides and foot;
  `--rd-space-pane`). `EmptyState` inside a pane or
  sheet already carries 14px padding, so a page never sets it inline.
- Table (`DataTable`, `components/data-table.tsx` on `components/ui/table.tsx`; `PagedTable` for cursor lists): quiet
  header, hairline rows, text and status at the reading start, numbers tabular and aligned to the reading end (the
  column's `num`). Every `DataTable` header sorts when the table holds the whole list; a column with no words in its
  head does not sort, and the actions column's head is for readers only. A cursor list (`PagedTable`) reads every
  page (up to 2000 rows) on the first header click and then sorts and pages the whole set; a server-paged table shows
  plain headers in the server's order. The pager is a hairline row with square page numbers, the current one ink.
  Phones (under 640px, D7): a row is a card — the first cell its title, every other value under its column's name
  two to a row, ⋯ in the corner; a cell that holds price editors (the sell cell's fields and save, a `.price-pair`)
  takes the card's whole row and wraps there, a price field never wider than its cell; the task and notice lists and
  the roles matrix keep their own layout (`cards={false}`).
- Row menu (`RowMenu`, `components/row-menu.tsx`, on `DropdownMenu`): the only contextual row action, a 28px
  horizontal ellipsis; the menu is the `DropdownMenu` look above.
- Dialog (`components/dialog.tsx`): the `Dialog` look above; `size` is `confirm`, `form`, or `wide`; a header, a
  scrolling body, and a footer; it names its action with a mark and a one-line lede.
- Tabs (`components/tabs.tsx`): the `Tabs` look above; an optional crimson count; arrow keys. Tab strips wrap so every
  tab is in view.
- Facts: label/value pairs are `<Facts>` + `<Fact label>` (`components/facts.tsx`), never a hand-written `<dl>`. One
  primitive, three densities (`variant`, read back as `data-variant` on `data-slot="facts"`): `tiles` (default: each
  fact one framed row drawn like a filter chip — its name on the soft track, a hairline, the value on the surface;
  rows stack and pair up in a wide dialog (owner 2026-11-11); every dialog's summary: QR, swap SIM, request eSIM,
  change number, transfer, disconnect, activation result, transfer dialog), `cards` (a summary card per fact,
  `data-slot="fact-card"`, with an `icon` and a `tone` of `good`/`warn`; the head of the user page), `list` (a compact
  ruled list for a narrow rail; the task ticket). Latin identifiers inside a value stay in `<bdi dir="ltr">`.
- Package facts: `PackageFacts` (`components/package-facts.tsx`, `data-slot="package-facts"`) — GB, minutes, messages
  and months on one muted line («500 جيجا · دقائق غير محدودة · 3 أشهر»), the package's extra text under it. Wherever a
  package is chosen or listed; the line alone (`withDetails={false}`) on small cards.
- Money (`Money`, `components/desk.tsx`): bold tabular figures; a negative one in `--rd-danger`, a signed positive
  one in `--rd-success` with its plus, `muted` (a reference figure) in `--rd-muted`; the shekel sign after it at 0.8em,
  normal weight, `--rd-muted`.
- Company mark (`CompanyMark`, `components/company-mark.tsx`, `data-slot="company-mark"`): the company picture or its
  letters on `markColor(name)` (`lib/company-mark.ts`, `hsl(h 42% 33%)`, at least 4.67:1 against white on every hue)
  with the cut corner, wherever packages are grouped (the packages list, a user's «الرزم والأسعار» tab, the numbers
  table) and beside a company's name.
- Image: an image whose source is a `data:` or `blob:` URL (logos, company marks, the eSIM QR) is `DataImage`
  (`components/data-image.tsx`); there is no bare `<img>`.

### Filters

`FilterBar` (`components/filter-bar.tsx`, `data-slot` `filter-bar` / `filter-panel`) is the only filter pattern; do
not write hand-made filter markup on a new page.

- Chips in one wrapping row in a bar of its own (12px / 16px padding, 6px corners, the surface and a 1px inset
  `--rd-line` ring) on the top edge of the table card below (its bottom corners square when a pane follows it) — the
  field's name on a raised segment, the field beside it (as wide as its value), crimson once it holds a value; «مسح»
  in crimson at the end, shown only once something is filtered (`onClear` / `clearLabel`).
- Pressing a chip opens the design's own list under it (the `Select` list, hung under the whole chip), not the
  browser's; the chip's value is the `Select`'s combobox trigger, for the keyboard and assistive tech. A chip that
  holds a value shows «×» (pointer shortcut; the field's «الكل» does the same from the keyboard).
- A yes/no filter (e.g. «السالب فقط») is a toggle chip: the chip lights when on; the checkbox stays over it,
  invisible, for keyboards and screen readers; focus is the choice mark.
- `loose` drops the bar's padding, fill and ring, so the chips stand above the list (the packages list, the report
  filters); `bare` leaves its children as they are and keeps them in place on a phone, with no «كل الفلاتر» (the
  two-step method chip).
- Under 768px only «كل الفلاتر» shows (36px, the soft track); it opens the fields in a drawer from the inline end
  (`w-drawer`, `animate-drawer`, the surface, `--rd-shadow-pop`), with «عرض النتائج».
- Search inside a list: `TableSearch` (`components/table-search.tsx`) or the `label.filter-search` field — an inset
  box with its icon and placeholder.

### Fields beyond the primitives

- Name picker: `NameField` (`components/name-field.tsx`, matching in `lib/name-match.ts`; spec
  2026-11-09-admin-review, 2a) — the one way to pick an account, point of sale, package, company or provider: a text
  field that suggests up to eight names from the first letter, closest first (exact, starts with, a word starts with
  — also after «ال» —, contains, one letter off for letters only), the matched part in bold, a `hint` line (layer,
  company · provider) under each. Arabic-aware (marks, tatweel, أ/إ/آ = ا, ة = ه, ى = ي, Arabic-Indic digits). ↑/↓,
  Enter, Esc (closes the list only, not a dialog); a picked name has a «×»; no free text. The list is a portal with a
  fixed position, styled like the filter chip's own list (the `Select` list); 44px rows under 768px. Its own look
  (the row, the «×», the list) is Tailwind utilities in the component since migration T2.2; the text field takes the
  look of the place it sits in (chip, pane, dialog), whose rules read `[data-slot='name-field']`. In a `FilterBar` it
  sits in the chip, `allLabel` («الكل») as its empty state.
- Dates are `DateField` (`components/date-field.tsx`, Tailwind migration T2.8): a `YYYY-MM-DD` field and the
  system's month — never `type="date"`. It opens its month in `Popover`: 280px, the month name between two 30px
  steps, seven equal columns 2px apart, 11px semibold `--rd-muted` weekday names, 34px days (40px under 641px) with 4px
  corners in 12px semibold ink, today ringed 1px in `--rd-accent`, the chosen day on `--rd-accent-fill`, «اليوم» and
  «مسح» as 30px crimson links over a hairline; its calendar button is a 34px cell beside the field (40px under 641px)
  with a 1px `--rd-line` border on `--rd-surface-2`, crimson under the pointer and while open, and the chip's 30px
  value end inside a filter.
- Price field: `PriceField` (`components/price-field.tsx`) — a short inline shekel input (`Input` with utilities since
  Tailwind migration T2.2: 6.5rem, 34px, 4px corners, 13px bold on the surface — at most its cell's width in a phone
  card, which a base rule in `app/tailwind.css` reads by `[data-slot='price-field']` — tabular, LTR) that saves on
  blur or Enter when the text changed; empty means back to the default, Escape drops the draft. The default sits
  beside it as a muted `Money`. Used by the package sheet and the line-prices table; the user page's packages tab edits
  prices in a dialog instead.
- Switch: `LiveSwitch` (`components/live-switch.tsx`) — the `Switch` primitive after its words, 8px apart; the label
  and the state word sit beside it as `children`; `className` places it (a column on an operation card). A switch
  beside its state word in a table keeps the word's width, so the columns do not move. This is the only on/off
  control; do not draw a second toggle.
- A file is chosen through a system button (`<Button asChild>` around a `<label>`) over a hidden input, with the chosen
  name beside it; the branding logo through `BrandingDrop` (`components/branding-drop.tsx`).

### Feedback

- One alert line for an error, one for a success, always through `Alert` (`components/alert.tsx`): `<Alert>{error}</Alert>`
  draws the `--rd-danger` line on `--rd-danger-soft` with `role="alert"`, `<Alert tone="success">` the `--rd-success`
  line on `--rd-success-soft` with `role="status"` (10px / 12px padding, 6px corners, 13px semibold), `banner` keeps
  16px under it (none as a direct child of `.desk` or the settings page), `className` places it (the dialog's error
  line, 12px / 16px in), and an empty message draws nothing. Pages inside `Desk` get theirs from `PageAlert`, which
  uses `Alert`. No hand-written `<p className="error">` and no browser `alert` for success.
- Saved messages are toasts (`components/toast.tsx` `useToasts`, fed by `PageAlert`'s note; on
  `components/ui/toast.tsx`): stacked in the reading-end bottom corner over the page, a green edge, ×, gone after
  4.6s; nothing on the page moves. Errors stay in the page.
- Empty: `EmptyState` (`components/empty-state.tsx`, Tailwind since migration T2.7) — muted icon in a 32px circle on
  `--rd-surface-2`, title (`children`), optional secondary `text`, optional `actions`, centered (both axes) in the
  available `Pane` / `TableSheet` space, not pinned to the start edge; `tone="danger"` for `LoadFailed` and the error
  screen. Not a lone italic line.
- Loading: `components/loading.tsx` — `Spinner`, and `TableSkeleton` rows of `Skeleton` bars.
- The account's name: `AccountName` (`components/account-name.tsx`) draws its own look (the name, the full name at
  0.92em).

### Figures and charts

- KPI: `StatRow` wraps a row of `Stat` items (`components/stat.tsx`). Each `Stat` is a card on `--rd-surface` with a
  1px inset hairline, 6px corners and the cut corner (`figureCardClass`, Tailwind migration T3.3): the `label` at the
  start and a small `icon` (`IconName`) at the end on the first line, then a large tabular `value`, then optional
  `meta`. `tone` colours the icon; `highlight` draws the value and the icon in `--rd-success` for the one figure that
  matters most on a screen (the card stays on the surface, as graphite drew it); `progress` (0–1) draws a thin bar
  under the value. This is the only KPI pattern; do not hand-write a KPI card. `pointerGlowClass` (T6.3) is
  the figure tiles' soft `--rd-glow` light under the pointer (the shell sets `--mx` / `--my`) and their 2px lift; the
  home and wallet bands, the line operations and the package cards compose it.
- Figure cards (`.stat-row`): four cards sit in one row when they fit and two by two from 768 to 1100px, never three
  and one; under 768px an odd last card spans the row. A name as a figure (a `<bdi>` with `STAT_NAME`,
  `features/reports/screens/report-pages.tsx`) starts at the reading start.
- Account band (home): `AccountBand` (`features/desk/home-top.tsx`) — the lead card (available balance, the ceiling as
  twenty ticks, its edge `--rd-accent` at 35% over `--rd-line` with a 2px crimson thread along its top up to the cut,
  the figure 1.9rem; wider from 1100px, the whole row under it), three period cards (`data-slot="pulse-tile"`: sales,
  new subscriptions, profit, each with its change chip and a `TrendLine` under the figures) and the active numbers.
  The wallet head (`WalletHead`, `features/wallets/wallet-head.tsx`) draws the same lead and figure cards.
- Chart: `TrendLine` (`components/trend-line.tsx`) — SVG, no library; a smooth curve over a gradient area that draws
  in, a soft glow, a breathing dot at the latest point, the step's value on hover; `size="large"` (the wallet head's
  balance over time) adds faint guide lines. Time runs left to right in every language. It draws in by a
  left-to-right reveal (`clip-path`), its area is a fill only. In a home period card it lies under the figures along
  the card's lower 55% instead of a band of its own.
- Donut (`components/donut.tsx`): slices with square ends and a thin gap between them, its middle words unstroked (the
  global `svg` icon rule is overridden); a legend whose row reads dot, label, change, count — the count closes the
  line, the change (green ↑ / red ↓ with the number; `data-testid` `donut-change-up` / `donut-change-down`) just
  before it; pointing at a slice (ring or legend, or focus) puts its share and name in the middle, thickens it and
  dims the rest; the ring draws in (reduced motion: none).
- Users card (`UsersCard`, `features/desk/overview.tsx`, utilities since Tailwind migration T4.1): a tile per managed
  layer in its `--rd-layer-*` colour (mark, count, label, a link to the list), the ceilings in use as a bar, then
  debtors (count pill, debt; `--rd-warning` while there are debtors, `data-warn`) and frozen as ruled rows.
- Shortcut tiles: none. The home has had no shortcuts card since spec 2026-11-09-admin-review (7)
  (`features/desk/screens/home-screen.tsx`); this file still named one until Tailwind migration T7.1.
- Offers hero (home, spec 2026-11-09-offers-tasks-addons-wallet-esim): `OfferHero` (`components/offer-hero.tsx`,
  utilities since Tailwind migration T4.1) — a compact strip — text at the reading start and a small 240px 2:1 picture
  at the end, stacked picture-first under 760px; the picture is optional, and without one the offer is text only on
  one column (`data-text-only`); a pill dot per offer under it, the current one wide with a `--rd-primary-bg` fill
  that is its timer (`seconds` per offer); arrows show on hover or focus on desktop; swipe and the arrow keys move it;
  it pauses on hover, focus and a hidden tab, and does not run with reduced motion. The dot button is the touch target
  and the 8px bar inside it is what shows.

### Cards and dialogs of the catalog

- Operation cards (`features/accounts/screens/line-ops.tsx`, each `data-slot="op-card"`): a grid of cards (a 1px
  inset hairline ring, `--rd-surface-2` while stopped): a 40px glyph tile, title and one-line description, an
  inherited-stop badge, and a `LiveSwitch` with the state word under it.
- Run-mode cards: `ModeCards` (`components/mode-cards.tsx`) — one cut-corner card per operation with a three-way
  `Segmented fill` (مباشر / مهمة فرع / متوقف) that spans the card in three equal parts, so longer languages never
  spill past its edge (a long label ends in an ellipsis); a stopped one dims. Cards are at least 250px wide; on a phone
  a run-mode card puts its mark beside its name.
- Terms list (user page → «الرزم والأسعار», spec 2026-11-08-user-packages-tab-redesign): `TableSheet`
  (`features/accounts/screens/packages-terms.tsx`) → one folding section per company (a sticky head button with the
  company's mark and a chevron, `aria-expanded`, folded until
  pressed or matched by the filter) → a bare `DataTable` with plain headers, one line per package: name and GB ·
  «سعرك (اشتراك / تجديد)» · «سعر البيع (اشتراك / تجديد)» (green and bold when custom) · margin · a badge only when
  special (`سعر خاص`, `متوقف`, `موقوف من فوق`) · the switch · `RowMenu` («تعديل السعر» dialog, «إرجاع للافتراضي»,
  «أسعار الأرقام القائمة»). A row whose switch is off reads muted and struck through. No company switch, no bulk on/off,
  no «موروث».
- The package price chain (`ChainBoard`, `features/catalog/chain-board.tsx`, its table `data-testid="chain-grid"`):
  one table row per layer — the branch's cost first, tinted —, the subscription and the renewal side by side, each
  price with its margin over the layer above; the eSIM price and the re-pricing sit as two cards under it (D6).
- **Line prices dialog** (`components/line-prices-dialog.tsx`): Dialog `size="form"` that groups a package's renewable
  numbers by the renewal price they carry and lets the operator set a new flat price per group or «follow current»; a
  `Table` (`components/ui/table.tsx`) with `num` columns, `PriceField` for the new price, secondary follow button,
  footer cancel/save. Mounted from the user packages tab and the package sheet.
- **Transfer dialog** (`components/transfer-dialog.tsx`): Dialog `size="form" mark="transfer"` that moves a point of
  sale or an agent: destination select, live preview (balances, line count, below-floor badge), radio pairs on
  `RadioGroup` (each in its 44px label, Tailwind migration T2.5) for own/child terms (keep / follow → `reset`) and for
  moved-number prices (keep / recapture), no defaults, submit disabled until every choice is made. Mounted from the
  users page; the number detail page asks the same line-price choice inline.
- QR (`components/esim-qr.tsx`): `QrTile` draws the code on the white `--rd-qr-tile`; `EsimDialog` shows a number's
  eSIM, `QrPicker` takes a picture, `SimBadge` / `EsimMark` open it from a row.

### Shell

The shell is utilities in `components/app-shell.tsx`, `chrome.tsx` (`topbarIcon`: every topbar control's box),
`crumbs.tsx` and `shell-search.tsx` since Tailwind migration T3.1.

- Sidebar (ported from `design/night-desk-family`): the canvas colour with a hairline at its edge; a brand row on top
  (the crimson cut-corner tile, name, «door · layer»), sections with small muted titles, 40px items (icon 19px) — the
  current page is ink on `--rd-surface-2` with a 2px crimson bar and a crimson icon, hover is `--rd-surface-2`. A
  folding group (a `NavGroup`, e.g. «التقارير») slides its pages open under a hairline, each page marked by a small
  diamond that lights crimson when current. The foot holds the account (test id `side-user`: `Avatar`, name, layer →
  `/settings`) and «تسجيل الخروج»: open (and in the drawer) a muted icon button at the end of the account's row,
  red under the pointer; on the folded rail a line of its own under the avatar. The round handle on its edge shows on hover or keyboard focus and folds the sidebar
  (the `[` key too) to a 76px rail: names fade, section titles become hairlines, and hovering an icon
  shows its name in a flyout (`data-slot="side-flyout"`) — pressing or hovering a group (التقارير) opens its pages as
  a small menu there; it never leaves the page. The width glides (320ms). Under 900px the sidebar is the drawer (menu
  button in the topbar), a start `Sheet`.
- Sidebar counts: a small crimson square at the end of the item (a corner mark on the folded rail) — the open tasks
  beside «المهام», from `/office/home` `openTasks`.
- Topbar: a crimson hairline under it; the **path** (`ShellPath`, `components/crumbs.tsx`) at the reading start, in
  an inset box — `⌂ / section / list / item`; section titles plain, the levels above the page links, the page in ink;
  `Alt+↑` goes one level up. There is no back button. Then, at the end: «ابحث أو انتقل» (`ShellSearch`: pages by
  name, then accounts and numbers; `/`, Ctrl K or ⌘K) on an inset field, the wallet chip (raised, balance only in
  ink, crimson mark), notices (unread as a glowing crimson dot on the bell) and the theme as bare icons. The account
  and the language are not in the topbar: they sit at the sidebar's foot (the drawer's foot on a phone).
- Topbar widths: under 900px the path takes its own full-width row under the icons. The topbar's sides are the page
  gutter on a phone: 16px (`--rd-space-4`) under 768px, so its first and last controls line up with the page content;
  28px from 768px, where the canvas keeps `clamp(16px, 2vw, 28px)` until both share one gutter token (ADR 0021 D9).
  Under 768px the search and the notices do not hang from their button: each opens as one sheet under the whole
  topbar, `--rd-space-2` from each screen edge (the topbar is their containing block: the search box and the notices'
  wrapper stop being positioned under 768px; `components/shell-search.tsx`, `components/app-shell.tsx`); on a short or
  landscape screen each sheet stops `--rd-space-2` above the bottom edge: the notice list scrolls inside, and the
  search keeps its field and scrolls its results. From 768px the notices open under the bell (`top-pop`),
  `min(22rem, 80vw)` wide, and the search results under the field — or, where the topbar is too narrow for the field
  (720px of content or less), the field opens under the search icon, 18rem wide. `tests/topbar-narrow.spec.ts` checks
  320, 360 and 390px in ar and en.
- Return bar and outage bar (`components/app-shell.tsx`, `components/outage.tsx`): a strip over the page with its own
  warning look and a crimson button (the return bar).

## Page templates

### Inner pages

New screens compose `Desk` (`components/desk.tsx`: the page head), `FilterBar`, `Pane`, `Tabs`, `DataTable`, `Badge`,
`Stat` / `StatRow`, `EmptyState`, `Dialog`, and `RowMenu`. Spacing comes from `--rd-space-*`. Control height inside a
pane or filter is 34px.

- The desk column: a flex column 14px apart that fills the canvas. The page head is one wrapping row, the title
  (1.25rem bold, `text-page`) at the start and the action at the end, 8px apart, the lede (13px `--rd-muted`) on its
  own line under them, rising in when motion is allowed. The page's own action (`Desk`'s `action`) is the crimson
  button on the screen; the other head actions are secondary.
- List page: the title and one lede line, the filters (`FilterBar`), then the table card (`DataTable`, the pager
  under it). A list page opens with a lede under its title.
- Detail page (the number card, the user page, the company and package pages, the task ticket): the title (the thing's
  name, its state as a badge), the lede (what it belongs to), the figure or fact row, then `Tabs` above their content.
  Each page's own details are under [Screens](#screens).
- Create page (`features/catalog/add-steps.ts`): numbered steps, each a pane (a 24px round `--rd-accent-soft` number
  tag in 12px bold crimson), a provider query row, choices as `RadioCard`s, and the actions at the end (cancel then
  the action; each an equal share and 44px under 768px).
- Dialogs: a header, a scrolling body, and a footer (see `Dialog`).

### Report pages

The report pages (sales, profits, orders, balances, provider costs, activity log) share one layout from
`features/reports/report-kit.tsx`: the title and lede with «CSV» in the head (`CsvLink`), then
`data-slot="report-filters"` — the `Period` switch (`SegmentedToggle`, `data-slot="period"`: today / 7 days / 30 days
/ 3 months, the chosen one raised with a crimson underline; full width under 768px) beside the loose filter chips —,
three figure tiles with a meta line and no icon (`Stat` without `icon`; a red or green figure through `text-danger` /
`text-success`, a name as `STAT_NAME`), and the table. A package cell is the package over its company (muted, under
it); a share is a thin crimson bar beside its percentage. Balances have no period (they are a snapshot). Operations
and provider operations take the report layout.

### Finance and wallet pages

The finance and wallet pages share the design's wallet head (`WalletHead`): the balance tile leads (held, left to
sell, the ceiling as twenty ticks), money in (green) and out (red) over the chosen window, the movements with how many
were made by hand, then «الرصيد عبر الوقت» (a large `TrendLine`) with the 7 days / 30 days / 3 months switch
(`SegmentedToggle`) that every tile follows. Every ledger reads the reason as a tag (`data-slot="reason-tag"`,
`features/wallets/ledger-parts.tsx`, its `ReasonTone`: sale `leaf`, held `amber`, money back `alarm`, funding `plum`,
payment `leaf`, settlement and the rest `mute`, a line operation `amber`).

### Home layout

The home opens with the design's top: the head (the greeting is the title; date and layer the lede; the head's
«تمويل حساب» and crimson «تفعيل رقم»; the period switch at the end), the `AccountBand` (see Figures), then (not for
the branch) the last operations (`LastOperations`, the wider, at the reading start) beside the tasks waiting
(«مهام بانتظارك», `WaitingTasks`), side by side from 1000px (`features/desk/home-top.tsx`). The period's overview
follows with no heading, in two columns that stack their own cards (`features/desk/screens/home-screen.tsx`,
utilities since Tailwind migration T4.1), so nothing is stretched to a neighbour: the wide one (reading start) holds
top sellers (`TopCard`), most active (`ActiveCard`) and providers (`ProvidersCard`); the narrow one (reading end,
first in the page so a phone reads it first, `data-slot="home-side"`) holds numbers by status (`LinesCard`: a 112px
`Donut`, legend beside it, under it in a card below 340px), tasks (`TasksCard`) and the accounts summary
(`UsersCard`). There is no shortcuts card (spec 2026-11-09-admin-review, 7). Each
period card's change chip sits in its corner — up green, down red, against yesterday by this time or the same span of
last month, none over all time. Between 640 and 1099px the narrow column's cards pair up; one column under 640px,
where the lead figure and the fourth tile take full rows.

### Sign-in, password and two-step pages

Utilities since Tailwind migration T3.2 (`components/auth-frame.tsx`'s `authClass`, `components/auth-art.tsx`,
`features/auth/screens/login-screen.tsx`): the form on the reading side (brand row, title, the door as a crimson
outlined tag, inset fields with an icon, crimson «دخول» (the view's primary), raised passkey button), and a dark art
panel beside it (`components/auth-art.tsx`: the crimson tag rising from its corner, one line about the office, heading
and line in `--rd-login-ink` over the tag); stacked under 861px (`max-auth:`) with the art below. The door picker
(`components/doors.tsx`) is cards on `--rd-radius-panel`. The enrolment screens show the allowed methods only; a single
one is named («الطريقة المحددة لحسابك») instead of offered.

### Error and not-found screens

`app/error.tsx` and `app/not-found.tsx` draw the empty state (`EmptyState`, `tone="danger"` for the error) in a `Pane`
(`components/desk.tsx`, in a `DeskColumn`) inside the shell, with the way out in its `actions`: one row, centered; a
primary `Button` (`<Button asChild>` around the not-found `Link`) for the main way and the back link (utilities in
`app/error.tsx` since Tailwind migration T3.3: 32px, 44px at 720px and under, a hairline card in `--rd-ink-2`) for the
second.

## Screens

Graphite page details, matched to the prototype page by page (2026-11-09).

- Numbers table (as in the design): the number with its SIM mark; the package beside its company's cut-corner mark
  (`CompanyMark`) with the company under it; the point of sale; the status; «الأيام المتبقية» (`data-slot="days"` —
  crimson «ينتهي قريباً · N يوم» within the expiring window, «انتهى» past its end, the end date as the cell's title);
  the price.
- Page ledes: numbers and tasks have one line under the title, as in the design.
- Number card: the number is the title, with its status and what is left (crimson when it ends soon); under it the
  company · package · point of sale (a crimson link); no action buttons in the head (every operation is a card of
  «العمليات»); four cut-corner facts (package, ends on, price, last recharge); tabs العمليات / السجل (count) /
  التفاصيل; every operation a card (`data-slot="line-op"`, `features/lines/screens/line-card-screen.tsx`) — crimson
  mark, name, one line on what it does, a chevron that slides on hover; disconnect in danger. A card with keyboard
  focus draws a 2px crimson ring inside its edge, on its `::before` above the hover glow (an outline outside the card
  would be cut away by its `clip-path`); the ring follows the rounded corners and stops where the cut corner begins.
- Users list: the account's square mark with a crimson letter, the name over the login; the layer as an outlined tag
  in its own hue (`--rd-layer-*`).
- User page: four tabs — packages and prices, number operations, the account's numbers, access. Its head: a 48px
  cut-corner crimson mark, the name, the layer tag, the state; wallet actions are secondary; the facts as `Facts
  cards`. «الإعدادات والصلاحيات»: «إعدادات الحساب» open on top, «صلاحيات الحساب» folded under it (a `<details>`,
  `data-testid="access-fold"`); each grant a three-way `Segmented` (حسب الدور / مسموح / ممنوع), extra roles as toggle
  buttons (`ROLE_CHIP`, `aria-pressed`, D3; `features/accounts/screens/account-screen.tsx`).
- Tasks: status tabs above the filters (all, in progress, done, closed — counts from the overview of all time); each
  task a card row (`data-testid="task-card"`, `features/tasks/screens/tasks-screen.tsx`): a crimson cut-corner mark,
  the operation and its status, the number · company · package · point of sale under it, the amount, «استلام» or
  «فتح التذكرة», and ⋯.
- Task ticket: the operation and its state are the title, number · company · package the lede; the log is the wide
  side at the reading start, the details the narrow side, each its own card. On a ticket 36rem wide or narrower
  (`@container task-ticket`) the details sit above the log, at most 40% of the board high and scrolling inside it;
  the board then scrolls as one column, the log at its full length with the compose bar at its end (a message wider
  than the ticket scrolls sideways in the log). A task that went to a provider opens its details with the operation's
  block (`ProviderOperationPanel`, `features/tasks/components/provider-operation-panel.tsx`): a title and the phase
  as a `Badge` (see [Status tones](#status-tones)), one sentence, the amount with what became of it, then the
  decisions. The queue (`/tasks/decisions`) reuses the proposal card and one ruled
  row per operation (`data-testid="po-row"`, `features/tasks/screens/provider-decisions-screen.tsx`).
- Task ticket actions sit in the page head: «إكمال» is primary and shows its open form by a pressed state
  (`aria-pressed`), not by changing variant (ADR 0021 D13); take is primary too, so an unassigned task's head shows
  both, and the ticket's in-page forms keep their primary submits beside them (a named exception: see
  [Primary button](#primary-button)); release is secondary, «رفض» and «إلغاء» are the danger outline (D13); complete
  and reject open their form in the details column. Every action is `Button` (primary, secondary, danger).
- Provider «طريقة التنفيذ»: `ModeCards` (see Cards and dialogs of the catalog). The provider account page is the
  ledger and the matching as two tabs under the figure row, with CSV, edit credit and record payment in the head
  (record payment the primary; the matching tab's «مقارنة» stays primary beside it, a named exception).
- Companies list: a grid of cut-corner cards (`data-slot="company-card"`,
  `features/catalog/screens/companies-screen.tsx`) — the company's mark and an «eSIM» tag, the name (the whole card
  opens it), its SIM rules («19 خانة · تبدأ 8997202» or «بلا قيود»), then bold counts under a hairline; ⋯ in the
  corner. Short cards (company, fact, operation) sit two a row on a phone.
- Company page opens on «الرزم» (no card around it): the company's packages in one table (`CompanyPackages`,
  `features/catalog/company-packages.tsx`: facts, provider, prices, margin, the on/off switch; a provider filter; the
  name opens the package); the company's cut-corner mark beside its name; the lede reads «N رزمة · N مزود · eSIM
  مدعوم»; tabs الرزم / المزودون / الإعدادات. The company «الإعدادات» tab
  (`features/catalog/screens/company-screen.tsx`): blocks in one pane, each under a hairline — picture, SIM rules,
  eSIM (a `LiveSwitch`) (D2). Its «حفظ» stays primary beside the head's «إضافة رزمة» (a named exception).
- Packages list: the lede, a search box with its icon and placeholder, the provider and status chips standing above
  the list (`FilterBar loose`); companies fold as groups — mark, name over «N رزمة · M متوقفة», chevron at the far
  end — and the first opens with the page; rows 56px with the name over its facts, a square switch, a stopped
  package's row dim.
- Package page: the company's mark, «company · package» and whether it is for sale as the title, the switch beside it;
  provider and live numbers the lede; it opens on «سلسلة الأسعار»
  (`features/catalog/screens/package-sheet-screen.tsx`): the `ChainBoard` (see Cards and dialogs of the catalog) — one
  row per layer, the price edited in place, each layer's margin beside it, the branch's cost row first and tinted —
  with the eSIM price and the re-pricing as cards under it.
- Notices are card rows (`data-slot="notice-card"`, `features/notices/screens/notices-screen.tsx`: the group's mark,
  the title over its detail, the age, a small crimson diamond while unread, the unread row tinted) under «الكل / غير
  مقروءة» tabs.
- Roles are the design's matrix (`features/roles/screens/roles-screen.tsx`: a green tick tile per grant held,
  `data-testid="grant-on"`, an empty tile otherwise, a muted dash where the layer can never use it).
- The role dialog (`features/roles/screens/roles-screen.tsx`; the grouped design chosen from three, owner
  2026-11-11): the grants in three groups (`GRANT_GROUPS` in `lib/grants.ts`: viewing and accounting, daily work,
  accounts and transfers; a group with nothing the layer can use is left out), each with a leading rail — its name
  and how many are on, `2/3` — beside hairline rows; a row is a name and a `LiveSwitch` at its end, the whole row the
  target; an «on» name is ink 700, an «off» one muted, so state never rests on colour alone; the head carries the
  total («4 من 8 مفعّلة»). Under them the layer's session rules: two labelled fields side by side (`RuleSelects`,
  `features/auth/session-rules.tsx`)
  drawn exactly as every ordinary field — surface fill, 1px field border, 6px corners, 34px (44px on a phone),
  13px/600, a crimson edge and soft ring on focus — the text following the page's direction (no forced `dir`), the
  inherited value as the placeholder, the range inside at the end, red with a sentence when out of range, and «حفظ»
  waits. Never a column of tick boxes.
- The two-step rule (`features/auth/two-factor-policy.tsx`, owner 2026-11-11): a full-width `Segmented` (`fill`, 8px
  sides; Tailwind migration T3.2) — *optional | required* for a layer (a block under the session rules in the layer
  role dialog, titled like it), *as the layer | required | optional* for an account (a block in `UserSettingsPane`
  after the password) — and, only while «إلزامي» is chosen, the method list as the filter chip (`<FilterBar loose
  bare>` around a `<label>` + `Select`: name, then the value in a frame, 32px, opening the `Select` list — exactly the
  filters'). Under it: a state badge, a «إعادة تعيين التسجيل» outline button when enrolled, and one muted line «المطبّق
  الآن: …». SMS and email are hidden everywhere in the interface (`SHOWN_METHODS` in `two-factor-policy.tsx` = the app
  only, owner 2026-11-11; the API keeps them as a spare path), so with one method the list is not drawn at all.
- Settings: the account card has one «حفظ» for every field and a crimson square account mark; the two-step methods are
  `RadioCard`s (the chosen one outlined in crimson); sessions and passkeys are cards with a crimson device mark, the
  sign-in methods three across (utilities in `features/auth/sign-in-methods.tsx` and
  `features/auth/screens/settings-screen.tsx` since Tailwind migration T3.2).
- Ledgers: a ledger's movement type is a reason tag (`data-slot="reason-tag"`, see Finance and wallet pages).

## Known gaps

The gap inventory (removed 2026-11-17, in git history) is closed (Tailwind migration T6.4). What it found and the
slices did not close is listed here; each item keeps today's look until its own slice (and, where it changes the look,
the owner's choice).

- States outside `components/ui`: `NameField` has no disabled, invalid or no-match look and its «×» is 24px (32px under
  768px) (audit 3.10-16); `DateField` has no disabled field or days and no invalid look, and its button is 34px beside a
  44px field at 641–720px (3.2-08, 3.10-15); `Alert` has no warning or info tone (the outage bar draws its own); `Stat`
  has no lead variant or loading state (3.6-02, 3.9-*); `Donut` has no empty ring; the dialog has no busy submit look;
  the table's loading rows differ in height from real rows (3.4-19); clickable cards draw their states per screen
  (3.6-09); the file chooser has three shapes (3.5-27).
- Names and targets: the toast close is named «×» (`components/toast.tsx`, 3.10-20); the ⋯ trigger of `RowMenu` stays
  28px on touch and its icon is `--rd-faint` (3.2-09).
- The rail flyout and the filter drawer draw their own looks; moving the drawer onto `Sheet` would change its focus
  and scroll behaviour (3.6-06).
- Copies: hand-written `<dl>` ×2 beside `Facts` (`features/lines/line-details.tsx`,
  `features/tasks/components/provider-operation-panel.tsx`; 3.6-11); company marks by hand ×3 beside `CompanyMark`
  (3.6-08); hand-drawn `<svg>` icons beside lucide and the global `svg` base rule (3.1-06, 3.1-29, 3.6-04); legacy
  `.pane` / `.pane-head` / `.pane-body` / `.hint` markup beside `Pane` (3.6-17) and the three 44px base blocks
  (3.2-23); the step heads per screen (3.6-31).
- Contrast (owner's call, every field or every status text changes): the field border `--rd-field-line` is under 3:1
  on the sunken fill (3.10-04); light `--rd-success` and `--rd-warning` text on their soft fills are under 4.5:1
  (3.10-06, 3.10-07).
- Type: the selected tab's bold label widens it (3.7-20: keeping its width needs the label as data in
  `components/tabs.tsx`); positive letter spacing on Arabic and Hebrew text (sidebar titles, the table head, the
  language; 3.7-13).
- Names: the `--rd-primary-*` family still says "primary" for an ink fill (3.1-14: no owner name chosen).
- Smaller: callers still resize `Button` by class (the pager arrows' `h-7.5`; 3.5-20); direction-aware icons are
  `ltr:hidden` / `rtl:hidden` pairs and the flyout has two keyframes (3.6-27); the calendar days are 34px (40px under
  641px) (3.10-13); a badge tone may still be picked inline somewhere (3.6-16, not re-checked).
- Code comments: many components and screens still say which deleted sheet a value was ported from
  (`graphite.css`, `desk/frame.css`, `styles/ui.css` …) and a few say "the legacy rules still read" a handle. They
  record provenance; the rules they name now live in `app/tailwind.css` or in the utilities, and this file is the
  reference (Tailwind migration T7.1 left the code untouched). The shell's pointer-glow lookup
  (`components/app-shell.tsx`) still lists the deleted classes `.figure-tile`, `.shortcut-tile`, `.op-card` and
  `.op-tile` beside the live `data-slot` handles; they match nothing.
- Class names in this file: until T7.1 its controls, figures and Screens sections named deleted legacy classes as
  live markup (`.seg`, `.role-chip`, `.task-list`, `.po-panel`, `.co-card`, `.chain-step`, `.notice-list`,
  `.roles-matrix`, `.role-fields`, `.terms-group`, `.shortcut-grid`, `.stat-card`, `.donut-change`, `.filter-line`,
  `.bp-mark` and more). T7.1 replaced each with the component, file, `data-slot` or `data-testid` that draws it (checked
  by `rg` against `apps/web`); a class this file still names (`.pane`, `.pane-head`, `.pane-body`, `.desk`, `.stack`,
  `.stat-row`, `.price-pair`, `.hint`, `.dark`) is a live rule in `app/tailwind.css`, and `.btn`, `.badge` and the
  button context rules are named only to say they are gone. The descriptions were re-read against the code only where
  a name changed; the rest of Screens was not re-checked line by line.
- Not re-checked since the 2026-11-13 audit, treated as open: the per-screen type sets (section titles, menu items,
  counters, legends), the spacing rhythms, small crimson / success / warning text contrast, and the accessible names
  and live regions it listed. The finding ids are in the inventory's §8.4.
- Outside the identity (their own spec and the owner's choice; inventory §6 "Open, outside T6"): the button hierarchy
  rows not yet aligned with ADR 0021 D2 / D13 / D14, page templates and layout, responsive checks that need a width,
  direction of motion, and visual hierarchy.

Closed earlier (Phase 5, 2026-11-08): key/value had three hand-written shapes (now one `Facts` primitive with three
densities); the sidebar animated `width` (now the width glides and its contents fade); below 360px the topbar's
controls ran off the screen; radius literals (every radius is a scale step); company-mark contrast
(`tests/company-mark.spec.ts`).
