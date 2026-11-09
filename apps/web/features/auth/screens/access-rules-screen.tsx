'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Desk } from '../../../components/desk';
import { useOffice } from '../../../lib/office-session';
import { usePrefs } from '../../../lib/prefs';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { LayerSessionRulesPane } from '../session-rules';

/**
 * «قواعد الدخول» (spec 2026-11-09-admin-review, 5): the sign-in rules of each layer — open sessions per account and
 * the idle timeout —, a system setting of the branch owner, out of the owner's own account page. An account's own
 * values stay on its user page («إعدادات المستخدم»), falling back to these.
 */
export function AccessRulesScreen() {
  const { t } = usePrefs();
  const router = useRouter();
  const { me } = useOffice();
  const allowed = useRequireLayer(['branch']);
  const owner = allowed && Boolean(me?.isBranchOwner) && !me?.impersonating;
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (me && (!me.isBranchOwner || me.impersonating)) router.replace('/');
  }, [me, router]);

  if (!owner) return null;

  return (
    <Desk title={t.accessRulesTitle} lede={t.accessRulesLede} error={error} note={note}>
      <LayerSessionRulesPane setError={setError} setNote={setNote} />
    </Desk>
  );
}
