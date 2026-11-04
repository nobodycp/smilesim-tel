import { createTotpSecret, currentTotp, totpMatches } from './totp';

describe('totp', () => {
  it('accepts the current six-digit code only', () => {
    const secret = createTotpSecret();
    const code = currentTotp(secret);
    expect(totpMatches(secret, code)).toBe(true);
    expect(totpMatches(secret, '000000')).toBe(false);
  });
});
