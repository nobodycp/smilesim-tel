import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { request, segment } from '../../lib/http';
import type { AccountProfile, AccountSessionRules, LayerKey, SessionRuleValues, SessionRulesView, CodeSent, Next, PasskeyInfo, Profile, SessionInfo, SignInMethods, TwoFactorMethod } from '../../lib/api-types';

type Result<T> = Awaited<ReturnType<typeof request<T>>>;
/** The browser's own prompt refused or was dismissed: a failure the page shows, never a thrown error. */
const passkeyRefused = <T,>(): Result<T> => ({ ok: false, status: 0, message: 'تعذّر التحقق من مفتاح المرور', code: 'PASSKEY_FAILED' }) as Result<T>;

/** The auth calls of the office API. Composed into `api` by lib/api.ts. */
export const authApi = {
  login: (loginName: string, password: string) =>
    request<{ next: Next }>('POST', '/auth/login', { loginName, password }),
  changePassword: (password: string, nextPassword: string) =>
    request<{ next: Next }>('POST', '/auth/password', { password, nextPassword }),
  getProfile: () => request<AccountProfile>('GET', '/auth/profile'),
  updateProfile: (patch: {
    nickname?: string;
    email?: string;
    phone?: string;
    city?: string;
    address?: string;
    nextPassword?: string;
    currentPassword?: string;
  }) => request<Profile>('PATCH', '/auth/profile', patch),
  listSessions: () => request<{ sessions: SessionInfo[] }>('GET', '/auth/sessions'),
  revokeSession: (id: string) => request<{ ok: true }>('DELETE', `/auth/sessions/${segment(id)}`),
  setupTwoFactor: () => request<{ otpauth: string }>('POST', '/auth/two-factor/setup'),
  confirmTwoFactor: (code: string) => request<{ next: Next }>('POST', '/auth/two-factor/confirm', { code }),
  verifyTwoFactor: (code: string) => request<{ next: Next }>('POST', '/auth/two-factor/verify', { code }),
  sessionRules: () => request<SessionRulesView>('GET', '/auth/session-rules'),
  setLayerSessionRules: (layer: LayerKey, values: SessionRuleValues) =>
    request<{ layers: SessionRulesView['layers'] }>('PATCH', `/auth/session-rules/${segment(layer)}`, values),
  accountSessionRules: (loginName: string) => request<AccountSessionRules>('GET', `/auth/users/${segment(loginName)}/session-rules`),
  setAccountSessionRules: (loginName: string, values: SessionRuleValues) =>
    request<AccountSessionRules>('PATCH', `/auth/users/${segment(loginName)}/session-rules`, values),
  disableTwoFactor: () => request<{ ok: true }>('DELETE', '/auth/two-factor'),
  signInMethods: () => request<SignInMethods>('GET', '/auth/sign-in-methods'),
  /** Enrolment by SMS or email: the API sends a code to the account's phone or email. */
  chooseTwoFactorMethod: (method: Exclude<TwoFactorMethod, 'app'>) => request<CodeSent>('POST', '/auth/two-factor/method', { method }),
  confirmTwoFactorMethod: (method: Exclude<TwoFactorMethod, 'app'>, code: string) =>
    request<{ next: Next }>('POST', '/auth/two-factor/method/confirm', { method, code }),
  /** At the sign-in challenge: sends the SMS or email code; the app method sends nothing. */
  sendTwoFactorCode: () => request<{ method: TwoFactorMethod } & Partial<CodeSent>>('POST', '/auth/two-factor/send'),
  removePasskey: (id: string) => request<{ ok: true }>('DELETE', `/auth/passkeys/${segment(id)}`),
  /** Asks the API for options, lets the browser create the passkey, and hands its answer back. */
  addPasskey: async (name: string): Promise<Result<PasskeyInfo>> => {
    const options = await request<Parameters<typeof startRegistration>[0]['optionsJSON']>('POST', '/auth/passkeys/options');
    if (!options.ok) return options;
    let response: Awaited<ReturnType<typeof startRegistration>>;
    try {
      response = await startRegistration({ optionsJSON: options.data });
    } catch {
      return passkeyRefused();
    }
    return request<PasskeyInfo>('POST', '/auth/passkeys', { response, name });
  },
  /** Sign-in with any passkey of this site; it stands for the password and the second step. */
  passkeyLogin: async (): Promise<Result<{ next: Next }>> => {
    const begin = await request<{ loginId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>('POST', '/auth/passkey-login/options');
    if (!begin.ok) return begin;
    let response: Awaited<ReturnType<typeof startAuthentication>>;
    try {
      response = await startAuthentication({ optionsJSON: begin.data.options });
    } catch {
      return passkeyRefused();
    }
    return request<{ next: Next }>('POST', '/auth/passkey-login', { loginId: begin.data.loginId, response });
  },
};
