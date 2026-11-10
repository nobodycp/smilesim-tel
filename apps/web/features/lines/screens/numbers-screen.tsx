'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { AccountName, accountLabel } from '../../../components/account-name';
import { PagedTable, type Column } from '../../../components/data-table';
import { ActivationResult } from '../../../components/activation-result';
import { Desk, Money, OutcomePick, applyNote, lineStatus } from '../../../components/desk';
import { DataImage } from '../../../components/data-image';
import { markColor, markOf } from '../../../lib/company-mark';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { NameField } from '../../../components/name-field';
import { Dialog } from '../../../components/dialog';
import { DisconnectConfirm } from '../../../components/disconnect-confirm';
import { EsimDialog, SimBadge } from '../../../components/esim-qr';
import { FilterBar } from '../../../components/filter-bar';
import { lineActions } from '../../../components/line-actions';
import { RowMenu } from '../../../components/row-menu';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { PackageFacts } from '../../../components/package-facts';
import { api, type ApplyResult, type LineRow, type Outcome, type PackageRow, type PosChoice } from '../../../lib/api';
import { useDoor } from '../../../lib/door-context';
import { useOffice } from '../../../lib/office-session';
import { usePrefs } from '../../../lib/prefs';
import { OPEN_SIM, hasSimRules, simFits, simHint, withPrefix } from '../../../lib/sim-rules';
import { useAction } from '../../../lib/use-action';
import { pick } from '../../../lib/fetched';
import { pageRows, usePaged } from '../../../lib/use-paged';
import { useDebouncedField, useUrlFilters } from '../../../lib/url-state';
import { lineTone } from '../../../lib/status-tone';
import { EXPIRING_DAYS, daysLeft } from '../../../lib/days-left';

const NO_POSES: PosChoice[] = [];
const NO_PACKAGES: PackageRow[] = [];

const FILTER_KEYS = ['q', 'status', 'pack', 'provider', 'company', 'sim'] as const;
// `expiring` is a filter, not a stored status: active lines ending within three days.
const LINE_STATUSES = ['active', 'expiring', 'frozen', 'disconnected', 'suspended'];

