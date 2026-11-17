'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useDesk } from '../../lib/desk-session';
import { useRequireLayer } from '../../lib/use-require-layer';

/**
 * The system monitor's guard (spec 2026-11-17-system-monitor, D1): the branch door and the branch owner alone. Any
 * other door or account is sent home, as `/roles` does, instead of drawing the page and failing on its 403. True only
 * when the page may draw.
 */
export function useSystemOwner(): boolean {
  const router = useRouter();
  const { me } = useDesk();
  const allowed = useRequireLayer(['branch']);

  useEffect(() => {
    if (me && !me.isBranchOwner) router.replace('/');
  }, [me, router]);

  return allowed && Boolean(me?.isBranchOwner);
}
