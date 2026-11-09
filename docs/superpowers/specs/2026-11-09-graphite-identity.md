# Graphite — the new visual identity and home layout

Date: 2026-11-09 · Owner approved: direction 08 "Night Desk · Graphite" v3 (`design/08-nd-graphite`, artifact
DDT5hZjbV8EKsP7jGXtiK1). Owner, 2026-11-09: "the old visual identity — I need nothing from it; re-arrange the home page
from scratch too".

## Goal

Replace Pearl (warm paper, ink, logo red, 18px radii, Tajawal) with Graphite everywhere, and give the home page a new
arrangement. Behaviour, endpoints, response shapes, copy and permissions stay as they are.

## Identity

- **Dark is the default** (a browser with no saved choice gets dark); light is the same system on cool paper. The theme
  toggle and its cookie keep working as today.
- Neutral graphite surfaces, one crimson thread (`--rd-accent`): dark `#ff4d63`, light `#d93049`. Primary action stays
  ink-on-canvas (white on dark, black on light). Status colours from Night Desk (green / amber / red, softened in dark).
- Lines are white or ink at 6–13% alpha, not solid greys.
- Radii tighten: 4–10px (cards 8px), pills stay round. The figure tiles and fact cards carry the tag's **cut corner**
  (clip-path on the inline-end top corner).
- Font: **Noto Kufi Arabic** for Arabic and Latin (`next/font`), IBM Plex Sans Hebrew stays for Hebrew. Latin digits
  only, tabular, as today.
- Motion (only under `prefers-reduced-motion: no-preference`): cards and table rows rise in with a short stagger when a
  page opens; figure tiles lift on hover with a soft glow that follows the pointer; sparklines draw in.

## Shell

- **Sidebar**: same colour as the canvas, a hairline at its edge. The current item is ink text with a 2px crimson bar at
  the inline start; hover is a raised fill. Collapsing moves to a round handle on the sidebar's edge (and the `[` key);
  the collapsed rail is 76px of icons. Under 860px the sidebar is the drawer, as today.
- **Topbar**: the greeting leaves the topbar. Its place is the **path**: `⌂ / <group> / <list> / <item>` — the home
  button, the sidebar group's title, the list, then each level below it (names from `useCrumbs`). Every part but the
  last is a link; `Alt+↑` goes one level up. A page outside the sidebar shows `⌂ / <its title>`. The back link and the
  in-canvas trail above pages are removed. On the phone the path takes its own full-width row under the icons.
- Search keeps its behaviour; it reads as a command box with a `/` hint.

## Home (every layer)

Top to bottom:

1. Head: «الرئيسية», the greeting and date as the lede (moved from the topbar), the period switch at the end.
2. The offers strip (unchanged behaviour) and the provider-problem banner.
3. **Figure band**: four cut-corner tiles — sales (the lead tile: the largest figure, with the period's trend as a
   sparkline), my profit, net (refunds as its meta line), number of sales.
4. **Middle row** (three columns from 1200px, two from 760px): numbers by status (donut), tasks by status (meters, with
   the oldest open task), and «اختصارات» as a grid of square action tiles (was a row of pills).
5. **Rankings row**: top sellers (tabs), most active accounts (tabs), and the accounts summary — the last two not for
   the point of sale.
6. Providers table, full width (branch only, as today).
7. Last operations (wide) beside the board (narrow), as today.

Every card keeps its links (donut slices, meters, counts) and its empty and failed states.

## Out of scope

Inner pages keep their structure; they change only through the shared tokens and components (tables get zebra rows
and a quieter head; tabs, buttons, inputs and badges follow the new tokens). Page-by-page refinements are later slices.

## Acceptance

- ar / en, light / dark, 1440px and 390px: no horizontal scroll, no overlap, 4.5:1 text contrast.
- The path names each level correctly on numbers → number, users → user, providers → provider → package, reports.
- Gate green: lint, check:copy, typecheck, test:api, build, e2e.

## Revision 2026-11-09 (owner review)

The owner rejected the first rollout's home ("very bad") and asked for every detail of the approved sidebar. Now:
the sidebar is the design's (hover flyouts when folded, the account and sign-out at its foot, groups that slide
open, diamond marks); it becomes the drawer under 900px. The home is two stacked columns under the figure band
(see DESIGN.md → Home layout); each figure tile has a meta line. Every change is checked by screenshots at 360, 390,
768, 1024, 1280, 1440 and 1920px, ar/en, light/dark, branch and point of sale, before it is reported.
