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
  'TRIAL_SEED',
  'TRIAL_SEED_ALLOW_PRODUCTION',
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

/**
 * What is unsafe about this process's settings when it runs in production. Said at boot (main.ts); it does not
 * stop the process, so a staging copy that leans on a default keeps running while the log names what to fix.
 */
export function productionWarnings(): string[] {
  if (!isProduction()) return [];
  const warnings: string[] = [];
  if (env('COOKIE_SECURE') !== 'true') warnings.push('COOKIE_SECURE is not "true": session cookies travel over plain HTTP.');
  if (!env('WEB_ORIGIN')) warnings.push('WEB_ORIGIN is not set: CORS falls back to the local development origin.');
  if (!env('REDIS_URL')) warnings.push('REDIS_URL is not set: rate limits and the duplicate-write guard live in one process only.');
  if (env('PROVIDER_SIMULATION') !== '0') warnings.push('Provider operations are simulated (PROVIDER_SIMULATION is not "0"): the client states the outcome.');
  if (!env('TRUST_PROXY')) warnings.push('TRUST_PROXY is not set: behind a proxy every caller has the proxy\'s address, so the per-address sign-in limit is off and the audit log shows one address.');
  if (env('TRIAL_SEED') === 'true') warnings.push('TRIAL_SEED is on: trial accounts with known passwords exist.');
  return warnings;
}
