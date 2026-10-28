import { hashPassword } from './password';
import { MemoryAuthStore } from './auth.store';
import { buildTrialSeed } from './trial-seed';

export const TRIAL_PASSWORD = '123456';

/** The default store: the four trial accounts, so a freshly booted server can be logged into. */
export async function createTrialStore(): Promise<MemoryAuthStore> {
  const store = new MemoryAuthStore();
  for (const account of buildTrialSeed()) {
    store.addUser({
      id: account.loginName,
      loginName: account.loginName,
      disabledAt: null,
      mustChangePassword: account.mustChangePassword,
      layer: account.layer,
      twoFactorExempt: account.twoFactorExempt,
      twoFactorEnabled: false,
      isBranchOwner: account.isBranchOwner,
      email: account.email ?? undefined,
      phone: account.phone ?? undefined,
      passwordHash: await hashPassword(TRIAL_PASSWORD),
    });
  }
  return store;
}
