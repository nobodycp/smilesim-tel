# Session tokens hashed at rest, 2FA secrets sealed — spec

Review 2026-11-10: S6 (session ids are bearer secrets stored and returned as written) and S12 (TOTP secrets in
clear). Backend only. No route or response shape changes except one: the `id` in `GET /auth/sessions` stops being
the cookie value (it already is only used to revoke, so the web needs no change).

## Today (commit 314d290)

- `Session.id` (uuid) **is** the `sid` cookie. It is the Redis key (`session:<id>`), it is returned by
  `GET /auth/sessions`, stored in the handoff secret, and kept in the `home` cookie. Anyone who reads the database,
  Redis, or that response holds every live session.
- `User.twoFactorSecret` and `pendingTwoFactorSecret` are base32 text. A database dump lets its reader produce
  every account's codes.

## Decisions

1. **Token ≠ id.** The cookie carries a random 32-byte token (base64url). The database stores only
   `Session.tokenHash` = SHA-256(token), unique. `Session.id` stays a uuid and becomes the public handle (list,
   revoke, `operatorId` log). Redis keys become `session:<tokenHash>`.
2. **Store contract** (`auth/auth.store.ts`): `saveSession` and `saveImpersonation` return `{ id, token }`;
   `liveSession(token)`, `touchSession(token)`, `userBySession(token)` take the token; `revokeSessions(ids)` and
   `listFullSessions` keep working on ids. `MemoryAuthStore` follows.
3. **Nobody is signed out by the deploy.** The migration sets `tokenHash = sha256(id)` for existing rows, so a
   cookie that holds an old id still resolves. Redis: `liveSession` looks up `session:<hash>`; on a miss it checks
   the old `session:<token>` key and renames it. The fallback is removed in a later slice, after the longest idle
   rule has passed (`SESSION_MINUTES_RANGE` max), with its date written in the code.
4. **`home` cookie and handoff secret** carry tokens, never ids. `ActivityRecorder` finds the session by
   `tokenHash`.
5. **2FA secrets are sealed** with AES-256-GCM (`shared/secret-box.ts`: `seal(plain)`, `open(sealed)`), format
   `v1:<iv>:<tag>:<ciphertext>` in base64url. The key is `SECRETS_KEY` (32 bytes, base64) through `config.ts`.
   Sealing happens in the store (`PrismaAuthStore` on write, `toStoredUser` on read), so `AuthService` is untouched.
6. **Old rows.** A value without the `v1:` prefix is read as plain text and sealed on its next write; a one-off
   backfill (`npm run seal-secrets --workspace api`, idempotent) seals the rest. It is run by the owner on each
   environment, not at boot.
7. **No key.** Outside production: secrets stay plain, with a boot warning. In production without `SECRETS_KEY`:
   a boot warning, existing secrets keep working, and **new 2FA enrolment by app is refused** (`400 INVALID`) so no
   new plain secret is written. *Owner to confirm this over "refuse to start".*
8. **Key rotation** is out of scope; the `v1:` prefix leaves room for it.

## Non-goals

- Changing cookie flags, session lifetimes, or the 2FA flows.
- Encrypting other columns (email, phone).

## Risks

- Every sign-in path touches the store contract: `auth.service.ts` (login, password change, two-factor promote,
  logout), `passkeys.ts`, `accounts.service.ts` (`enter`), `account-session.service.ts` (handoff, leave),
  `door.middleware.ts`, `rate-limit.middleware.ts`, `duplicate-guard.interceptor.ts`, `office-kernel.ts` `actor`,
  `notice-inbox.service.ts`, `branding.service.ts`, `activity-recorder.ts`. All are covered by HTTP specs; the
  Redis path only by `prisma-auth.store.spec.ts`.
- A lost `SECRETS_KEY` locks every app-2FA user out: the owner can clear 2FA per account
  (`DELETE /auth/two-factor/:loginName`). The key must be backed up with the database.
