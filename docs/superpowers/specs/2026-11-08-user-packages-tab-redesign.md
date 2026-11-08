# User page → «الرزم والأسعار»: folded companies, one line per package, prices from the row menu

Date: 2026-11-08 · Status: approved by owner (chat, 2026-11-08) · Screens: `/users/:login#packages`, every `LiveSwitch`

## Owner's request

- Companies are folded sections; the page opens with every company folded.
- No switch for a whole company: only a package is turned on or off.
- No "Turn all on / Turn all off" bulk actions at the top.
- No inline price fields and no «موروث» badge in the row. The price is edited from the row menu («تعديل السعر»), and
  each package shows its full details on one line.
- The on/off switch is smaller, green when on and red when off, everywhere in the system.

## Design

**Filter bar:** package name, company, the summary line (`7 رزمة · 5 ظاهرة · 2 بسعر خاص`), clear. Typing a name or
choosing a company opens the companies that match.

**Company section:** a header button (`aria-expanded`, chevron, company name, its own summary) that folds and unfolds
it. Folded by default.

**Package line** — a table inside the section, one row per package, plain headers:

| Column | Content |
|---|---|
| الرزمة | name · `150 GB` |
| سعرك (اشتراك / تجديد) | `25.00 / 22.00` — what this account pays |
| سعر البيع (اشتراك / تجديد) | `30.00 / 27.00` — what it sells at (the custom price when there is one) |
| الهامش | sell − buy on the subscription |
| الحالة | only what is special: `سعر خاص`, `متوقف`, `موقوف من فوق`; empty otherwise (no «موروث») |
| (switch) | on/off for this point of sale, just before the menu (owner, follow-up); disabled with a lock title when stopped above |
| ⋯ | «تعديل السعر», «إرجاع للافتراضي» (custom only), «أسعار الأرقام القائمة» (numbers only) |

A stopped or locked row is muted.

**«تعديل السعر» dialog:** the package and its buy prices, two shekel fields (subscription, renewal) filled with the
current custom price or empty with the current price as placeholder, the margin as typed, save / cancel. An empty
field goes back to the default price. Same API as today: `PUT /office/users/:login/packages/:code`
`{ price, renewalPrice }`.

**Switch (system-wide):** track 34×20 px (was 44×26), knob 14 px; on = `--rd-success`, off = `--rd-danger`;
disabled keeps its colour at 45% opacity. The button stays 44 px on touch widths. `mixed` is no longer used by any
screen and goes.

**Row menu (system-wide follow-up):** a roomier card — 38 px lines, 14 px semibold labels, each icon on a soft tile,
rounded hover; destructive actions red with a red tile.

## Not changing

The API, the line-prices dialog, the bulk endpoint (kept, unused by this tab), the other two tabs' layout.

## Checks

`tests/user-terms.spec.ts` rewritten for the folded companies, the row menu price dialog and the missing bulk
buttons; screenshots light/dark, ar/en, desktop/390 px; the switch checked on the package sheet and the line
operations tab.
