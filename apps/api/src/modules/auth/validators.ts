export const LOGIN_FAIL_LIMIT = 10;
export const LOGIN_FAIL_WINDOW_SECONDS = 900;
export const RATE_LIMIT_MESSAGE = 'محاولات كثيرة. أعد المحاولة بعد قليل';
export const NICKNAME_ERROR = 'النيك نيم من حرفين إلى أربعين حرفاً';
export const PASSWORD_ERROR = 'كلمة السر ثمانية أحرف على الأقل';

export function loginBlocked(failedCount: number): boolean {
  return failedCount >= LOGIN_FAIL_LIMIT;
}

/** True once LOGIN_FAIL_WINDOW_SECONDS have passed since the first failure of the window. */
export function failureWindowExpired(startedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - startedAt.getTime() >= LOGIN_FAIL_WINDOW_SECONDS * 1000;
}

export function validateNickname(value: string): string | null {
  const length = Array.from(value.trim()).length;
  if (length < 2 || length > 40) return NICKNAME_ERROR;
  return null;
}

export function validateNewPassword(value: string): string | null {
  if (value.length < 8) return PASSWORD_ERROR;
  return null;
}
