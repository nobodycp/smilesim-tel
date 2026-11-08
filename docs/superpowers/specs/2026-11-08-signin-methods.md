# Sign-in: Passkeys and a choice of 2FA method (roadmap N9)

Date: 2026-11-08 · Status: done · Owner: «Passkeys، والتحقق الثنائي بالرسائل وبالإيميل؛ الافتراضي التطبيق، والمستخدم يقدر يغيّر. نبني الأساس ونحدد المزود لاحقاً»

## 2FA method

- `User.twoFactorMethod`: `app` (default, the authenticator code as today), `sms` or `email`.
- Choosing SMS or email (settings, or the enrollment page when 2FA is required): the API sends a six-digit code to the
  account's phone or email; entering it sets the method and turns 2FA on. Choosing the app keeps today's QR flow.
- At sign-in with SMS or email, the two-factor page asks the API to send a code (`POST /auth/two-factor/send`, at most
  once every 30 seconds) and shows where it went (masked). A code lives 5 minutes and allows 5 tries; it is stored
  hashed. The app method is unchanged.
- **Sender:** `MessageSender` (`auth/message-sender.ts`), one interface for SMS and email. Until the owner picks the
  gateways, `LogSender` writes the message to the server log (never the code to an API answer); a gateway is a new
  class behind the same token.

## Passkeys

- `Passkey` (credential id, public key, counter, transports, name, last used) per user, through `@simplewebauthn`.
- Settings: list, «إضافة مفتاح» (registration), delete. The browser's own prompt does the rest.
- Login page: «الدخول بمفتاح المرور» signs in with any passkey of an account on this door; a passkey is a strong
  factor on its own, so it skips the password and the 2FA step. Door, disabled account and session limit rules stay.
- Relying party: `WEBAUTHN_RP_ID` (default: the request host without its first label, so `admin.x.com` and `pos.x.com`
  share `x.com`; `*.localhost` → `localhost`), origin from the request's `Origin`, checked against the CORS list.
- Challenges live 5 minutes in Redis (memory in specs), keyed by session or by a one-time login id.

## Checked

`auth/sign-in-methods.http.spec.ts` (SMS enrolment from settings with a resend throttle; a code for one method does not
confirm another; email challenge with five wrong tries then expired; the right code makes a full session; the app sends
nothing; enrolment by email when the layer requires it; a password-only session may not switch; passkey add, sign-in,
replayed challenge, door, disabled account, unproven and unknown passkey; delete only one's own; RP ID rules) and
`tests/sign-in-methods.spec.ts` (settings SMS, missing contact, the code page countdown, and a real passkey made by
Chrome's virtual authenticator, then used to sign in). Decision record: ADR 0007. On Docker: the branch trial account chose email, the code from the log turned it on,
the next sign-in asked for a code, a wrong one was refused and the sent one gave a full session; passkey options came
back for RP `localhost`; an origin outside `WEB_ORIGIN` was refused. 2FA was switched off again afterwards.
