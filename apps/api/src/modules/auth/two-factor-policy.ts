import { Layer, mustEnrol } from './decide-login';
import { TWO_FACTOR_METHODS, type AuthStore, type StoredUser, type TwoFactorMethod } from './auth.store';
import type { MessageSender } from './message-sender';

// Two-step verification policy per layer and per account (spec 2026-11-11-two-factor-policy): the rule that applies to
// an account, the method it must use, and the sign-out of accounts that have to have two-step and have none.

const LAYERS: readonly Layer[] = ['branch', 'main_agent', 'agent', 'pos'];

export type LayerRule = { required: boolean; method: TwoFactorMethod };

export type UserSettingsView = {
  loginName: string;
  email: string;
  phone: string;
  twoFactorEnabled: boolean;
  twoFactorExempt: boolean;
  twoFactorMethod: string;
  twoFactorMode: 'follow' | 'required' | 'optional';
  /** The method this account must use; null follows its layer's. */
  requiredMethod: TwoFactorMethod | null;
  /** What applies to the account now: whether it is required, and the one method it must use (null: any). */
  effective: { required: boolean; method: TwoFactorMethod | null };
};

/**
 * The methods that can be carried out now (spec 2026-11-12-two-factor-available-methods): the authenticator app
 * always; SMS and email only while the message sender delivers on that channel. A method outside this list is
 * not offered, cannot be set as a layer's or an account's method, and cannot be enrolled with.
 */
export function availableMethods(sender: MessageSender): TwoFactorMethod[] {
  return TWO_FACTOR_METHODS.filter((method) => method === 'app' || sender.delivers(method));
}

/**
 * The methods an account may enrol with. One when it is held to a method that is available. An account held to
 * a method that is not available (a setting stored before the method was switched off) still has to enrol, with
 * any available method: the stored setting is left as it is and the account is not locked out.
 */
export async function enrolmentChoices(store: AuthStore, sender: MessageSender, user: StoredUser): Promise<TwoFactorMethod[]> {
  const available = availableMethods(sender);
  const fixed = await fixedMethod(store, user);
  return fixed && available.includes(fixed) ? [fixed] : available;
}

/**
 * The method the account has to use while two-step verification is required of it, as it is stored: its own,
 * else its layer's; null when it is free to choose. It may name a method that is not available now.
 */
export async function fixedMethod(store: AuthStore, user: StoredUser): Promise<TwoFactorMethod | null> {
  if (!mustEnrol(user, (await store.policy())[user.layer])) return null;
  return user.requiredMethod ?? (await store.layerMethods())[user.layer];
}

/** Each layer's rule: required or optional, and the method its accounts enrol with while required. */
export async function policyView(store: AuthStore): Promise<Record<Layer, LayerRule>> {
  const [required, method] = await Promise.all([store.policy(), store.layerMethods()]);
  return Object.fromEntries(LAYERS.map((layer) => [layer, { required: required[layer], method: method[layer] }])) as Record<Layer, LayerRule>;
}

/**
 * Signs out every account among `users` that has to have two-step verification and has none: its full sessions
 * end, so the next sign-in lands on the enrolment step. A session that is already on the enrolment step stays,
 * and so does the acting owner's own account. Answers how many accounts were signed out.
 */
export async function endUnenrolledSessions(store: AuthStore, users: StoredUser[], actingUserId: string): Promise<number> {
  const policy = await store.policy();
  let ended = 0;
  for (const user of users) {
    if (user.id === actingUserId || user.twoFactorEnabled || !mustEnrol(user, policy[user.layer])) continue;
    const live = await store.listFullSessions(user.id);
    if (!live.length) continue;
    await store.revokeSessions(live.map((row) => row.id));
    ended += 1;
  }
  return ended;
}

export async function settingsView(store: AuthStore, user: StoredUser): Promise<UserSettingsView> {
  const fixed = await fixedMethod(store, user);
  return {
    loginName: user.loginName,
    email: user.email ?? '',
    phone: user.phone ?? '',
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    twoFactorExempt: Boolean(user.twoFactorExempt),
    twoFactorMethod: user.twoFactorMethod ?? 'app',
    twoFactorMode: user.twoFactorRequired ? 'required' : user.twoFactorExempt ? 'optional' : 'follow',
    requiredMethod: user.requiredMethod ?? null,
    effective: { required: Boolean(user.twoFactorEnabled) || fixed !== null, method: fixed },
  };
}
