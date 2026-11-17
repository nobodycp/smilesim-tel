'use client';

import { FileUp } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { DataTable, type Column } from '../../components/data-table';
import { Money, Pane, latinWhen } from '../../components/desk';
import { Dialog } from '../../components/dialog';
import { Stat, StatRow } from '../../components/stat';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectItem } from '../../components/ui/select';
import { TBody, TCell, THead, THeadCell, TRow, Table } from '../../components/ui/table';
import { api, type ReconItem, type StatementMap, type StatementPreview } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { useAction } from '../../lib/use-action';
import { useApiQuery } from '../../lib/use-api-query';

type Loaded = { fileName: string; content: string; preview: StatementPreview };

/*
 * The look (ADR 0022):
 * - the column: the desk's stack, a column 12px apart at its own height, never wider than the canvas; it keeps the
 *   `stack` class as the handle the desk column (`has-[>.stack]`), the canvas (`:has(.stack)`) and `Pane`
 *   (`[.desk>.stack>&]`) size by;
 * - the upload pane: its head a row at least 52px high, 14px / 18px padding, a 1px `--rd-line` rule under it, its
 *   title 14px bold ink; its body a grid 12px apart, 14px / 18px / 18px padding, that scrolls inside the pane in the
 *   desk, its children never wider than it, a button in it at the reading start; a hint 12px `--rd-muted`, no margin;
 * - the file pick: a wrapping row 10px apart, items centred; the button over the hidden input has a pointer cursor and
 *   a 2px `--rd-accent` outline 2px off while the input has focus;
 * - the column choice: as many 10rem-or-wider columns as fit, 12px apart; each caption 12px `--rd-muted` 600, 4px
 *   above its pick;
 * - the sample: scrolls sideways inside a 1px `--rd-line` border with the card corners (8px);
 * - the earlier runs: a caption 12px `--rd-muted` 600, 4px above its pick, at most 32rem wide;
 * - «no run yet» outside a pane: a plain paragraph;
 * - the dialog: a column 12px apart; the note is a dialog label and field.
 */
const COLUMN = 'stack flex min-h-auto min-w-0 max-w-full flex-none flex-col gap-3 overflow-visible *:min-w-0';
const PANE_HEAD = 'flex min-h-13 items-center justify-between gap-2 border-b border-line bg-transparent px-4.5 py-3.5';
const PANE_TITLE = 'm-0 inline-flex items-center gap-2 text-base font-bold text-ink';
const PANE_BODY = 'grid min-h-0 min-w-0 max-w-full content-start gap-3 overflow-auto px-4.5 pt-3.5 pb-4.5 *:min-w-0';
const HINT = 'm-0 text-sm text-muted';

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
  const runs = useApiQuery(['api', 'reconciliations', code], () => api.reconciliations(code));
  const chosen = runId || runs.data?.runs[0]?.id || '';
  const run = useApiQuery(['api', 'reconciliation', chosen], () => api.reconciliation(chosen), { enabled: Boolean(chosen) });
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
    { key: 'at', header: t.when, kind: 'when', render: (row) => (row.at ? <bdi dir="ltr">{latinWhen(row.at)}</bdi> : '—') },
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
          ? <Button type="button" size="sm" variant="secondary" onClick={() => { setText(''); setHandling(row); }}>{t.reconHandle}</Button>
          : <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void send(() => api.updateReconItem(row.id, { status: 'open', note: '' }))}>{t.reconReopen}</Button>
      ) : null),
    },
  ];
  const data = run.data;
  const column = (label: string, key: keyof StatementMap, optional = false) => (
    <Label tone="pane" className="text-sm">
      {label}
      <Select place="pane" value={map[key] == null ? '' : String(map[key])} onValueChange={(next) => setMap((current) => ({ ...current, [key]: next === '' ? (optional ? null : undefined) : Number(next) }))}>
        <SelectItem value="">{optional ? t.none : '—'}</SelectItem>
        {loaded?.preview.columns.map((name, index) => <SelectItem key={`${index}-${name}`} value={String(index)}>{name}</SelectItem>)}
      </Select>
    </Label>
  );

  return (
    <div className={COLUMN}>
      {canWrite ? (
        <Pane>
          <header className={PANE_HEAD}><h2 className={PANE_TITLE}>{t.reconUpload}</h2></header>
          <div className={PANE_BODY}>
            <p className={HINT}>{t.reconUploadHint}</p>
            {/* The system's button over a hidden file input — never the browser's «Choose File» (owner 2026-11-11). */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* The pane's field captions (`.pane label`) dim it: muted, 11px, a 4px gap; ink on hover. */}
              <Button
                asChild
                variant="secondary"
                className="cursor-pointer gap-1 text-xs leading-5 text-muted hover:text-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
              >
                <label>
                  <FileUp size={16} aria-hidden="true" />
                  {t.chooseFile}
                  <input type="file" className="sr-only" accept=".xlsx,.csv" onChange={(event) => void pick(event)} />
                </label>
              </Button>
              <span className={HINT}>{loaded ? loaded.fileName : t.noFileChosen}</span>
            </div>
            {loaded ? (
              <>
                <p className={HINT}>{t.reconRows.replace('{file}', loaded.fileName).replace('{n}', String(loaded.preview.rows))}</p>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
                  {column(t.number, 'msisdn')}
                  {column(t.when, 'date')}
                  {column(t.amount, 'amount')}
                  {column(t.reconReference, 'reference', true)}
                </div>
                <div className="overflow-x-auto rounded-card border border-line">
                  <Table>
                    <THead><TRow>{loaded.preview.columns.map((name, index) => <THeadCell key={`${index}-${name}`}>{name}</THeadCell>)}</TRow></THead>
                    <TBody>{loaded.preview.sample.map((row, index) => <TRow key={index}>{row.map((cell, at) => <TCell key={at}>{cell}</TCell>)}</TRow>)}</TBody>
                  </Table>
                </div>
                <Button type="button" className="justify-self-start" disabled={busy} onClick={() => void compare()}>{t.reconCompare}</Button>
              </>
            ) : null}
          </div>
        </Pane>
      ) : null}
      {runs.data && runs.data.runs.length > 1 ? (
        <Label tone="pane" className="max-w-128 text-sm">
          {t.reconEarlier}
          <Select place="desk" value={chosen} onValueChange={setRunId}>
            {runs.data.runs.map((item) => <SelectItem key={item.id} value={item.id}>{`${latinWhen(item.at)} · ${item.fileName} · ${item.open} ${t.orderOpen}`}</SelectItem>)}
          </Select>
        </Label>
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
          <Pane>
            <DataTable columns={columns} rows={data.items} rowKey={(row) => row.id} empty={t.reconAllMatched} keepHead skeleton={{ rows: 4, columns: 8 }} />
          </Pane>
        </>
      ) : runs.loaded && !chosen ? <p>{t.reconNone}</p> : null}
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
        <div className="grid gap-3">
          <Label tone="dialog">
            {t.note}
            <Input value={text} onChange={(event) => setText(event.target.value)} />
          </Label>
        </div>
      </Dialog>
    </div>
  );
}
