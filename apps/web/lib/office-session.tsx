'use client';

import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Directory, type OfficeMe } from './api';
import { rememberBalance, rememberIdentity } from './identity';

type OfficeSessionValue = {
  ready: boolean;
  me: OfficeMe | null;
  /** Login name → full name for the accounts this viewer may meet; empty until loaded. */
  names: Directory;
  initialName: string;
  initialBalance: number | null;
};

const NO_NAMES: Directory = {};

const OfficeContext = createContext<OfficeSessionValue>({
  ready: false,
  me: null,
  names: NO_NAMES,
  initialName: '',
  initialBalance: null,
});

function authPath(pathname: string) {
  return pathname === '/login' || pathname === '/password' || pathname.startsWith('/two-factor');
}

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

  useEffect(() => {
    if (skip) return;
    let live = true;
    api.officeMe().then((result) => {
      if (!live) return;
      if (result.ok) {
        const name = result.data.nickname || result.data.loginName;
        rememberIdentity(name, result.data.nickname ? result.data.loginName : '');
        rememberBalance(result.data.balance);
        setMe(result.data);
      }
      setReady(true);
    });
    // The directory is a convenience: a screen that renders before it lands shows login names alone.
    api.officeDirectory().then((result) => {
      if (live && result.ok) setNames(result.data.names);
    });
    return () => {
      live = false;
    };
  }, [skip]);

  return (
    <OfficeContext.Provider value={{ ready: skip || ready, me, names, initialName, initialBalance }}>
      {children}
    </OfficeContext.Provider>
  );
}

export function useOffice() {
  return useContext(OfficeContext);
}
