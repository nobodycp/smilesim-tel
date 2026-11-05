'use client';

import { useOffice } from '../lib/office-session';

/** `login (Full Name)` as plain text, for option labels and aria labels. Just the login when the name is missing or the same. */
export function accountLabel(login: string, name?: string | null): string {
  const full = (name ?? '').trim();
  return full && full !== login ? `${login} (${full})` : login;
}

/** `accountLabel` with the session directory filling in a name the caller does not hold. */
export function useAccountLabel() {
  const { names } = useOffice();
  return (login: string, name?: string | null) => accountLabel(login, name ?? names[login]);
}

/**
 * A reference to an account: the login name, then the full name in parentheses.
 * The name comes from the prop when the row carries it, else from the session directory.
 */
export function AccountName({ login, name, className }: { login: string | null | undefined; name?: string | null; className?: string }) {
  const { names } = useOffice();
  if (!login) return <>—</>;
  const full = (name ?? names[login] ?? '').trim();
  return (
    <span className={className ? `account-name ${className}` : 'account-name'}>
      <bdi dir="ltr">{login}</bdi>
      {full && full !== login ? (
        <>
          {' '}
          <span className="account-full">(<bdi>{full}</bdi>)</span>
        </>
      ) : null}
    </span>
  );
}
