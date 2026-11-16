# The package page — plan

Spec: `docs/superpowers/specs/2026-11-16-package-page.md`. One slice = one commit on local `main`, ticked with its
hash. Per slice: `npm run lint`, `npm run typecheck`, `npm run check:copy`, `npm run check:styles`, the touched
specs; checked on the running copy (port 3000) per `.cursor/rules/verify-before-reply.mdc`.

- [x] **P.1 eSIM on the start tab** (`ec1b9cd`). `apps/web/features/catalog/package-esim.tsx` (switch, price, source line,
  save); `package-sheet-screen.tsx` puts it on «نظرة عامة» and drops the price card from «سلسلة الأسعار»;
  `package-details-form.tsx` loses the checkbox (the details route still takes `esimAvailable`). Web tests that
  reach the checkbox or the price card follow.
- [x] **P.2 The start tab shows the package** (`52b0d5c7`). The details form sits on «نظرة عامة»; the «التفاصيل» tab is gone.
- [x] **P.3 «أرقام الحسابات» tab** (`6c98c6e`). API `GET /v1/packages/:code/line-accounts` (`pricing/terms.service.ts`,
  repository count by point of sale, `testing/routes.ts`, permissions, `response-shape.spec.ts`); web tab with
  «تعديل السعر» per account; the re-pricing card leaves «سلسلة الأسعار».
- [ ] **P.4 What the point of sale sees (the marks).** The details as tiles on the subscribe step are done
  (`components/package-facts.tsx` `PackageFactTiles`). Open: The package card's facts. The «لا تُفصل» and «عرض» marks wait for the
  lock and deals.
- [x] **P.5a Porting and card-to-bill (API)** (`0fa78e5a`). `prisma/schema.prisma` `Package.portMode`, `convertMode`,
  `Task.activationKind` and the migration; `catalog/packages/packages.schemas.ts` `PackageModeBody`; the sheet;
  `pricing/package-shelf.service.ts` `canPort`, `canConvert`; `sales/lines.schemas.ts` `kind`;
  `sales/lines.service.ts` `openKindTask`; `tasks/tasks.service.ts`. Specs: `sales/activation-kind.db.spec.ts`,
  `testing/response-shape.spec.ts`.
- [x] **P.5b Porting and card-to-bill (web)** (`4c92a2d4`). The two switches with their mode on «نظرة عامة»; the kind choice
  in the activation form when the package offers one; the task's name in the tasks list and its page.
- [x] **P.6 The point of sale's flow: one question at a time** (`efe9190c`). `apps/web/features/catalog/screens/packages-screen.tsx`
  (`PosCatalog`, `Answer`, `GbRing`), copy in ar, en, he; web tests `activation-request-key`, `packages-terms`,
  `branch-packages` follow. Prototype: `docs/prototypes/2026-11-16-activation-variants.html`.
