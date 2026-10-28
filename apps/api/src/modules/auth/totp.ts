import { authenticator } from 'otplib';

const totp = authenticator.clone();
totp.options = { step: 30, digits: 6, window: 0 };

export function createTotpSecret(): string {
  return totp.generateSecret();
}

export function totpMatches(secret: string, code: string): boolean {
  return totp.verify({ token: code, secret });
}
