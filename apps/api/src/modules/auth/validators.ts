import { ERROR_MESSAGES, type ErrorCode } from '../../errors';
import { isPalestineCity } from './cities';

export const LOGIN_FAIL_LIMIT = 10;
export const LOGIN_FAIL_WINDOW_SECONDS = 900;

export function loginBlocked(failedCount: number): boolean {
  return failedCount >= LOGIN_FAIL_LIMIT;
}

/** True once LOGIN_FAIL_WINDOW_SECONDS have passed since the first failure of the window. */
export function failureWindowExpired(startedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - startedAt.getTime() >= LOGIN_FAIL_WINDOW_SECONDS * 1000;
}

/** The error code of a bad full name (stored as `nickname`), or null when it is fine. */
export function fullNameProblem(value: string): ErrorCode | null {
  const length = Array.from(value.trim()).length;
  return length < 2 || length > 40 ? 'FULL_NAME_INVALID' : null;
}

/** The error code of a bad new password, or null when it is fine. */
export function newPasswordProblem(value: string): ErrorCode | null {
  return value.length < 8 ? 'PASSWORD_TOO_SHORT' : null;
}

export const ADDRESS_MAX_LENGTH = 120;

/** The error code of a bad city key, or null when it is a known city or empty. */
export function cityProblem(value: string): ErrorCode | null {
  const key = value.trim();
  return key === '' || isPalestineCity(key) ? null : 'CITY_INVALID';
}

/** The error code of a too-long address, or null when it fits. Empty clears the field. */
export function addressProblem(value: string): ErrorCode | null {
  return Array.from(value.trim()).length > ADDRESS_MAX_LENGTH ? 'ADDRESS_INVALID' : null;
}

export function validateFullName(value: string): string | null {
  const problem = fullNameProblem(value);
  return problem ? ERROR_MESSAGES[problem] : null;
}

export function validateNewPassword(value: string): string | null {
  const problem = newPasswordProblem(value);
  return problem ? ERROR_MESSAGES[problem] : null;
}
