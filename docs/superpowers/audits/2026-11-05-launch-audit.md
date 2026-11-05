# Launch audit — 2026-11-05

Scope: the branch (manager) and the point of sale, Arabic only, light theme, 1440×900. Real API on its own database (`smilesim_audit`, reset on every run), no real providers.

Run it with `npm run test:audit` (builds the API, then `npm run audit --workspace web`). Screenshots and `report.json` land in `apps/web/audit-output/screens/`.

## Result of the last run

| Check | Result |
| --- | --- |
| Web and API typecheck | pass |
| API unit tests | 203 / 203 |
| Operations audit | 8 / 8 |
| Screens audit | 40 / 40 views with no problems, including the disconnect dialog on both doors |
| Existing mock UI suite (`npm test --workspace web`) | 31 / 41 before the decisions below, see open finding 7 |

## What the audit runs

- Funding from the users screen (branch to itself, branch to the point of sale).
- Point of sale, on its own screens, one number through activate, refresh, SIM swap, freeze, unfreeze, package switch, disconnect, charge.
- eSIM activation, extend, then disconnect.
- A manual package: activation becomes a task, the branch completes it, a second completion is refused.
- Branch activation for the point of sale, then every operation failing at the provider, each one going through a task and being completed; then extend and transfer to another point of sale.
- A failed branch activation: the task opens and the number appears only once it is done.

Each operation checks: the balance moves by the rule, exactly one wallet row of that kind with that amount and its package, one provider operation with its cost, one row in the number log, a finance row only when money moved, the on-screen message, and that the note does not repeat the package.

Each screen checks: `dir`/`lang`, no side scroll, no wide sheet or pane, no clipped text, every control has an accessible name, Latin words are isolated in `bdi`, the side menu matches the layer, no 5xx response, no console error, no Next.js error badge.

## Fixed during the audit

1. **Empty catalog on a fresh database (launch blocker).** A migration inserts companies, so `ensureCatalog` thought the catalog was already seeded and never created providers or packages. It now checks providers.
2. **Point of sale activation form** asked for a line number and offered the provider outcome picker. It now asks only what the provider needs: details for neod, the number for tokman, otherwise the SIM serial or eSIM; eSIM is only offered where the number is generated.
3. **Activity log** showed raw error codes, the task UUID, and `::ffff:` in the IP. Reasons are now Arabic, a task subject opens the task, and the IP is plain. The result is green or red text on the same line.
4. **Tables** used a fixed layout, so cells that do not wrap spilled into the next column. Tables now size to content; numeric headers may wrap, numeric cells do not.
5. **Latin names inside Arabic text** (login names, nicknames, device labels, names inside the task timeline, the header greeting) flipped the line order. They are now isolated in `bdi`.
6. **Provider and package mode selects** had no accessible name.
7. **Point of sale home** showed a point-of-sale column (always itself) and a shortcut to a screen it cannot open. The column is gone and the shortcut goes to finance.
8. **Point of sale side menu** followed the branch order with group titles. It is one list: home, numbers, packages, tasks, finance, activity.
9. **Wallet note repeated the package name** for activate, extend, switch, disconnect, and charge, next to the package column. The note now holds only a human or task note; finance search also matches package and company names, and the home list names the package from its own field.

## Decided after the audit

1. **Disconnect after extend refunded only the last period** (31.40 ₪ where 64.40 ₪ was prepaid and unused). Decision: every paid day comes back, and a switch values every day left the same way. Built in `docs/superpowers/specs/2026-11-05-prepaid-periods-refund.md`: each prepaid wallet row records its period, and disconnect and switch add up the open periods. Completing an extend or charge task now also records the package that was bought and the price that was paid, not the list price.
2. **Same-name packages from different providers** under one company in the point of sale catalog. Decision: leave them as they are.
3. **Disconnect had no confirmation.** Decision: a confirm dialog that names the number and shows the amount that comes back (or that a task opens). Built in the same spec; the audit confirms the shown amount is the amount that moved.

## Open — noted, not in this slice

4. Drawer links stay focusable while the drawer is closed on narrow screens.
5. Task timeline lines and notice texts are composed on the server in Arabic only.
6. Copy keys `noticeReply`, `reportConsumption`, and `reportFunding` are not used (`npm run check:copy`).
7. The mock UI suite has fallen behind the app: tasks table columns, row-menu labels, line action order, notices, and endpoints the mock does not answer (settings falls back to login). None of the ten failures touch the audit fixes; the suite needs its own pass.
8. The shared danger button keeps white text on a light red in the dark theme; its contrast is low.
