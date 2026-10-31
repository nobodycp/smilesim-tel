import type { ReactNode } from 'react';

// The empty message of a list. `.empty` already carries its padding, so nothing is styled here.
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
