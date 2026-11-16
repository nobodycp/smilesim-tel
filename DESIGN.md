# Smile Sim — Graphite

This is the visual source of truth (spec `docs/superpowers/specs/2026-11-09-graphite-identity.md`, from direction 08
"Night Desk · Graphite" in `design/`). The
operations desk after hours: neutral graphite surfaces, one crimson thread, sharp tag-cut corners, dense rows, Latin
digits. `.cursor/rules/smilesim-ui.mdc` points here.

Every style reads the `--rd-*` tokens (`apps/web/app/tailwind.css`, the one stylesheet). Do not add another accent colour.

## Identity

- **Dark is the default** (a browser with no saved choice); light is the same system on cool paper. The theme toggle and
  its cookie work as before.
- Graphite surfaces, never pure `#000`. Lines are white or ink at 5–8% alpha.
- Primary action is crimson, in both themes, and there is one per view (precedence and named exceptions under
  Components → Primary button; ADR 0021 D2). Ink fills are not actions. Beyond the primary button the crimson accent
  (`--rd-accent`) is the thread: the current nav item's bar and icon, the lead figure tile, sparklines, focus rings.
  Anything drawn on a crimson fill — the primary button, the brand tile, the account marks, the nav count, the chosen
  day, a checked box — sits on `--rd-accent-fill` in `--rd-on-accent` (white), ≥4.5:1 in both themes (ADR 0021 D1).
  Errors are `--rd-danger`, separate from the accent.
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
  page is ink with a 2px crimson bar and a crimson icon, hover is `--rd-surface-2`. A folding group (a `NavGroup`, e.g.
  «التقارير») slides its pages open under a hairline, each page marked by a small diamond that lights crimson when
  current. The foot holds the account (test id `side-user`: avatar, name, layer → `/settings`) and «تسجيل الخروج». The round
  handle on its edge shows on hover (and the `[` key) and folds the sidebar to a 76px rail: names fade, section
  titles become hairlines, and hovering an icon shows its name in a flyout (`data-slot="side-flyout"`) — a group shows
  its pages as a small menu there. The width glides (320ms). Under 900px the sidebar is the drawer (menu button in the
  topbar), a start `Sheet` (`components/ui/sheet.tsx`). The shell is utilities in `components/app-shell.tsx`,
  `chrome.tsx` (`topbarIcon`: every topbar control's box), `crumbs.tsx` and `shell-search.tsx` since Tailwind
  migration T3.1.
- Topbar: the **path** (`ShellPath`, `components/crumbs.tsx`) at the reading start — `⌂ / section / list / item`;
  section titles plain, the levels above the page links, the page in ink; `Alt+↑` goes one level up. There is no back
  button. Then, at the end: «ابحث أو انتقل» (`ShellSearch`: pages by name, then accounts and numbers; `/`, Ctrl K or
  ⌘K) on an inset field, the wallet chip (raised, balance only, crimson mark), notices and the theme as bare icons.
  The account and the language are not in the topbar: they sit at the sidebar's foot (the drawer's foot on a phone).
  Under 900px the path takes its own full-width row under the icons. The topbar's sides are the page gutter on a
  phone: 16px (`--rd-space-4`) under 768px, so its first and last controls line up with the page content; 28px from
  768px, where the canvas keeps `clamp(16px, 2vw, 28px)` until both share one gutter token (ADR 0021 D9). Under
  768px the search and the notices do not hang from their button: each opens as one sheet under the whole topbar,
  `--rd-space-2` from each screen edge (the topbar is their containing block: the search box and the notices' wrapper stop
  being positioned under 768px; `components/shell-search.tsx`, `components/app-shell.tsx`); on a short or landscape screen each sheet stops `--rd-space-2` above the bottom edge: the
  notice list scrolls inside, and the search keeps its field and scrolls its results. From 768px the notices open
  under the bell, `min(22rem, 80vw)` wide, and the search results under the field — or, where the topbar is too
  narrow for the field (720px of content or less), the field opens under the search icon, 18rem wide.
- Sign-in, password and two-step pages (utilities since Tailwind migration T3.2: `components/auth-frame.tsx`'s
  `authClass`, `components/auth-art.tsx`, `features/auth/screens/login-screen.tsx`) — the form on the reading side
  (brand row, title, the door as a crimson outlined tag, inset fields with an icon, crimson «دخول» (the view's
  primary), raised passkey button), and a dark art panel beside it (`components/auth-art.tsx`: the crimson tag rising
  from its corner, one line about the office, heading and line in `--rd-login-ink` over the tag); stacked under 861px
  with the art below.
- Filters (`FilterBar`): chips in one wrapping row on the top edge of the table card below — the field's name on a
  raised segment, the field beside it (as wide as its value), crimson once it holds a value; «مسح» in crimson at the
  end. Pressing a chip opens the design's own list under it (the `Select` list, hung under the whole chip: raised,
  34px rows, the chosen one in crimson with a tick; a row under the pointer takes the surface fill, a row with keyboard
  focus the same fill and a 2px crimson ring inside its edge, so the list's scroll box never clips it), not the
  browser's; the chip's value is the `Select`'s combobox trigger, for the keyboard and assistive tech. Under 768px only
  «كل الفلاتر» shows; it opens the fields in a drawer from the inline end, with «عرض النتائج».
- Tables (`components/ui/table.tsx`, Tailwind migration T2.9): no band behind the head, 46px zebra rows, every cell on
  one line (a long text column is `kind: 'wrap'`), the table scrolls inside its card; the pager is a hairline row with square page numbers, the current one ink.
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
  company · package · point of sale (a crimson link); no action buttons in the head (every operation is a card of
  «العمليات»); four cut-corner facts (package, ends on, price, last recharge); tabs العمليات / السجل (count) /
  التفاصيل; every operation a `.line-op` card — crimson mark, name, one line on what it does, a chevron that slides on
  hover; disconnect in danger. A card with keyboard focus draws a 2px crimson ring inside its edge, on its `::before`
  above the hover glow (an outline outside the card would be cut away by its `clip-path`); the ring follows the
  rounded corners and stops where the cut corner begins.
- Folded sidebar: pressing or hovering a group (التقارير) opens its pages in the flyout menu; it never leaves the page.
- User page head: a 48px cut-corner crimson mark, the name, the layer tag, the state; wallet actions are secondary.
- Task ticket: the operation and its state are the title, number · company · package the lede; the log is the wide
  side at the reading start, the details the narrow side, each its own card. On a ticket 36rem wide or narrower
  (`@container task-ticket`) the details sit above the log, at most 40% of the board high and scrolling inside it;
  the board then scrolls as one column, the log at its full length with the compose bar at its end (a message wider
  than the ticket scrolls sideways in the log).
  A task that went to a provider opens its details with the operation's block (`.po-panel`): a title and the
  phase as a `Badge` (waiting `info`, unconfirmed `warning`, failed `danger`, a success that could not be settled
  `violet`, applied `success`), one sentence, the amount with what became of it, then the decisions. The queue
  (`/tasks/decisions`) reuses the proposal card and one ruled row per operation (`.po-row`).
- Provider «طريقة التنفيذ»: `ModeCards` (`components/mode-cards.tsx`) — one cut-corner card per operation with a
  three-way segmented control (`Segmented fill`, `components/ui/segmented.tsx`, since Tailwind migration T2.3)
  (مباشر / مهمة فرع / متوقف) that spans the card in three equal parts, so longer languages never spill past its edge
  (a long label ends in an ellipsis); a stopped one dims. Cards are at least 250px wide.
