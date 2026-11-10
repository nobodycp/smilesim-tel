import { buildTrialSeed, trialSeedDecision } from './trial-seed';

describe('buildTrialSeed', () => {
  it('links the four ready accounts and keeps their login exceptions', () => {
    const accounts = buildTrialSeed();
    expect(accounts.map((account) => account.loginName)).toEqual(['branch', 'main', 'agent', 'pos']);
    expect(accounts.map((account) => account.parentLoginName)).toEqual([null, 'branch', 'main', 'agent']);
    for (const account of accounts) {
      expect(account.mustChangePassword).toBe(false);
      expect(account.twoFactorExempt).toBe(true);
      expect(account.email).toBeNull();
      expect(account.phone).toBeNull();
    }
    expect(accounts[0].isBranchOwner).toBe(true);
    expect(accounts[1].isBranchOwner).toBe(false);
  });
});

describe('trialSeedDecision', () => {
  it('is closed unless TRIAL_SEED is true', () => {
    for (const TRIAL_SEED of [undefined, '', 'false', '0', 'yes']) {
      expect(trialSeedDecision({ TRIAL_SEED, NODE_ENV: 'development' })).toEqual({ allowed: false, reason: 'not-enabled' });
    }
  });

  it('is open outside production with TRIAL_SEED=true', () => {
    expect(trialSeedDecision({ TRIAL_SEED: 'true' })).toEqual({ allowed: true, production: false });
    expect(trialSeedDecision({ TRIAL_SEED: 'true', NODE_ENV: 'development' })).toEqual({ allowed: true, production: false });
    expect(trialSeedDecision({ TRIAL_SEED: ' TRUE ', NODE_ENV: 'test' })).toEqual({ allowed: true, production: false });
  });

  it('stays closed in production without the second flag', () => {
    expect(trialSeedDecision({ TRIAL_SEED: 'true', NODE_ENV: 'production' })).toEqual({ allowed: false, reason: 'production-blocked' });
    expect(trialSeedDecision({ TRIAL_SEED: 'true', NODE_ENV: 'production', TRIAL_SEED_ALLOW_PRODUCTION: 'false' })).toEqual({
      allowed: false,
      reason: 'production-blocked',
    });
  });

  it('opens in production only with both flags', () => {
    expect(trialSeedDecision({ TRIAL_SEED: 'true', NODE_ENV: 'production', TRIAL_SEED_ALLOW_PRODUCTION: 'true' })).toEqual({
      allowed: true,
      production: true,
    });
  });

  it('ignores the production flag alone', () => {
    expect(trialSeedDecision({ NODE_ENV: 'production', TRIAL_SEED_ALLOW_PRODUCTION: 'true' })).toEqual({ allowed: false, reason: 'not-enabled' });
  });
});
