// What a production process must be told before it starts (ADR 0016). One pure check over the environment, run by
// main.ts before anything is opened. It names the variable and the rule, never the value.

type Env = Record<string, string | undefined>;

const isTrue = (value: string | undefined) => value?.trim().toLowerCase() === 'true';

function parsedUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * The number of reverse proxies in front of the API, as `TRUST_PROXY` states it: `0` when callers reach the API
 * directly, a positive whole number of hops otherwise. `null` when it is unset or anything else: the API does not
 * guess the shape of the deployment.
 */
export function trustedProxyHops(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** Each unsafe production setting as `NAME: what it must be`. Empty outside production, and when all is in order. */
export function productionConfigProblems(env: Env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];

  if (env.COOKIE_SECURE !== 'true') problems.push('COOKIE_SECURE: must be "true", so the session cookie never travels over plain HTTP.');

  const origins = (env.WEB_ORIGIN ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  const httpsOrigin = (origin: string) => {
    const url = parsedUrl(origin);
    return url !== null && url.protocol === 'https:' && url.origin === origin;
  };
  if (origins.length === 0 || !origins.every(httpsOrigin)) {
    problems.push('WEB_ORIGIN: must list the public web origins, each an https origin with no path (comma-separated).');
  }

  const redis = parsedUrl(env.REDIS_URL ?? '');
  if (!redis || (redis.protocol !== 'redis:' && redis.protocol !== 'rediss:')) {
    problems.push('REDIS_URL: must be a redis:// or rediss:// address; sessions, rate limits and the duplicate-write guard are shared through it.');
  }

  if (trustedProxyHops(env.TRUST_PROXY) === null) {
    problems.push('TRUST_PROXY: must state the reverse proxies in front of the API, as a whole number: 0 when callers reach it directly, otherwise the number of hops. The per-address sign-in limit and the audit log depend on it.');
  }

  const key = env.SECRETS_KEY ?? '';
  if (Buffer.from(key, 'base64').length !== 32) {
    problems.push('SECRETS_KEY: must be 32 random bytes in base64; it seals authenticator secrets.');
  }

  const simulation = env.PROVIDER_SIMULATION;
  if (simulation !== undefined && simulation !== '' && simulation !== '0') {
    problems.push('PROVIDER_SIMULATION: must be unset or "0"; provider operations are never simulated in production.');
  }

  if (isTrue(env.TRIAL_SEED)) problems.push('TRIAL_SEED: must not be "true"; the trial accounts have a published password.');
  if (isTrue(env.TRIAL_SEED_ALLOW_PRODUCTION)) problems.push('TRIAL_SEED_ALLOW_PRODUCTION: must not be "true"; the trial accounts have a published password.');

  return problems;
}

export class ProductionConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Refusing to start: ${problems.length} unsafe production setting(s).\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ProductionConfigError';
  }
}

/** Throws when a production process is set up unsafely; does nothing anywhere else. */
export function assertProductionConfig(env: Env): void {
  const problems = productionConfigProblems(env);
  if (problems.length > 0) throw new ProductionConfigError(problems);
}
