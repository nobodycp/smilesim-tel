'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * Server state for the web app (ADR 0001). One QueryClient per browser tab. Defaults are conservative: data is
 * fresh for 30 s, nothing refetches on window focus, and a query does not retry unless it says so; each query
 * states its own retry rule (the session retries while the API is unreachable).
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false },
          mutations: { retry: false },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** A refusal or an unreachable API, as a thrown value a query can hold. `code` is the API's stable code. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }

  /** The API did not answer (network, gateway, a 5xx without our JSON): worth asking again. */
  get unreachable(): boolean {
    return this.code === 'NETWORK' || this.status >= 500;
  }
}

type Answer<T> = { ok: true; data: T } | { ok: false; status: number; message: string; code?: string };

/** The data of an `api.*` answer, or an ApiFailure thrown for a query to hold. */
export async function unwrap<T>(answer: Promise<Answer<T>>): Promise<T> {
  const result = await answer;
  if (result.ok) return result.data;
  throw new ApiFailure(result.status, result.message, result.code);
}

/** Query keys, one place, so a write can invalidate what it changed. */
export const queryKeys = {
  me: ['api', 'me'] as const,
  directory: ['api', 'directory'] as const,
};

/** Keys of shared reads: one cache entry, whichever screen asked first. */
export const sharedKeys = {
  packages: ['api', 'packages'] as const,
  users: ['api', 'users'] as const,
  companies: ['api', 'companies'] as const,
  providers: ['api', 'providers'] as const,
  task: (id: string) => ['api', 'task', id] as const,
  taskDecision: (id: string) => ['api', 'task', id, 'decision'] as const,
  providerDecisions: ['api', 'provider-decisions'] as const,
  account: (login: string) => ['api', 'account', login] as const,
  accountPackages: (login: string) => ['api', 'account', login, 'packages'] as const,
  accountOps: (login: string) => ['api', 'account', login, 'ops'] as const,
  providerSettings: (code: string) => ['api', 'provider', code, 'settings'] as const,
  line: (id: string) => ['api', 'line', id] as const,
  home: ['api', 'home'] as const,
  overview: (period: string) => ['api', 'overview', period] as const,
  liveOffers: ['api', 'offers', 'live'] as const,
  offers: ['api', 'offers'] as const,
  financeSummary: ['api', 'finance', 'summary'] as const,
  roles: ['api', 'roles'] as const,
  brandingDraft: ['branding', 'draft'] as const,
  profile: ['auth', 'profile'] as const,
  sessions: ['auth', 'sessions'] as const,
};

/** Reads that belong to one package's sheet; an action on the sheet asks for these again. */
export const packageKeys = {
  sheet: (code: string) => ['api', 'package', code, 'sheet'] as const,
  lines: (code: string) => ['api', 'package', code, 'lines'] as const,
  customPrices: (code: string) => ['api', 'package', code, 'custom-prices'] as const,
  hiddenAccounts: (code: string) => ['api', 'package', code, 'hidden-accounts'] as const,
  linePrices: (code: string, scope: string) => ['api', 'package', code, 'line-prices', scope] as const,
  all: (code: string) => ['api', 'package', code] as const,
};
