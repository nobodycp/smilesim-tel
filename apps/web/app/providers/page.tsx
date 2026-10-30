'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Desk } from '../../components/desk';
import { TableSkeleton } from '../../components/loading';
import { api, type ProviderRow } from '../../lib/api';
import { useDoor } from '../../lib/door-context';
import { useOffice } from '../../lib/office-session';
import { usePrefs } from '../../lib/prefs';

export default function ProvidersPage() {
  const { t, apiText } = usePrefs();
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const { me } = useOffice();
  const door = useDoor();
  const allowed = door.layer === 'branch' && me?.layer === 'branch';

  const load = useCallback(async () => {
    const result = await api.officeProviders();
    if (!result.ok) {
      setError(apiText(result.message));
      setLoaded(true);
      return;
    }
    setRows(result.data.providers);
    setLoaded(true);
  }, [apiText]);

  useEffect(() => {
    if (door.layer !== 'branch' || (me && me.layer !== 'branch')) window.location.replace('/');
  }, [door.layer, me]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  return (
    <Desk title={allowed ? t.providersTitle : ''} lede="" error={error} note="">
      <section className="pane">
        <div className="sheet">
          {!loaded ? <TableSkeleton rows={5} columns={3} /> : (
            <table className="data">
              <thead>
                <tr>
                  <th>{t.provider}</th>
                  <th>{t.company}</th>
                  <th>{t.navPlans}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((provider) => (
                  <tr key={provider.code}>
                    <td><Link className="row-link" href={`/providers/${provider.code}`}>{provider.name}</Link></td>
                    <td>{provider.companies.length}</td>
                    <td>{provider.companies.reduce((sum, company) => sum + company.packages.length, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </Desk>
  );
}
