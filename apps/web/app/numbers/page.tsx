'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AccountName, accountLabel } from '../../components/account-name';
import { PagedTable, type Column } from '../../components/data-table';
import { ActivationResult } from '../../components/activation-result';
import { Desk, OutcomePick, applyNote, lineBadgeTone, lineStatus } from '../../components/desk';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { Dialog } from '../../components/dialog';
import { DisconnectConfirm } from '../../components/disconnect-confirm';
import { EsimDialog, SimBadge } from '../../components/esim-qr';
import { FilterBar } from '../../components/filter-bar';
import { lineActions } from '../../components/line-actions';
import { RowMenu } from '../../components/row-menu';
import { api, type ApplyResult, type LineRow, type Outcome, type PosChoice } from '../../lib/api';
import { useDoor } from '../../lib/door-context';
import { useOffice } from '../../lib/office-session';
import { usePrefs } from '../../lib/prefs';
import { OPEN_SIM, hasSimRules, simFits, simHint, withPrefix } from '../../lib/sim-rules';
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
  const [currentDetails, setCurrentDetails] = useState('');
  const [givenNumber, setGivenNumber] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('success');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [urlRead, setUrlRead] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [pack, setPack] = useState('');
  const [provider, setProvider] = useState('');
  const [company, setCompany] = useState('');
  const [needle, setNeedle] = useState('');
  const [ending, setEnding] = useState<LineRow | null>(null);
  const [qrLine, setQrLine] = useState<LineRow | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const { me } = useOffice();
  const door = useDoor();
  const isPos = door.layer === 'pos' || me?.layer === 'pos';
  const verdict: Outcome = isPos ? 'success' : outcome;

  // The server filters and pages. Each filter set has a key; a page only shows while its key is current.
  const list = usePaged<LineRow, PosChoice[]>(
    `${needle}|${status}|${pack}|${provider}|${company}`,
    async (cursor) =>
      pick(await api.officeLines({ q: needle, status, packageCode: pack, provider, company, cursor }), (data) => ({ rows: data.lines, next: data.nextCursor, total: data.total, extra: data.poses })),
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
    if (initial === 'active' || initial === 'frozen' || initial === 'disconnected' || initial === 'suspended') {
      setStatus(initial);
    }
    setUrlRead(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setNeedle(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const applied = { note: (data: { applied: boolean; debited?: boolean }) => applyNote(t, data) };

  const sellable = packages.filter((row) => row.activateMode !== 'off');
  const chosen = sellable.find((row) => row.code === packageCode) ?? sellable[0];
  const activation = chosen?.providerCode === 'neod' ? 'details' : chosen?.providerCode === 'tokman' ? 'number' : 'generated';
  const rules = chosen?.sim ?? OPEN_SIM;
  const offersEsim = activation === 'generated' && rules.esim;
  const withEsim = offersEsim && esim;
  const simReady = withEsim || simFits(rules, iccid.trim());

  function openActivate() {
    setIccid((value) => withPrefix(rules, value));
    setActivateOpen(true);
  }

  function pickPackage(code: string) {
    setPackageCode(code);
    setIccid(sellable.find((row) => row.code === code)?.sim.prefix ?? '');
  }

  async function activate(event: FormEvent) {
    event.preventDefault();
    await run(
      () => api.activateLine({
        packageCode: chosen?.code || '',
        posLogin: posLogin || poses[0]?.loginName || '',
        esim: withEsim,
        iccid: withEsim ? '' : iccid.trim(),
        msisdn: activation === 'number' ? givenNumber : '',
        currentDetails: activation === 'details' ? currentDetails : '',
        outcome: verdict,
      }),
      { then: (data) => { setResult(data); setIccid(''); setCurrentDetails(''); setGivenNumber(''); setActivateOpen(false); } },
    );
  }

  const providerOptions = useMemo(() => {
    const names = new Set(packages.map((row) => row.providerName).filter(Boolean));
    return [...names].sort((left, right) => left.localeCompare(right, 'ar'));
  }, [packages]);
  const companyOptions = useMemo(() => {
    const names = new Set(
      packages.filter((row) => !provider || row.providerName === provider).map((row) => row.companyName).filter(Boolean),
    );
    return [...names].sort((left, right) => left.localeCompare(right, 'ar'));
  }, [packages, provider]);
  const filterPackages = useMemo(() => {
    return packages
      .filter((row) => (!provider || row.providerName === provider) && (!company || row.companyName === company))
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name, 'ar'));
  }, [packages, provider, company]);
  const activeFilters = Number(Boolean(query.trim())) + Number(Boolean(status)) + Number(Boolean(pack)) + Number(Boolean(provider)) + Number(Boolean(company));

  const columns: Column<LineRow>[] = [
    { key: 'number', header: t.number, cell: 'msisdn', render: (line) => <Link className="num-link" href={`/numbers/${line.id}`}><bdi dir="ltr">{line.msisdn}</bdi></Link> },
    { key: 'company', header: t.company, render: (line) => line.companyName || '—' },
    { key: 'package', header: t.packageName, render: (line) => line.packageName },
    {
      key: 'sim',
      header: t.simType,
      render: (line) => (
        <span className="sim-cell">
          <SimBadge line={line} label={`${t.showQr} ${line.msisdn}`} onOpen={() => setQrLine(line)} />
        </span>
      ),
    },
    ...(isPos ? [] : [{ key: 'pos', header: t.pointOfSale, render: (line: LineRow) => <AccountName login={line.posLogin} /> }]),
    {
      key: 'status',
      header: t.status,
      render: (line) => (
        <Badge
          variant={lineBadgeTone(line.status)}
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
        <RowMenu label={`${t.rowActions} ${line.msisdn}`} items={lineActions(line, verdict, (work) => run(work, applied), t, { onDisconnect: setEnding })} />
      ),
    },
  ];

  return (
    <Desk
      title={t.numbersTitle}
      lede=""
      action={ready && me && me.layer !== 'pos' && sellable.length > 0 ? (
        <Button type="button" onClick={openActivate}>{t.activateLine}</Button>
      ) : undefined}
      error={failure}
      note={note}
    >
      <FilterBar
        onClear={() => { setQuery(''); setNeedle(''); setStatus(''); setPack(''); setProvider(''); setCompany(''); }}
        clearLabel={t.clearFilters}
      >
        {!isPos && <OutcomePick value={outcome} onChange={setOutcome} />}
        <label>
          {t.lineSearch}
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        {providerOptions.length > 0 && (
          <label>
            {t.provider}
            <Select
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value);
                setCompany('');
                setPack('');
              }}
            >
              <option value="">{t.allRows}</option>
              {providerOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </Select>
          </label>
        )}
        <label>
          {t.company}
          <Select
            value={company}
            onChange={(event) => {
              setCompany(event.target.value);
              setPack('');
            }}
          >
            <option value="">{t.allRows}</option>
            {companyOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </Select>
        </label>
        <label>
          {t.packageName}
          <Select value={pack} onChange={(event) => setPack(event.target.value)}>
            <option value="">{t.allRows}</option>
            {filterPackages.map((row) => (
              <option key={row.code} value={row.code}>
                {company ? row.name : `${row.companyName} · ${row.name}`}
              </option>
            ))}
          </Select>
        </label>
        <label>
          {t.status}
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t.allRows}</option>
            <option value="active">{t.lineActive}</option>
            <option value="frozen">{t.lineFrozen}</option>
            <option value="disconnected">{t.lineDisconnected}</option>
            <option value="suspended">{t.lineSuspended}</option>
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
                <Button type="submit" form="activate-line" disabled={busy || !simReady}>{t.actActivate}</Button>
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
                        {accountLabel(pos.loginName, pos.nickname)}
                      </option>
                    ))}
                  </Select>
                </label>
                <label>
                  {t.packageName}
                  <Select value={chosen?.code || ''} onChange={(event) => pickPackage(event.target.value)}>
                    {sellable.map((row) => (
                      <option key={row.code} value={row.code}>
                        {row.providerName ? `${row.providerName} · ${row.companyName} · ${row.name}` : `${row.companyName} · ${row.name}`}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              {offersEsim && (
                <label className="check">
                  <input type="checkbox" checked={esim} onChange={(event) => setEsim(event.target.checked)} />
                  {t.esim}
                </label>
              )}
              {activation === 'details' && (
                <label>
                  {t.currentNumberDetails}
                  <input value={currentDetails} onChange={(event) => setCurrentDetails(event.target.value)} />
                </label>
              )}
              {activation === 'number' && (
                <label>
                  {t.number}
                  <input value={givenNumber} onChange={(event) => setGivenNumber(event.target.value)} dir="ltr" />
                </label>
              )}
              {!withEsim && (
                <label>
                  {t.iccid}
                  <input value={iccid} onChange={(event) => setIccid(event.target.value)} inputMode="numeric" dir="ltr" />
                  {hasSimRules(rules) && <span className="hint">{simHint(t, rules)}</span>}
                </label>
              )}
              <OutcomePick value={outcome} onChange={setOutcome} />
            </form>
          </Dialog>
        )}
        <PagedTable
          list={list}
          waiting={!ready}
          columns={columns}
          rowKey={(line) => line.id}
          empty={activeFilters > 0 ? t.noMatches : t.noLines}
          skeleton={{ rows: 5, columns: isPos ? 6 : 7 }}
        />
        <EsimDialog line={qrLine} onClose={() => setQrLine(null)} />
        <ActivationResult result={result} onClose={() => setResult(null)} />
        <DisconnectConfirm
          line={ending}
          busy={busy}
          failing={verdict === 'fail'}
          onClose={() => setEnding(null)}
          onConfirm={(line) => run(() => api.disconnectLine(line.id, verdict), applied)}
        />
      </section>
    </Desk>
  );
}