- Figure cards (`.stat-row`): four cards sit in one row when they fit and two by two from 768 to 1100px, never three
  and one; under 768px an odd last card spans the row. A name as a figure (`.stat-name`) starts at the reading start.
- A yes/no filter in `FilterBar` (e.g. «السالب فقط») is a toggle chip: the chip lights when on; the checkbox stays
  over it, invisible, for keyboards and screen readers.
- An empty table that keeps its head shows its empty block at its own height under the head (never cut off).
- The package price chain (`ChainBoard`, `.chain-grid`): one table row per layer — the branch's cost first, tinted —, the subscription and the renewal side by side, each price with its margin over the layer above; the eSIM price and the re-pricing sit as two cards under it (D6).
- The user page's «الإعدادات والصلاحيات»: «إعدادات الحساب» open on top, «صلاحيات الحساب» folded (`.inherit-fold`) under it; each grant a three-way `.seg` (حسب الدور / مسموح / ممنوع), extra roles as `.role-chip` toggles (D3).
- The company «الإعدادات» tab: `.settings-block`s — picture, SIM rules, eSIM (a `LiveSwitch`) (D2). Its «حفظ» stays primary beside the head's «إضافة رزمة» (a named exception to one primary per view: see Components → Primary button).
- Every primary button is crimson, in both themes (`Button`'s `primary`, the login's «دخول», the package picker's button), and there is one per view (ADR 0021 D2; the named exceptions are under Components → Primary button): the page-head action, else the submit of the view's main form; a save in a secondary pane, a lookup step and a per-row save are secondary. A dialog's «حفظ» / «تفعيل» is its own view's primary. The other head actions are secondary, the boxed ⋯ drawn the same. A main form's submit is the view's primary when the head carries no primary action, and then it is at its default size, never a small or secondary one; under a primary head action it is secondary, except where a named exception keeps it primary (a tab's main form beside the head action; the task ticket's in-page forms). The chosen page number is a state, not an action: it stays ink (D3).
- Tabs sit above their content, never inside its card, on every page.
- Dates are `DateField` (`components/date-field.tsx`): a `YYYY-MM-DD` field and the system's month — never
  `type="date"`. A file is chosen through a system button over a hidden input, with the chosen name beside it.
- Tables: the actions column's head is for readers only; a column with no words in its head does not sort.
- The role dialog (`features/roles/screens/roles-screen.tsx`; the grouped design chosen from three, owner 2026-11-11): the grants in three groups (`GRANT_GROUPS` in `lib/grants.ts`: viewing and accounting, daily work, accounts and transfers; a group with nothing the layer can use is left out), each with a leading rail — its name and how many are on, `2/3` — beside hairline rows; a row is a name and a `LiveSwitch` at its end, the whole row the target; an «on» name is ink 700, an «off» one muted, so state never rests on colour alone; the head carries the total («4 من 8 مفعّلة»). Under them the layer's session rules: two labelled fields side by side (`.role-fields`) drawn exactly as every ordinary field — surface fill, 1px field border, 6px corners, 34px (44px on a phone), 13px/600, a crimson edge and soft ring on focus — the text following the page's direction (no forced `dir`), the inherited value as the placeholder, the range inside at the end, red with a sentence when out of range, and «حفظ» waits. Never a column of tick boxes.
- The two-step rule (`features/auth/two-factor-policy.tsx`, owner 2026-11-11): a full-width `Segmented` (`fill`, 8px sides; Tailwind migration T3.2) — *optional | required* for a layer (a block under the session rules in the layer role dialog, titled like it), *as the layer | required | optional* for an account (a block in `UserSettingsPane` after the password) — and, only while «إلزامي» is chosen, the method list as the filter chip (`<FilterBar loose bare>` around a `<label>` + `Select`: name, then the value in a frame, 32px, opening the design's own list (the `Select` list) — exactly the filters'). Under it: a state badge, a «إعادة تعيين التسجيل» outline button when enrolled, and one muted line «المطبّق الآن: …». SMS and email are hidden everywhere in the interface (`SHOWN_METHODS` in `two-factor-policy.tsx` = the app only, owner 2026-11-11; the API keeps them as a spare path), so with one method the list is not drawn at all. The enrolment screens show the allowed methods only; a single one is named («الطريقة المحددة لحسابك») instead of offered.
- A count or a duration is typed, not picked from a list: a number field without the browser's spin arrows, its
  range under it (red with the field's edge while out of range), the inherited value as its placeholder — the session
  rules (sessions allowed, idle hours) on a role and on an account (owner 2026-11-11).
- Buttons (owner 2026-11-11): every action is `Button` (a link or a file label drawn as one is `<Button asChild>`) — the task ticket's take, release, complete,
  reject and cancel too (primary, secondary, danger); a list row opens from its own link and its ⋯ menu, with at most
  one primary button of its own («أخذ المهمة», a named exception to one primary per view: see Components → Primary
  button). Corners are 6px (`--rd-radius-sm`, ADR 0021 D19). A group of buttons reads cancel then the action (D8);
  in a dialog's foot (and a multi-step create page's last step) the cluster sits at the inline end, so the action is
  at the far end; an in-pane edit form's own buttons sit at the reading start (Controls and primitives).
- Saved messages are toasts (`components/toast.tsx` `useToasts`, fed by `PageAlert`'s note; on
  `components/ui/toast.tsx`, Radix Toast, since Tailwind migration T2.6): stacked in the reading-end bottom corner over
  the page, a green edge, ×, gone after 4.6s; nothing on the page moves. Errors stay in
  the page. A switch beside its state word in a table keeps the word's width, so the columns do not move.
- Sorting: every `DataTable` header sorts; a cursor list (`PagedTable`) reads every page (up to 2000 rows) on the first
  header click and then sorts and pages the whole set.
- Phones (under 640px, D7): a `DataTable` row is a card — the first cell its title, every other value under its column's name (`td[data-label]`) two to a row, ⋯ in the corner; a cell that holds price editors (the sell cell's fields and save, a `.price-pair`) takes the card's whole row and wraps there, a price field never wider than its cell; the task and notice lists and the roles matrix keep their own layout (`cards={false}`; the cards are `Table cards`, components/ui/table.tsx). Tab strips wrap so every tab is in view; the pager's page buttons and page-size select are 40px; short cards (company, fact, operation) sit two a row; a run-mode card puts its mark beside its name.
- Company page and package groups: the company's cut-corner mark beside its name.
- White on crimson: every crimson fill that carries content — the primary and accent buttons, the sign-in «دخول»,
  the sidebar count, the brand tile and the sign-in mark, the side account avatar, the user page and settings marks,
  the offer action, the branding preview button, the return bar's button, the date picker's chosen day and a checked
  box or radio — is `--rd-accent-fill` (hover `--rd-accent-fill-hover`, darker) under `--rd-on-accent`; text ≥4.5:1
  and a glyph-only mark ≥3:1 in both themes, checked by `apps/web/scripts/contrast.mjs` (ADR 0021 D1, slice P0.9).
  The sign-in art's tag is a fill too: its heading and line are drawn over it, so the tag is `--rd-accent-fill` (at
  0.88 over the dark room) and both are in `--rd-login-ink`, ≥4.5:1 on the tag in both themes. The chosen day that is
  also today keeps its ring in the fill colour (no lighter ring inside the fill). The notice dot carries no text and
  stays on `--rd-accent`.
