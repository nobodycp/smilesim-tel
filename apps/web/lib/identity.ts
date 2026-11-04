'use client';

import { useSyncExternalStore } from 'react';
import { BALANCE_COOKIE, NAME_COOKIE } from './document-prefs';

type Identity = { account: string; hint: string };

const EMPTY: Identity = { account: '', hint: '' };
const KEY = 'smilesim-identity';
const BALANCE_KEY = 'smilesim-balance';

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}
const listeners = new Set<() => void>();
let rawSeen = '';
let snapshot: Identity = EMPTY;

function read(): Identity {
  try {
    const raw = sessionStorage.getItem(KEY) ?? '';
    if (raw === rawSeen) return snapshot;
    rawSeen = raw;
    if (!raw) {
      snapshot = EMPTY;
      return snapshot;
    }
    const parsed = JSON.parse(raw) as Partial<Identity>;
    snapshot = {
      account: typeof parsed.account === 'string' ? parsed.account : '',
      hint: typeof parsed.hint === 'string' ? parsed.hint : '',
    };
    return snapshot;
  } catch {
    return snapshot;
  }
}

function emit() {
  rawSeen = '\u0000';
  listeners.forEach((listener) => listener());
}

export function rememberIdentity(account: string, hint: string) {
  try {
    const next = JSON.stringify({ account, hint });
    writeCookie(NAME_COOKIE, account);
    if (sessionStorage.getItem(KEY) === next) return;
    sessionStorage.setItem(KEY, next);
    emit();
  } catch {
    // Private mode can block storage. The name still comes from the request.
  }
}

export function rememberBalance(balance: number) {
  try {
    sessionStorage.setItem(BALANCE_KEY, String(balance));
    writeCookie(BALANCE_COOKIE, String(balance));
  } catch {
    // The chip still fills in when the account request returns.
  }
}

export function forgetIdentity() {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(BALANCE_KEY);
    clearCookie(NAME_COOKIE);
    clearCookie(BALANCE_COOKIE);
  } catch {
    // The visible name is cleared by the next signed-out screen.
  }
  emit();
}

export function useIdentity(): Identity {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => EMPTY,
  );
}
