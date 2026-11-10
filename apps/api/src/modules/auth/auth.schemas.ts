import { z } from 'zod';
import { SESSION_LIMIT_RANGE, SESSION_MINUTES_RANGE } from './sessions';

// The bodies of the /auth routes (backend-engineering.mdc 4.1, 4.2). Fields with a code of their own (password,
// full name, email, mobile, city, address, one-time code) are only capped here: the service's validators answer
// `PASSWORD_TOO_SHORT`, `FULL_NAME_INVALID`, `EMAIL_INVALID`, … themselves.

/**
 * A body against its schema, or null when it does not fit. The auth services answer an `Outcome` instead of
 * throwing, so they turn null into `fail(400, 'INVALID')` (the login into 401 `BAD_CREDENTIALS`).
 */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> | null {
  const result = schema.safeParse(body ?? {});
  return result.success ? result.data : null;
}

/** The longest password the API reads. Its minimum is `newPasswordProblem`'s to answer. */
const PASSWORD_MAX = 1024;
const password = z.string().max(PASSWORD_MAX);
/** A one-time code as typed: six digits, with room for spaces. */
const oneTimeCode = z.string().max(32);
const email = z.string().max(254);
const phone = z.string().max(40);
/** The browser's WebAuthn answer; `@simplewebauthn/server` verifies what is inside. */
const webAuthnResponse = z.record(z.string(), z.unknown());

export const AUTH_LAYERS = ['branch', 'main_agent', 'agent', 'pos'] as const;
export const CODE_METHODS = ['sms', 'email'] as const;

/** `POST /auth/login` */
export const LoginBody = z.object({ loginName: z.string().max(200), password });
export type LoginBody = z.input<typeof LoginBody>;

/** `POST /auth/password` */
export const ChangePasswordBody = z.object({ password, nextPassword: password });
export type ChangePasswordBody = z.input<typeof ChangePasswordBody>;

/** `PATCH /auth/profile` */
export const UpdateProfileBody = z.object({
  nickname: z.string().max(200).optional(),
  email: email.optional(),
  phone: phone.optional(),
  city: z.string().max(64).optional(),
  address: z.string().max(500).optional(),
  nextPassword: password.optional(),
  currentPassword: password.optional(),
});
export type UpdateProfileBody = z.input<typeof UpdateProfileBody>;

/** `POST /auth/users/:loginName/password` */
export const SetPasswordBody = z.object({ password });
export type SetPasswordBody = z.input<typeof SetPasswordBody>;

/** `POST /auth/two-factor/confirm`, `POST /auth/two-factor/verify` */
export const TwoFactorCodeBody = z.object({ code: oneTimeCode });
export type TwoFactorCodeBody = z.input<typeof TwoFactorCodeBody>;

/** `POST /auth/two-factor/method` */
export const TwoFactorMethodBody = z.object({ method: z.enum(CODE_METHODS) });
export type TwoFactorMethodBody = z.input<typeof TwoFactorMethodBody>;

/** `POST /auth/two-factor/method/confirm` */
export const ConfirmMethodBody = z.object({ method: z.enum(CODE_METHODS), code: oneTimeCode });
export type ConfirmMethodBody = z.input<typeof ConfirmMethodBody>;

/** `PATCH /auth/policy` */
export const PolicyBody = z.object({ layer: z.enum(AUTH_LAYERS), required: z.boolean() });
export type PolicyBody = z.input<typeof PolicyBody>;

/** `PATCH /auth/exemptions/:loginName` */
export const ExemptionBody = z.object({ exempt: z.boolean() });
export type ExemptionBody = z.input<typeof ExemptionBody>;

/** `PATCH /auth/session-rules/:layer`, `PATCH /auth/users/:loginName/session-rules`: null follows the next level. */
export const SessionRulesBody = z.object({
  maxSessions: z.number().int().min(SESSION_LIMIT_RANGE.min).max(SESSION_LIMIT_RANGE.max).nullable(),
  sessionMinutes: z.number().int().min(SESSION_MINUTES_RANGE.min).max(SESSION_MINUTES_RANGE.max).nullable(),
});
export type SessionRulesBody = z.input<typeof SessionRulesBody>;

/** `PATCH /auth/users/:loginName/contact`: an empty string clears one. */
export const UserContactBody = z.object({ email: email.optional(), phone: phone.optional() });
export type UserContactBody = z.input<typeof UserContactBody>;

/** `POST /auth/passkeys` */
export const PasskeyBody = z.object({ response: webAuthnResponse, name: z.string().max(200).optional() });
export type PasskeyBody = z.input<typeof PasskeyBody>;

/** `POST /auth/passkey-login` */
export const PasskeyLoginBody = z.object({ loginId: z.string().max(100), response: webAuthnResponse });
export type PasskeyLoginBody = z.input<typeof PasskeyLoginBody>;
