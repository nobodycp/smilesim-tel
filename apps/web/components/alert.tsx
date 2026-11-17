import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/*
 * The look (ADR 0022): no margin, 10px / 12px padding,
 * 6px corners, 13px semibold at the reading start; an error in `--rd-danger` on `--rd-danger-soft`, a success in
 * `--rd-success` on `--rd-success-soft`; a banner keeps 16px under it, except as a direct child of the `.desk` column
 * or the settings page, whose gap spaces it. Handles: `data-slot="alert"` with `data-tone` (the sign-in room's rule
 * reads them), `data-testid` `banner` / `error`.
 */
const TONE = {
  error: 'bg-danger-soft text-danger',
  success: 'bg-success-soft text-success',
} as const;

/**
 * The one error or success line (DESIGN.md → Feedback). An error has `role="alert"`, a success `role="status"`;
 * `banner` gives it the page-top card. Nothing renders while there is no message, so a caller writes
 * `<Alert>{message}</Alert>` without its own guard. `className` places it (the dialog's error line).
 */
export function Alert({
  tone = 'error',
  banner = false,
  id,
  className,
  children,
}: {
  tone?: 'error' | 'success';
  banner?: boolean;
  id?: string;
  className?: string;
  children?: ReactNode;
}) {
  if (children === null || children === undefined || children === false || children === '') return null;
  return (
    <p
      className={cn(
        'm-0 rounded-sm px-3 py-2.5 text-start text-md font-semibold',
        TONE[tone],
        banner && 'mb-4 [.desk>&]:mb-0',
        className,
      )}
      data-slot="alert"
      data-tone={tone}
      data-testid={banner ? 'banner' : tone === 'error' ? 'error' : undefined}
      id={id}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {children}
    </p>
  );
}
