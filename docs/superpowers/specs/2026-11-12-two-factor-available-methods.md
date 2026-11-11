# Two-step verification: only methods that can be carried out — spec

Owner request, 2026-11-12. The screens offer the authenticator app only, while the API accepted a layer or an
account held to SMS or email. An account held to one of those and not yet enrolled was shown the app, and the API
refused it (`METHOD_NOT_ALLOWED`): it could not get in. An account enrolled with SMS or email cannot receive its
code, because no gateway is connected (`LogSender`).

## Where an unusable setting could be made (inspection, before any change)

| Path | What it could store |
|---|---|
| `PATCH /auth/policy` with `method: sms \| email` | a layer's method |
| `PATCH /auth/policy` `{ required: true }` on a layer whose stored method is SMS or email | a required layer nobody can enrol under |
| `PATCH /auth/users/:loginName/two-factor` `mode: required` with `method: sms \| email`, or with no method under such a layer | an account held to it |
| `POST /auth/two-factor/method` and `/method/confirm` (own enrolment, forced or voluntary) | an account enrolled with it (in production the code never arrives, so this could not complete) |
| Rows stored before this change | any of the above |

Signing in, the code check, ending sessions and the owner's reset do not create one.

## Rules

1. **Available methods.** The app always; SMS and email only while `MessageSender.delivers(channel)` is true.
   `LogSender` delivers nothing, in any environment. `two-factor-policy.ts` `availableMethods`.
2. **New settings.** A layer's method, and an account's required method (its own, or the layer's it would follow),
   must be available. Making a layer required while its stored method is unavailable is refused too. The refusal
   is `400 METHOD_UNAVAILABLE` and comes before anything is written or any session is ended. Optional, follow and
   the app are always accepted.
3. **Enrolment.** `allowedMethods` (enrolment screen and own settings) holds only available methods: the one the
   account is held to when it is available, otherwise every available one. Enrolling with an unavailable method is
   `METHOD_UNAVAILABLE`; with an available one the account is not held to, `METHOD_NOT_ALLOWED` as before.
4. **Stored settings are kept.** Nothing is rewritten. A layer or an account stored with SMS or email reads as it
   is stored. An account held to it still has to enrol, and is offered the available methods: required stays
   required, and nobody is locked out by a method that cannot be carried out.
5. **An account enrolled with SMS or email** is not let in without its code, and its second step is not removed.
   Asking for the code answers `METHOD_UNAVAILABLE` (no code is generated or sent), which the code page shows. The
   way back is the existing one: the branch owner resets the account's two-step verification; it then enrols.
6. **Screens** never propose a method the API would refuse: when none of the API's allowed methods is on the
   screens' own list, the API's list is shown. Saving a rule as required sends a method the screens offer when the
   stored one is not.

## Existing data

`npm run two-factor-methods --workspace api` (after a build): read-only, lists layers set to SMS or email, accounts
that have to enrol and are held to one, and accounts enrolled with one. Accounts by id only; exit 0 none, 1 some,
2 failed. It changes nothing; any correction is the owner's, in the office.

## Bringing SMS and email back

1. Bind a real gateway class to `MESSAGE_SENDER` in `auth.module.ts` whose `delivers('sms')` / `delivers('email')`
   answer true for the channels it carries. The API then accepts, offers and enrols with them; nothing else changes
   in the API.
2. Add the methods to `SHOWN_METHODS` in `apps/web/features/auth/two-factor-policy.tsx`, so the owner's lists and
   the choice cards show them, and un-skip the two SMS tests in `apps/web/tests/sign-in-methods.spec.ts`.

## Out of scope

Rewriting stored settings, moving enrolled accounts to another method, any change to passkeys or passwords.
