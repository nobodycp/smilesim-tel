# Provider operations

Spec: `docs/superpowers/specs/2026-11-05-provider-operations-design.md`.

1. `providerBranchCost` in `apps/api/src/modules/office/office-rules.ts`, with a rule test.
2. `GET /office/provider-operations` in the office service and controller. Branch and reports only. Rows carry provider and branch cost. The payload includes count, filtered cost, this-month cost, and the provider list.
3. Page `/provider-operations`: filters, three stat cards, table. Nav item under المزودون والشركات. Copy in ar, en, he.
4. Typecheck, the rule test, then the page in the browser against the existing charge and activation.
