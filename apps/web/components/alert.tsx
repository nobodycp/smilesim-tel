import type { ReactNode } from 'react';

/**
 * The one error or success line (DESIGN.md → Feedback). An error is `.error` with `role="alert"`, a success is
 * `.note` with `role="status"`; `banner` gives it the page-top card. Nothing renders while there is no message, so
 * a caller writes `<Alert>{message}</Alert>` without its own guard.
 */
export function Alert({
  tone = 'error',
  banner = false,
  id,
  children,
}: {
  tone?: 'error' | 'success';
  banner?: boolean;
  id?: string;
  children?: ReactNode;
}) {
  if (children === null || children === undefined || children === false || children === '') return null;
  const base = tone === 'error' ? 'error' : 'note';
  return (
    <p className={banner ? `${base} banner` : base} id={id} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