export function NumbersScreen() {
  const { t, locale } = usePrefs();
  const [posLoginName, setPosLoginName] = useState('');
  const [packageCode, setPackageCode] = useState('');
  const [esim, setEsim] = useState(false);
  const [iccid, setIccid] = useState('');
  const [currentDetails, setCurrentDetails] = useState('');
  const [givenNumber, setGivenNumber] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('success');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [activateOpen, setActivateOpen] = useState(false);
  // The filters live in the address (`?status=frozen&q=…`), so back/forward and links keep them.
  const [filters, setFilters] = useUrlFilters(FILTER_KEYS);
  const { q: needle, pack, provider, company } = filters;
  const sim = filters.sim === 'sim' || filters.sim === 'esim' ? filters.sim : '';
  const status = LINE_STATUSES.includes(filters.status) ? filters.status : '';
  const commitQuery = useCallback((value: string) => setFilters({ q: value }), [setFilters]);
  const [query, setQuery] = useDebouncedField(needle, commitQuery);
  const [ending, setEnding] = useState<LineRow | null>(null);
  const [qrLine, setQrLine] = useState<LineRow | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const { me } = useOffice();
  const door = useDoor();
  const isPos = door.layer === 'pos' || me?.layer === 'pos';
  const verdict: Outcome = isPos ? 'success' : outcome;

  // The server filters and pages. Each filter set has a key; a page only shows while its key is current.
  const list = usePaged<LineRow, PosChoice[]>(
    `${needle}|${status}|${pack}|${provider}|${company}|${sim}`,
    async (cursor) =>
      pick(await api.officeLines({ q: needle, status, packageCode: pack, provider, company, sim, cursor }), (data) => ({ ...pageRows(data), extra: data.poses })),
  );
  const catalog = useApiQuery(sharedKeys.packages, () => api.officePackages());
  const packages = catalog.data?.packages ?? NO_PACKAGES;
  const poses = list.extra ?? NO_POSES;
  const ready = catalog.loaded && list.started;
  const { run, busy } = useAction({ setError, setNote, onDone: list.reload });
  // A failed list is shown once, in the table; the banner is for actions and the catalogue.
  const failure = error || catalog.error;

  const applied = { note: (data: { applied: boolean; debited?: boolean }) => applyNote(t, data) };

  const sellable = packages.filter((row) => row.sellable);
  const chosen = sellable.find((row) => row.code === packageCode) ?? sellable[0];
  const activation = chosen?.activateInput === 'current-details' ? 'details' : chosen?.activateInput === 'number-and-sim' ? 'number' : 'generated';
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
        posLoginName: posLoginName || poses[0]?.loginName || '',
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

  // The table as in the approved design (Graphite): the number with its SIM, the package with its company's mark,
  // the point of sale, the status, what is left (crimson when it ends soon), the price.
  const columns: Column<LineRow>[] = [
    {
      key: 'number',
      header: t.number,
      cell: 'msisdn',
      render: (line) => (
        <span className="line-cell">
          <Link className="num-link" href={`/numbers/${line.id}`}><bdi dir="ltr">{line.msisdn}</bdi></Link>
          <SimBadge line={line} label={`${t.showQr} ${line.msisdn}`} onOpen={() => setQrLine(line)} />
        </span>
      ),
    },
    {
      key: 'package',
      header: t.packageName,
      render: (line) => (
        <span className="pack-cell">
          {line.companyImage ? (
            <DataImage className="co-mark" src={line.companyImage} alt="" />
          ) : (
            <span className="co-mark" style={{ background: markColor(line.companyName || '?') }} aria-hidden="true">{markOf(line.companyName || '?')}</span>
          )}
          <span>
            <b>{line.packageName}</b>
            <span className="sub">{line.companyName || '—'}</span>
          </span>
        </span>
      ),
    },
    ...(isPos ? [] : [{ key: 'pos', header: t.pointOfSale, render: (line: LineRow) => <AccountName login={line.posLoginName} /> }]),
    {
      key: 'status',
      header: t.status,
      render: (line) => (
        // «معلّق» is read from the end date and the package's period, over the stored status (spec I).
        <Badge
          variant={lineTone(line.suspended ? 'suspended' : line.status)}
          dot
        >
          {lineStatus(t, line.suspended ? 'suspended' : line.status)}
        </Badge>
      ),
    },
    {
      key: 'days',
      header: t.remainingDays,
      cell: 'days-col',
      render: (line) => {
        const ends = new Date(line.endsAt).toLocaleDateString(locale === 'he' ? 'he' : locale === 'en' ? 'en' : 'ar-u-nu-latn');
        if (line.status !== 'active') return <span className="days off" title={ends}>—</span>;
        const days = daysLeft(line.endsAt);
        if (days <= 0) return <span className="days out" title={ends}>{t.lineEndedShort}</span>;
        if (days <= EXPIRING_DAYS) return <span className="days soon" title={ends}>{t.expiringSoon} · <span className="num">{days}</span> {t.dayUnit}</span>;
        return <span className="days" title={ends}><span className="num">{days}</span> {t.dayUnit}</span>;
      },
    },
    { key: 'price', header: t.price, num: true, render: (line) => <Money value={line.posPrice} /> },
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
      lede={t.numbersLede}
      action={ready && me && me.layer !== 'pos' && sellable.length > 0 ? (
        <Button type="button" className="ui-btn-accent" onClick={openActivate}><Plus size={16} aria-hidden="true" />{t.activateLine}</Button>
      ) : undefined}
      error={failure}
      note={note}
    >
      <FilterBar
        onClear={() => setFilters({ q: '', status: '', pack: '', provider: '', company: '', sim: '' })}
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
            <NameField value={provider} allLabel={t.allRows} onChange={(next) => setFilters({ provider: next, company: '', pack: '' })} options={providerOptions.map((name) => ({ value: name, label: name }))} />
          </label>
        )}
        <label>
          {t.company}
          <NameField value={company} allLabel={t.allRows} onChange={(next) => setFilters({ company: next, pack: '' })} options={companyOptions.map((name) => ({ value: name, label: name }))} />
        </label>
        <label>
          {t.packageName}
          <NameField
            value={pack}
            allLabel={t.allRows}
            onChange={(next) => setFilters({ pack: next })}
            options={filterPackages.map((row) => ({ value: row.code, label: row.name, hint: [company ? '' : row.companyName, provider ? '' : row.providerName ?? ''].filter(Boolean).join(' · ') || undefined, keys: [row.companyName, row.code] }))}
          />
        </label>
        <label>
          {t.status}
          <Select value={status} onChange={(event) => setFilters({ status: event.target.value })}>
            <option value="">{t.allRows}</option>
            <option value="active">{t.lineActive}</option>
            <option value="expiring">{t.expiringSoon}</option>
            <option value="frozen">{t.lineFrozen}</option>
            <option value="disconnected">{t.lineDisconnected}</option>
            <option value="suspended">{t.lineSuspended}</option>
          </Select>
        </label>
        {/* SIM or eSIM (spec 2026-11-11-ui-consistency-pass, D1). */}
        <label>
          {t.simType}
          <Select value={sim} onChange={(event) => setFilters({ sim: event.target.value })}>
            <option value="">{t.allRows}</option>
            <option value="sim">{t.physicalSim}</option>
            <option value="esim">{t.esim}</option>
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
                  <NameField
                    value={posLoginName || poses[0]?.loginName || ''}
                    onChange={setPosLoginName}
                    options={poses.map((pos) => ({ value: pos.loginName, label: accountLabel(pos.loginName, pos.nickname), keys: [pos.loginName] }))}
                  />
                </label>
                <label>
                  {t.packageName}
                  <NameField
                    value={chosen?.code || ''}
                    onChange={(code) => { if (code) pickPackage(code); }}
                    options={sellable.map((row) => ({
                      value: row.code,
                      label: row.name,
                      hint: [row.providerName, row.companyName].filter(Boolean).join(' · '),
                      keys: [row.companyName, row.providerName ?? '', row.code].filter(Boolean),
                    }))}
                  />
                </label>
              </div>
              {chosen ? <PackageFacts facts={chosen} /> : null}
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
