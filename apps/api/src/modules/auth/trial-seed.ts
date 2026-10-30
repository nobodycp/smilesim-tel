import { Layer } from './decide-login';

export const TRIAL_PASSWORD = '123456';

/**
 * The trial accounts have a published password, so seeding them is opt-in.
 * TRIAL_SEED=true turns it on. In production (NODE_ENV=production) it also needs
 * TRIAL_SEED_ALLOW_PRODUCTION=true, a second flag that has to be written on purpose.
 */
export type TrialSeedDecision =
  | { allowed: true; production: boolean }
  | { allowed: false; reason: 'not-enabled' | 'production-blocked' };

const isTrue = (value: string | undefined) => value?.trim().toLowerCase() === 'true';

export function trialSeedDecision(env: Record<string, string | undefined>): TrialSeedDecision {
  if (!isTrue(env.TRIAL_SEED)) return { allowed: false, reason: 'not-enabled' };
  const production = env.NODE_ENV === 'production';
  if (production && !isTrue(env.TRIAL_SEED_ALLOW_PRODUCTION)) return { allowed: false, reason: 'production-blocked' };
  return { allowed: true, production };
}

export type TrialAccount = {
  loginName: string;
  layer: Layer;
  parentLogin: string | null;
  isBranchOwner: boolean;
  mustChangePassword: false;
  twoFactorExempt: true;
  email: null;
  phone: null;
};

export function buildTrialSeed(): TrialAccount[] {
  return [
    { loginName: 'branch', layer: 'branch', parentLogin: null, isBranchOwner: true, mustChangePassword: false, twoFactorExempt: true, email: null, phone: null },
    { loginName: 'main', layer: 'main_agent', parentLogin: 'branch', isBranchOwner: false, mustChangePassword: false, twoFactorExempt: true, email: null, phone: null },
    { loginName: 'agent', layer: 'agent', parentLogin: 'main', isBranchOwner: false, mustChangePassword: false, twoFactorExempt: true, email: null, phone: null },
    { loginName: 'pos', layer: 'pos', parentLogin: 'agent', isBranchOwner: false, mustChangePassword: false, twoFactorExempt: true, email: null, phone: null },
  ];
}
