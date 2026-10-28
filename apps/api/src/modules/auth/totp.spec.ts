import { authenticator } from 'otplib';
import { createTotpSecret, totpMatches } from './totp';

describe('totp', () => {
  it('accepts the current six-digit code only', () => {
    const secret = createTotpSecret();
    const code = authenticator.generate(secret);
    expect(totpMatches(secret, code)).toBe(true);
    expect(totpMatches(secret, '000000')).toBe(false);
  });
});
