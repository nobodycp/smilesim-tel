import { failureWindowExpired, loginBlocked, validateNewPassword, validateNickname } from './validators';

describe('validators', () => {
  it('blocks the eleventh attempt after ten failures', () => {
    expect(loginBlocked(10)).toBe(true);
    expect(loginBlocked(9)).toBe(false);
  });

  it('ends the failure window 900 seconds after its first failure', () => {
    const started = new Date('2026-10-28T10:00:00Z');
    expect(failureWindowExpired(started, new Date('2026-10-28T10:14:59Z'))).toBe(false);
    expect(failureWindowExpired(started, new Date('2026-10-28T10:15:00Z'))).toBe(true);
  });

  it('accepts a nickname of two to forty characters', () => {
    expect(validateNickname('أب')).toBeNull();
    expect(validateNickname('أ')).toMatch(/حرفين/);
  });

  it('rejects a new password shorter than eight characters', () => {
    expect(validateNewPassword('1234567')).toMatch(/ثمانية/);
    expect(validateNewPassword('12345678')).toBeNull();
  });
});
