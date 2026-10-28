// Every call goes to the backend with the session cookie. No login policy lives here:
// the backend decides, and the pages display what it returns.

export type Next = 'password' | 'two_factor_enroll' | 'two_factor_code' | 'app';

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string };

export type Profile = { nickname?: string; email?: string; phone?: string };
export type AccountProfile = Profile & { loginName: string };

export type SessionInfo = {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

const base = () => process.env.NEXT_PUBLIC_API_URL ?? '';

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${base()}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, message: 'تعذّر الاتصال بالخادم' };
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.message === 'string' ? data.message : 'حدث خطأ';
    if (
      response.status === 401 &&
      message === 'يلزم تسجيل الدخول' &&
      typeof window !== 'undefined' &&
      window.location.pathname !== '/login'
    ) {
      window.location.assign('/login');
    }
    return { ok: false, status: response.status, message };
  }
  return { ok: true, status: response.status, data: data as T };
}

const segment = encodeURIComponent;

export const api = {
  login: (loginName: string, password: string) =>
    request<{ next: Next }>('POST', '/auth/login', { loginName, password }),
  changePassword: (password: string, nextPassword: string) =>
    request<{ next: Next }>('POST', '/auth/password', { password, nextPassword }),
  getProfile: () => request<AccountProfile>('GET', '/auth/profile'),
  updateProfile: (patch: {
    nickname?: string;
    email?: string;
    phone?: string;
    nextPassword?: string;
    currentPassword?: string;
  }) => request<Profile>('PATCH', '/auth/profile', patch),
  listSessions: () => request<{ sessions: SessionInfo[] }>('GET', '/auth/sessions'),
  revokeSession: (id: string) => request<{ ok: true }>('DELETE', `/auth/sessions/${segment(id)}`),
  setupTwoFactor: () => request<{ otpauth: string }>('POST', '/auth/two-factor/setup'),
  confirmTwoFactor: (code: string) => request<{ next: Next }>('POST', '/auth/two-factor/confirm', { code }),
  verifyTwoFactor: (code: string) => request<{ next: Next }>('POST', '/auth/two-factor/verify', { code }),
  disableTwoFactor: () => request<{ ok: true }>('DELETE', '/auth/two-factor'),
};

export const TWO_FACTOR_STEP_KEY = 'twoFactorStep';

// Route on the `next` field only. Both authenticator steps go to `/two-factor` with no
// query string; which step it is travels in sessionStorage.
export function routeFor(next: Next): string {
  switch (next) {
    case 'password':
      return '/password';
    case 'two_factor_enroll':
      sessionStorage.setItem(TWO_FACTOR_STEP_KEY, 'enroll');
      return '/two-factor';
    case 'two_factor_code':
      sessionStorage.setItem(TWO_FACTOR_STEP_KEY, 'code');
      return '/two-factor';
    case 'app':
      return '/settings';
  }
}
