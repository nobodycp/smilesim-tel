# Hotspot Store identity reflector — spec

## Why

The hand-rolled Pearl CSS rebuild (Phases 1–3: shell/home, tables, detail pages, all on `--rd-*`
tokens with no framework) is being set aside. The owner has a separate, more deliberately designed
project, `hotspot-store` (`/Users/nobody1/Desktop/Digtail teach/hotspot-store/frontend`), and wants
its whole presentation layer — filters, buttons, the row-actions dropdown, back button, pagination,
tables, selects, skeleton loading, overall layout density — mirrored into `smilesim-tel` as a
one-to-one copy **in presentation, not in colour**. Pearl's existing light/dark colour tokens stay;
everything else about how things look and move should match hotspot-store.

This supersedes Phases 1–3's CSS output. Nothing from those phases is preserved once a page is
migrated under this spec; `desk.css`/`shell.css`/`dialog.css` and friends are legacy, removed
page-by-page as their replacements land, not kept in parallel.

## Goal

Adopt hotspot-store's actual frontend stack and component source (Tailwind + its `components/ui`
primitives + `lucide-react`) inside `smilesim-tel`, re-pointing hotspot-store's semantic CSS
variables at Pearl's current colour values (light and dark), so every page ends up visually
identical in structure/spacing/motion/shape to hotspot-store, in Pearl's own palette.

## Non-goals

- No backend or `lib/api.ts` changes. No business-logic changes on any page touched.
- hotspot-store is Arabic-only (hardcoded `dir="rtl"`). `smilesim-tel` stays fully bilingual
  (ar/en/he) with real direction switching — this spec adapts hotspot-store's RTL-aware patterns
  (the ones already written with `rtl:`/`ltr:` Tailwind variants, or that read
  `document.documentElement.dir` at runtime) rather than its hardcoded assumption.
  Hebrew/IBM Plex Sans Hebrew handling is untouched; hotspot-store has no equivalent and this spec
  doesn't change Pearl's existing Hebrew-font rule.
- Not deciding or wiring an eventual page-by-page rollout in detail. This spec and the plan that
  follows it cover **one slice only**: the shared foundation (tokens + Tailwind + primitives) and
  one pilot page. Later pages get their own specs/plans once this slice is verified, per
  `work-plan.mdc`.
- Not touching `/login` or the door picker (out of scope for this slice; revisit once the pilot is
  approved).

## Decisions

**D1 — Stack.** Add Tailwind (`darkMode: "class"`, matching hotspot-store's config) and
`lucide-react` to `apps/web`. Add a `cn` helper (`clsx` + `tailwind-merge`, matching hotspot-store's
`lib/utils.ts`) since every ported component uses it. Keep Next.js/React as is — no routing or data
layer change.

**D2 — Token mapping.** hotspot-store's components read a specific variable set. Each is redefined
in `apps/web/app/styles/tokens.css` to resolve to Pearl's existing value, both themes:

| hotspot-store token | Resolves to (Pearl) | Note |
|---|---|---|
| `--bg` | `--rd-bg` | |
| `--surface` | `--rd-surface` | |
| `--surface-2` | `--rd-surface-2` | |
| `--surface-3` | `--rd-surface-3` | |
| `--line` | `--rd-line` | |
| `--line-soft` | `--rd-line-soft` | |
| `--ink` | `--rd-ink` | |
| `--ink-2` | `--rd-ink-2` | |
| `--ink-3` | `--rd-muted` | hotspot-store has 4 ink steps, Pearl has 2 extra named steps — this is the closest semantic match |
| `--ink-4` | `--rd-faint` | |
| `--accent` | `--rd-primary-bg` | see D3 — hotspot-store's "accent" is its primary/CTA colour, not a rare highlight |
| `--accent-2` | `--rd-primary-hover` | |
| `--accent-fg` | `--rd-primary-fg` | |
| `--accent-soft` | derived: `color-mix(in srgb, var(--rd-primary-bg) 10%, transparent)` | used by default badges |
| `--good` / `--good-bg` | `--rd-success` / `--rd-success-soft` | |
| `--warn` / `--warn-bg` | `--rd-warning` / `--rd-warning-soft` | |
| `--bad` / `--bad-bg` | `--rd-danger` / `--rd-danger-soft` | |
| `--focus-ring` | `--rd-focus` | |
| `--shadow-card` / `--shadow-pop` | `--rd-shadow-card` / `--rd-shadow-pop` | |
| `--info` / `--info-bg`, `--violet` / `--violet-bg` | new Pearl tokens, both themes | only used by `Badge`'s `info`/`violet` variants; add as genuinely new tokens per `pearl-ui.mdc` ("a new colour is a new token in both themes, listed in DESIGN.md") |

`--rd-accent` (logo red) is **not** touched by this mapping and keeps its existing, separate,
rare use (brand mark, the one accent per screen) — it is not what hotspot-store's ported
components call "accent".

**D3 — Accent/primary semantics.** Confirmed with the owner: hotspot-store's `--accent` is used
pervasively (primary buttons, active pagination page, focus rings, default badge, info icons in
the filter toolbar) — it plays the role Pearl calls "primary action". Mapping it to
`--rd-primary-bg` (ink/near-black) keeps Pearl's own rule ("primary action is ink, not red") intact
while still reproducing hotspot-store's look structurally (one consistently-coloured interactive
accent, just not red).

