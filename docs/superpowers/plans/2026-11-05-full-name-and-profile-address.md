# Plan: full name, account labels, and profile address

Spec: `docs/superpowers/specs/2026-11-05-full-name-and-profile-address.md`

1. API: rename the error code `NICKNAME_INVALID` → `FULL_NAME_INVALID` with the full-name message; rename `nicknameProblem` → `fullNameProblem` (and `validateNickname` → `validateFullName`).
   Files: `apps/api/src/errors.ts`, `apps/api/src/errors.spec.ts`, `apps/api/src/modules/auth/validators.ts`, `apps/api/src/modules/auth/validators.spec.ts`, `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/office/office.service.ts`.
2. API: `User.city` and `User.address` (nullable) with migration `20261106010000_user_city_address`; `PALESTINE_CITIES` in `auth/cities.ts`; `CITY_INVALID` and `ADDRESS_INVALID` codes; `StoredUser`/`UserPatch` gain `city`/`address`; `getProfile`/`updateProfile` read, validate, and return them; DTOs updated; unit tests for a valid city, an unknown city, a long address, and clearing.
   Files: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261106010000_user_city_address/migration.sql`, `apps/api/src/modules/auth/cities.ts`, `apps/api/src/errors.ts`, `apps/api/src/modules/auth/auth.store.ts`, `apps/api/src/modules/auth/prisma-auth.store.ts`, `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/auth/auth.dto.ts`, `apps/api/src/modules/auth/account.http.spec.ts`.
3. API: `GET /office/directory` → `{ names }` scoped to visible subtree + ancestor chain + branch-layer accounts; unit test for a POS actor seeing its agent and the branch but not a sibling POS.
   Files: `apps/api/src/modules/office/office.service.ts`, `apps/api/src/modules/office/office.controller.ts`, `apps/api/src/modules/office/office.dto.ts`, `apps/api/src/modules/office/office-lists.spec.ts`.
4. Web: copy — `nickname` → `fullName`, `savedNickname` → `savedFullName`, drop `saveNickname`; new `city`, `address`, `savedCity`, `savedAddress`, `cityNone`; error texts for `FULL_NAME_INVALID`, `CITY_INVALID`, `ADDRESS_INVALID` in ar/en/he.
   Files: `apps/web/lib/copy/ar.ts`, `apps/web/lib/copy/en.ts`, `apps/web/lib/copy/he.ts`.
5. Web: `api.ts` — `Profile` gains `city`/`address`; `officeDirectory()` call and `Directory` type. `OfficeSession` loads the directory beside `me` and exposes `names`. New `components/account-name.tsx` with `AccountName` and `accountLabel`. Style `.account-name small` in the owning CSS file.
   Files: `apps/web/lib/api.ts`, `apps/web/lib/office-session.tsx`, `apps/web/components/account-name.tsx`, `apps/web/app/styles/*.css` (the file that owns table cells).
6. Web: apply `AccountName`/`accountLabel` to every account reference listed in the spec.
   Files: `apps/web/app/users/page.tsx`, `apps/web/app/users/[login]/page.tsx`, `apps/web/app/numbers/page.tsx`, `apps/web/app/numbers/[id]/page.tsx`, `apps/web/app/tasks/page.tsx`, `apps/web/app/tasks/[id]/page.tsx`, `apps/web/app/reports/[kind]/page.tsx`, `apps/web/app/finance/page.tsx`, `apps/web/app/operations/page.tsx`, `apps/web/app/audit/page.tsx`, `apps/web/app/page.tsx`, `apps/web/app/providers/[code]/[packageCode]/page.tsx`, `apps/web/components/shell-search.tsx`.
7. Web: profile page — city select (`lib/cities.ts`, sorted by current language) and address field, each a `.field-row` with save; `Profile` state and `saveProfile` handle them.
   Files: `apps/web/lib/cities.ts`, `apps/web/app/settings/page.tsx`.
8. Tests and mocks: `mock-api.mjs` serves `/office/directory` and `city`/`address` on the profile; update e2e expectations that read the old wording or the bare login.
   Files: `apps/web/tests/mock-api.mjs`, affected `apps/web/tests/*.spec.ts`.
9. Verify: `npm run lint`, `npm run check:copy`, `npm run typecheck`, `npm run test:api`, `npm run build`; migrate the local DB; browser check of users, numbers, a line card, finance, the profile (ar + en, light + dark, wide + narrow). Commit, push, watch CI.
