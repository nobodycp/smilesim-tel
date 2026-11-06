'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type Directory, type OfficeMe } from './api';
import { useConnection } from './connection';
import { rememberBalance, rememberIdentity } from './identity';

type OfficeSessionValue = {
  /** `/office/me` answered: the pages may draw. */
  ready: boolean;
  /** `/office/me` did not answer yet and the last attempt failed; the shell shows the outage instead of a page. */
  failed: boolean;
  /** An attempt is in flight after a failure. */
  retrying: boolean;
  /** Ask `/office/me` again now. */
  retry: () => void;
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
  me: null,
  names: NO_NAMES,
  initialName: '',
  initialBalance: null,
});

function authPath(pathname: string) {
  return pathname === '/login' || pathname === '/password' || pathname.startsWith('/two-factor');
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
  const [me, setMe] = useState<OfficeMe | null>(null);
  const [names, setNames] = useState<Directory>(NO_NAMES);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // Each attempt is one run of the effect below; bumping this asks again. A failed attempt
  // schedules the next bump after `wait`, which doubles up to the cap.
  const [attemptNo, setAttemptNo] = useState(0);
  const { generation } = useConnection();
  const wait = useRef(FIRST_RETRY_MS);
  const seenGeneration = useRef(0);

  useEffect(() => {
    if (skip || ready) return;
    // The API came back (another call reached it, or the browser went online): this run asks at once.
    if (generation !== seenGeneration.current) {
      seenGeneration.current = generation;
      wait.current = FIRST_RETRY_MS;
    }
    let live = true;
    let timer: number | null = null;
    void api.officeMe().then((result) => {
      if (!live) return;
      if (result.ok) {
        const name = result.data.nickname || result.data.loginName;
        rememberIdentity(name, result.data.nickname ? result.data.loginName : '');
        rememberBalance(result.data.balance);
        setMe(result.data);
        setFailed(false);
        setRetrying(false);
        wait.current = FIRST_RETRY_MS;
        setReady(true);
        return;
      }
      // A session that ended already redirected inside `api.ts`. An answer the API chose (4xx)
      // is final: the shell draws with no account. Only an API that is down is retried.
      if (result.code !== 'NETWORK' && result.status < 500) {
        setFailed(false);
        setRetrying(false);
        setReady(true);
        return;
      }
      setFailed(true);
      setRetrying(false);
      timer = window.setTimeout(() => {
        setRetrying(true);
        setAttemptNo((count) => count + 1);
      }, wait.current);
      wait.current = Math.min(wait.current * 2, MAX_RETRY_MS);
    });
    return () => {
      live = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [skip, ready, attemptNo, generation]);

  useEffect(() => {
    if (skip || !ready) return;
    let live = true;
    // The directory is a convenience: a screen that renders before it lands shows login names alone.
    void api.officeDirectory().then((result) => {
      if (live && result.ok) setNames(result.data.names);
    });
    return () => {
      live = false;
    };
  }, [skip, ready]);

  const retry = useCallback(() => {
    wait.current = FIRST_RETRY_MS;
    setRetrying(true);
    setAttemptNo((count) => count + 1);
  }, []);

  return (
    <OfficeContext.Provider value={{ ready: skip || ready, failed: !skip && !ready && failed, retrying: !ready && retrying, retry, me, names, initialName, initialBalance }}>
      {children}
    </OfficeContext.Provider>
  );
}

export function useOffice() {
  return useContext(OfficeContext);
}
