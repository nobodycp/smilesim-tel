# Launch audit implementation plan

Spec: `docs/superpowers/specs/2026-11-05-launch-audit-design.md`.

**Goal:** a repeatable audit that runs every branch and point-of-sale operation against the real API and database, checks every page those two layers open in Arabic at 1440 x 900, and fixes what it finds.

**Architecture:** a second Playwright config (`apps/web/playwright.audit.config.ts`) starts the real API on a throw-away database and the web app on its own port. Tests drive the screen and read the database with `pg` for the truth.

## Global constraints

- Never mock the API in the audit. Never write to the `smilesim` database.
- Arabic, light theme, viewport 1440 x 900, one worker.
- Fixtures go through the API as the branch. Operations under test go through the screen.
- Docs and code in English. No raw colours outside `tokens.css`.

### Task 1: Harness

**Files:**
- Create: `apps/web/playwright.audit.config.ts`
- Create: `apps/web/audit/reset-db.mjs` (drop, create, `prisma migrate deploy` on `smilesim_audit`)
- Create: `apps/web/audit/kit.ts` (doors, `login(page, door, login)`, `db()` query helper, `balance(login)`, `noteText(page)`, fixtures through the API)
- Modify: `apps/web/package.json` (`audit` script), root `package.json` (`test:audit`), `.gitignore` (`apps/web/audit-output/`, `apps/web/.next-audit/`)

Done when an empty test logs in as `branch` on the admin door and as `pos` on the pos door.

### Task 2: Operations

**Files:**
- Create: `apps/web/audit/operations.audit.ts`

Steps: fund `pos` from the branch users page; then for the point of sale and for the branch run the table in the spec through the numbers desk and the number card; then the failure plus task path from the branch. Each step uses one helper, `expectOperation({ kind, msisdn, delta, note, cost, finance })`, that checks the five records together.

Run, write every failure into the findings file, fix each in the API or web, re-run until green.

### Task 3: Point-of-sale side menu and activity result

**Files:**
- Modify: `apps/web/components/office-shell.tsx` (a layer-specific item list for `pos`)
- Modify: `apps/web/app/audit/page.tsx` (result as coloured text)
- Modify: `apps/web/app/styles/desk.css` (`.result-ok`, `.result-fail`)

Checked by Task 4.

### Task 4: Screens

**Files:**
- Create: `apps/web/audit/screens.audit.ts`
- Create: `apps/web/audit/page-checks.ts` (the per-page checks in the spec)

Run, log findings, fix, re-run until green. Look at every screenshot.

### Task 5: Findings and verification

**Files:**
- Create: `docs/superpowers/audits/2026-11-05-launch-audit.md`

Run `npm run typecheck`, the API unit tests, the existing Playwright suite, and the audit. Record results.