**D4 — Shape.** Adopt hotspot-store's radius scale for every ported component: `rounded-lg` =
`0.5rem`, `rounded-xl` = `0.625rem` (Tailwind `borderRadius.lg`/`xl` overrides, matching
hotspot-store's `tailwind.config.ts`). This replaces Pearl's current `--rd-radius-lg: 1.125rem` on
ported surfaces; `--rd-radius-lg` itself is left alone for any not-yet-migrated legacy CSS still
reading it.

**D5 — Typography.** No change needed: hotspot-store already loads Tajawal via
`next/font/google` for its base font, same as Pearl. Numbers keep `font-variant-numeric:
tabular-nums` per the existing rule. Hebrew stays on IBM Plex Sans Hebrew, untouched.

**D6 — Icons.** Adopt `lucide-react` everywhere a ported component uses it internally
(`ActionMenu`, `Select`, `Pagination`, `Modal`, `Skeleton` variants, etc. all import it directly).
The current hand-rolled `components/icon.tsx` (`IconName` union + inline SVG paths) is retired
page-by-page as each caller migrates; it is not deleted in this slice since pages outside the pilot
still use it.

**D7 — Component approach: reskin-in-place, not API replacement.** Several current components are
already architecturally equivalent to their hotspot-store counterparts (portal, focus trap,
outside-click/Escape, RTL-aware positioning). For these, keep the existing component **name, file,
and public API** (so the ~dozens of call sites across the app don't need to change in this slice or
later ones) and replace only their internals/markup/CSS to match hotspot-store's version:

| Current component | hotspot-store reference | Treatment |
|---|---|---|
| `components/dialog.tsx` (`Dialog`) | `components/ui/modal.tsx` | Reskin: rounded-xl panel, border-bottom header with lucide `X` close, backdrop blur, bottom-sheet on mobile / centered on desktop. Keep `open/title/closeLabel/onClose/error/children/footer/size` API — `size` keeps mapping to `confirm`/`form`/`wide`. |
| `components/row-menu.tsx` (`RowMenu`) | `components/ui/action-menu.tsx` | Reskin: lucide `MoreHorizontal` trigger, `rounded-lg`/`shadow-pop` panel, hotspot-store's hover/open states. Keep existing portal positioning, keyboard nav (arrow/Home/End — hotspot-store's version doesn't even have this; keep the better one), and the `RowAction[]` API. |
| `components/filter-bar.tsx` (`FilterBar`) | `dashboard-filters-toolbar/toolbar.tsx` (pattern only) | Reskin only: compact one-line row, `card`-style shell, trailing clear button styled as hotspot-store's `ClearButton`. Do **not** port the full `DashboardFiltersToolbar` (period presets, chips, debounced search) — `smilesim-tel`'s filters are plain label+input/select pairs today and don't need that machinery. Keep the existing `children`/`onClear`/`clearLabel` API. |
| `components/empty-state.tsx` (`EmptyState`) | `components/ui/empty-state.tsx` | Reskin only; keep `children/text/icon` API, swap `icon.tsx` lookup for a `lucide-react` icon prop once the caller migrates. |
| `components/loading.tsx` (`TableSkeleton`, `Spinner`, `PageSkeleton`) | `components/ui/skeleton.tsx` | Reskin: real shimmer animation (gradient translate, matching hotspot-store's `@keyframes shimmer`) replacing the current flat-colour skeleton bars. Keep existing `rows`/`columns` API. |

**D8 — Components ported fresh (no current equivalent).** `Button`, `Select`, `Table` (+
`THead`/`TBody`/`Tr`/`Th`/`Td`/`TdLabel`), `Card` (+ sub-parts), `Badge`, `Pagination` are new
additions — `smilesim-tel` has no single reusable component for these today (buttons are plain
`<button className="primary|secondary|danger">`, selects are bare `<select>`, tables are bare
`<table className="data">`). Port these from hotspot-store's `components/ui/*.tsx` directly, adapted
to read from the mapped tokens. `Pagination` is ported in this slice (so it exists for later pages)
but is **not wired into the pilot page** — see D10.

**D9 — Dead weight.** `RowAction`'s `RowIcon` glyph set inside `row-menu.tsx` and `icon.tsx` itself
are not deleted in this slice (still used elsewhere); the plan only removes CSS/markup actually
replaced by the pilot page's migration.

**D10 — Pilot page: `/users`.** Chosen because it exercises nearly every primitive in scope in one
page: `FilterBar` (text input + select), `.data` table with row actions, `RowMenu`, `Dialog` (both
the create-account form and the per-row operation dialog), primary/secondary/danger buttons,
`.badge`, and `TableSkeleton` while loading. It does **not** use pagination (it loads the full list)
— `Pagination` is ported as a standing primitive in this slice but wiring it into any page is
deferred to whichever later page-slice actually needs it. Note for that later decision:
`smilesim-tel` currently favours a "load more" pattern elsewhere (`components/load-more.tsx`) rather
than hotspot-store's page-number pagination; reconciling the two interaction models is explicitly
left open for that future slice, not decided here.

`/users`'s status pill (`.badge` / `.badge.pending`, per `content-ui.mdc`) migrates to the new
`Badge` component from D8. Exact variant per status value (e.g. "account open" → `success` or the
ink-primary `default`, "frozen" → `warning` or `muted`) is an implementation-time call, made once
and then recorded in `DESIGN.md` (D12) as the standing status→variant mapping for later pages to
reuse, not re-decided per page.

**D11 — Sequencing.** This spec and its plan cover Foundation + Pilot only:
1. Tailwind/PostCSS setup, `cn` helper, token mapping (D2–D4) in `tokens.css`/new Tailwind config.
2. Port/reskin the components in D7 and D8.
3. Migrate `/users` to use them, end to end, removing the CSS classes it stops using.
4. Verify: `tsc`, `next build`, visual screenshots (ar/en/he × light/dark), both wide (~1440px) and
   narrow viewports, per `screen-size.mdc` and `direction-theme.mdc`.

Once the owner has seen `/users` rendered and approved it, later slices (shell/topbar/sidebar, the
rest of the list pages, the detail pages, forms/dialogs elsewhere) get their own specs/plans in
turn — not detailed here.

**D12 — `DESIGN.md`.** Gets a new section documenting the adopted stack (Tailwind + lucide-react),
the full token-mapping table from D2, and the shape/radius rule from D4, once the pilot lands —
this becomes the new source of truth section, alongside (not replacing, until later slices migrate
the rest) the existing Pearl identity section.

## Risks / things to watch in the pilot

- Tailwind's `@layer base` can strip bare `.dark { ... }` blocks (hotspot-store's own `globals.css`
  has a comment about this) — the token redefinitions must stay outside any `@layer`, same as
  hotspot-store does it.
- `next build` is known to rewrite `apps/web/tsconfig.json` as a side effect (seen repeatedly in
  Phases 1–3) — revert it after every build, confirm clean before each commit.
- `ActionMenu`/`RowMenu`'s RTL positioning must be re-verified by hand in all three languages once
  reskinned, not assumed from reading the source.
