import { ERROR_MESSAGES, type ErrorCode } from '../../errors';

export const LOGIN_FAIL_LIMIT = 10;
export const LOGIN_FAIL_WINDOW_SECONDS = 900;

export function loginBlocked(failedCount: number): boolean {
  return failedCount >= LOGIN_FAIL_LIMIT;
}

/** True once LOGIN_FAIL_WINDOW_SECONDS have passed since the first failure of the window. */
export function failureWindowExpired(startedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - startedAt.getTime() >= LOGIN_FAIL_WINDOW_SECONDS * 1000;
}

/** The error code of a bad nickname, or null when it is fine. */
export function nicknameProblem(value: string): ErrorCode | null {
  const length = Array.from(value.trim()).length;
  return length < 2 || length > 40 ? 'NICKNAME_INVALID' : null;
}

/** The error code of a bad new password, or null when it is fine. */
export function newPasswordProblem(value: string): ErrorCode | null {
  return value.length < 8 ? 'PASSWORD_TOO_SHORT' : null;
}

export function validateNickname(value: string): string | null {
  const problem = nicknameProblem(value);
  return problem ? ERROR_MESSAGES[problem] : null;
}

export function validateNewPassword(value: string): string | null {
  const problem = newPasswordProblem(value);
  return problem ? ERROR_MESSAGES[problem] : null;
}
