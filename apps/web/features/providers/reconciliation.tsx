'use client';

import { useState, type ChangeEvent } from 'react';
import { DataTable, type Column } from '../../components/data-table';
import { Money, latinWhen } from '../../components/desk';
import { Dialog } from '../../components/dialog';
import { Stat, StatRow } from '../../components/stat';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { api, type ReconItem, type StatementMap, type StatementPreview } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { useAction } from '../../lib/use-action';
import { useApiQuery } from '../../lib/use-api-query';

type Loaded = { fileName: string; content: string; preview: StatementPreview };

/** A file as base64 for the API (the 1 MB body allows a statement of about 700 KB). */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * «المطابقة» on a provider's page (roadmap N8): upload the provider's statement, point at its columns, compare it with
 * our operations, and follow every difference until it is handled.
 */
export function Reconciliation({ code, canWrite, setError, setNote }: { code: string; canWrite: boolean; setError: (t: string) => void; setNote: (t: string) => void }) {
  const { t, apiText } = usePrefs();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [map, setMap] = useState<Partial<StatementMap>>({});
  const [runId, setRunId] = useState('');
  const [handling, setHandling] = useState<ReconItem | null>(null);
  const [text, setText] = useState('');
  const runs = useApiQuery(['office', 'reconciliations', code], () => api.reconciliations(code));
  const chosen = runId || runs.data?.runs[0]?.id || '';
  const run = useApiQuery(['office', 'reconciliation', chosen], () => api.reconciliation(chosen), { enabled: Boolean(chosen) });
  const { run: send, busy } = useAction({ setError, setNote, onDone: async () => { await runs.reload(); await run.reload(); } });

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const content = await readBase64(file);
    await send(() => api.previewStatement(code, { fileName: file.name, content }), {
      reload: false,
      then: (preview) => {
        setLoaded({ fileName: file.name, content, preview });
        setMap(preview.map);
      },
    });
  }

  async function compare() {
    if (!loaded || map.msisdn === undefined || map.date === undefined || map.amount === undefined) {
      setError(apiText('بيانات غير صالحة'));
      return;
    }
    const full: StatementMap = { msisdn: map.msisdn, date: map.date, amount: map.amount, reference: map.reference ?? null };
    await send(() => api.runReconciliation(code, { fileName: loaded.fileName, content: loaded.content, map: full }), {
      note: t.reconDone,
      then: (result) => {
        setLoaded(null);
        setRunId(result.id);
      },
    });
  }

  const kindName = (kind: ReconItem['kind']) => ({ different: t.reconDifferent, missing_ours: t.reconMissingOurs, missing_theirs: t.reconMissingTheirs, duplicate: t.reconDuplicate })[kind];
  const columns: Column<ReconItem>[] = [
    { key: 'kind', header: t.kind, render: (row) => <Badge variant={row.kind === 'different' ? 'warning' : 'danger'} dot>{kindName(row.kind)}</Badge> },
    { key: 'number', header: t.number, render: (row) => <bdi dir="ltr">{row.msisdn}</bdi> },
    { key: 'at', header: t.when, cell: 'when', render: (row) => (row.at ? <bdi dir="ltr">{latinWhen(row.at)}</bdi> : '—') },
    { key: 'theirs', header: t.reconTheirs, num: true, render: (row) => (row.theirAmount == null ? '—' : <Money value={row.theirAmount} />) },
    { key: 'ours', header: t.reconOurs, num: true, render: (row) => (row.ourAmount == null ? '—' : <Money value={row.ourAmount} />) },
    { key: 'ref', header: t.reconReference, render: (row) => row.reference || '—' },
    {
      key: 'status',
      header: t.status,
      render: (row) => (row.status === 'resolved'
        ? <span title={row.note ?? ''}><Badge variant="success" dot>{t.reconResolved}</Badge></span>
        : <Badge variant="warning" dot>{t.orderOpen}</Badge>),
    },
    {
      key: 'act',
      header: <span className="sr-only">{t.rowActions}</span>,
      actions: true,
      render: (row) => (canWrite ? (
        row.status === 'open'
          ? <Button type="button" size="sm" variant="outline" onClick={() => { setText(''); setHandling(row); }}>{t.reconHandle}</Button>
          : <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void send(() => api.updateReconItem(row.id, { status: 'open', note: '' }))}>{t.reconReopen}</Button>
      ) : null),
    },
  ];
  const data = run.data;
  const column = (label: string, key: keyof StatementMap, optional = false) => (
    <label>
      {label}
      <Select value={map[key] == null ? '' : String(map[key])} onChange={(event) => setMap((current) => ({ ...current, [key]: event.target.value === '' ? (optional ? null : undefined) : Number(event.target.value) }))}>
        <option value="">{optional ? t.none : '—'}</option>
        {loaded?.preview.columns.map((name, index) => <option key={`${index}-${name}`} value={index}>{name}</option>)}
      </Select>
    </label>
  );

  return (
    <div className="stack">
      {canWrite ? (
        <section className="pane">
          <header className="pane-head"><h2>{t.reconUpload}</h2></header>
          <div className="pane-body stack">
            <p className="hint">{t.reconUploadHint}</p>
            <label className="file-pick">
              <input type="file" accept=".xlsx,.csv" onChange={(event) => void pick(event)} />
            </label>
            {loaded ? (
              <>
                <p className="hint">{t.reconRows.replace('{file}', loaded.fileName).replace('{n}', String(loaded.preview.rows))}</p>
                <div className="recon-map">
                  {column(t.number, 'msisdn')}
                  {column(t.when, 'date')}
                  {column(t.amount, 'amount')}
                  {column(t.reconReference, 'reference', true)}
                </div>
                <div className="recon-sample">
                  <table className="data">
                    <thead><tr>{loaded.preview.columns.map((name, index) => <th key={`${index}-${name}`}>{name}</th>)}</tr></thead>
                    <tbody>{loaded.preview.sample.map((row, index) => <tr key={index}>{row.map((cell, at) => <td key={at}>{cell}</td>)}</tr>)}</tbody>
                  </table>
                </div>
                <Button type="button" disabled={busy} onClick={() => void compare()}>{t.reconCompare}</Button>
              </>
            ) : null}
          </div>
        </section>
      ) : null}
      {runs.data && runs.data.runs.length > 1 ? (
        <label className="recon-pick">
          {t.reconEarlier}
          <Select value={chosen} onChange={(event) => setRunId(event.target.value)}>
            {runs.data.runs.map((item) => <option key={item.id} value={item.id}>{`${latinWhen(item.at)} · ${item.fileName} · ${item.open} ${t.orderOpen}`}</option>)}
          </Select>
        </label>
      ) : null}
      {data ? (
        <>
          <StatRow>
            <Stat icon="reports" tone="success" label={t.reconMatched} value={data.counts.matched} />
            <Stat icon="reports" tone="warning" label={t.reconDifferent} value={data.counts.different} />
            <Stat icon="reports" tone="danger" label={t.reconMissingOurs} value={data.counts.missing_ours} />
            <Stat icon="reports" tone="danger" label={t.reconMissingTheirs} value={data.counts.missing_theirs} />
            <Stat icon="reports" tone="danger" label={t.reconDuplicate} value={data.counts.duplicate} />
          </StatRow>
          <StatRow>
            <Stat icon="wallet" label={t.reconTheirsTotal} value={<Money value={data.statementTotal} />} meta={data.fileName} />
            <Stat icon="wallet" label={t.reconOursTotal} value={<Money value={data.ourTotal} />} />
            <Stat icon="plans" label={t.reconGap} value={<Money value={data.statementTotal - data.ourTotal} signed />} highlight={data.statementTotal === data.ourTotal} />
          </StatRow>
          <section className="pane">
            <DataTable columns={columns} rows={data.items} rowKey={(row) => row.id} empty={t.reconAllMatched} keepHead skeleton={{ rows: 4, columns: 8 }} />
          </section>
        </>
      ) : runs.loaded && !chosen ? <p className="hint">{t.reconNone}</p> : null}
      <Dialog
        open={handling !== null}
        size="form"
        title={t.reconHandle}
        lede={handling ? `${kindName(handling.kind)} · ${handling.msisdn}` : ''}
        mark="check"
        closeLabel={t.cancel}
        onClose={() => { if (!busy) setHandling(null); }}
        footer={(
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setHandling(null)}>{t.cancel}</Button>
            <Button type="button" disabled={busy || !text.trim()} onClick={() => handling && void send(() => api.updateReconItem(handling.id, { status: 'resolved', note: text }), { note: t.saved, then: () => setHandling(null) })}>{t.save}</Button>
          </>
        )}
      >
        <div className="dialog-form">
          <label>
            {t.note}
            <input value={text} onChange={(event) => setText(event.target.value)} />
          </label>
        </div>
      </Dialog>
    </div>
  );
}
