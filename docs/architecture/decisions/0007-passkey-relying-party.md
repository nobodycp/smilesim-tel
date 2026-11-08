# 0007 — One passkey for every door

Date: 2026-11-08 · Status: accepted

## Context

The office has four doors on four host names (`admin.`, `main.`, `agent.`, `pos.`). A passkey is bound to a relying
party ID. Binding it to the full host would make a passkey work on one door only. Binding it to the parent domain
lets one passkey work on every door, and the API still refuses a sign-in on a door that is not the account's.

## Decision

The RP ID is `WEBAUTHN_RP_ID` when set, else the page origin's host without its first label (`pos.x.com` → `x.com`,
`*.localhost` → `localhost`). The page origin must be in the CORS list (`WEB_ORIGIN`). A passkey sign-in counts as
both factors: it skips the password and the second step, but the door, a disabled account, a forced password change
and the session limit still apply.

## Consequences

- Moving the office to another domain invalidates every passkey; users add them again.
- Codes by SMS and email go through `MESSAGE_SENDER`; the gateway is a new class behind that token, nothing else changes.
