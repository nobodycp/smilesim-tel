'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Desk, Money, actionName, latinWhen, lineStatus, taskStatus } from '../../../components/desk';
import { api, type ReportPayload } from '../../../lib/api';
import { useDoor } from '../../../lib/door-context';
import { useOffice } from '../../../lib/office-session';
import { usePrefs } from '../../../lib/prefs';

const kinds = {
  providers: 'reportProviders',
  consumption: 'reportConsumption',
  funding: 'reportFunding',
  tasks: 'reportTasks',
  numbers: 'reportNumbers',
  operations: 'reportOperations',
} as const;

type Kind = keyof typeof kinds;

export default function ReportPage() {
  const { t, apiText } = usePrefs();
  const params = useParams<{ kind: string }>();
  const kind = typeof params.kind === 'string' && params.kind in kinds ? (params.kind as Kind) : '';
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [error, setError] = useState('');
  const { me } = useOffice();
  const door = useDoor();
  const allowed = door.layer === 'branch' && me?.layer === 'branch';

  const load = useCallback(async () => {
    if (!kind) return;
    const result = await api.officeReport(kind);
    if (!result.ok) {
      setError(apiText(result.message));
      setPayload(null);
      return;
    }
    setPayload(result.data);
  }, [apiText, kind]);

  useEffect(() => {
    if (door.layer !== 'branch' || (me && me.layer !== 'branch')) window.location.replace('/');
  }, [door.layer, me]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  const titleKey = kind ? kinds[kind] : 'navReports';
  const title = t[titleKey];

  return (
    <Desk title={allowed ? title : ''} lede="" error={error} note="">
      <section className="pane">
        {!payload || error ? null : payload.rows ? (
          <div className="sheet">
            <table className="data">
              <thead>
                <tr>
                  <th>{t.provider}</th>
                  <th>{t.company}</th>
                  <th>{t.packageName}</th>
                  <th className="num">{t.branchCost}</th>
                  <th className="num">{t.linesCount}</th>
                </tr>
              </thead>
              <tbody>
                {payload.rows.map((row) => (
                  <tr key={`${row.providerName}-${row.companyName}-${row.packageName}`}>
                    <td>{row.providerName}</td>
                    <td>{row.companyName}</td>
                    <td>{row.packageName}</td>
                    <td className="num"><Money value={row.price} /></td>
                    <td className="num">{row.lines}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : payload.lines ? (
          payload.lines.length === 0 ? <p className="empty" style={{ padding: 14 }}>{t.noLines}</p> : (
            <div className="sheet">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t.number}</th>
                    <th>{t.packageName}</th>
                    <th>{t.pointOfSale}</th>
                    <th>{t.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="msisdn"><bdi dir="ltr">{line.msisdn}</bdi></td>
                      <td>{line.packageName}</td>
                      <td>{line.posLogin}</td>
                      <td>{lineStatus(t, line.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : payload.tasks ? (
          payload.tasks.length === 0 ? <p className="empty" style={{ padding: 14 }}>{t.noTasks}</p> : (
            <div className="sheet">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t.status}</th>
                    <th>{t.movement}</th>
                    <th>{t.number}</th>
                    <th>{t.pointOfSale}</th>
                    <th>{t.accountName}</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.tasks.map((row) => (
                    <tr key={row.id}>
                      <td>{taskStatus(t, row.status)}</td>
                      <td>{actionName(t, row.action)} · {row.packageName}</td>
                      <td><bdi dir="ltr">{row.msisdn ?? '—'}</bdi></td>
                      <td>{row.posLogin}</td>
                      <td>{row.assigneeLogin ?? row.submitterLogin}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          !payload.entries || payload.entries.length === 0 ? <p className="empty" style={{ padding: 14 }}>{t.noMovements}</p> : (
            <div className="sheet">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t.when}</th>
                    <th>{t.accountName}</th>
                    <th>{t.movement}</th>
                    <th className="num">{t.amount}</th>
                    <th className="num">{t.balance}</th>
                    <th>{t.note}</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.entries.map((row) => (
                    <tr key={row.id}>
                      <td className="when"><bdi dir="ltr">{latinWhen(row.at)}</bdi></td>
                      <td>
                        {row.loginName}
                        <div className="hint">{row.actorLogin}</div>
                      </td>
                      <td>{actionName(t, row.kind)}</td>
                      <td><Money value={row.amount} /></td>
                      <td><Money value={row.balanceAfter} /></td>
                      <td>{row.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </section>
    </Desk>
  );
}
