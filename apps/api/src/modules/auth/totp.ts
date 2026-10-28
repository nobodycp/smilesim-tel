import { authenticator } from 'otplib';

authenticator.options = { step: 30, digits: 6, window: 0 };

export function createTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpMatches(secret: string, code: string): boolean {
  return authenticator.verify({ token: code, secret });
}
