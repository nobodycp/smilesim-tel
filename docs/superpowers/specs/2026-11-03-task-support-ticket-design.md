# Task support ticket — design

## Why

Branch admin and staff work long-running manual tasks (package switch, disconnect, failed
provider ops) from a list with row menus only. Support cannot open a full workflow page, leave
inspection notes without closing the task, or see a timed timeline. Separately, disconnect
refund and switch price-difference rules need clearer money behaviour (including agorot) but
must not be gated on the ticket UI.

## Goal

**Slice A — ticket workspace.** Full page `/tasks/[id]` for branch owners and staff with the
`tasks` grant: take/release, add notes without changing status, timeline with inspection
timestamps, complete/reject/cancel from the page. List links into the ticket. Existing
`posDelta` application on complete stays unchanged in this slice.

**Slice B — money (documented, not built here).** Internal agorot (₪1 = 100) with decimal
display; disconnect refund and usage-cost rules for both direct and manual disconnect; switch
applies POS buy-price **difference** on complete.

## Non-goals (Slice A)

- Agorot migration, disconnect refund formula, switch delta pricing.
- Changing who may take/work tasks beyond today’s branch + `tasks` grant rules.
- Login reskin, other desks, provider integration, worker jobs.

## Decisions

**D1 — Two independent slices.** Ticket UX (A) and disconnect/switch money (B) do not depend
on each other. Disconnect money is a **general** product rule (direct and manual).

**D2 — Detail route.** `/tasks/[id]` is the support ticket. List keeps take in the row menu;
complete/reject live on the detail page. The `/tasks` table leads with the number (start-aligned);
other columns stay centered. Filters cover number (msisdn contains), movement, package, provider,
company, and status. The note column shows only the latest `OfficeTaskNote` body (not the open
note, log, or result).

**D3 — Notes.** New `OfficeTaskNote` rows. `POST /office/tasks/:id/notes` while the task is
`pending` or `working` for any branch owner/staff with the `tasks` grant (not only the
assignee). Status unchanged. System take/release lines stay in `log`. The ticket UI keeps a
compact summary (number, SIM/ICCID, package, company, provider, amount) and a dominant
inspection tree for notes; actions use small controls, not full-width command cards.

**D4 — Timeline.** Detail response merges system log lines, notes (author + `createdAt`), and
close `resultNote` into ordered `events`, **newest first** so support reads from the latest
message at the top. Each take/release (and similar) log line is stored with its own ISO
timestamp so the tree does not reuse the task `createdAt` for every system row. Legacy
unstamped lines still fall back to `createdAt`. The ticket pane fills the canvas height; only
the inspection tree scrolls inside its column (composer stays pinned under it).

**D5 — Slice B money (reference only).**

- Store balances in agorot; show decimals to users. Fixed disconnect fee = **50 agorot**.
- Disconnect (direct or manual): refund = remaining-days value of POS buy price (pro-rata over
  package duration) — **fee is not subtracted inside the refund formula**. Usage/execution
  cost = day-cost for counted days **+ 50 agorot in the same cost item**. Manual: days from
  disconnect request until task marked done count on the POS. Direct: zero wait days when
  disconnect succeeds immediately; 50 agorot still sits in the usage-cost item. Fee goes to
  the branch (not taken from chain profits). Chain profits on usage days distribute as usual.
  Prepaid charge at activation is why remaining value returns to the POS wallet.
- Switch on complete: apply POS buy-price **difference** between packages (not full renewal).

## Verification (Slice A)

- `npm run typecheck:web` and `npm run typecheck:api`
- Browser: open ticket from `/tasks`, add note without status change, timestamps visible;
  ar/en × light/dark spot-check
