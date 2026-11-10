import { ProductionConfigError, assertProductionConfig, productionConfigProblems, trustedProxyHops } from './production-config';

const KEY = Buffer.alloc(32, 7).toString('base64');
const REDIS = 'redis://:redis-password-value@redis:6379';

/** A production environment with nothing wrong in it. */
const safe = (over: Record<string, string | undefined> = {}) => ({
  NODE_ENV: 'production',
  COOKIE_SECURE: 'true',
  WEB_ORIGIN: 'https://app.example.com,https://admin.example.com',
  REDIS_URL: REDIS,
  TRUST_PROXY: '1',
  SECRETS_KEY: KEY,
  ...over,
});

const named = (env: Record<string, string | undefined>) => productionConfigProblems(env).map((problem) => problem.split(':')[0]);

describe('production configuration', () => {
  it('lets a complete production environment start', () => {
    expect(productionConfigProblems(safe())).toEqual([]);
    expect(() => assertProductionConfig(safe())).not.toThrow();
    // The simulation switched off by name, trial flags written as off, and a direct deployment are all in order.
    expect(productionConfigProblems(safe({ PROVIDER_SIMULATION: '0', TRIAL_SEED: 'false', TRIAL_SEED_ALLOW_PRODUCTION: 'false', TRUST_PROXY: '0' }))).toEqual([]);
  });

  it('checks nothing outside production', () => {
    for (const NODE_ENV of [undefined, 'development', 'test']) {
      expect(productionConfigProblems({ NODE_ENV, PROVIDER_SIMULATION: '1', TRIAL_SEED: 'true' })).toEqual([]);
    }
  });

  it('names every missing setting of a bare production environment', () => {
    expect(named({ NODE_ENV: 'production' })).toEqual(['COOKIE_SECURE', 'WEB_ORIGIN', 'REDIS_URL', 'TRUST_PROXY', 'SECRETS_KEY']);
    expect(() => assertProductionConfig({ NODE_ENV: 'production' })).toThrow(ProductionConfigError);
  });

  it.each([
    ['COOKIE_SECURE', { COOKIE_SECURE: 'false' }],
    ['COOKIE_SECURE', { COOKIE_SECURE: '1' }],
    ['WEB_ORIGIN', { WEB_ORIGIN: undefined }],
    ['WEB_ORIGIN', { WEB_ORIGIN: 'http://app.example.com' }],
    ['WEB_ORIGIN', { WEB_ORIGIN: 'https://app.example.com,http://localhost:3000' }],
    ['WEB_ORIGIN', { WEB_ORIGIN: 'https://app.example.com/path' }],
    ['WEB_ORIGIN', { WEB_ORIGIN: '*' }],
    ['REDIS_URL', { REDIS_URL: undefined }],
    ['REDIS_URL', { REDIS_URL: 'http://redis:6379' }],
    ['TRUST_PROXY', { TRUST_PROXY: undefined }],
    ['TRUST_PROXY', { TRUST_PROXY: 'true' }],
    ['TRUST_PROXY', { TRUST_PROXY: '-1' }],
    ['TRUST_PROXY', { TRUST_PROXY: '1.5' }],
    ['SECRETS_KEY', { SECRETS_KEY: undefined }],
    ['SECRETS_KEY', { SECRETS_KEY: Buffer.alloc(16, 1).toString('base64') }],
    ['PROVIDER_SIMULATION', { PROVIDER_SIMULATION: '1' }],
    ['PROVIDER_SIMULATION', { PROVIDER_SIMULATION: 'true' }],
    ['TRIAL_SEED', { TRIAL_SEED: 'true' }],
    ['TRIAL_SEED', { TRIAL_SEED: ' TRUE ' }],
    ['TRIAL_SEED_ALLOW_PRODUCTION', { TRIAL_SEED_ALLOW_PRODUCTION: 'true' }],
  ])('refuses an unsafe %s (%j)', (name, over) => {
    expect(named(safe(over))).toEqual([name]);
    expect(() => assertProductionConfig(safe(over))).toThrow(ProductionConfigError);
  });

  it('says which variable and why, never a value', () => {
    const secret = Buffer.alloc(16, 9).toString('base64');
    const env = safe({ SECRETS_KEY: secret, REDIS_URL: 'http://:redis-password-value@redis:6379', WEB_ORIGIN: 'http://private.example.com', PROVIDER_SIMULATION: 'on-purpose' });
    let message = '';
    try {
      assertProductionConfig(env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('Refusing to start: 4 unsafe production setting(s).');
    for (const value of [secret, 'redis-password-value', 'private.example.com', 'on-purpose']) expect(message).not.toContain(value);
  });

  it('reads the proxy hops as a whole number only', () => {
    expect([trustedProxyHops('0'), trustedProxyHops('2'), trustedProxyHops(' 1 ')]).toEqual([0, 2, 1]);
    expect([trustedProxyHops(undefined), trustedProxyHops(''), trustedProxyHops('true'), trustedProxyHops('1,2'), trustedProxyHops('-1')]).toEqual([null, null, null, null, null]);
  });
});
