'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Door } from './doors';

const DoorContext = createContext<Door | null>(null);

export function DoorProvider({ door, children }: { door: Door; children: ReactNode }) {
  return <DoorContext.Provider value={door}>{children}</DoorContext.Provider>;
}

export function useDoor(): Door {
  const door = useContext(DoorContext);
  if (!door) throw new Error('door');
  return door;
}
