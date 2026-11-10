import { z } from 'zod';
import { loginName, optionalText } from '../../shared/schemas';

// The bodies of the account routes (backend-engineering.mdc 4.1, 4.2). A full name and a password are only capped
// here: `fullNameProblem` and `newPasswordProblem` answer their own codes in the service.

/** The longest password the API reads. Its minimum is `newPasswordProblem`'s to answer. */
const PASSWORD_MAX = 1024;
const password = z.string().max(PASSWORD_MAX).optional().default('');

/** A list of grant codes or role ids. */
const codes = z.array(z.string().max(64)).max(200).optional().default([]);

/** What an account may be opened as: a layer below the actor, or an employee of the branch. */
export const CREATE_LAYERS = ['main_agent', 'agent', 'pos', 'staff'] as const;

/** `POST /office/users` */
export const CreateUserBody = z.object({
  loginName,
  nickname: optionalText(200),
  password,
  layer: z.enum(CREATE_LAYERS),
  parentLogin: optionalText(64),
  roleId: optionalText(64),
});
export type CreateUserBody = z.input<typeof CreateUserBody>;

/** `POST /office/users/:loginName/password` */
export const SetAccountPasswordBody = z.object({ password });
export type SetAccountPasswordBody = z.input<typeof SetAccountPasswordBody>;

/** `PATCH /office/users/:loginName/access` */
export const AccessBody = z.object({
  extraGrants: codes,
  deniedGrants: codes,
  extraRoleIds: codes,
  roleId: optionalText(64),
});
export type AccessBody = z.input<typeof AccessBody>;

/** `POST /office/handoff` */
export const HandoffBody = z.object({ code: z.string().min(1).max(100) });
export type HandoffBody = z.input<typeof HandoffBody>;
