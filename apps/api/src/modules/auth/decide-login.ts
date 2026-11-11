import { ERROR_MESSAGES, type ErrorCode } from '../../errors';

export type Layer = 'branch' | 'main_agent' | 'agent' | 'pos';
export type LoginUser = {
  id: string;
  loginName: string;
  disabledAt: Date | null;
  mustChangePassword: boolean;
  layer: Layer;
  twoFactorExempt: boolean;
  /** Account mode *required*: must enrol whatever its layer says. */
  twoFactorRequired?: boolean;
  twoFactorEnabled: boolean;
  isBranchOwner: boolean;
};

export type LoginDecision =
  | { kind: 'error'; message: string; code: ErrorCode; status: 401 | 403 }
  | {
      kind: 'session';
      next: 'app' | 'password' | 'two_factor_enroll' | 'two_factor_code';
      scope: 'full' | 'password_change' | 'two_factor';
    };

const BAD = { kind: 'error' as const, status: 401 as const, message: ERROR_MESSAGES.BAD_CREDENTIALS, code: 'BAD_CREDENTIALS' as const };

export function trialUser(layer: Layer): LoginUser {
  return {
    id: layer,
    loginName: layer === 'main_agent' ? 'main' : layer,
    disabledAt: null,
    mustChangePassword: false,
    layer,
    twoFactorExempt: true,
    twoFactorEnabled: false,
    isBranchOwner: layer === 'branch',
  };
}

/** Whether the account has to have two-step verification on, whether or not it has yet (spec 2026-11-11-two-factor-policy). */
export function mustEnrol(user: Pick<LoginUser, 'twoFactorExempt' | 'twoFactorRequired'>, layerRequired: boolean): boolean {
  return Boolean(user.twoFactorRequired) || (!user.twoFactorExempt && layerRequired);
}

export function decideLogin(input: {
  user: LoginUser | null;
  passwordMatches: boolean;
  policy: Record<Layer, boolean>;
}): LoginDecision {
  const { user, passwordMatches, policy } = input;
  if (!user || !passwordMatches) return BAD;
  if (user.disabledAt) return { kind: 'error' as const, status: 403 as const, message: ERROR_MESSAGES.ACCOUNT_DISABLED, code: 'ACCOUNT_DISABLED' as const };
  if (user.mustChangePassword) return { kind: 'session' as const, next: 'password' as const, scope: 'password_change' as const };
  const required = user.twoFactorEnabled || mustEnrol(user, policy[user.layer]);
  if (required && !user.twoFactorEnabled) {
    return { kind: 'session' as const, next: 'two_factor_enroll' as const, scope: 'two_factor' as const };
  }
  if (required && user.twoFactorEnabled) {
    return { kind: 'session' as const, next: 'two_factor_code' as const, scope: 'two_factor' as const };
  }
  return { kind: 'session' as const, next: 'app' as const, scope: 'full' as const };
}
