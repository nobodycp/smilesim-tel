# UI consistency pass — spec

Date: 2026-11-11. Owner request (one message, asleep while it runs): audit every part of the office visually, record
the audit so it can be re-run, and fix what is out of place, inconsistent or badly laid out — mobile first-class,
desktop not neglected. One verified phase at a time; a second model checks each phase before the next starts.

## Goal

One way to do each thing. Where the system shows two shapes for the same idea (two switches, two dialogs, a button
beside an operation that is also in the list below it), keep one.

## Decisions

### D1 — SIM / eSIM, everywhere

- The two kinds of SIM are named **SIM** and **eSIM** in every language. «شريحة عادية» / «شريحة إلكترونية» (and their
  en/he forms) go. The word «الشريحة» stays where it means the card itself (its serial, its length, its prefix).
- «الأرقام» gains a **SIM / eSIM** filter. API: `GET /office/lines?sim=sim|esim` (and nothing else changes).

### D2 — Companies

- **Card:** no «eSIM» tag on the card (accepting eSIM is a setting, not an identity). The ⋯ menu goes: «تعديل» opened
  the same page the card opens, and the picture moves into the company's settings. The whole card opens the company.
- **Company settings tab:** three blocks in this order — the company's **picture** (preview, «رفع صورة» and remove),
  **SIM rules** (length, prefix, the accepted shape), **eSIM** (a `LiveSwitch` «تقبل eSIM» and the default eSIM price).
  No native checkbox.
- **Company packages tab:** the «الحالة» column is a `LiveSwitch` that turns the package on and off from the list
  (`PATCH /packages/:code/mode { enabled }`, as the package page does today). The row's ⋯ menu with its one item
  («فتح الرزمة») goes: the name is the link.
- **Package page:** the `LiveSwitch` in its head goes (the list owns on/off). Its state still shows as a badge.

### D3 — The user page: settings and permissions in one tab

- «إعدادات المستخدم» (email, mobile, two-step, new password, session rules) leaves the dialog and the menus (users list
  row menu, the user page ⋯). It lives in the user page's last tab, renamed «الإعدادات والصلاحيات»:
  - top, **always open**: «إعدادات الحساب» — the dialog's fields, one «حفظ»;
  - below, **folded by default** (a disclosure): «صلاحيات الحساب» — the grants and the extra roles.
- Each grant is a three-way segmented control — **حسب الدور / مسموح / ممنوع** — the same `.seg` the package and
  provider run modes use, with the effective state as a badge. No native `select`, no native checkbox: extra roles
  are toggle chips.

### D4 — The number page

- The head's quick-action buttons go: every operation is in the «العمليات» grid below, once.
- «التفاصيل» is drawn with the system's fact cards and shows what the head does not. The usage dials go: the API
  has no usage data, so they only ever showed «—».
- Its dialogs use the shared `Dialog` with the same head (mark, title, lede), body (`.dialog-form` fields) and footer
  (cancel secondary, action primary) as every other dialog.

### D5 — Dialogs

Every dialog: `components/dialog.tsx`, the mark beside the title in the head — a confirmation too, which no longer
centres it —, labelled fields, the buttons at the end of the foot; one width scale (`confirm` 460, `form` 560, `wide`
760). Checkboxes and radios are drawn by the system everywhere (`controls.css`), not by the browser.

### D6 — The package page

- The price chain («السلسلة») is compact: one row per layer (label, subscription price, renewal), not a card per step.
- The eSIM price and the re-pricing of live numbers are two cards under the chain, side by side, with «حفظ» above them.

### D7 — Mobile

- No sideways page scroll at 360–430px; tables scroll inside their card.
- Tap targets at least 40px on phones; tab strips scroll with a visible edge fade and the active tab in view.
- Cards (companies, ops, modes) two per row where they fit at 390px instead of one tall card each.
- Dialogs keep the footer in view on a phone (the body scrolls).

### D8 — The audit record

`apps/web/visual-audit/` (a Playwright script that drives the one running copy on port 3000 and starts no server)
screenshots every route and every tab at 390 / 768 / 1280 in ar-dark and en-light, and lists sideways scroll, boxes
past the edge, clipped text, small tap targets on phones, tiny text and native controls. Findings and their status
live in `docs/reviews/2026-11-11-visual-audit.md`; re-run it after a visual change and update the record.

## Non-goals

- No money, status or permission rule changes: D2's switch calls the existing endpoint; D3 saves through the existing
  endpoints.
- No new pages; no route changes.
- Offers and branding keep their current design.
