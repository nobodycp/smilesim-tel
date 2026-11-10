# 0013 — The session cookie is a token; authenticator secrets are sealed

Date: 2026-11-10. Status: accepted. Spec and plan:
`docs/superpowers/{specs,plans}/2026-11-10-session-and-secret-storage.md`.

## Context

The session cookie carried the session row's id, the same value the database and Redis keyed on and
`GET /auth/sessions` listed: whoever could read the table or that list could use a session. Authenticator (TOTP)
secrets were stored as they were issued.

## Decision

1. The cookie is a random token (`auth/session-token.ts`). The database keeps its SHA-256 (`Session.tokenHash`),
   Redis keys on `session:<tokenHash>`, and `Session.id` is a public handle that opens nothing.
2. Sessions opened before the change keep working: the migration hashed the old ids with PostgreSQL's built-in
   `sha256`, and `PrismaAuthStore.hasLiveKey` still reads the old Redis key. That fallback is removed after
   2026-12-15.
3. Authenticator secrets are sealed with AES-256-GCM under `SECRETS_KEY` (`shared/secret-box.ts`, prefix `v1:`).
   A secret stored before the key was set stays readable; `npm run seal-secrets --workspace api` seals them once.
4. Without a key nothing is sealed and the API warns at start in production. Refusing new enrolment there instead
   is the owner's open decision (plan item T.3).

## Consequences

- A lost `SECRETS_KEY` locks app-2FA users out until the owner clears 2FA on each account: the key is backed up
  with the database.
- `architecture.spec.ts` `session-id-as-token` (0) keeps the id out of cookies and Redis keys.
