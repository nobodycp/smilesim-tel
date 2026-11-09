// Every environment variable the API reads, in one place (backend-engineering.mdc 5.7). Nothing else touches
// `process.env`. Values are read when asked, not at import, so a spec can set one before building its app.

export const ENV_NAMES = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'REDIS_URL',
  'WEB_ORIGIN',
  'COOKIE_DOMAIN',
  'COOKIE_SECURE',
  'WEBAUTHN_RP_ID',
  'PROVIDER_SIMULATION',
  'TRUST_PROXY',
] as const;

export type EnvName = (typeof ENV_NAMES)[number];

/** The value of one known variable; `undefined` when unset or empty. */
export function env(name: EnvName): string | undefined {
  return process.env[name] || undefined;
}

export function isProduction(): boolean {
  return env('NODE_ENV') === 'production';
}

export function isTest(): boolean {
  return env('NODE_ENV') === 'test';
}
