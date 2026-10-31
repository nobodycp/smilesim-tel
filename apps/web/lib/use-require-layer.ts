'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useDoor } from './door-context';
import { useOffice } from './office-session';

/**
 * The one layer guard for pages that only some layers may open.
 *
 * It sends the visitor to the home page, through the router (no full reload), when the door
 * or the signed-in account is not one of `layers`. It answers `true` only when both are, and the
 * account is known, so a page draws nothing before the answer. The backend still decides;
 * this keeps a closed page from being drawn and then thrown out.
 */
export function useRequireLayer(layers: readonly string[]): boolean {
  const router = useRouter();
  const door = useDoor();
  const { me } = useOffice();
  const doorOk = layers.includes(door.layer);
  const meOk = !me || layers.includes(me.layer);

  useEffect(() => {
    if (!doorOk || !meOk) router.replace('/');
  }, [doorOk, meOk, router]);

  return doorOk && meOk && me !== null;
}
