# The package page — plan

Spec: `docs/superpowers/specs/2026-11-16-package-page.md`. One slice = one commit on local `main`, ticked with its
hash. Per slice: `npm run lint`, `npm run typecheck`, `npm run check:copy`, `npm run check:styles`, the touched
specs; checked on the running copy (port 3000) per `.cursor/rules/verify-before-reply.mdc`.

- [x] **P.1 eSIM on the start tab** (`ec1b9cd`). `apps/web/features/catalog/package-esim.tsx` (switch, price, source line,
  save); `package-sheet-screen.tsx` puts it on «نظرة عامة» and drops the price card from «سلسلة الأسعار»;
  `package-details-form.tsx` loses the checkbox (the details route still takes `esimAvailable`). Web tests that
  reach the checkbox or the price card follow.
- [ ] **P.2 The start tab shows the package.** After the owner's answer (shown, or edited there).
- [ ] **P.3 «أرقام الحسابات» tab.** API `GET /v1/packages/:code/line-accounts` (`pricing/terms.service.ts`,
  repository count by point of sale, `testing/routes.ts`, permissions, `response-shape.spec.ts`); web tab with
  «تعديل السعر» per account; the re-pricing card leaves «سلسلة الأسعار».
- [ ] **P.4 What the point of sale sees.** The package card's facts. The «لا تُفصل» and «عرض» marks wait for the
  lock and deals.
- [ ] **P.5 Porting and card-to-bill.** After the owner's answers A–D.
