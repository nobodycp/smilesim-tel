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
2. The migration hashed the old session ids with PostgreSQL's built-in `sha256`. A fallback that read the old
   Redis key was planned to stay until 2026-12-15; the owner had it removed on 2026-11-10, so a session opened
   before that day and not used since signs in again.
3. Authenticator secrets are sealed with AES-256-GCM under `SECRETS_KEY` (`shared/secret-box.ts`, prefix `v1:`).
   A secret stored before the key was set stays readable; `npm run seal-secrets --workspace api` seals them once.
4. Without a key nothing is sealed and the API warns at start in production. A production API without a key
   refuses a new authenticator enrolment (`403 APP_CODE_UNAVAILABLE`; owner's decision, 2026-11-10, plan item T.3).

## Consequences

- A lost `SECRETS_KEY` locks app-2FA users out until the owner clears 2FA on each account: the key is backed up
  with the database.
- `architecture.spec.ts` `session-id-as-token` (0) keeps the id out of cookies and Redis keys.
