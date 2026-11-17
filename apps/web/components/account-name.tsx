'use client';

import { cn } from '../lib/cn';
import { useDesk } from '../lib/desk-session';

/** `login (Full Name)` as plain text, for option labels and aria labels. Just the login when the name is missing or the same. */
export function accountLabel(login: string, name?: string | null): string {
  const full = (name ?? '').trim();
  return full && full !== login ? `${login} (${full})` : login;
}

/**
 * A reference to an account: the login name, then the full name in parentheses.
 * The name comes from the prop when the row carries it, else from the session directory.
 * Look: inline, may shrink, the login in tabular digits; the full name `--rd-muted`, medium, at 0.92em, on one line. `className` places
 * the whole reference.
 */
export function AccountName({ login, name, className }: { login: string | null | undefined; name?: string | null; className?: string }) {
  const { names } = useDesk();
  if (!login) return <>—</>;
  const full = (name ?? names[login] ?? '').trim();
  return (
    <span className={cn('inline min-w-0', className)}>
      <bdi dir="ltr" className="tabular-nums">{login}</bdi>
      {full && full !== login ? (
        <>
          {' '}
          <span className="whitespace-nowrap text-[0.92em] font-medium text-muted">(<bdi>{full}</bdi>)</span>
        </>
      ) : null}
    </span>
  );
}
