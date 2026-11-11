# Smile Sim — Graphite

This is the visual source of truth (spec `docs/superpowers/specs/2026-11-09-graphite-identity.md`, from direction 08
"Night Desk · Graphite" in `design/`). The
operations desk after hours: neutral graphite surfaces, one crimson thread, sharp tag-cut corners, dense rows, Latin
digits. `.cursor/rules/smilesim-ui.mdc` points here.

All CSS reads `--rd-*` tokens. Do not add another accent colour.

## Identity

- **Dark is the default** (a browser with no saved choice); light is the same system on cool paper. The theme toggle and
  its cookie work as before.
- Graphite surfaces, never pure `#000`. Lines are white or ink at 5–8% alpha.
- Primary action is ink on the canvas (white on dark, black on light). The crimson accent (`--rd-accent`) is the thread:
  the current nav item's bar and icon, the lead figure tile, sparklines, focus rings, the brand tile, and at most one
  special action on a screen. Errors are `--rd-danger`, separate from the accent.
- The tag's **cut corner** (`--rd-cut`, 12px, clip-path on the inline-end top corner) marks figure tiles and the brand
  tile.
- Dense and quiet. Hairlines, almost no shadow on dark, compact zebra tables.
- RTL first. Logical properties only.
- The brand is data, not a drawing. A saved site identity (`/branding`, owner only) replaces the brand tile in the
  sidebar, the drawer, and the sign-in lockup with `BrandLogo`, and sets the tab title and icon. Without one, the
  crimson tile with the signal glyph and the name stay. The logo keeps a browser-derived dark copy
  (`.brand-logo-light` / `.brand-logo-dark`).
- Sidebar (ported from `design/night-desk-family`): the canvas colour with a hairline at its edge; a brand row on top
  (the crimson cut-corner tile, name, door), sections with small muted titles, 40px items (icon 19px) — the current
  page is ink with a 2px crimson bar and a crimson icon, hover is `--rd-surface-2`. A folding group (`.nav-group`, e.g.
  «التقارير») slides its pages open under a hairline, each page marked by a small diamond that lights crimson when
  current. The foot holds the account (`.side-user`: avatar, name, layer → `/settings`) and «تسجيل الخروج». The round
  `.side-handle` shows on hover at the edge (and the `[` key) and folds the sidebar to a 76px rail: names fade, section
  titles become hairlines, and hovering an icon shows its name in a `.side-flyout` — a group shows its pages as a small
  menu there. The width glides (320ms). Under 900px the sidebar is the drawer (menu button in the topbar).
- Topbar: the **path** (`ShellPath`, `components/crumbs.tsx`) at the reading start — `⌂ / section / list / item`;
  section titles plain, the levels above the page links, the page in ink; `Alt+↑` goes one level up. There is no back
  button. Then, at the end: «ابحث أو انتقل» (`ShellSearch`: pages by name, then accounts and numbers; `/`, Ctrl K or
  ⌘K) on an inset field, the wallet chip (raised, balance only, crimson mark), notices and the theme as bare icons.
  The account and the language are not in the topbar: they sit at the sidebar's foot (the drawer's foot on a phone).
  Under 900px the path takes its own full-width row under the icons.
- Sign-in, password and two-step pages: `.gauth` — the form on the reading side (brand row, title, the door as a
  crimson outlined tag, inset fields with an icon, ink «دخول», raised passkey button), and a dark art panel beside it
  (`components/auth-art.tsx`: the crimson tag rising from its corner, one line about the office); stacked under 860px
  with the art below.
- Filters (`FilterBar`): chips in one wrapping row on the top edge of the table card below — the field's name on a
  raised segment, the field beside it (as wide as its value), crimson once it holds a value; «مسح» in crimson at the
  end. Pressing a chip opens the design's own list under it (`.filter-pop`: raised, 34px rows, the chosen one in
  crimson with a tick), not the browser's; the `<select>` stays the field for the keyboard and assistive tech. Under 768px only
  «كل الفلاتر» shows; it opens the fields in a drawer from the inline end, with «عرض النتائج».
- Tables: no band behind the head, 46px zebra rows, every cell on one line (a long text column is `cell: 'wrap'`),
  the table scrolls inside its card; the pager is a hairline row with square page numbers, the current one ink.
