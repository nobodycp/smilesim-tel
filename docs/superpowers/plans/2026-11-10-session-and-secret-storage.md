# Session tokens hashed at rest, 2FA secrets sealed — plan

Spec: `docs/superpowers/specs/2026-11-10-session-and-secret-storage.md`. Paths under `apps/api/`. One slice = one
commit. Each slice ends with `tsc`, ESLint, `architecture.spec` and the named specs
(`npm test -- --forceExit <path>`).

## Part 1 — session tokens

- [x] **S.1 (this commit) Schema.** `prisma/schema.prisma` `Session.tokenHash String? @unique`; migration
  `…_session_token_hash`: add the column, `UPDATE "Session" SET "tokenHash" = encode(sha256("id"::bytea), 'hex')`,
  then `SET NOT NULL`. `prisma generate`; `prisma migrate diff` empty. No code reads it yet.
- [x] **S.2 (this commit) Token helpers.** `src/modules/auth/session-token.ts`: `newToken()` (32 random bytes, base64url),
  `hashToken(token)` (SHA-256 hex). Spec `session-token.spec.ts` (length, alphabet, the hash of an old uuid equals
  what the migration wrote).
- [x] **S.3 (this commit) Store contract.** `auth.store.ts`: `saveSession` / `saveImpersonation` → `Promise<{ id: string; token:
  string }>`; `liveSession`, `touchSession`, `userBySession` take the token. `testing/memory-auth.store.ts` and
  `prisma-auth.store.ts` implement it: rows found by `tokenHash`, Redis key `session:<tokenHash>`, old-key fallback
  with rename (spec decision 3, with the removal date in a comment). `prisma-auth.store.spec.ts` gains: a new
  session is found by its token and not by its id; an old row (tokenHash = sha256(id)) is found by its id; the old
  Redis key is renamed on first use.
- [x] **S.4 (this commit) Callers that create sessions.** `auth.service.ts` (`login`, `changePassword`, `promoteToFull`),
  `passkeys.ts`, `auth.controller.ts` (`setSessionCookie` gets the token), `office/accounts/accounts.service.ts`
  `enter` (handoff secret stores the token and the owner's token as `home`),
  `office/accounts/account-session.{service,controller}.ts`. Specs: every `auth/*.http.spec.ts`,
  `office/accounts/accounts.http.spec.ts`, `src/door.middleware.spec.ts`.
- [x] **S.5 (this commit) Callers that read sessions.** `office/activity/activity-recorder.ts` (`findUnique({ where: { tokenHash
  } })`), anything that compared the cookie to `session.id` (`auth.service.ts` `revokeSession` `current`,
  `listSessions` `current`). `GET /auth/sessions` returns `Session.id`, which is no longer the cookie.
  Specs: `auth/account.http.spec.ts` (list and revoke), `office/activity/*.spec.ts`. New assertion: no value in the
  `GET /auth/sessions` body equals the caller's cookie.
- [x] **S.6 (this commit) Guard.** `src/architecture.spec.ts` rule `session-id-as-token`: no `sessionKey(` call with anything but
  a hash, and no `res.cookie('sid'|'home', <x>.id`. Baseline 0. `docs/architecture/backend.md` auth row.
- [ ] **S.7 (later, dated)** Remove the old Redis key fallback once the date in S.3 has passed.

### How part 1 was done (2026-11-10)

Smaller than planned: `saveSession` / `saveImpersonation` keep answering one string, which is now the **token**
(every caller already used that string as the cookie value), and `liveSession` / `touchSession` / `userBySession`
take the token. So no caller changed except `ActivityRecorder` (finds the session by `tokenHash`). `Session.id` is
the public handle that `GET /auth/sessions`, revoke and `operatorId` use. The migration hashes each existing id
(`pgcrypto`), and the store renames an old Redis key to its hash on first use (remove after 2026-12-15 — S.7).
Checked on the running copy: a cookie opened before the change still works; a new cookie is 43 characters and is
not in the session list; enter, handoff and leave work.

## Part 2 — sealed 2FA secrets

- [ ] **T.1 `secret-box`.** `src/modules/shared/secret-box.ts`: `seal`, `open`, `isSealed`; key from
  `config.ts` (`SECRETS_KEY` added to `ENV_NAMES`, validated as 32 bytes). Spec: round trip, a tampered value is
  refused, a plain value passes through `open` unchanged, no key → `seal` returns the plain text.
- [ ] **T.2 Store seals and opens.** `prisma-auth.store.ts`: `updateUser` seals `twoFactorSecret` and
  `pendingTwoFactorSecret`; `toStoredUser` opens them. `prisma-auth.store.spec.ts`: what is written is sealed, what
  is read is plain, an old plain row still reads.
- [ ] **T.3 Production without a key.** `config.ts` `productionWarnings()` line; `auth.service.ts`
  `setupTwoFactor` refuses in production when `SECRETS_KEY` is unset (spec decision 7 — confirm with the owner
  first). Spec in `auth/two-factor.http.spec.ts`.
- [ ] **T.4 Backfill.** `apps/api/scripts/seal-secrets.ts` + `"seal-secrets"` script: reads users with a plain
  secret, seals, writes; prints counts; safe to run twice. Run locally against the dev database; document the
  command in `docs/architecture/backend.md` ("before real sales").
- [ ] **T.5 Docs.** ADR `0013-session-tokens-and-sealed-secrets.md`; backend map; the review file's S6 / S12 marked
  done; `docker-compose.yml` and the Coolify env list name `SECRETS_KEY`.
