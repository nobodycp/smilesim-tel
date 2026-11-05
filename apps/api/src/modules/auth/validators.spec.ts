import { addressProblem, cityProblem, failureWindowExpired, loginBlocked, validateFullName, validateNewPassword } from './validators';

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

  it('accepts a full name of two to forty characters', () => {
    expect(validateFullName('أب')).toBeNull();
    expect(validateFullName('أ')).toMatch(/حرفين/);
  });

  it('rejects a new password shorter than eight characters', () => {
    expect(validateNewPassword('1234567')).toMatch(/ثمانية/);
    expect(validateNewPassword('12345678')).toBeNull();
  });

  it('accepts a listed city or an empty city and refuses anything else', () => {
    expect(cityProblem('ramallah')).toBeNull();
    expect(cityProblem('gaza')).toBeNull();
    expect(cityProblem('')).toBeNull();
    expect(cityProblem('atlantis')).toBe('CITY_INVALID');
    expect(cityProblem('Ramallah')).toBe('CITY_INVALID');
  });

  it('accepts an address up to 120 characters', () => {
    expect(addressProblem('')).toBeNull();
    expect(addressProblem('ش'.repeat(120))).toBeNull();
    expect(addressProblem('ش'.repeat(121))).toBe('ADDRESS_INVALID');
  });
});