- The page's own action (`.page-head` primary button) is the crimson button on the screen.
- Numbers table (as in the design): the number with its SIM mark; the package beside its company's cut-corner mark
  (`.co-mark`, the company picture or its letters on `markColor`) with the company under it; the point of sale; the
  status; «الأيام المتبقية» (`.days` — crimson «ينتهي قريباً · N يوم» within the expiring window, «انتهى» past its
  end, the end date as the cell's title); the price.
- Shell details: the current sidebar page sits on `--rd-surface-2` with the crimson thread; the fold handle stays in
  sight (75%); a crimson hairline under the topbar; the path in an inset box; the wallet balance in ink; unread
  notices as a glowing crimson dot on the bell; the brand row reads «door · layer».
- Users list: the account's square mark with a crimson letter, the name over the login; the layer as an outlined tag
  in its own hue (`--rd-layer-*`).
- Tasks: status tabs above the filters (all, in progress, done, closed — counts from the overview of all time); each
  task a card row (`.task-list`): a crimson cut-corner mark, the operation and its status, the number · company ·
  package · point of sale under it, the amount, «استلام» or «فتح التذكرة», and ⋯.
- Page ledes: numbers and tasks have one line under the title, as in the design.
- Number card: the number is the title, with its status and what is left (crimson when it ends soon); under it the
  company · package · point of sale (a crimson link); «شحن» and «تمديد» (crimson) beside the title; four cut-corner
  facts (package, ends on, price, last recharge); tabs العمليات / السجل (count) / التفاصيل; every operation a
  `.line-op` card — crimson mark, name, one line on what it does, a chevron that slides on hover; disconnect in danger.
- Folded sidebar: pressing or hovering a group (التقارير) opens its pages in the flyout menu; it never leaves the page.
- User page head: a 48px cut-corner crimson mark, the name, the layer tag, the state; wallet actions are secondary.
- Task ticket: the operation and its state are the title, number · company · package the lede; the log is the wide
  side at the reading start, the details the narrow side, each its own card.
- Provider «طريقة التنفيذ»: `ModeCards` (`components/mode-cards.tsx`) — one cut-corner card per operation with a
  three-way segmented control (مباشر / مهمة فرع / متوقف) that spans the card in three equal parts, so longer languages
  never spill past its edge; a stopped one dims. Cards are at least 250px wide.
- Figure cards (`.stat-row`): four cards sit in one row when they fit and two by two from 768 to 1100px, never three
  and one; under 768px an odd last card spans the row. A name as a figure (`.stat-name`) starts at the reading start.
- A yes/no filter in `FilterBar` (e.g. «السالب فقط») is a toggle chip: the chip lights when on; the checkbox stays
  over it, invisible, for keyboards and screen readers.
- An empty table that keeps its head shows its empty block at its own height under the head (never cut off).
- The package price chain (`ChainBoard`, `.chain-grid`): one table row per layer — the branch's cost first, tinted —, the subscription and the renewal side by side, each price with its margin over the layer above; the eSIM price and the re-pricing sit as two cards under it (D6).
- The user page's «الإعدادات والصلاحيات»: «إعدادات الحساب» open on top, «صلاحيات الحساب» folded (`.inherit-fold`) under it; each grant a three-way `.seg` (حسب الدور / مسموح / ممنوع), extra roles as `.role-chip` toggles (D3).
- The company «الإعدادات» tab: `.settings-block`s — picture, SIM rules, eSIM (a `LiveSwitch`) (D2).
- Every primary button is crimson, in both themes (`.ui-btn.ui-btn-primary`, the login's «دخول», the chosen page number, the package picker's button): a page's main action, a dialog's «حفظ» / «تفعيل», a form's submit. The other head actions are secondary, the boxed ⋯ drawn the same. A form's submit is the primary button at its default size, never a small or secondary one.
- Tabs sit above their content, never inside its card, on every page.
- Dates are `DateField` (`components/date-field.tsx`): a `YYYY-MM-DD` field and the system's month — never
  `type="date"`. A file is chosen through a system button over a hidden input, with the chosen name beside it.
- Tables: the actions column's head is for readers only; a column with no words in its head does not sort.
- The role dialog (`features/roles/screens/roles-screen.tsx`; the grouped design chosen from three, owner 2026-11-11): the grants in three groups (`GRANT_GROUPS` in `lib/grants.ts`: viewing and accounting, daily work, accounts and transfers; a group with nothing the layer can use is left out), each with a leading rail — its name and how many are on, `2/3` — beside hairline rows; a row is a name and a `LiveSwitch` at its end, the whole row the target; an «on» name is ink 700, an «off» one muted, so state never rests on colour alone; the head carries the total («4 من 8 مفعّلة»). Under them the layer's session rules: two labelled fields side by side (`.role-fields`) drawn exactly as every ordinary field — surface fill, 1px field border, 6px corners, 34px (44px on a phone), 13px/600, a crimson edge and soft ring on focus — the text following the page's direction (no forced `dir`), the inherited value as the placeholder, the range inside at the end, red with a sentence when out of range, and «حفظ» waits. Never a column of tick boxes.
- The two-step rule (`features/auth/two-factor-policy.tsx`, owner 2026-11-11): a full-width `.seg.role-seg` — *optional | required* for a layer (a block under the session rules in the layer role dialog, titled like it), *as the layer | required | optional* for an account (a block in `UserSettingsPane` after the password) — and, only while «إلزامي» is chosen, a labelled method list (`.role-field` + `Select`, bordered like the session fields, never brighter). Under it: a state badge, a «إعادة تعيين التسجيل» outline button when enrolled, and one muted line «المطبّق الآن: …». The enrolment screens show the allowed methods only; a single one is named («الطريقة المحددة لحسابك») instead of offered.
- A count or a duration is typed, not picked from a list: a number field without the browser's spin arrows, its
  range under it (red with the field's edge while out of range), the inherited value as its placeholder — the session
  rules (sessions allowed, idle hours) on a role and on an account (owner 2026-11-11).
- Buttons (owner 2026-11-11): every action is `Button` or `buttonClass` — the task ticket's take, release, complete,
  reject and cancel too (primary, secondary, danger); a list row opens from its own link and its ⋯ menu, with at most
  one primary button of its own («أخذ المهمة»).
- Saved messages are toasts (`components/toast.tsx` `useToasts`, fed by `PageAlert`'s note): stacked in the
  reading-end bottom corner over the page, a green edge, ×, gone after 4.6s; nothing on the page moves. Errors stay in
  the page. A switch beside its state word in a table keeps the word's width, so the columns do not move.
- Sorting: every `DataTable` header sorts; a cursor list (`PagedTable`) reads every page (up to 2000 rows) on the first
  header click and then sorts and pages the whole set.
- Phones (under 640px, D7): a `DataTable` row is a card — the first cell its title, every other value under its column's name (`td[data-label]`) two to a row, ⋯ in the corner; the task and notice lists and the roles matrix keep their own layout. Tab strips wrap so every tab is in view; the pager's page buttons and page-size select are 40px; short cards (company, fact, operation) sit two a row; a run-mode card puts its mark beside its name.
- Company page and package groups: the company's cut-corner mark beside its name.
- White on crimson: the sidebar count, the notice dot and the page's own action.
- Task ticket actions sit in the page head (take / complete in ink, reject / cancel outlined in danger); complete and
  reject open their form in the details column.
- Company page opens on «الرزم» (no card around it): the company's packages as `.line-op` cards that open each
  package; the lede reads «N رزمة · N مزود · eSIM مدعوم»; tabs الرزم / قواعد الشريحة / المزودون.
- Companies list: a grid of cut-corner `.co-card`s — the company's mark and an «eSIM» tag, the name (the whole card
  opens it), its SIM rules («19 خانة · تبدأ 8997202» or «بلا قيود»), then bold counts under a hairline; ⋯ in the corner.
- Packages list: the lede, a search box with its icon and placeholder, the provider and status chips standing above
  the list (`FilterBar loose`); companies fold as groups — mark, name over «N رزمة · M متوقفة», chevron at the far
  end — and the first opens with the page; rows 56px with the name over its facts, a square switch, a stopped
  package's row dim.
- Package page opens on «سلسلة الأسعار»: five steps across per group (`.chain-step`), the price edited in place, each
  layer's margin under it; the for-sale state and the switch beside the title.
- Money: the shekel sign small and quiet after the figure (`.money .cur`); the text still reads «12.50 ₪».
- A chip that holds a value shows «×» (pointer shortcut; the field's «الكل» does the same from the keyboard);
  «مسح» shows only once something is filtered.
- Settings: the two-step methods are cards to choose (`.method-card`, the chosen one outlined in crimson); sessions
  and passkeys are cards with a crimson device mark.
- Finance and wallet (`WalletHead`): a figure band — the balance leads (held, available to sell, its 30-day
  sparkline), money in and out over 30 days, the entries with this account's profit — then the ceiling's cards, then
  the balance over time with a 7 / 30 days switch.
- Package page: the company's mark, «company · package» and whether it is for sale as the title; provider and live
  numbers the lede; the price chain as a row of cut-corner steps per group, the branch's cost first in crimson.
- Copy: every Arabic string uses Latin digits (no ٠–٩).
- Sidebar counts: `.nav-count`, a small crimson square at the end of the item (a corner mark on the folded rail) —
  the open tasks beside «المهام», from `/office/home` `openTasks`.

## Stylesheets

`apps/web/app/globals.css` is the only file `layout.tsx` imports. It `@import`s `apps/web/app/styles/*.css` in cascade order. Do not reorder the imports: several rules rely on coming later at equal specificity.

| Order | File | Holds |
|---|---|---|
| 1 | `tokens.css` | every `--rd-*` token, light and dark |
| 2 | `base.css` | reset, element defaults, default SVG `stroke-width: 1.9`, `.icon-btn`, language switch, brand mark, motion opt-in |
| 3 | `doors.css` | door picker on the bare host |
| 4 | `auth.css` | sign-in frame |
| 5 | `forms.css` | page type, fields, `.error` / `.note` |
| 6 | `shell.css` | sidebar, drawer, topbar, shell panels, search, notices, wallet chip |
| 7 | `desk/*.css` | inner pages, one file per owner, imported in this order: `frame` (canvas, desk layout and scroll model, page head, back link, `.stack`, banners, `.sr-only`), `pane` (pane, sheet, `.steps`, `.seg`, field and switch rows, `.check`), `table` (`.data`, sort header, row actions, money, account and kind cells, pager), `filters` (filter bar, table search, period chips), `components` (EmptyState, skeletons, spinner, Stat, LiveSwitch, operation cards, outage and return bars), then the pages: `numbers`, `tasks`, `users`, `packages`, `home`, `settings`, `branding`. Shared files come first, so a page file can refine them at equal specificity; a rule belongs in the file of the class its selector is about. |
| 8 | `dialog.css` | toast, `Dialog`, `.perm-grid`, `.op-blocks`, `RowMenu` |
| 9 | `controls.css` | the system's checkbox and radio (`appearance: none`, 18px, crimson when on), last so it beats every `input` height rule |
| 10 | `responsive.css` | shell and layout breakpoints, the 44px touch-target block |
| 11 | `ui.css` | the `components/ui` primitives (`.ui-btn*`, `.ui-badge*`, `.ui-select*`, `.ui-pager*`) and the direction helpers `.only-rtl`, `.only-ltr`, `.flip-ltr` |
| 12 | `graphite.css` | Graphite on the shared parts of inner pages (G4): square segmented tabs lit underneath, raised secondary buttons, inset fields (`--rd-sunken`), diamond status marks on `Badge dot`, cut-corner `Stat` and fact cards with the pointer light, number-card action tiles, the dialog's crimson thread and cut-corner mark, dense table heads, filter bars that become a grid of labelled fields under 1280px, one-line table cells on a phone, rise-in and lift motion. It overrides the older sheets' look only. |

## Tokens

Both themes are defined in `apps/web/app/styles/tokens.css`. Use the token, never the value. No hex or `rgba()` outside that file.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--rd-bg` | `#f5f5f4` | `#111213` | page |
| `--rd-surface` | `#ffffff` | `#18191b` | cards, inputs, menus |
| `--rd-surface-2` | `#efefee` | `#1f2023` | headers, chips, hover rows, active nav |
| `--rd-surface-3` | `#e6e6e4` | `#27282b` | skeletons, pressed or hovered icon buttons |
| `--rd-sunken` | `#ebebea` | `#0c0d0e` | fields and search boxes, a step below the surface |
| `--rd-line` | ink at 8% | white at 7% | hairline borders |
| `--rd-line-soft` | ink at 5% | white at 4.5% | dividers inside a card |
| `--rd-qr-tile` | `#ffffff` | `#ffffff` | the tile behind a QR picture; stays white in dark mode so the code scans |
| `--rd-field` | `#8a8a8a` | `#6e6e72` | input borders (3:1 against the surface) |
| `--rd-ink` | `#161616` | `#ececec` | text, links, active state, focus ring |
| `--rd-ink-2` | `#474747` | `#b9b9b9` | labels and nav text |
| `--rd-muted` | `#6a6a6a` | `#8e8e91` | secondary text. Passes 4.5:1 on bg, surface, surface-2 and surface-3 |
| `--rd-faint` | `#a8a8a8` | `#545457` | decoration and locked or disabled items only. **Fails 4.5:1: never body text** |
| `--rd-accent` | `#d93049` | `#ff4d63` | the one accent |
| `--rd-accent-soft` | accent at 9% | accent at 12% | accent tint |
| `--rd-on-accent` | `#ffffff` | `#111213` | text on accent |
| `--rd-on-mark` | `#ffffff` | `#ffffff` | text over a coloured company mark (an inline hue) |
| `--rd-primary-bg` | `#161616` | `#ececec` | primary button fill |
| `--rd-primary-hover` | `#2b2b2b` | `#ffffff` | primary button hover |
| `--rd-primary-fg` | `#ffffff` | `#111213` | text and icons on the primary fill |
| `--rd-success` / `--rd-success-soft` | `#0f8a59` / 10% | `#3ddc97` / 12% | active, paid, profit |
| `--rd-warning` / `--rd-warning-soft` | `#a9670a` / 12% | `#ffb547` / 12% | pending |
| `--rd-danger` / `--rd-danger-soft` | `#c8291b` / 9% | `#ff6b5b` / 12% | failed, destructive |
| `--rd-chart-frozen` | `#6d5bd0` | `#a89bff` | chart slice for frozen numbers (the home donut); never text |
| `--rd-chart-suspended` | `#8a6d3b` | `#d6b37a` | chart slice for suspended numbers (the home donut); never text |
| `--rd-focus` | accent at 18% | accent at 22% | focus halo around a field |
| `--rd-scrim` | ink at 48% | black at 70% | dialog backdrop |
| `--rd-scrim-strong` | `rgba(0,0,0,.50)` | same | drawer backdrop |
| `--rd-radius-lg` | `8px` | same | cards, panes, filter bars, primary and secondary buttons |
| `--rd-cut` | `12px` | same | the tag's cut corner on figure tiles |
| `--rd-glow` | accent at 10% | accent at 14% | the soft light under the pointer on a hovered figure or shortcut tile |

### Scales

Theme-independent, in `:root`. They name the values the stylesheets already used (Phase 5.3b); a new rule uses a step, not a literal.

| Token | Value | Token | Value |
|---|---|---|---|
| `--rd-radius-2xs` | 3px | `--rd-text-2xs` | 10px |
| `--rd-radius-xs` | 4px | `--rd-text-xs` | 11px |
| `--rd-radius-sm` | 6px | `--rd-text-sm` | 12px |
| `--rd-radius-md` | 6px | `--rd-text-md` | 13px |
| `--rd-radius-card` | 8px | `--rd-text-base` | 14px |
| `--rd-radius-tile` | 8px | `--rd-text-lg` / `-xl` / `-2xl` | 15 / 16 / 18px |
| `--rd-radius-panel` | 10px | | |
| `--rd-radius-pill` | 999px | | |

Which radius where: cards, panes, filter bars and the cards in a page grid (`.company-card`, `.pack-card`, `.stat`) take `--rd-radius-lg`; a surface that stands alone on the page or floats over it (`.auth-card`, `.door-card`, `.toast`, `.notice-pop`) takes `--rd-radius-panel`; menus, popovers and tile lists (`.menu`, `.wallet-pop`, `.command-list`, the data-table frame) take `--rd-radius-card`; the marks and skeleton tiles take `--rd-radius-tile`; controls take `sm`/`md`; small inner bits `2xs`/`xs`. There is no `border-radius` literal left in the sheets but `0` and `50%`.

Spacing, layers and motion are tokens too (5.3d), named from the values the sheets already used:

- Spacing `--rd-space-*` on a 4px step: `0-5` 2px, `1` 4px, `1-5` 6px, `2` 8px, `2-5` 10px, `3` 12px, `3-5` 14px, `4` 16px, `5` 20px, `6` 24px. Gaps, padding and margins use them; hairlines (1px), negative pulls, larger one-off sizes and the shell's rem values stay literal.
- Layers `--rd-z-*`, low to high: `raised` 1 (sticky table head, tree dots), `topbar` 20, `popover` 30 (shell menus, wallet pop), `overlay` 40 (drawer backdrop, search results), `drawer` 50, `shell-toast` 60, `dialog` 70, `top` 80 (toasts and the row menu, which open over a dialog). The sign-in frame's local 3 and 5 stay literal.
- Motion `--rd-dur-fast` 150ms, `--rd-dur-base` 180ms, `--rd-ease-standard` (0.4, 0, 0.2, 1), `--rd-ease-out` (0.2, 0.8, 0.2, 1). One-off timings (the sign-in choreography, the bell, the spinner, the shimmer) stay where they are used.
| `--rd-shadow-card` | `0 1px 2px` ink at 4% | inset 1px hairline | cards |
| `--rd-shadow-frame` | `0 1px 2px` slate at 5% | `0 1px 2px` black at 40% | the outer frame of a data table |
| `--rd-shadow-sm` | `0 1px 2px` black at 5% | `0 1px 2px` black at 5% | page actions |
| `--rd-shadow-pop` | `0 24px 64px` ink at 16% | `0 24px 64px` black at 50% | menus, dialogs, toasts, auth card |

Where the ink fills a button, use `--rd-primary-bg`. Where ink is a text, border, or link colour, use `--rd-ink`. They hold the same value today but mean different things.

## Controls and primitives

Lists, the shared dialog, row menu, filter bar, empty state and skeleton share one layout. Colours are the Graphite tokens above; `--rd-accent` (crimson) stays one thread per screen.

There is no Tailwind (removed in Phase 5.4a, ADR 0003); `base.css` is the reset. Icons are `lucide-react`. New controls are `apps/web/components/ui/` (`Button`, `Select`, `Badge`, `Pagination`), styled by `ui.css` with one `ui-` class per part and a modifier class per variant or size (`ui-btn ui-btn-outline ui-btn-sm`). A component joins its classes with `[...].filter(Boolean).join(' ')`; a `className` from the caller comes last and wins only by the cascade, so give it a class from a sheet, not a one-off utility. `Button` sizes: `sm` 32px, `default` 34px (the pane control height), `lg` 40px (sign-in-sized screens: password, two-factor), `icon` 36px square, `iconSm` 28px square; corners are 8px everywhere. Every action button is `Button` (5.4b-4d): no `.btn`, `.btn-sm`, `button.primary` / `.secondary` / `.danger`, and no context rule (`form > button`, `.pane form > button`, `.field-row > button`, `.dialog button.*`) restyles a button by where it sits. A button that is a `form`'s or `.pane-body`'s own child sits at the reading start. A link that must look like a button takes `buttonClass({ variant, size })`. Controls with their own look stay plain `<button>`s with their own class: tabs (`.steps`), the segmented pick (`.seg`), period chips, tiles and cards (`.op-tile`, `.op-card`, `.pack-card`, `.company-card`, `.pack-pick`, `.task-op`), the switch, menu items, shell icons, the sort header, the toast close, and the outage and return bars. `Select` takes `compact` for the 28px pager field. A `Button` never draws the browser's default border (5.4b-4a); `variant="danger"` is the danger outline (border and text, `--rd-danger-soft` on hover), like every destructive button. Every dropdown is `Select` (5.4b-4c: no bare `<select>` in a page); its `className` lands on the wrapper, which carries the layout (width, grid place), and in a `.data` cell the wrapper is inline-block so it follows the cell's centring. A `Select` keeps 2.25rem at its inline end for the chevron in every context, including the 28px filter bar where `.desk .filter-panel select` resets the padding.

The classes and the primitives read `--rd-*` tokens directly (Phase 5.3a; the alias names `--bg`, `--surface*`, `--line*`, `--ink*`, `--accent*`, `--good*`, `--warn*`, `--bad*`, `--focus-ring`, `--shadow-*` are gone). The ink primary's 10% tint is `--rd-primary-soft`. A badge's inset ring is its text colour at 15% (`color-mix`), the muted badge's is `--rd-line`; until 5.4a every badge drew Tailwind's default blue ring because the `/15` colours were never generated.

Status → tone lives in one file, `apps/web/lib/status-tone.ts` (Phase 5.4b-2): line active → `success`, frozen → `warning`, disconnected → `danger`, else `muted`; task done → `success`, cancelled → `danger`, else `warning`; account frozen → `warning`, open → `success`; notice unread → `warning`, read → `muted`; on/off (for sale, enabled, grant) → `success` / `danger`; package terms stopped → `danger`, custom price → `success`, inherited → `muted`. `<Badge variant={tone} dot>` draws it; there is no plain `.badge` class any more (5.4b-4b), and a page never picks a tone inline. `info` and `violet` are typed and unused until their tokens exist. Shell chrome uses `lucide-react` (nav, wallet, bell, theme).

The filter bar is its own card, one row, controls at 28px. It does not share a border with the table. `postcss.config.js` loads Autoprefixer from this file on disk, because the dev worker cannot see packages hoisted to the repo root.

## Type

Fonts come from `next/font` in `apps/web/app/layout.tsx`. No Google stylesheet link, no new family.

- Arabic and Latin text: **Noto Kufi Arabic** (`--font-sans`, variable, so 500 and 600 are real weights) — angular like a
  stamp, clear at small sizes.
- Hebrew: **IBM Plex Sans Hebrew** (`--font-he`, weights 400 to 700).
- Stack: `var(--font-sans), var(--font-he), Tahoma, sans-serif`. Headings use the same stack at weight 700.
- Numbers, money, dates, phone numbers: **Latin digits only** (dates use `ar-u-nu-latn`), in that same face with
  `font-variant-numeric: tabular-nums` (`.money`, `.num`, `.when`, `.line-number`, `td.msisdn`).
- Icons: lucide at stroke 1.9.

## Inner pages

New screens compose `.page-head`, `.filter-bar`, `.pane`, `Tabs` (`components/tabs.tsx`: a segmented control on a `--rd-surface-2` track, the selected tab on the surface with a hairline; an optional count pill; arrow keys), `.data`, `Badge` (`components/ui/badge.tsx`), `Stat` / `StatRow` (`components/stat.tsx`), `EmptyState` (`components/empty-state.tsx`), `Dialog` (`components/dialog.tsx`), and `RowMenu` (`components/row-menu.tsx`). Spacing comes from `--rd-space-*`; the common steps are 4, 8, 12 and 14. Control height inside a pane or filter is 34px. Under 720px every control on the canvas, in a dialog, in a row menu, and on the sign-in screen is at least 44px (sign-in fields and buttons are 42px and 40px above that). Tables keep text and status at the start and numeric columns at the end, with `class="num"` on both the header and the cell. Identifiers that are Latin digits stay in `<bdi dir="ltr">`. The actions column is `class="row-actions"`: it stays at the inline end, sized to its label, and does not grow with the table. Contextual row actions are only the 28px horizontal ellipsis in `RowMenu`. Its menu (`.row-menu-panel`) is a 12px-radius card with 6px padding, at least 13rem wide, opening from the trigger's inline end: each action is a 38px line, 14px semibold, its icon on a 27px `--rd-surface-2` tile at the start; hover fills the line; a destructive action is danger red with a `--rd-danger-soft` tile, after a hairline rule. Every popup next to a button (row menu, account menu, wallet pop, notices, language) opens and closes through `usePopover` (`lib/use-popover.ts`): a press outside or Escape closes it and Escape returns the focus to the button; a `role="menu"` opens on its first item and ArrowUp/ArrowDown, Home and End move between items. A new popup uses the hook, not its own listeners. Dialogs use a header, a scrolling body, and a footer; `size` is `confirm`, `form`, or `wide`. A dialog carries a hairline, sits on `--rd-scrim` with an 8px blur, and names its action with a round mark and a one-line lede. Every size has the same head (the mark beside the title) and the same foot (the buttons at the end, the action first); `confirm` (460px) is only narrower than `form` (560px) and `wide` (760px) (spec 2026-11-11-ui-consistency-pass, D5). Checkboxes and radios are drawn by the system, not the browser (`controls.css`): an 18px box on the surface, crimson with a light mark when on, a crimson ring on keyboard focus; they never inherit text-field height. `.empty` inside a pane or sheet already carries 14px padding, so a page never sets it inline.

Graphite page details, matched to the prototype page by page (2026-11-09): every primary button is crimson (`.ui-btn.ui-btn-primary`, owner 2026-11-11: a page's main action, a dialog's «حفظ» / «تفعيل», a form's submit, the chosen page number); ink fills are gone from actions, and the secondary button stays the soft track. A list page opens with a lede under its title. A company is shown by its `.co-mark` (logo or a cut-corner tile with its initials) wherever packages are grouped: the packages list, a user's «الرزم والأسعار» tab, the numbers table. A ledger's movement type is a `.reason` tag (`r-leaf` payment, `r-mute` settlement, `r-amber` a line operation). The user page is four tabs — packages and prices, number operations, the account's numbers, access; the provider account page is the ledger and the matching as two tabs under the figure row, with CSV, edit credit and record payment in the head.

The report pages (sales, profits, orders, balances, provider costs, activity log) share one layout from `features/reports/report-kit.tsx`: the title and lede with «CSV» in the head (`CsvLink`), then `.report-filters` — the `Period` switch (`.period`: today / 7 days / 30 days / 3 months, the chosen one raised with a crimson underline; full width under 768px) beside the loose filter chips —, three figure tiles with a meta line and no icon (`Stat` without `icon`; a red or green figure through `.tone-danger` / `.tone-success`, a name as `.stat-name`), and the table. A package cell is the package over its company (`.sub`); a share is a `.cap` bar. Balances have no period (they are a snapshot).

Notices are card rows (`.notice-list`: the group's mark, the title over its detail, the age, a crimson `.unread-dot` while unread, the unread row tinted) under «الكل / غير مقروءة» tabs. Roles are the design's matrix (`.roles-matrix`: a green `.grant.on` tick per grant held, an empty `.grant` tile otherwise, a dash where the layer can never use it). Settings: the account card has one «حفظ» for every field, a crimson square account mark, and the sign-in methods three across. The home opens with the design's top — the head's «تمويل حساب» and crimson «تفعيل رقم», the `AccountBand` (available balance with the ceiling as twenty `.hero-bar` ticks, active numbers, numbers ending within three days, profit of the last 30 days), the three period cards (`.pulse-tile`: sales with their volume, new subscriptions, profit) follow the period switch in the head, each with a `.change` chip in its corner — up green, down red, against yesterday by this time or the same span of last month, none over all time — and a `TrendLine` (a curve over a gradient area that draws in, a soft glow, a breathing dot at the latest point, the step's value on hover; motion only without reduced motion); then `.home-top-row`: the last operations (`.op-list`) beside «مهام بانتظارك» (`.waiting-list`); the period's overview («نظرة عامة») follows below it.

The finance and wallet pages share the design's wallet head: the balance tile leads (held, left to sell, the ceiling as ticks), money in (green) and out (red) over the chosen window, the movements with how many were made by hand, then «الرصيد عبر الوقت» with the 7 days / 30 days / 3 months switch that every tile follows. Every ledger reads the reason as a tag (`.reason`: sale `r-leaf`, held `r-amber`, money back `r-alarm`, funding `r-plum`, the rest `r-mute`). Operations and provider operations take the report layout.

## Components

One of each. A new page uses these, it does not invent a sibling.

- Page: title, one muted lede, then the content. No second heading that repeats the title.
- Card: white surface, hairline, `--rd-radius-lg` radius, `--rd-shadow-card`.
- Table: quiet header, hairline rows, text at the reading start, numbers tabular and aligned to the reading end. A header is a sort button only when the table holds the whole list; a server-paged table (`PagedTable`) shows plain headers in the server's order.
- Primary button: ink fill. One per group. The single special action may be accent. Destructive is an outline in danger (border and text), not a filled red.
- Badge: label plus a dot. Active, pending, danger, neutral.
- Chart: `TrendLine` (`components/trend-line.tsx`) — SVG, no library; a smooth curve over a gradient area that draws in, a soft glow, a breathing dot at the latest point, the step's value on hover; `size="large"` (the wallet head's balance over time) adds faint guide lines. Time runs left to right in every language. It draws in by a left-to-right reveal (`clip-path`), its area is a fill only. In a `.pulse-tile` it lies under the figures along the card's lower 55% instead of a band of its own.
- Users card (`.users-card`): a tile per managed layer in its `--rd-layer-*` colour (mark, count, label, a link to the list), the ceilings in use as a `.users-meter` bar, then debtors (count pill, debt) and frozen as ruled rows.
- Offers hero (home, spec 2026-11-09-offers-tasks-addons-wallet-esim): `OfferHero` (`components/offer-hero.tsx`, `.offer-hero`) — a compact strip — text at the reading start and a small 240px 2:1 picture at the end, stacked picture-first under 760px; the picture is optional, and without one the offer is text only on one column (`.text-only`); a pill dot per offer under it, the current one wide with a `--rd-primary-bg` fill that is its timer (`seconds` per offer); arrows show on hover or focus on desktop; swipe and the arrow keys move it; it pauses on hover, focus and a hidden tab, and does not run with reduced motion. The dot button is the touch target and the 8px bar inside it is what shows.
- Home layout: the head (the greeting is the title; date and layer the lede; the period switch at the end), the figure band, then `.home-columns` — two columns that stack their own cards, so nothing is stretched to a neighbour: the wide one (reading start) holds the last operations, top sellers, most active, providers and the board; the narrow one (reading end, first in the page so a phone reads it first) holds numbers by status (a 112px `Donut`, legend beside it, under it in a card below 340px), tasks, shortcuts (3 per row) and the accounts summary. Between 640 and 1099px the narrow column's cards pair up; one column under 640px, where the lead figure and the fourth tile take full rows.
- KPI: `StatRow` wraps a row of `Stat` items. Each `Stat` is a white card with a hairline and a 12px radius: the `label` at the start and a small `icon` (`IconName`) at the end on the first line, then a large tabular `value`, then optional `meta`. `tone` colours the icon; `highlight` tints the card with `--rd-success-soft` for the one figure that matters most on a screen; `progress` (0–1) draws a thin bar under the value. This is the only KPI pattern; do not use ad-hoc `.stat-card` markup.
- Figure band (home): `FigureBand` (`features/desk/overview.tsx`, `.figure-band`) — four `.figure-tile`s with the cut corner: label and a small icon tile on the first line, a large tabular figure, a meta line (profit: share of sales; net: refunds; count: average sale). The `.lead` tile (sales) is wider from 1100px, has a crimson top thread and a `Sparkline` (`components/sparkline.tsx`: SVG line plus a soft area, time left to right, draws in once); `.good` colours the figure green. `followPointer` moves a soft `--rd-glow` light under the pointer.
- Shortcut tiles (home): `ShortcutsCard`, `.shortcut-grid` of square `.shortcut-tile`s (icon tile in crimson, label under it) on `--rd-surface-2`.
- Filter: `FilterBar` wraps `.filter-bar`/`.filter-panel` — a card of `<label>` fields above the table, with an optional trailing clear button (`onClear`/`clearLabel`). This is the only filter pattern; do not write a bare `.filter-line` or inline filter markup on a new page.
- Donut (`components/donut.tsx`): slices with square ends and a thin gap between them, its middle words unstroked (the global `svg` icon rule is overridden); a legend whose row reads dot, label, change, count — the count closes the line, the change (`.donut-change` green ↑ / red ↓ with the number) just before it; pointing at a slice (ring or legend, or focus) puts its share and name in the middle, thickens it and dims the rest; the ring draws in (reduced motion: none).
- Name picker: `NameField` (`components/name-field.tsx`, matching in `lib/name-match.ts`; spec 2026-11-09-admin-review, 2a) — the one way to pick an account, point of sale, package, company or provider: a text field that suggests up to eight names from the first letter, closest first (exact, starts with, a word starts with — also after «ال» —, contains, one letter off for letters only), the matched part in bold, a `hint` line (layer, company · provider) under each. Arabic-aware (marks, tatweel, أ/إ/آ = ا, ة = ه, ى = ي, Arabic-Indic digits). ↑/↓, Enter, Esc (closes the list only, not a dialog); a picked name has a «×»; no free text. The list `.name-pop` is a portal with a fixed position, styled like the filter chip's own list (`.filter-pop`); 44px rows under 768px. In a `FilterBar` it sits in the chip, `allLabel` («الكل») as its empty state. Fixed short lists (status, layer, kind) stay `Select`.
- Facts: label/value pairs are `<Facts>` + `<Fact label>` (`components/facts.tsx`), never a hand-written `<dl>`. One primitive, three densities: `tiles` (default, `.detail-rows`: each fact one framed row drawn like a filter chip — its name on the soft track, a hairline, the value on the surface; rows stack and pair up in a wide dialog (owner 2026-11-11); every dialog's summary: QR, swap SIM, request eSIM, change number, transfer, disconnect, activation result, transfer dialog), `cards` (`.fact-grid`: a summary card per fact with an `icon` and a `tone` of `good`/`warn`; the head of the user page), `list` (`.task-facts`: a compact ruled list for a narrow rail; the task ticket). Latin identifiers inside a value stay in `<bdi dir="ltr">`.
- Empty: `EmptyState` inside `.empty` — muted icon in a small circle on `--rd-surface-2`, title (`children`), optional secondary `text`, centered (both axes) in the available `.pane`/`.sheet` space, not pinned to the start edge. Not a lone italic line.
- Feedback: one alert line for an error, one for a success, always through `Alert` (`components/alert.tsx`): `<Alert>{error}</Alert>` draws `.error` with `role="alert"`, `<Alert tone="success">` draws `.note` with `role="status"`, `banner` adds the page-top card, and an empty message draws nothing. Pages inside `Desk` get theirs from `PageAlert`, which uses `Alert`. No hand-written `<p className="error">` and no browser `alert` for success. An image whose source is a `data:` or `blob:` URL (logos, company marks, the eSIM QR) is `DataImage` (`components/data-image.tsx`); there is no bare `<img>`.
- Switch: `LiveSwitch` (`components/live-switch.tsx`) — `role="switch"` button with a `.track` (34×20 px) and a 14 px knob; **green (`--rd-success`) when on, red (`--rd-danger`) when off**, everywhere (owner, 2026-11-08); disabled keeps its colour at 45% opacity. The button is 36×32 px, 44 px under 720 px. There is no mixed state. The label and the state word sit beside it as `children`. This is the only on/off control; do not draw a second toggle.
- Price field: `PriceField` (`components/price-field.tsx`) — a short inline shekel input (`.terms-price`, 6.5rem, tabular, LTR) that saves on blur or Enter when the text changed; empty means back to the default, Escape drops the draft. The default sits beside it as a muted `Money`. Used by the package sheet and the line-prices table; the user page's packages tab edits prices in a dialog instead.
- Terms list (user page → «الرزم والأسعار», spec 2026-11-08-user-packages-tab-redesign): `.terms-sheet` → one folding `.terms-group` per company (a `.terms-group-head` button with a chevron, `aria-expanded`, folded until pressed or matched by the filter) → a bare `DataTable` with plain headers, one line per package: name and GB · «سعرك (اشتراك / تجديد)» · «سعر البيع (اشتراك / تجديد)» (green and bold when custom) · margin · a badge only when special (`سعر خاص`, `متوقف`, `موقوف من فوق`) · the switch · `RowMenu` («تعديل السعر» dialog, «إرجاع للافتراضي», «أسعار الأرقام القائمة»). A row whose switch is off reads muted and struck through. No company switch, no bulk on/off, no «موروث».
- Package facts: `PackageFacts` (`components/package-facts.tsx`, `.package-facts`) — GB, minutes, messages and months on one muted line («500 جيجا · دقائق غير محدودة · 3 أشهر»), the package's extra text under it. Wherever a package is chosen or listed; the line alone (`withDetails={false}`) on small cards.
- Operation cards: `.op-grid` of `.op-card` (hairline by `box-shadow`, `--rd-surface-2` when `.off`): a round `.op-mark` glyph, title and one-line description, an inherited-stop badge, and a `LiveSwitch` with the state word under it.
- **Line prices dialog** (`components/line-prices-dialog.tsx`): Dialog `size="form"` that groups a package's renewable numbers by the renewal price they carry and lets the operator set a new flat price per group or «follow current»; table `.data` with `num` columns, `PriceField` for the new price, secondary follow button, footer cancel/save. Mounted from the user packages tab and the package sheet.
- **Transfer dialog** (`components/transfer-dialog.tsx`): Dialog `size="form" mark="transfer"` that moves a point of sale or an agent: destination select, live preview (balances, line count, below-floor badge), radio pairs on `label.check` for own/child terms (keep / follow → `reset`) and for moved-number prices (keep / recapture), no defaults, submit disabled until every choice is made. Mounted from the users page; the number detail page asks the same line-price choice inline.

### Error and not-found screens

`app/error.tsx` and `app/not-found.tsx` draw the empty state (`.empty.empty-state`, `.load-failed` for the error) in a `.pane` inside the shell, with the way out in `.empty-actions`: one row, centered; a primary `Button` (or `buttonClass()` on the not-found `Link`) for the main way and `.back-link` for the second.

## Motion and access

- Motion is transform and opacity only, 150–900ms, and all of it sits under `@media (prefers-reduced-motion: no-preference)`
  (keyframes `rd-rise`, `rd-fade`, `rd-draw`, `rd-grow` in `styles/base.css`): the sidebar's contents fade after a fold;
  the drawer slides; the home's cards and tiles rise in with a 40ms stagger; figure and shortcut tiles lift 2px on hover;
  the sparkline draws in and the meters grow; table rows fade in. Plus the bell, the spinner and the skeleton shimmer.
- Targets at least 44px on touch widths.
- Text contrast at least 4.5:1 in both themes. `--rd-faint` is the one token below that; it is never used for body text on the canvas.
- Visible focus. Text inputs show an ink border plus the `--rd-focus` halo. Page-level buttons and links use a 2px solid `--rd-ink` outline.
- Check light and dark (dark is the default).

## Known gaps

None open. Closed after Phase 5 (2026-11-08):

- Key/value had three hand-written shapes; they are one `Facts` primitive with three densities (same pixels).
- The sidebar animated `width`; the width snaps and its contents fade (opacity).
- Below 360px the topbar's controls ran off the screen (the account menu at 320px); theme and language move to the drawer's foot there (`tests/topbar-narrow.spec.ts` checks 320, 360 and 390px in ar and en).
- Radius literals; every radius is a scale step with a rule for which one (see Scales).
- Company-mark contrast: the letters sit on `markColor(name)` (`lib/company-mark.ts`, `hsl(h 42% 33%)`), at least 4.67:1 against white on every hue (`tests/company-mark.spec.ts`).
