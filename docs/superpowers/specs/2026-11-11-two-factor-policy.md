# Two-step verification policy per layer and per account — spec

Owner request, 2026-11-11 (paraphrased from Arabic): the two-step verification section of the user page looks poor
and must be arranged like the rest of the system. Two-step verification must also be settable **per layer**: required
or optional. When it becomes required, every live session of an account that has no two-step verification is ended.
When it is required the owner picks the layer's **default method** from a list and the other methods disappear. The
same control exists **per account**.

## Today

- `LayerPolicy.required` and `User.twoFactorExempt` exist; `PATCH /auth/policy` exists but **no screen uses it**, so
  the policy can only be changed by calling the API.
- The account pane has one badge and one button («تشغيل/إيقاف التحقق بخطوتين») that only flips the exemption. «تشغيل»
  does nothing while the layer is optional.
- When a layer becomes required, accounts that are already signed in keep their sessions until they sign out.
- The enrolment screen always offers the three methods (app, SMS, email).

## Rules

1. **Layer.** A layer is *optional* (default) or *required*, with a **default method** (`app` | `sms` | `email`,
   default `app`) that applies only while it is required.
2. **Account.** An account is in one of three modes:
   - **follow** (default): the layer decides;
   - **required**: this account must enrol whatever the layer says, with its own method or, when none is set, the
     layer's default;
   - **optional**: this account is exempt even when its layer is required (today's `twoFactorExempt`).
3. **Effective rule** of an account: *required* when it already has two-step on, or its mode is required, or its mode
   is follow and its layer is required. *Fixed method* when it is required and not yet enrolled: the account's own
   method, else the layer's. Otherwise any method may be chosen.
4. **Enrolment** (app, SMS, email) refuses a method other than the fixed one (`400 METHOD_NOT_ALLOWED`); the
   enrolment screen and the sign-in settings show only the fixed method. An account that is already enrolled keeps its
   method (changing the policy never forces a re-enrolment).
5. **Ending sessions.** When a layer is saved as *required*, or an account is saved as *required* (or *follow* under a
   required layer), or an account's enrolment is reset, every live session (any scope) of each affected account that has no two-step verification and is
   not exempt is revoked. The account signs in again and lands on the enrolment step. The acting owner's own account
   is skipped, so the owner cannot lock themself out mid-change. The response says how many accounts were signed out.
6. **Disabling.** An account may turn two-step off for itself only when its effective rule is not required (as today,
   now including the account-level *required* mode).
7. Only the branch owner (a non-entered session) changes policy, as today. Every change writes the existing
   `two_factor` audit entry.

## Data

- `LayerPolicy.method String @default("app")`.
- `User.twoFactorRequired Boolean @default(false)`, `User.requiredMethod String?` (null follows the layer).
- Mode ↔ columns: follow = (`twoFactorExempt` false, `twoFactorRequired` false); required = (false, true);
  optional = (true, false). Setting one clears the other. Migration: additive columns with defaults, no backfill.

## API (paths of existing endpoints unchanged)

- `GET /auth/policy` → `{ policy: Record<Layer, { required, method }> }` (branch owner).
- `PATCH /auth/policy` body `{ layer, required?, method? }` (at least one) → `{ policy, endedAccounts }`.
- `GET /auth/users/:loginName/settings` adds `twoFactorMode`, `requiredMethod`, `effective { required, method }`.
- `PATCH /auth/users/:loginName/two-factor` body `{ mode, method? }` → `{ settings, endedAccounts }`.
- `PATCH /auth/exemptions/:loginName` stays as the shorthand for optional/follow.
- `GET /auth/sign-in-methods` adds `required` and `allowedMethods`.
- New error code `METHOD_NOT_ALLOWED` (ar/en/he).

## Screens

- **Layer role dialog** (`/roles`, layer roles only): a «التحقق بخطوتين» block under the session rules — a two-way
  control *optional | required*; when required, a labelled list «الطريقة الافتراضية» (app / SMS / email) and a hint
  that sessions without two-step are ended on save. When optional the list is hidden. Saved with the dialog's Save.
- **Account settings pane** (user page → «الإعدادات والصلاحيات»): the two-step block redrawn in the system's own
  language — the same labelled-field look as the session fields, a three-way `.seg` (*follow the layer | required |
  optional*), the method list shown only for *required*, a status line (enrolled with which method / not enrolled) and
  a «إعادة تعيين» button that clears the account's enrolment. Saved with the pane's Save.
- **Enrolment / own sign-in settings**: only the allowed method(s) are shown; with a single one the choice cards go
  and its name is stated.

## Out of scope

- Forcing already-enrolled accounts onto a new method.
- A per-layer end-of-grace period; sessions end at once.
- Staff-role control of this setting (owner only, ADR 0006 keeps the grants unenforced).
