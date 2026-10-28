import { Layer } from './decide-login';

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