- Task ticket actions sit in the page head: «إكمال» is primary and shows its open form by a pressed state
  (`aria-pressed`), not by changing variant (ADR 0021 D13); take is primary too, so an unassigned task's head shows
  both, and the ticket's in-page forms keep their primary submits beside them — the open complete form's «إكمال» and
  the note composer's «إضافة ملاحظة» (one named exception to one primary per view: see Components → Primary button);
  release is secondary, «رفض» and «إلغاء» are the danger outline (D13); complete and reject open their form in the
  details column.
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
- Settings: the two-step methods are cards to choose (the chosen one outlined in crimson); sessions and passkeys are
  cards with a crimson device mark (utilities in `features/auth/sign-in-methods.tsx` and
  `features/auth/screens/settings-screen.tsx` since Tailwind migration T3.2).
- Finance and wallet (`WalletHead`): a figure band — the balance leads (held, available to sell, its 30-day
  sparkline), money in and out over 30 days, the entries with this account's profit — then the ceiling's cards, then
  the balance over time with a 7 / 30 days switch.
- Package page: the company's mark, «company · package» and whether it is for sale as the title; provider and live
  numbers the lede; the price chain as a row of cut-corner steps per group, the branch's cost first in crimson.
- Copy: every Arabic string uses Latin digits (no ٠–٩).
- Sidebar counts: a small crimson square (`components/app-shell.tsx`) at the end of the item (a corner mark on the folded rail) —
  the open tasks beside «المهام», from `/office/home` `openTasks`.

## Stylesheet

`apps/web/app/tailwind.css` is the only stylesheet and the only style source (ADR 0022, Tailwind migration T5.2);
`app/layout.tsx` imports it. In order it holds: the cascade layers (`theme`, `base`, `components`, `utilities`; a
utility always wins over a base rule), Tailwind's theme and utilities (no preflight: the element defaults below are
the reset), the `@source` folders (`app`, `components`, `features`, `lib`), the `@theme inline` block that gives every
`--rd-*` token its Tailwind name (`text-ink-2`, `bg-surface`, `rounded-card`, `text-sm`, `gap-3`, `shadow-pop`,
`z-dialog`, the `sm:` … `xl:` width scale; Tailwind's own palette, radii, type, shadows, easings, fonts and
breakpoints are cleared), the `dark:` variant on the `.dark` class of `<html>`, the tokens of both themes (`:root` and
`.dark` in `@layer base`), the global rules still in use (`@layer base`: element defaults, fields, the checkbox and
radio, and the rules that style content through a component's `data-slot` handle or the few legacy classes the markup
still writes) and the keyframes the utilities name.

Every other style is a Tailwind utility in the markup or a `cva` variant in `apps/web/components/ui/*`, joined with
`cn()` (`apps/web/lib/cn.ts`). There is no other `.css` file and no stylesheet ownership table: `npm run check:styles`
(`apps/web/scripts/check-styles.mjs`) fails on any `.css`, `.scss`, `.sass` or `.less` file under `apps/web` but
`app/tailwind.css`, and on physical-direction utilities, arbitrary colour values and literal inline colours in the
markup. A new colour, radius, size, layer or timing is a token in `tailwind.css` (both themes when it differs), mapped
in its `@theme` block, and listed below; a look two screens need is a component variant, not a new rule. The legacy
sheets (`app/styles/*.css`, `app/globals.css`) and their guard (`scripts/check-css.mjs`) are deleted since Tailwind
migration T5.1.

## Tokens

Both themes are defined in `apps/web/app/tailwind.css` (`:root` and `.dark` in `@layer base`); its `@theme inline` block gives each token its Tailwind name (`--rd-ink-2` → `text-ink-2`, `--rd-surface` → `bg-surface`). Use the token, never the value. No hex or `rgba()` outside those two blocks; in the markup no arbitrary colour (`bg-[#…]`) and no literal colour in `style={{}}` (`npm run check:styles`).

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
| `--rd-line-strong` | ink at 11% | ink at 11% | a stronger hairline; one `:root` definition (`color-mix(in srgb, var(--rd-ink) 11%, transparent)`) that follows the theme's ink. Today read by the `/roles` grant tiles (`.grant`); the literal `ink) 11%` mixes elsewhere (base rules in `app/tailwind.css`, utilities) are one-offs to fold onto it |
| `--rd-panel-line` | ink at 14% into `--rd-line` | the same | the border of a topbar panel (the notices) and of the live notice card; one `:root` definition (`color-mix(in srgb, var(--rd-ink) 14%, var(--rd-line))`); `border-panel-line` (Tailwind migration T3.1) |
| `--rd-qr-tile` | `#ffffff` | `#ffffff` | the tile behind a QR picture; stays white in dark mode so the code scans |
| `--rd-field` | `#8a8a8a` | `#6e6e72` | input borders (3:1 against the surface) |
| `--rd-ink` | `#161616` | `#ececec` | text, links, active state, focus ring |
| `--rd-ink-2` | `#474747` | `#b9b9b9` | labels and nav text |
| `--rd-muted` | `#6a6a6a` | `#8e8e91` | secondary text. Passes 4.5:1 on bg, surface, surface-2 and surface-3 |
| `--rd-faint` | `#a8a8a8` | `#545457` | decoration and locked or disabled items only. **Fails 4.5:1: never body text** |
| `--rd-accent` | `#d93049` | `#ff4d63` | the one accent |
| `--rd-accent-soft` | accent at 9% | accent at 12% | accent tint |
| `--rd-accent-fill` | `#d93049` (the accent) | `#d93049` | a crimson fill that carries content (buttons, marks, counts, the chosen day, a checked box); darker than the dark thread so white passes 4.70:1 in both themes (ADR 0021 D1) |
| `--rd-accent-fill-hover` | fill 88% toward `#000` | fill 88% toward `#000` | the fill's hover: always darker, never toward ink (`#bf2a40`, 5.80:1 under white) |
| `--rd-on-accent` | `#ffffff` | `#ffffff` | text and marks on `--rd-accent-fill` |
| `--rd-on-mark` | `#ffffff` | `#ffffff` | text over a coloured company mark (an inline hue) |
| `--rd-primary-bg` | `#161616` | `#ececec` | ink fill: the offer timer's fill, the branding preview's mark and tab icon, the default badge's text; not a button colour — every primary is crimson (ADR 0021 D2). The sidebar and drawer tile does not read it: it is crimson (`bg-accent-fill` in `components/app-shell.tsx`, Tailwind migration T3.1); P1.3 renames it `--rd-ink-fill` |
| `--rd-primary-hover` | `#2b2b2b` | `#ffffff` | not an ink fill's hover today: no rendered reader since P0.9 (the offer hero's `.offer-action:hover`, its last one, darkens to `--rd-accent-fill-hover`, ADR 0021 D1). No rule reads it since Tailwind migration T5.1 deleted `auth.css`; `bg-primary-hover` is mapped and unused |
| `--rd-primary-fg` | `#ffffff` | `#111213` | text on an ink fill: the branding preview's mark (`.bp-mark`). Also the text colour of the sidebar and drawer tile (`text-primary-fg` in `components/app-shell.tsx`, Tailwind migration T3.1), which does not render it: the tile has no text and strokes its icon with `--rd-on-accent` |
| `--rd-success` / `--rd-success-soft` | `#0f8a59` / 10% | `#3ddc97` / 12% | active, paid, profit |
| `--rd-warning` / `--rd-warning-soft` | `#a9670a` / 12% (the tint is `color-mix` of `--rd-warning`, UI maintenance P1.2) | `#ffb547` / 12% | pending |
| `--rd-danger` / `--rd-danger-soft` | `#c8291b` / 9% | `#ff6b5b` / 12% | failed, destructive |
| `--rd-chart-frozen` | `#6d5bd0` | `#a89bff` | chart slice for frozen numbers (the home donut); never text |
| `--rd-chart-suspended` | `#8a6d3b` | `#d6b37a` | chart slice for suspended numbers (the home donut); never text |
| `--rd-focus` | accent at 18% | accent at 22% | focus halo around a field |
| `--rd-scrim` | ink at 48% | black at 70% | dialog backdrop |
| `--rd-scrim-strong` | `rgba(0,0,0,.50)` | same | drawer backdrop |
| `--rd-radius-lg` | `8px` | same | cards, panes, filter bars (buttons take `--rd-radius-sm`, 6px: ADR 0021 D19) |
| `--rd-cut` | `12px` | same | the tag's cut corner on figure tiles |
| `--rd-glow` | accent at 10% | accent at 14% | the soft light under the pointer on a hovered figure or shortcut tile |

