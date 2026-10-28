import { buildTrialSeed } from './trial-seed';

describe('buildTrialSeed', () => {
  it('links the four ready accounts and keeps their login exceptions', () => {
    const accounts = buildTrialSeed();
    expect(accounts.map((account) => account.loginName)).toEqual(['branch', 'main', 'agent', 'pos']);
    expect(accounts.map((account) => account.parentLogin)).toEqual([null, 'branch', 'main', 'agent']);
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
