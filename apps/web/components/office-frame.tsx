'use client';

// One shell per tab. The layout mounts this once, so moving between sections swaps only the
// page inside `.canvas`; the sidebar, topbar, and their state stay where they are.

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { authPath } from '../lib/office-session';
import { OfficeShell } from './office-shell';

export function OfficeFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (authPath(pathname)) return <>{children}</>;
  return <OfficeShell>{children}</OfficeShell>;
}