### Scales

Theme-independent, in `:root`. They name the values the legacy stylesheets used (Phase 5.3b); a new rule uses a step, not a literal.

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

Which radius where: cards, panes, filter bars and the cards in a page grid (`.company-card`, `.pack-card`, `.stat`) take `--rd-radius-lg`; a surface that stands alone on the page or floats over it (`.auth-card`, the door picker's cards: `rounded-panel` in `components/doors.tsx` since Tailwind migration T3.1) takes `--rd-radius-panel`; menus, popovers and tile lists (`.menu`, `.wallet-pop`, `.command-list`, the data-table frame) take `--rd-radius-card`; the marks and skeleton tiles take `--rd-radius-tile`; controls take `sm`/`md`; small inner bits `2xs`/`xs`. There is no `border-radius` literal left in `app/tailwind.css` but `0` and `50%`.

Spacing, layers and motion are tokens too (5.3d), named from the values the legacy sheets used:

- Spacing `--rd-space-*` on a 4px step: `0-5` 2px, `1` 4px, `1-5` 6px, `2` 8px, `2-5` 10px, `3` 12px, `3-5` 14px, `4` 16px, `5` 20px, `6` 24px. Gaps, padding and margins use them; hairlines (1px), negative pulls, larger one-off sizes and the shell's rem values stay literal.
- Layers `--rd-z-*`, low to high: `raised` 1 (sticky table head, tree dots), `topbar` 20, `popover` 30 (shell menus, wallet pop), `overlay` 40 (drawer backdrop, search results), `drawer` 50, `shell-toast` 60, `dialog` 70, `top` 80 (toasts and the row menu, which open over a dialog). The sign-in frame's local 3 and 5 stay literal.
- Motion `--rd-dur-fast` 150ms, `--rd-dur-base` 180ms, `--rd-ease-standard` (0.4, 0, 0.2, 1), `--rd-ease-out` (0.2, 0.8, 0.2, 1). One-off timings (the sign-in choreography, the bell, the spinner, the shimmer) stay where they are used.
| `--rd-shadow-card` | `0 1px 2px` ink at 4% | inset 1px hairline | cards |
| `--rd-shadow-frame` | `0 1px 2px` slate at 5% | `0 1px 2px` black at 40% | the outer frame of a data table |
| `--rd-shadow-sm` | `0 1px 2px` black at 5% | `0 1px 2px` black at 5% | page actions |
| `--rd-shadow-pop` | `0 24px 64px` ink at 16% | `0 24px 64px` black at 50% | menus, dialogs, toasts, auth card |

Where ink fills a surface (never an action: ink fills are not actions, ADR 0021 D2), use `--rd-primary-bg`. Where ink is a text, border, or link colour, use `--rd-ink`. They hold the same value today but mean different things.

## Controls and primitives

Lists, the shared dialog, row menu, filter bar, empty state and skeleton share one layout. Colours are the Graphite tokens above; `--rd-accent` (crimson) stays one thread per screen.

Tailwind CSS v4 is the styling (ADR 0022; `app/tailwind.css`, no preflight, so its `@layer base` element defaults are the reset). Icons are `lucide-react`. New controls are `apps/web/components/ui/` (`Button`, `IconButton`, `Input`, `Textarea`, `Label`, `Field`, `Switch`, `Checkbox`, `RadioGroup` / `RadioGroupItem`, `Segmented` / `SegmentedItem`, `Select` / `SelectItem`, `DropdownMenu` and its parts, `Dialog` and its parts, `Sheet` and its parts, `Tabs` and its parts, `Toast` and its parts, `Popover` and its parts, `Tooltip` and its parts, `Badge`, `Pagination`, `Skeleton`, `Avatar`). `Button` and `IconButton` are Tailwind utilities on the tokens with their variants in `class-variance-authority` (`components/ui/button-variants.ts`, `icon-button.tsx`; Tailwind migration T2.1), joined by `lib/cn.ts` `cn()`, so a caller's `className` wins over the component's own utility for the same property. Marks and feedback (Tailwind migration T2.7): `Badge` is the status pill — 4px corners, 2px / 8px padding, 11.5px semibold, the tone's soft fill and text under an inset 1px ring of the text colour at 15% (`muted`: `--rd-line`); with `dot` it is the Graphite diamond mark instead (no fill, ring or side padding, 12.5px, a 7px square turned 45deg with 1px corners glowing 8px in the text colour, `muted` without the glow); `Pagination` is the hairline row under a table (12px / 16px padding, 12px `--rd-muted` facts and the 88px per-page `Select`, quiet 30px previous / next, 30px square page numbers with 4px corners in 12.5px bold `--rd-ink-2`, the current one ink on the page colour, 40px under 641px); the table (`components/ui/table.tsx`, Tailwind migration T2.9) sits in a `TableSheet` that scrolls sideways: a sticky head on the surface (38px, 11.5px bold `--rd-muted` at 0.02em, a 1px ink rule at 11% under it), 46px rows with 8px / 14px padding (8px sides on the canvas up to 1100px), even rows `--rd-surface-2` at 55%, the row under the pointer `--rd-accent-soft`, centred cells but the first at the reading start, numbers tabular, the header's sort chevrons at 45% until sorted, rows fading in; under 641px a `cards` table draws each row as a card (14px / 16px padding, two values a row under their 11.5px names, the title across, ⋯ in the corner, ink at 3% on even cards); `Skeleton` is a 6px-corner `--rd-surface-3` bar with the shimmer sweeping across it; `Avatar` is the sidebar account's 36px crimson tile with the initial in 14px bold; `Alert`, `EmptyState` (`tone="danger"` for `LoadFailed` and the error screen) and `AccountName` draw their own look (see Feedback and Empty below). `Button` variants: `primary` (crimson), `secondary` (the soft track), `ghost`, `danger` (the danger outline), `link` (a button that reads as text, no size); sizes `sm` 32px, `md` 34px (the default, the pane control height), `lg` 40px (sign-in-sized screens: password, two-factor); corners are 6px (`--rd-radius-sm`) everywhere (ADR 0021 D19); the focus ring is 2px of page colour then 2px of `--rd-accent`. `IconButton` (one icon, an `aria-label` required): `md` 34px (the default), `lg` 36px (a dialog's close), `sm` 28px with 4px corners and 40px on phones (a copy button); tones `muted`, `faint`, `faint-to-ink`; the ink focus outline. Fields (Tailwind migration T2.2): `Input` is the one-line text field — full width, a 1px border at 70% of `--rd-field`, 6px corners, 12px sides, ink text, the crimson thread on focus (an `--rd-accent` border and the 3px `--rd-focus` ring), an inset 1px `--rd-danger` line while `aria-invalid` and not focused; sizes `md` 34px (the default, the desk control height) and `lg` 42px, both 44px at 720px and under; surfaces `sunken` (the default, graphite's inset field) and `surface` (inside a `.pane`, as the pane's legacy field rule drew it). Its type is inherited from the label, as every legacy field's is. `Textarea` is the pane text area (at least 72px, 8px / 12px padding, the same border, fill and focus, resized in height only). `Label` tones: `page` (6px gap, 13px semibold `--rd-ink-2`), `pane` (4px, 11px semibold `--rd-muted`), `dialog` (4px, 11px bold `--rd-muted`). `Field` names its one control by `htmlFor` and wires the id, `aria-describedby` (help, then error) and `aria-invalid` through Radix `Slot`; the help is the 12px `--rd-muted` hint line, the error the same line in `--rd-danger`. `Input` draws no read-only or disabled look: no legacy rule reached a text field with one (gap for T6.1). Choice controls (Tailwind migration T2.3, on Radix): `Switch` is the on/off switch `LiveSwitch` draws (the Switch entry below); `Checkbox` and `RadioGroupItem` are the system's box and dot (18px on the surface, a 1.5px border of ink at 32%, 4px corners or round; on: the `--rd-accent-fill` fill with its light `--rd-on-accent` mark growing in; an empty box takes the `--rd-accent` border under the pointer; the 2px `--rd-accent` outline 2px out on keyboard focus; 45% when disabled); `RadioGroup` sets no layout of its own. `Segmented` (Radix ToggleGroup, `role="radiogroup"` of `role="radio"` segments, arrow keys between them, the chosen one never unset) is the segmented pick: 6px corners and an inset 1px ink line at 11% around square 32px segments (44px at 720px and under), 10px sides, 12px bold `--rd-muted`, a 1px ink line at 11% between them; the chosen one on `--rd-surface-2` in ink over the 2px crimson thread; `fill` spreads equal segments over the full width (each label on one line, an ellipsis when long). It draws no disabled look or focus mark of its own (none reached a legacy segment outside a dialog). Every action button is `Button` (5.4b-4d): no `.btn`, `.btn-sm`, `button.primary` / `.secondary` / `.danger`, and no context rule (`form > button`, `.pane form > button`, `.field-row > button`, `.dialog button.*`) restyles a button by where it sits. A button that is a `form`'s or `.pane-body`'s own child sits at the reading start (`form > [data-slot='button']`, until the screens carry it). A link or a file label that must look like a button is `<Button asChild>` around it (Radix `Slot`); `buttonClass({ variant, size })` is only for a prop that takes a class name (the `RowMenu` trigger). Controls with their own look stay plain `<button>`s with their own class: the legacy segmented pick (`.seg`: the account's grants and the two-step rule, until their screens move onto `Segmented`), period chips, tiles and cards (`.op-tile`, `.op-card`, `.pack-card`, `.company-card`, `.pack-pick`, `.task-op`), menu items, shell icons, the sort header, and the outage and return bars. A `Button` never draws the browser's default border (5.4b-4a); `variant="danger"` is the danger outline (border and text, `--rd-danger-soft` on hover), like every destructive button. Every dropdown is `Select` (5.4b-4c: no bare `<select>` in a page), on Radix Select since Tailwind migration T2.4: a combobox button (`data-slot="select-trigger"`, `data-value` the chosen value) and its list in a portal, `SelectItem` rows, `onValueChange(value)`, `''` a value like any other (the «الكل» row). Its `className` lands on the trigger, which carries the layout (width, grid place). `place` says where it sits, each the legacy native-select look of that place: `field` (outside the desk, the sign-in screens: 36px, sunken, a border at 70% of `--rd-field`, 12px at the start, 14px), `desk` and `dialog` (the same at 34px), `pane` (34px, the surface fill, the full `--rd-field` border, 8px at the start, 13px), `pager` (the pane look at 28px, 40px at 640px and under); all but the pager 44px at 720px and under; every place keeps 36px at its inline end for the 16px `--rd-faint` chevron, `--rd-shadow-sm`, 6px corners, the label's weight, and on focus the `--rd-accent` border and the 3px `--rd-focus` ring; disabled: `--rd-surface-2`, 60%, not-allowed. Inside a `FilterBar` it is the chip's value (see Filters). Its list is the chip list's look for every Select: `--rd-surface-2`, an inset 1px ink line at 11%, `--rd-shadow-pop`, 6px corners, 4px padding, 34px rows in `--rd-ink-2` 13px medium, the chosen one crimson and bold with a tick, min(320px, 92vw) by min(360px, 60vh) at most, at least as wide as its field (under a chip: as the chip, at least 180px, from the chip's start, 6px below). Overlays (Tailwind migration T2.5, on Radix Dialog): `Dialog` (`components/dialog.tsx`, the one dialog, composed from `components/ui/dialog.tsx`) is a panel centred on the `--rd-scrim` with an 8px backdrop blur and 16px around it: min(560px, 100%) wide (`confirm` 460px, `wide` 760px), at most min(720px, the window less 48px) tall, 6px corners, the surface fill, an inset 1px ink line at 11% under `--rd-shadow-pop`, the 2px crimson thread across its top, dropping in over 200ms when motion is allowed. Its head (16px, 14px below, a hairline under it) holds the mark (a 40px `--rd-accent-soft` tile with 6px corners and the tag's cut corner at the reading end, an 18px crimson glyph; danger and success take their own soft fill and colour; `markSize="lg"` 56px with a 28px glyph for the activation result), the 16px bold title with its 13px medium `--rd-muted` lede, and the 36px close; the body scrolls with 16px padding; the foot is the buttons at the inline end on `--rd-surface-2` over a hairline. It names itself by its title and is described by its lede; Tab wraps inside it; only the scrim or Escape closes it. `Sheet` (`components/ui/sheet.tsx`, modal) is a full-height side panel: `start` the shell drawer's look (min(300px, 86vw), the page colour, a hairline at its inline end, over `--rd-scrim-strong` with a 2px blur), `end` the filter drawer's (min(380px, 92vw), the surface, over `--rd-scrim`); no bottom sheet yet (T6). Floating parts (Tailwind migration T2.6, on Radix): `Tabs` (`components/ui/tabs.tsx`, composed by `components/tabs.tsx`) is the tab strip — square 36px tabs side by side in 6px corners and an inset 1px ink line at 11%, 16px sides, 13px semibold `--rd-muted`, a 1px ink line at 11% between them, the selected one ink bold on `--rd-surface-2` over the 2px crimson thread, a disabled one at 40%, the count a crimson 11px bold figure; at least 44px high at 720px and under; under 641px a grid of equal cells (three a row, two for two or four tabs), 40px, each label centred on as many lines as it needs. A toast (`components/ui/toast.tsx`) is a row on the surface with 6px corners, an inset 1px `--rd-line` under `--rd-shadow-pop` and a 3px start edge (`--rd-success`, `--rd-danger` for an error), its 13px semibold message and a 28px `--rd-faint` × (44px at 720px and under), at most min(420px, the window less 32px) wide, rising in over 220ms; the toasts stack 8px apart 20px from the bottom and the reading end (under 641px across the width, 12px in). `Popover` (`components/ui/popover.tsx`) is the calendar panel's look: the surface, 10px padding, 6px corners, an inset 1px `--rd-line` under `--rd-shadow-pop`, 6px from its anchor at its reading start, above a dialog. `Tooltip` (`components/ui/tooltip.tsx`) is the rail flyout's look: `--rd-surface-2`, 7px / 12px padding, 6px corners, ink 12.5px semibold on one line up to 280px, an inset 1px `--rd-line` under `--rd-shadow-pop`, 10px from its trigger, at once, drifting in over 160ms. `DateField` (`components/date-field.tsx`, Tailwind migration T2.8) opens its month in `Popover`: 280px, the month name between two 30px steps, seven equal columns 2px apart, 11px semibold `--rd-muted` weekday names, 34px days (40px under 641px) with 4px corners in 12px semibold ink, today ringed 1px in `--rd-accent`, the chosen day on `--rd-accent-fill`, «اليوم» and «مسح» as 30px crimson links over a hairline; its calendar button is a 34px cell beside the field (40px under 641px) with a 1px `--rd-line` border on `--rd-surface-2`, crimson under the pointer and while open, and the chip's 30px value end inside a filter. Tooltip has no caller yet (the shell in T3.1).

The classes and the primitives read `--rd-*` tokens directly (Phase 5.3a; the alias names `--bg`, `--surface*`, `--line*`, `--ink*`, `--accent*`, `--good*`, `--warn*`, `--bad*`, `--focus-ring`, `--shadow-*` are gone). The ink fill's 10% tint is `--rd-primary-soft`. A badge's inset ring is its text colour at 15% (`inset-ring-<tone>/15`), the muted badge's is `--rd-line`; until 5.4a every badge drew Tailwind's default blue ring because the `/15` colours were never generated.

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

New screens compose `Desk` (`components/desk.tsx`: the page head), `FilterBar` (`components/filter-bar.tsx`), `Pane` (`components/desk.tsx`; its head and body are still `.pane-head` / `.pane-body`), `Tabs` (`components/tabs.tsx` on `components/ui/tabs.tsx`: square tabs in an inset ink line, the selected one on `--rd-surface-2` over the crimson thread; an optional crimson count; arrow keys), `DataTable` (`components/data-table.tsx` on `components/ui/table.tsx`), `Badge` (`components/ui/badge.tsx`), `Stat` / `StatRow` (`components/stat.tsx`), `EmptyState` (`components/empty-state.tsx`), `Dialog` (`components/dialog.tsx`), and `RowMenu` (`components/row-menu.tsx`). Spacing comes from `--rd-space-*`; the common steps are 4, 8, 12 and 14. Control height inside a pane or filter is 34px. Under 720px every control on the canvas, in a dialog, in a row menu, and on the sign-in screen is at least 44px (sign-in fields and buttons are 42px and 40px above that). Tables keep text and status at the start and numeric columns at the end, with the column's `num` on both the header and the cell (`data-num`). Identifiers that are Latin digits stay in `<bdi dir="ltr">`. The actions column is the column's `actions` (`data-actions`): it stays at the inline end, sized to its label, and does not grow with the table. Contextual row actions are only the 28px horizontal ellipsis in `RowMenu` (on `components/ui/dropdown-menu.tsx`, Radix DropdownMenu, not modal, since Tailwind migration T2.4). Its menu is an 8px-radius (`--rd-radius-card`) card with 6px padding, at least 13rem wide, opening from the trigger's inline end: each action is a 38px line, 14px semibold, its icon on a 27px `--rd-surface-2` tile at the start; hover fills the line; a destructive action is danger red with a `--rd-danger-soft` tile, after a hairline rule. Every popup next to a button opens and closes the same way: a press outside or Escape closes it and Escape returns the focus to the button; a `role="menu"` opens on its first item and ArrowUp/ArrowDown (wrapping), Home and End move between items. The row menu and every `Select` list get it from Radix (`components/ui/dropdown-menu.tsx`, `components/ui/select.tsx`); the date field's month from Radix Popover (`components/ui/popover.tsx`); the account menu, wallet pop, notices and language still from `usePopover` (`lib/use-popover.ts`) until their slices. A new popup uses a `components/ui` primitive, not its own listeners. Dialogs use a header, a scrolling body, and a footer; `size` is `confirm`, `form`, or `wide`. A dialog carries a hairline, sits on `--rd-scrim` with an 8px blur, and names its action with a round mark and a one-line lede. Every size has the same head (the mark beside the title) and the same foot (the buttons at the inline end, cancel then the action, so the action sits at the far end; ADR 0021 D8); `confirm` (460px) is only narrower than `form` (560px) and `wide` (760px) (spec 2026-11-11-ui-consistency-pass, D5). Checkboxes and radios are drawn by the system, not the browser (the `input[type='checkbox']` / `input[type='radio']` base rules in `app/tailwind.css`, and `Checkbox` / `RadioGroupItem`): an 18px box on the surface, crimson with a light mark when on, a crimson ring on keyboard focus; they never inherit text-field height. `.empty` inside a pane or sheet already carries 14px padding, so a page never sets it inline.

Graphite page details, matched to the prototype page by page (2026-11-09): every primary button is crimson (`Button`'s `primary`, owner 2026-11-11: a page's main action, a dialog's «حفظ» / «تفعيل», a main form's submit), one per view by the precedence (and the named exceptions) under Components → Primary button (ADR 0021 D2); the chosen page number is a state and stays ink (D3); ink fills are gone from actions, and the secondary button stays the soft track. A list page opens with a lede under its title. A company is shown by its `.co-mark` (logo or a cut-corner tile with its initials) wherever packages are grouped: the packages list, a user's «الرزم والأسعار» tab, the numbers table. A ledger's movement type is a `.reason` tag (`r-leaf` payment, `r-mute` settlement, `r-amber` a line operation). The user page is four tabs — packages and prices, number operations, the account's numbers, access; the provider account page is the ledger and the matching as two tabs under the figure row, with CSV, edit credit and record payment in the head (record payment the primary; the matching tab's «مقارنة» stays primary beside it, a named exception under Components → Primary button).

