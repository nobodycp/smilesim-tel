# Company SIM settings implementation plan

Spec: `docs/superpowers/specs/2026-11-05-company-sim-settings.md`.

**Goal:** each company records its ICCID length, ICCID prefix, and eSIM support; activation and SIM swap obey them; the company page edits them.

## Global constraints

- A company with no settings behaves exactly as today.
- Stored ICCIDs are never re-checked.
- No commit, no deploy. The audit runs on `smilesim_audit` only. No real operations on the dev DB.

### Task 1: Data, rule, and enforcement

**Files:**
- Create: `apps/api/prisma/migrations/<timestamp>_company_sim_settings/migration.sql`
- Modify: `apps/api/prisma/schema.prisma` (`Company.iccidLength`, `Company.iccidPrefix`, `Company.esim`)
- Modify: `apps/api/src/errors.ts` (`SIM_DIGITS`, `SIM_LENGTH`, `SIM_PREFIX`, `ESIM_UNSUPPORTED`)
- Modify: `apps/api/src/modules/office/office-rules.ts` (`SimRules`, `simRulesOf`, `simRefusal`)
- Modify: `apps/api/src/modules/office/office-rules.spec.ts` (rule cases first, failing)
- Modify: `apps/api/src/modules/office/office.service.ts` (`activate` and `swapSim` call `simRefusal`; eSIM refused when the company does not take it)
- Modify: `apps/web/lib/copy/{ar,en,he}.ts` (the four error texts)

Done when the API tests pass and `check:copy` is clean.

### Task 2: Read and write the settings

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts` (`sim` on the companies shelf, on package rows, and on line detail; `setCompanySim`)
- Modify: `apps/api/src/modules/office/office.controller.ts`, `office.dto.ts` (`PUT /office/companies/:code/sim`)
- Modify: `apps/api/src/modules/office/response-shape.spec.ts` (the new `sim` shape)
- Modify: `apps/web/lib/api.ts` (`SimRules`, `sim` on `Shelf` companies, `PackageRow`, `LineRow`; `setCompanySim`)

Done when typecheck and the API tests pass.

### Task 3: Company page settings tab

**Files:**
- Modify: `apps/web/app/companies/[code]/page.tsx` (tabs: settings first, providers second; the settings form)
- Modify: `apps/web/lib/copy/{ar,en,he}.ts` (tab, field, and hint labels)
- Modify: the stylesheet that owns the form row only if no existing class fits

Done when the page is checked in the browser in Arabic and English, light and dark, at about 1440px and in a narrow window.

### Task 4: Forms follow the rules

**Files:**
- Create: `apps/web/lib/sim-rules.ts` (`simHint`, `simReady`, `withPrefix`)
- Modify: `apps/web/app/packages/page.tsx` (point-of-sale activation)
- Modify: `apps/web/app/numbers/page.tsx` (branch activation dialog)
- Modify: `apps/web/app/numbers/[id]/page.tsx` (SIM swap dialog)

Done when the forms prefill the prefix, show the hint, keep submit disabled until the ICCID fits, and hide eSIM for a company without it.

### Task 5: Audit

**Files:**
- Modify: `apps/web/audit/operations.audit.ts` (set rules on a company; a wrong ICCID is refused with the right text; a correct one activates; SIM swap the same; eSIM refused where off; clear the rules after)
- Modify: `apps/web/audit/screens.audit.ts` (company page settings tab on both themes and both widths)

Done when `npm run test:audit` is green and the screenshots are reviewed.
