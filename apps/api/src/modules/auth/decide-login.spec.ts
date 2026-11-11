import { decideLogin, trialUser } from './decide-login';

const openPolicy = { branch: false, main_agent: false, agent: false, pos: false };

describe('decideLogin', () => {
  it('opens a full session for a trial account', () => {
    expect(decideLogin({ user: trialUser('pos'), passwordMatches: true, policy: openPolicy }))
      .toEqual({ kind: 'session', next: 'app', scope: 'full' });
  });

  it('uses one message for an unknown user and a wrong password', () => {
    const missing = decideLogin({ user: null, passwordMatches: false, policy: openPolicy });
    const wrong = decideLogin({ user: trialUser('pos'), passwordMatches: false, policy: openPolicy });
    expect(missing).toEqual(wrong);
    expect(missing).toEqual({ kind: 'error', status: 401, message: 'بيانات الدخول غير صحيحة', code: 'BAD_CREDENTIALS' });
  });

  it('rejects a disabled account after the password matches', () => {
    const user = { ...trialUser('agent'), disabledAt: new Date('2026-10-28') };
    expect(decideLogin({ user, passwordMatches: true, policy: openPolicy }))
      .toEqual({ kind: 'error', status: 403, message: 'الحساب موقوف', code: 'ACCOUNT_DISABLED' });
  });

  it('stops a new account on password change before two-factor', () => {
    const user = { ...trialUser('pos'), mustChangePassword: true, twoFactorExempt: false };
    expect(decideLogin({ user, passwordMatches: true, policy: { ...openPolicy, pos: true } }))
      .toEqual({ kind: 'session', next: 'password', scope: 'password_change' });
  });

  it('requires enrollment when the layer is mandatory and the account is not exempt', () => {
    const user = { ...trialUser('branch'), twoFactorExempt: false, isBranchOwner: false };
    expect(decideLogin({ user, passwordMatches: true, policy: { ...openPolicy, branch: true } }))
      .toEqual({ kind: 'session', next: 'two_factor_enroll', scope: 'two_factor' });
  });

  it('requires enrollment of an account in mode required even when its layer is optional', () => {
    const user = { ...trialUser('agent'), twoFactorExempt: false, twoFactorRequired: true };
    expect(decideLogin({ user, passwordMatches: true, policy: openPolicy }))
      .toEqual({ kind: 'session', next: 'two_factor_enroll', scope: 'two_factor' });
  });

  it('lets an optional account skip a required layer', () => {
    const user = { ...trialUser('agent'), twoFactorExempt: true };
    expect(decideLogin({ user, passwordMatches: true, policy: { ...openPolicy, agent: true } }))
      .toEqual({ kind: 'session', next: 'app', scope: 'full' });
  });

  it('asks for a code when two-factor is already enabled', () => {
    const user = { ...trialUser('pos'), twoFactorEnabled: true };
    expect(decideLogin({ user, passwordMatches: true, policy: openPolicy }))
      .toEqual({ kind: 'session', next: 'two_factor_code', scope: 'two_factor' });
  });
});
