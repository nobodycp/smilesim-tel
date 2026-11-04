import { generateSecret, generateSync, generateURI, verifySync } from 'otplib';

const totp = { digits: 6 as const, period: 30, epochTolerance: 0 };

export function createTotpSecret(): string {
  return generateSecret();
}

export function totpMatches(secret: string, code: string): boolean {
  try {
    return verifySync({ secret, token: code, ...totp }).valid;
  } catch {
    return false;
  }
}

export function totpKeyUri(secret: string, account: string, issuer: string): string {
  return generateURI({ issuer, label: account, secret, algorithm: 'sha1', ...totp });
}

export function currentTotp(secret: string): string {
  return generateSync({ secret, ...totp });
}
