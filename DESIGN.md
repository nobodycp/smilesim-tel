# Smile Sim — Pearl

This is the visual source of truth, carried from account manager's Pearl system into this Next.js office. Calm, warm, RTL-first: off-white paper, ink-black primary actions, one logo-red accent, numbers that line up. `.cursor/rules/pearl-ui.mdc` points here.

The screens built so far still use the older blue tokens (`--bg`, `--accent`) in `apps/web/app/globals.css`. That set is legacy. New work and any screen you touch moves onto the tokens below. Do not add another blue.

## Identity

- Paper and ink. Warm off-white page, white surfaces, near-black text. Dark mode is the same system on warm blacks, never pure `#000`.
- Primary action is ink, not blue and not red.
- Logo red is the accent: dots, focus, and at most one special action on a screen. Errors are danger red, separate from the accent.
- Dense and quiet. Hairline borders, light shadows, compact tables.
- RTL first. Logical properties only.

## Tokens

Define both themes in `apps/web/app/globals.css`. Use the token, never the value.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--rd-bg` | `#fafaf8` | `#0b0b0a` | page |
| `--rd-surface` | `#ffffff` | `#151514` | cards, inputs |
| `--rd-surface-2` | `#f4f4f2` | `#1f1f1d` | headers, chips, skeletons |
| `--rd-line` | `#ececea` | `#2a2a27` | hairline borders |
| `--rd-field` | `#8a8a86` | `#74746e` | input borders |
| `--rd-ink` | `#0a0a0a` | `#f5f5f2` | text and primary fill |
| `--rd-muted` | `#6b6b68` | `#9a9a94` | secondary text |
| `--rd-accent` | `#d00000` | `#ff3b3b` | the one accent |
| `--rd-accent-soft` | `rgba(208,0,0,.10)` | `rgba(255,59,59,.15)` | accent tint |
| `--rd-on-accent` | `#ffffff` | `#0a0a0a` | text on accent |
| `--rd-primary-bg` / `--rd-primary-fg` | `#0a0a0a` / `#fff` | `#f5f5f2` / `#0a0a0a` | primary button |
| `--rd-success` / `--rd-success-soft` | `#0a7a3e` / `#e8f6ee` | `#4ade80` / `rgba(74,222,128,.12)` | active, paid |
| `--rd-warning` / `--rd-warning-soft` | `#c2410c` / `#fff0e9` | `#fbbf24` / `rgba(251,191,36,.12)` | pending |
| `--rd-danger` / `--rd-danger-soft` | `#b91c1c` / `#fdecec` | `#f87171` / `rgba(248,113,113,.12)` | failed, destructive |
| `--rd-shadow-card` | very light ink | inset hairline | cards |

## Type

Self-hosted or `next/font`, no extra Google stylesheet.

- Body: IBM Plex Sans Arabic.
- Headings: Noto Kufi Arabic.
- Numbers, money, dates, phone numbers: Inter Tight with tabular figures.

## Inner pages

The shell (sidebar and header) is outside this contract. New screens compose `.page-head`, `.filter-bar`, `.pane`, `.steps`, `.data`, `.badge`, `Dialog` (`components/dialog.tsx`), and `RowMenu` (`components/row-menu.tsx`). Spacing steps are 4, 8, 12, and 14. Control height inside a pane or filter is 34px, and 44px under 720px. Tables keep text and status at the start and numeric columns at the end, with `class="num"` on both the header and the cell. Identifiers that are Latin digits stay in `<bdi dir="ltr">`. The operations column is `class="row-actions"`. Contextual row actions are only the horizontal ellipsis in `RowMenu`. Dialogs use a header, a scrolling body, and a footer; `size` is `confirm`, `form`, or `wide`. Checkboxes stay 16px inside `label.check` and never inherit text-field height. Motion on menus and dialogs is opacity and a short translate, and `prefers-reduced-motion` already collapses it.

Body type is Tajawal, with IBM Plex Sans Hebrew for Hebrew. That choice stays; do not swap in another family.

## Components

One of each. A new page uses these, it does not invent a sibling.

- Page: title, one muted lede, then the content. No second heading that repeats the title.
- Card: white surface, hairline, 12px radius, `--rd-shadow-card`.
- Table: quiet header, hairline rows, text at the reading start, numbers tabular and aligned to the reading end.
- Primary button: ink fill. One per group. The single special action may be accent. Destructive is an outline in danger, not a filled red.
- Badge: label plus a dot. Active, pending, danger, neutral.
- Feedback: one alert line for an error, one for a success. No browser `alert` for success.

## Motion and access

150–450ms, transform and opacity only. Targets at least 44px. Text contrast at least 4.5:1. Visible focus. Check light and dark.
