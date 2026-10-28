import { authenticator } from 'otplib';

const totp = authenticator.clone();
totp.options = { step: 30, digits: 6, window: 0 };

export function createTotpSecret(): string {
  return totp.generateSecret();
}

export function totpMatches(secret: string, code: string): boolean {
  return totp.verify({ token: code, secret });
}

export function totpKeyUri(secret: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${query.toString()}`;
}
