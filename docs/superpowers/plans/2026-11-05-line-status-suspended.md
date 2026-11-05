# Plan: line statuses (rename + suspended)

Spec: `docs/superpowers/specs/2026-11-05-line-status-suspended.md`

1. **API** — `office-paging.ts` adds `suspended` to `LINE_STATUSES`; `office-rules.ts` names the
   suspended branch in `offeredOperations`; `office-rules.spec.ts` pins that it offers nothing.
2. **Copy** — `lib/copy/{ar,en,he}.ts`: `lineActive` → "فعال" (ar only), new `lineSuspended`.
3. **Helpers** — `components/names.ts`: `lineStatus` handles `suspended`; new `lineBadgeTone` and
   `lineBadgeClass`.
4. **Screens** — `app/numbers/page.tsx` (filter option, URL parse, badge tone),
   `app/numbers/[id]/page.tsx` (head badge), `app/providers/[code]/[packageCode]/page.tsx` (lines tab
   badge), `components/line-actions.ts` (disconnect only for active/frozen).
5. **Verify** — API tests, web tsc + lint + check:copy, browser: numbers list filter shows four
   statuses and the active badge reads "فعال".
