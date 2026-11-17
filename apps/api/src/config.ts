// Every environment variable the API reads, in one place (backend-engineering.mdc 5.7). Nothing else touches
// `process.env`. Values are read when asked, not at import, so a spec can set one before building its app.

export const ENV_NAMES = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  // The most connections the process's main database pool opens (DB.15): the API's (default 20) or the worker's
  // (default 10). `db.ts` states every other pool and the time limits.
  'DATABASE_POOL_MAX',
  'REDIS_URL',
  'WEB_ORIGIN',
  'COOKIE_DOMAIN',
  'COOKIE_SECURE',
  'WEBAUTHN_RP_ID',
  'PROVIDER_SIMULATION',
  'PROVIDER_DISPATCH',
  'PROVIDER_ADAPTERS',
  'PROVIDER_TARGET',
  'DEPLOYMENT_ID',
  'TRUST_PROXY',
  'TRIAL_SEED',
  'TRIAL_SEED_ALLOW_PRODUCTION',
  'SECRETS_KEY',
  // The commit the build was made from, when the deployment gives it (Coolify sets it); shown by the system status.
  'SOURCE_COMMIT',
  // `off` stops every outbound call of the versions page (system monitor M.11): the npm registry and endoflife.date.
  // Any other value, or none, leaves the daily check on.
  'VERSION_CHECK',
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

/** The whole environment, for the few functions that take it as an argument so a spec can hand them its own. */
export function wholeEnv(): Record<string, string | undefined> {
  return process.env;
}


/** The most `DATABASE_POOL_MAX` may ask for: past about 80 connections the office needs PgBouncer, not a bigger pool. */
export const POOL_MAX_CEILING = 80;

/**
 * `DATABASE_POOL_MAX` read as a number of connections: `undefined` when it is unset (the process's default is
 * used), `null` when it is set to anything but a whole number from 1 to `POOL_MAX_CEILING`.
 */
export function poolMaxSetting(value: string | undefined): number | null | undefined {
  const text = value?.trim() ?? '';
  if (text === '') return undefined;
  if (!/^\d+$/.test(text)) return null;
  const count = Number(text);
  return count >= 1 && count <= POOL_MAX_CEILING ? count : null;
}