The report pages (sales, profits, orders, balances, provider costs, activity log) share one layout from `features/reports/report-kit.tsx`: the title and lede with «CSV» in the head (`CsvLink`), then `.report-filters` — the `Period` switch (`.period`: today / 7 days / 30 days / 3 months, the chosen one raised with a crimson underline; full width under 768px) beside the loose filter chips —, three figure tiles with a meta line and no icon (`Stat` without `icon`; a red or green figure through `.tone-danger` / `.tone-success`, a name as `.stat-name`), and the table. A package cell is the package over its company (`.sub`); a share is a `.cap` bar. Balances have no period (they are a snapshot).

Notices are card rows (`.notice-list`: the group's mark, the title over its detail, the age, a crimson `.unread-dot` while unread, the unread row tinted) under «الكل / غير مقروءة» tabs. Roles are the design's matrix (`.roles-matrix`: a green `.grant.on` tick per grant held, an empty `.grant` tile otherwise, a dash where the layer can never use it). Settings: the account card has one «حفظ» for every field, a crimson square account mark, and the sign-in methods three across. The home opens with the design's top — the head's «تمويل حساب» and crimson «تفعيل رقم», the `AccountBand` (available balance with the ceiling as twenty `.hero-bar` ticks, active numbers, numbers ending within three days, profit of the last 30 days), the three period cards (`.pulse-tile`: sales with their volume, new subscriptions, profit) follow the period switch in the head, each with a `.change` chip in its corner — up green, down red, against yesterday by this time or the same span of last month, none over all time — and a `TrendLine` (a curve over a gradient area that draws in, a soft glow, a breathing dot at the latest point, the step's value on hover; motion only without reduced motion); then `.home-top-row`: the last operations (`.op-list`) beside «مهام بانتظارك» (`.waiting-list`); the period's overview («نظرة عامة») follows below it.

The finance and wallet pages share the design's wallet head: the balance tile leads (held, left to sell, the ceiling as ticks), money in (green) and out (red) over the chosen window, the movements with how many were made by hand, then «الرصيد عبر الوقت» with the 7 days / 30 days / 3 months switch that every tile follows. Every ledger reads the reason as a tag (`.reason`: sale `r-leaf`, held `r-amber`, money back `r-alarm`, funding `r-plum`, the rest `r-mute`). Operations and provider operations take the report layout.

## Components

One of each. A new page uses these, it does not invent a sibling.

- Page: title, one muted lede, then the content. No second heading that repeats the title.
- Card: white surface, hairline, `--rd-radius-lg` radius, `--rd-shadow-card`.
- Table: quiet header, hairline rows, text at the reading start, numbers tabular and aligned to the reading end. A header is a sort button only when the table holds the whole list; a server-paged table (`PagedTable`) shows plain headers in the server's order.
- Primary button: crimson fill (`Button`'s `primary`, `--rd-accent-fill`, hover `--rd-accent-fill-hover`), in both themes, with white text (`--rd-on-accent`; ADR 0021 D1, D2). **One primary per view.** Precedence: the page-head action, else the submit of the view's main form; a save in a secondary pane, a lookup step and a per-row save are secondary (a per-row save is `secondary` `sm`, enabled only when its row changed, D14). A dialog is its own view: its «حفظ» / «تفعيل» is its primary. Named exceptions, kept as they are (no visible change; P0.1's reading, to be confirmed by the owner: ADR 0021 D2): a takeable row of the tasks list keeps its own `sm` «أخذ المهمة» (owner 2026-11-11), so a list with several takeable rows shows several; the task ticket: its head shows take and «إكمال» both as primaries on an unassigned task (take as today, «إكمال» per D13), and its in-page forms keep their primary submits beside the head's primaries — the open complete form's «إكمال» and the note composer's «إضافة ملاحظة» (at the default size from P3.1); the reject form's submit is the danger outline; a tab's main form beside the page-head action: on a page whose head carries a primary action, the open tab's main form keeps its primary submit — today only the company page's «الإعدادات» tab («حفظ» beside «إضافة رزمة») and the provider account's «المطابقة» tab («مقارنة» beside «تسجيل دفعة»; its matching save turns secondary in P3.2). A tab is not otherwise its own view. A pressed state is `aria-pressed`, never a change of variant (D13). Secondary is the soft track; destructive is an outline in danger (border and text), not a filled red; ink fills are not actions. Corners 6px (`--rd-radius-sm`, D19). A group of buttons reads cancel then the action (D8): at the inline end in a dialog's foot and a multi-step create page's last step, at the reading start as an in-pane edit form's own child.
- Badge: label plus a dot. Active, pending, danger, neutral.
- Chart: `TrendLine` (`components/trend-line.tsx`) — SVG, no library; a smooth curve over a gradient area that draws in, a soft glow, a breathing dot at the latest point, the step's value on hover; `size="large"` (the wallet head's balance over time) adds faint guide lines. Time runs left to right in every language. It draws in by a left-to-right reveal (`clip-path`), its area is a fill only. In a home period card (`data-slot="pulse-tile"`) it lies under the figures along the card's lower 55% instead of a band of its own.
- Users card (`UsersCard`, `features/desk/overview.tsx`, utilities since Tailwind migration T4.1): a tile per managed layer in its `--rd-layer-*` colour (mark, count, label, a link to the list), the ceilings in use as a bar, then debtors (count pill, debt; `--rd-warning` while there are debtors, `data-warn`) and frozen as ruled rows.
- Offers hero (home, spec 2026-11-09-offers-tasks-addons-wallet-esim): `OfferHero` (`components/offer-hero.tsx`, utilities since Tailwind migration T4.1) — a compact strip — text at the reading start and a small 240px 2:1 picture at the end, stacked picture-first under 760px; the picture is optional, and without one the offer is text only on one column (`data-text-only`); a pill dot per offer under it, the current one wide with a `--rd-primary-bg` fill that is its timer (`seconds` per offer); arrows show on hover or focus on desktop; swipe and the arrow keys move it; it pauses on hover, focus and a hidden tab, and does not run with reduced motion. The dot button is the touch target and the 8px bar inside it is what shows.
- Home layout: the head (the greeting is the title; date and layer the lede; the period switch at the end), the figure band, then two columns that stack their own cards (`features/desk/screens/home-screen.tsx`, utilities since Tailwind migration T4.1), so nothing is stretched to a neighbour: the wide one (reading start) holds the last operations, top sellers, most active, providers and the board; the narrow one (reading end, first in the page so a phone reads it first) holds numbers by status (a 112px `Donut`, legend beside it, under it in a card below 340px), tasks, shortcuts (3 per row) and the accounts summary. Between 640 and 1099px the narrow column's cards pair up; one column under 640px, where the lead figure and the fourth tile take full rows.
- KPI: `StatRow` wraps a row of `Stat` items. Each `Stat` is a card on `--rd-surface` with a 1px inset hairline, 6px corners and the cut corner (`figureCardClass`, Tailwind migration T3.3): the `label` at the start and a small `icon` (`IconName`) at the end on the first line, then a large tabular `value`, then optional `meta`. `tone` colours the icon; `highlight` draws the value and the icon in `--rd-success` for the one figure that matters most on a screen (the card stays on the surface, as graphite drew it); `progress` (0–1) draws a thin bar under the value. This is the only KPI pattern; do not use ad-hoc `.stat-card` markup.
- Figure band (home): `FigureBand` (`features/desk/overview.tsx`, `.figure-band`) — four `.figure-tile`s with the cut corner: label and a small icon tile on the first line, a large tabular figure, a meta line (profit: share of sales; net: refunds; count: average sale). The `.lead` tile (sales) is wider from 1100px, has a crimson top thread and a `Sparkline` (`components/sparkline.tsx`: SVG line plus a soft area, time left to right, draws in once); `.good` colours the figure green. `followPointer` moves a soft `--rd-glow` light under the pointer.
- Shortcut tiles (home): `ShortcutsCard`, `.shortcut-grid` of square `.shortcut-tile`s (icon tile in crimson, label under it) on `--rd-surface-2`.
- Filter: `FilterBar` (`data-slot` `filter-bar` / `filter-panel`) — a card of `<label>` fields above the table, with an optional trailing clear button (`onClear`/`clearLabel`). This is the only filter pattern; do not write a bare `.filter-line` or inline filter markup on a new page.
- Donut (`components/donut.tsx`): slices with square ends and a thin gap between them, its middle words unstroked (the global `svg` icon rule is overridden); a legend whose row reads dot, label, change, count — the count closes the line, the change (`.donut-change` green ↑ / red ↓ with the number) just before it; pointing at a slice (ring or legend, or focus) puts its share and name in the middle, thickens it and dims the rest; the ring draws in (reduced motion: none).
- Name picker: `NameField` (`components/name-field.tsx`, matching in `lib/name-match.ts`; spec 2026-11-09-admin-review, 2a) — the one way to pick an account, point of sale, package, company or provider: a text field that suggests up to eight names from the first letter, closest first (exact, starts with, a word starts with — also after «ال» —, contains, one letter off for letters only), the matched part in bold, a `hint` line (layer, company · provider) under each. Arabic-aware (marks, tatweel, أ/إ/آ = ا, ة = ه, ى = ي, Arabic-Indic digits). ↑/↓, Enter, Esc (closes the list only, not a dialog); a picked name has a «×»; no free text. The list is a portal with a fixed position, styled like the filter chip's own list (the `Select` list); 44px rows under 768px. Its own look (the row, the «×», the list) is Tailwind utilities in the component since migration T2.2; the text field takes the look of the place it sits in (chip, pane, dialog), whose rules read `[data-slot='name-field']`. In a `FilterBar` it sits in the chip, `allLabel` («الكل») as its empty state. Fixed short lists (status, layer, kind) stay `Select`.
- Facts: label/value pairs are `<Facts>` + `<Fact label>` (`components/facts.tsx`), never a hand-written `<dl>`. One primitive, three densities: `tiles` (default, `.detail-rows`: each fact one framed row drawn like a filter chip — its name on the soft track, a hairline, the value on the surface; rows stack and pair up in a wide dialog (owner 2026-11-11); every dialog's summary: QR, swap SIM, request eSIM, change number, transfer, disconnect, activation result, transfer dialog), `cards` (`.fact-grid`: a summary card per fact with an `icon` and a `tone` of `good`/`warn`; the head of the user page), `list` (`.task-facts`: a compact ruled list for a narrow rail; the task ticket). Latin identifiers inside a value stay in `<bdi dir="ltr">`.
- Empty: `EmptyState` (`components/empty-state.tsx`, Tailwind since migration T2.7) — muted icon in a 32px circle on `--rd-surface-2`, title (`children`), optional secondary `text`, centered (both axes) in the available `.pane`/`.sheet` space, not pinned to the start edge. Not a lone italic line.
- Feedback: one alert line for an error, one for a success, always through `Alert` (`components/alert.tsx`): `<Alert>{error}</Alert>` draws the `--rd-danger` line on `--rd-danger-soft` with `role="alert"`, `<Alert tone="success">` the `--rd-success` line on `--rd-success-soft` with `role="status"` (10px / 12px padding, 6px corners, 13px semibold), `banner` keeps 16px under it (none as a direct child of `.desk` or the settings page), `className` places it (the dialog's error line, 12px / 16px in), and an empty message draws nothing. Pages inside `Desk` get theirs from `PageAlert`, which uses `Alert`. No hand-written `<p className="error">` and no browser `alert` for success. An image whose source is a `data:` or `blob:` URL (logos, company marks, the eSIM QR) is `DataImage` (`components/data-image.tsx`); there is no bare `<img>`.
- Switch: `LiveSwitch` (`components/live-switch.tsx`) — the `Switch` primitive (`components/ui/switch.tsx`, Radix Switch since Tailwind migration T2.3) after its words, 8px apart: a `role="switch"` button with a square track (38×20 px, 4px corners) and a square 14 px knob (2px corners, `--rd-on-mark`) that slides 18px to the end; **green (`--rd-success`) when on, red (`--rd-danger`) when off**, everywhere (owner, 2026-11-08); disabled keeps its colour at 45% opacity; keyboard focus is the 3px `--rd-focus` ring. The button is 36×32 px, 44 px under 720 px. `LiveSwitch` takes `className` for its place (a column on an operation card). There is no mixed state. The label and the state word sit beside it as `children`. This is the only on/off control; do not draw a second toggle.
- Price field: `PriceField` (`components/price-field.tsx`) — a short inline shekel input (`Input` with utilities since Tailwind migration T2.2: 6.5rem, 34px, 4px corners, 13px bold on the surface — at most its cell's width in a phone card, which a base rule in `app/tailwind.css` reads by `[data-slot='price-field']` — tabular, LTR) that saves on blur or Enter when the text changed; empty means back to the default, Escape drops the draft. The default sits beside it as a muted `Money`. Used by the package sheet and the line-prices table; the user page's packages tab edits prices in a dialog instead.
- Terms list (user page → «الرزم والأسعار», spec 2026-11-08-user-packages-tab-redesign): `TableSheet` `.terms-sheet` → one folding `.terms-group` per company (a `.terms-group-head` button with a chevron, `aria-expanded`, folded until pressed or matched by the filter) → a bare `DataTable` with plain headers, one line per package: name and GB · «سعرك (اشتراك / تجديد)» · «سعر البيع (اشتراك / تجديد)» (green and bold when custom) · margin · a badge only when special (`سعر خاص`, `متوقف`, `موقوف من فوق`) · the switch · `RowMenu` («تعديل السعر» dialog, «إرجاع للافتراضي», «أسعار الأرقام القائمة»). A row whose switch is off reads muted and struck through. No company switch, no bulk on/off, no «موروث».
- Package facts: `PackageFacts` (`components/package-facts.tsx`, `.package-facts`) — GB, minutes, messages and months on one muted line («500 جيجا · دقائق غير محدودة · 3 أشهر»), the package's extra text under it. Wherever a package is chosen or listed; the line alone (`withDetails={false}`) on small cards.
- Operation cards: `.op-grid` of `.op-card` (hairline by `box-shadow`, `--rd-surface-2` when `.off`): a round `.op-mark` glyph, title and one-line description, an inherited-stop badge, and a `LiveSwitch` with the state word under it.
- **Line prices dialog** (`components/line-prices-dialog.tsx`): Dialog `size="form"` that groups a package's renewable numbers by the renewal price they carry and lets the operator set a new flat price per group or «follow current»; a `Table` (`components/ui/table.tsx`) with `num` columns, `PriceField` for the new price, secondary follow button, footer cancel/save. Mounted from the user packages tab and the package sheet.
- **Transfer dialog** (`components/transfer-dialog.tsx`): Dialog `size="form" mark="transfer"` that moves a point of sale or an agent: destination select, live preview (balances, line count, below-floor badge), radio pairs on `RadioGroup` (each in its 44px label, Tailwind migration T2.5) for own/child terms (keep / follow → `reset`) and for moved-number prices (keep / recapture), no defaults, submit disabled until every choice is made. Mounted from the users page; the number detail page asks the same line-price choice inline.

### Error and not-found screens

`app/error.tsx` and `app/not-found.tsx` draw the empty state (`EmptyState`, `tone="danger"` for the error) in a `Pane` (`components/desk.tsx`, in a `DeskColumn`) inside the shell, with the way out in its `actions`: one row, centered; a primary `Button` (`<Button asChild>` around the not-found `Link`) for the main way and the back link (utilities in `app/error.tsx` since Tailwind migration T3.3: 32px, 44px at 720px and under, a hairline card in `--rd-ink-2`) for the second.

## Motion and access

- Motion is transform and opacity only, 150–900ms, and all of it sits under `@media (prefers-reduced-motion: no-preference)`
  (keyframes `rd-rise`, `rd-fade`, `rd-draw`, `rd-grow` in `app/tailwind.css`): the sidebar's contents fade after a fold;
  the drawer slides in and out over 340ms (`rd-sheet-in` / `rd-sheet-out` in `app/tailwind.css`, the start `Sheet`); the home's cards and tiles rise in with a 40ms stagger; figure and shortcut tiles lift 2px on hover;
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
