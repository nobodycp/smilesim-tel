'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

// Scoped to /sandbox/tanstack-lab only. No other route gets a query client;
// this is deliberate — see docs/superpowers/specs/2026-11-02-tanstack-lab-sandbox-design.md.
export function TanstackLabQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
