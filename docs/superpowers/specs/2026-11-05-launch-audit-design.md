# Launch audit: branch and point of sale

Goal: prove that the office can run without real providers, for the two layers that are in daily use (branch and point of sale). Every line operation is run for real against the real API and database, and the money, the message, and the records are checked against each other. Every page those two layers can open is checked on screen in Arabic. Defects found are fixed and stay covered.

The old browser tests answer from a mock API that returns whatever the test wrote. They passed while the card said "the wallet was charged" for a refresh that charged nothing. This audit never mocks the API.

## Decisions

### Stack

- A separate database, `smilesim_audit`, on the local Postgres. Every run drops it, creates it, and applies the Prisma migrations. The day-to-day database is never touched.
- The real API (`apps/api/dist/main.js`) on port 3931 with `TRIAL_SEED=true`, so the four trial accounts (`branch`, `main`, `agent`, `pos`, password `123456`) and the catalog are seeded on boot.
- The web app (`next dev`) on port 3930 with its own dist directory. Doors: `admin.localhost:3930` (branch) and `pos.localhost:3930` (point of sale).
- Playwright, one worker, tests in order, Arabic, light theme, viewport 1440 x 900.
- The test reads the database with `pg` for the truth of balances and rows. Every action is taken through the screen, never by calling the API directly. The only exceptions are the fixtures listed below.

### Fixtures (setup, not under test)

- A second point of sale, `pos2`, under `agent`, so a line can be transferred.
- One package switch target on the package used for the switch test.
- One package set to manual for the activate mode, so a task path without a provider failure is covered.

Fixtures are written through the API as the branch, not into the database.

### Operations

Each row runs once from the point-of-sale door (outcome is always success there) and once from the branch door with outcome success, and once from the branch door with outcome failure followed by taking and completing the task.

| Operation | Line state before | Money on success |
|---|---|---|
| Fund (branch to `pos`) | none | `+amount` to `pos`, `-amount` from branch |
| Activate, physical SIM | none | `-subscription posPrice` |
| Activate, eSIM | none | `-(subscription posPrice + 5.00)` |
| Extend | active, not expired | `-renewal posPrice` |
| Refresh number | active | none |
| Swap SIM | active | none |
| Freeze | active | none |
| Unfreeze | frozen | none |
| Disconnect | active | `+(remaining whole days of posPrice) - 0.50` |
| Charge | disconnected | `-posPrice` |
| Switch package | active, with a target | the amount the switch rule asks, `0` allowed |
| Transfer (branch only) | active | none |

For every run the audit checks all of these together:

1. Wallet balance after = before + the expected amount, to the agora.
2. The note on screen. "تم التنفيذ وخصم الرصيد." only when the balance went down. "تم التنفيذ." when it was applied with no debit. "أُرسلت مهمة للفرع. لم يُخصم شيء." when a task opened, and then the balance did not move.
3. One row in the provider-operations report with that kind, that number, and the expected provider cost.
4. One row in the line's own log tab.
5. One row in the finance report only when the amount is not zero.
6. A task path: no money and no report row before completion; exactly one movement and one report row after completion; completing it twice is refused.

### Screens

Pages per layer, each opened with real data after the operations ran:

- Branch: home, tasks, a task, numbers, a number card (each tab), users, finance, packages, companies, providers, a provider, a package sheet, provider reports, provider operations, activity log, roles, settings, and the pages under "not ready".
- Point of sale: home, numbers, a number card (each tab), packages, tasks, a task, finance, activity log, settings.

Checks on each page:

- No uncaught page error, no console error, no Next.js issue badge.
- `html` has `dir="rtl"` and `lang="ar"`.
- No horizontal scroll on the document.
- No clipped text in table cells, buttons, side links, or badges.
- Every button, link, and form field has an accessible name.
- No raw code shown as text (a cell or label that is only `[a-z_]+`, such as `refresh`).
- No Latin word in Arabic copy outside `bdi`, inputs, and an allow list (`SIM`, `eSIM`, `GB`).
- The side menu shows exactly the items and order of that layer.
- A full-page screenshot is saved to `apps/web/audit-output/` for review.

### Side menu per layer

- Branch keeps its current groups and order.
- Point of sale: one list with no group titles: home, numbers, packages, tasks, finance, activity log. Nothing from "not ready".

### Activity log result

The result column is plain text on the same line, green (`--rd-success`) for success and red (`--rd-danger`) for failure. No badge.

### Findings

Every defect the audit finds is written in `docs/superpowers/audits/2026-11-05-launch-audit.md` with the page or operation, what was wrong, and the fix. A defect is fixed with a check that fails before the fix.

## Non-goals

- Main agent and agent layers.
- English, Hebrew, and dark theme.
- Other viewport sizes.
- Real provider calls.
- Running the audit in CI.
