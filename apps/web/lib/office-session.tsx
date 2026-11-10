'use client';

import { usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { api, type Directory, type OfficeMe } from './api';
import { directoryNames } from './directory';
import { useConnection } from './connection';
import { rememberBalance, rememberIdentity } from './identity';
import { ApiFailure, queryKeys, unwrap } from './query';

type OfficeSessionValue = {
  /** `/office/me` answered: the pages may draw. */
  ready: boolean;
  /** `/office/me` did not answer yet and the last attempt failed; the shell shows the outage instead of a page. */
  failed: boolean;
  /** An attempt is in flight after a failure. */
  retrying: boolean;
  /** Ask `/office/me` again now. */
  retry: () => void;
  /** Re-read `/office/me` into `me` after the account changed (a profile save, a money write). */
  refresh: () => Promise<void>;
  me: OfficeMe | null;
  /** Login name → full name for the accounts this viewer may meet; empty until loaded. */
  names: Directory;
  initialName: string;
  initialBalance: number | null;
};

const NO_NAMES: Directory = {};

const OfficeContext = createContext<OfficeSessionValue>({
  ready: false,
  failed: false,
  retrying: false,
  retry: () => {},
  refresh: async () => {},
  me: null,
  names: NO_NAMES,
  initialName: '',
  initialBalance: null,
});

/** Screens that draw without the office shell and without a session (`/enter` opens an entered account's door). */
export function authPath(pathname: string) {
  return pathname === '/login' || pathname === '/password' || pathname.startsWith('/two-factor') || pathname === '/enter';
}

// Backoff between attempts while the API does not answer: 2s, 4s, 8s, 16s, then 30s.
const FIRST_RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;

export function OfficeSession({
  children,
  initialName = '',
  initialBalance = null,
}: {
  children: ReactNode;
  initialName?: string;
  initialBalance?: number | null;
}) {
  const pathname = usePathname();
  const skip = authPath(pathname);
  const client = useQueryClient();
  const { generation } = useConnection();

  // `/office/me` lives in the query cache (ADR 0001), so a write can invalidate it. It is read once and then
  // only when asked (`refresh`, or a write through useAction): it never goes stale on its own.
  const session = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => unwrap(api.officeMe()),
    enabled: !skip,
    staleTime: Infinity,
  });
  const error = session.error instanceof ApiFailure ? session.error : null;
  // An answer the API chose (4xx) is final: the shell draws with no account. A session that ended already
  // redirected inside `api.ts`. Only an API that does not answer is asked again.
  const final = Boolean(session.isError && !error?.unreachable);
  // Once `me` has answered, the pages stay drawn: a later refresh that fails keeps the last answer on screen.
  const ready = session.data !== undefined || final;
  const failed = !ready && Boolean(error?.unreachable);

  useEffect(() => {
    if (!session.data) return;
    const name = session.data.nickname || session.data.loginName;
    rememberIdentity(name, session.data.nickname ? session.data.loginName : '');
    rememberBalance(session.data.balance);
  }, [session.data]);

  // While the API is away: ask again after `wait`, which doubles up to the cap. A success resets it.
  const wait = useRef(FIRST_RETRY_MS);
  const { refetch } = session;
  useEffect(() => {
    if (session.data !== undefined) wait.current = FIRST_RETRY_MS;
    if (skip || !failed || session.isFetching) return;
    const timer = window.setTimeout(() => void refetch(), wait.current);
    wait.current = Math.min(wait.current * 2, MAX_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [skip, failed, session.isFetching, session.data, session.errorUpdatedAt, refetch]);

  // The API came back (another call reached it, or the browser went online): ask at once.
  const seenGeneration = useRef(generation);
  useEffect(() => {
    if (generation === seenGeneration.current) return;
    seenGeneration.current = generation;
    if (skip || ready) return;
    wait.current = FIRST_RETRY_MS;
    void refetch();
  }, [generation, skip, ready, refetch]);

  // The directory is a convenience: a screen that renders before it lands shows login names alone.
  const directory = useQuery({
    queryKey: queryKeys.directory,
    queryFn: () => unwrap(directoryNames()),
    enabled: !skip && session.data !== undefined,
    staleTime: Infinity,
  });

  const retry = useCallback(() => {
    wait.current = FIRST_RETRY_MS;
    void refetch();
  }, [refetch]);

  const refresh = useCallback(async () => {
    await client.invalidateQueries({ queryKey: queryKeys.me });
  }, [client]);

  return (
    <OfficeContext.Provider
      value={{
        ready: skip || ready,
        failed: !skip && failed,
        retrying: !skip && failed && session.isFetching,
        retry,
        refresh,
        me: session.data ?? null,
        names: directory.data?.names ?? NO_NAMES,
        initialName,
        initialBalance,
      }}
    >
      {children}
    </OfficeContext.Provider>
  );
}

export function useOffice() {
  return useContext(OfficeContext);
}
