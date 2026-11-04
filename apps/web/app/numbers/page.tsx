'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { PagedTable, type Column } from '../../components/data-table';
import { Desk, OutcomePick, lineStatus } from '../../components/desk';
import { TableSearch } from '../../components/table-search';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { Dialog } from '../../components/dialog';
import { FilterBar } from '../../components/filter-bar';
import { lineActions } from '../../components/line-actions';
import { RowMenu } from '../../components/row-menu';
import { api, type LineRow, type Outcome, type PosChoice } from '../../lib/api';
import { useDoor } from '../../lib/door-context';
import { useOffice } from '../../lib/office-session';
import { usePrefs } from '../../lib/prefs';
import { useAction } from '../../lib/use-action';
import { pick, useLoad } from '../../lib/use-load';
import { usePaged } from '../../lib/use-paged';

const NO_POSES: PosChoice[] = [];

export default function NumbersPage() {
  const { t, locale } = usePrefs();
  const [posLogin, setPosLogin] = useState('');
  const [packageCode, setPackageCode] = useState('');
  const [esim, setEsim] = useState(false);
  const [iccid, setIccid] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('success');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [urlRead, setUrlRead] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [pack, setPack] = useState('');
  const [needle, setNeedle] = useState('');
  const { me } = useOffice();
  const door = useDoor();
  const isPos = door.layer === 'pos' || me?.layer === 'pos';
  const verdict: Outcome = isPos ? 'success' : outcome;

  // The server filters and pages. Each filter set has a key; a page only shows while its key is current.
  const list = usePaged<LineRow, PosChoice[]>(
    `${needle}|${status}|${pack}`,
    async (cursor) =>
      pick(await api.officeLines({ q: needle, status, packageCode: pack, cursor }), (data) => ({ rows: data.lines, next: data.nextCursor, extra: data.poses })),
    { enabled: urlRead },
  );
  const catalog = useLoad(() => api.officePackages());
  const packages = catalog.data?.packages ?? [];
  const poses = list.extra ?? NO_POSES;
  const ready = catalog.data !== null && list.started;
  const { run, busy } = useAction({ setError, setNote, onDone: list.reload });
  const failure = error || list.error || catalog.error;

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('status') ?? '';
    if (initial === 'active' || initial === 'frozen' || initial === 'disconnected') {
      setStatus(initial);
    }
    setUrlRead(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setNeedle(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const applied = { note: (data: { applied: boolean }) => (data.applied ? t.appliedNow : t.sentToBranch) };

  async function activate(event: FormEvent) {
    event.preventDefault();
    await run(
      () => api.activateLine({ packageCode: packageCode || packages[0]?.code || '', posLogin: posLogin || poses[0]?.loginName || '', esim, iccid, msisdn: '', outcome: verdict }),
      { ...applied, then: () => { setIccid(''); setActivateOpen(false); } },
    );
  }

  const packageOptions = packages.map((row) => ({
    code: row.code,
    label: row.providerName ? `${row.providerName} · ${row.companyName} · ${row.name}` : `${row.companyName} · ${row.name}`,
  }));
  const activeFilters = Number(Boolean(query.trim())) + Number(Boolean(status)) + Number(Boolean(pack));

  const columns: Column<LineRow>[] = [
    { key: 'number', header: t.number, cell: 'msisdn', render: (line) => <Link className="num-link" href={`/numbers/${line.id}`}><bdi dir="ltr">{line.msisdn}</bdi></Link> },
    { key: 'company', header: t.company, render: (line) => line.companyName || '—' },
    { key: 'package', header: t.packageName, render: (line) => line.packageName },
    ...(isPos ? [] : [{ key: 'pos', header: t.pointOfSale, render: (line: LineRow) => <bdi dir="ltr">{line.posLogin}</bdi> }]),
    {
      key: 'status',
      header: t.status,
      render: (line) => (
        <Badge
          variant={line.status === 'active' ? 'success' : line.status === 'frozen' ? 'warning' : 'danger'}
          dot
        >
          {lineStatus(t, line.status)}
        </Badge>
      ),
    },
    { key: 'ends', header: t.endsOn, render: (line) => new Date(line.endsAt).toLocaleDateString(locale === 'he' ? 'he' : locale === 'en' ? 'en' : 'ar') },
    {
      key: 'ops',
      header: t.rowActions,
      actions: true,
      render: (line) => (
        <RowMenu label={`${t.rowActions} ${line.msisdn}`} items={lineActions(line, verdict, (work) => run(work, applied), t)} />
      ),
    },
  ];

  return (
    <Desk
      title={t.numbersTitle}
      lede=""
      action={ready && me && me.layer !== 'pos' ? (
        <Button type="button" onClick={() => setActivateOpen(true)}>{t.activateLine}</Button>
      ) : undefined}
      error={failure}
      note={note}
    >
      <FilterBar onClear={() => { setQuery(''); setNeedle(''); setStatus(''); setPack(''); }} clearLabel={t.clearFilters}>
        {!isPos && <OutcomePick value={outcome} onChange={setOutcome} />}
        <label>
          {t.status}
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t.allRows}</option>
            <option value="active">{t.lineActive}</option>
            <option value="frozen">{t.lineFrozen}</option>
            <option value="disconnected">{t.lineDisconnected}</option>
          </Select>
        </label>
        <label>
          {t.packageName}
          <Select value={pack} onChange={(event) => setPack(event.target.value)}>
            <option value="">{t.allRows}</option>
            {packageOptions.map((row) => (
              <option key={row.code} value={row.code}>
                {row.label}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>
      <section className="pane" id="lines">
        {ready && me && me.layer !== 'pos' && (
          <Dialog
            open={activateOpen}
            title={t.activateLine}
            lede={t.activateHint}
            mark="plus"
            closeLabel={t.closeMenu}
            error={failure}
            onClose={() => setActivateOpen(false)}
            footer={(
              <>
                <Button type="button" variant="secondary" onClick={() => setActivateOpen(false)}>{t.cancel}</Button>
                <Button type="submit" form="activate-line" disabled={busy}>{t.actActivate}</Button>
              </>
            )}
          >
            <form id="activate-line" className="dialog-form" onSubmit={activate}>
              <div className="pair">
                <label>
                  {t.pointOfSale}
                  <Select value={posLogin || poses[0]?.loginName || ''} onChange={(event) => setPosLogin(event.target.value)}>
                    {poses.map((pos) => (
                      <option key={pos.loginName} value={pos.loginName}>
                        {pos.nickname} · {pos.loginName}
                      </option>
                    ))}
                  </Select>
                </label>
                <label>
                  {t.packageName}
                  <Select value={packageCode || packages[0]?.code || ''} onChange={(event) => setPackageCode(event.target.value)}>
                    {packageOptions.map((row) => (
                      <option key={row.code} value={row.code}>
                        {row.label}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              <label className="check">
                <input type="checkbox" checked={esim} onChange={(event) => setEsim(event.target.checked)} />
                {t.esim}
              </label>
              {!esim && (
                <label>
                  {t.iccid}
                  <input value={iccid} onChange={(event) => setIccid(event.target.value)} dir="ltr" />
                </label>
              )}
              <OutcomePick value={outcome} onChange={setOutcome} />
            </form>
          </Dialog>
        )}
        <TableSearch label={t.numberSearch} value={query} onChange={setQuery} />
        <PagedTable
          list={list}
          waiting={!ready}
          columns={columns}
          rowKey={(line) => line.id}
          empty={activeFilters > 0 ? t.noMatches : t.noLines}
          skeleton={{ rows: 5, columns: isPos ? 5 : 6 }}
        />
      </section>
    </Desk>
  );
}
