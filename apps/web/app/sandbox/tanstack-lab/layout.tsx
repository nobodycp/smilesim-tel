import type { ReactNode } from 'react';
import { TanstackLabQueryProvider } from './query-provider';

export default function TanstackLabLayout({ children }: { children: ReactNode }) {
  return <TanstackLabQueryProvider>{children}</TanstackLabQueryProvider>;
}
