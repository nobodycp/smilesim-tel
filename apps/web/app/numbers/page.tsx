'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { AccountName, accountLabel } from '../../components/account-name';
import { PagedTable, type Column } from '../../components/data-table';
import { ActivationResult } from '../../components/activation-result';
import { Desk, OutcomePick, applyNote, lineStatus } from '../../components/desk';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { Dialog } from '../../components/dialog';
import { DisconnectConfirm } from '../../components/disconnect-confirm';
import { EsimDialog, SimBadge } from '../../components/esim-qr';
import { FilterBar } from '../../components/filter-bar';
import { lineActions } from '../../components/line-actions';
import { RowMenu } from '../../components/row-menu';
import { useApiQuery } from '../../lib/use-api-query';
import { sharedKeys } from '../../lib/query';
import { api, type ApplyResult, type LineRow, type Outcome, type PackageRow, type PosChoice } from '../../lib/api';
import { useDoor } from '../../lib/door-context';
import { useOffice } from '../../lib/office-session';
import { usePrefs } from '../../lib/prefs';
import { OPEN_SIM, hasSimRules, simFits, simHint, withPrefix } from '../../lib/sim-rules';
import { useAction } from '../../lib/use-action';
import { pick } from '../../lib/use-load';
import { usePaged } from '../../lib/use-paged';
import { useDebouncedField, useUrlFilters } from '../../lib/url-state';
import { lineTone } from '../../lib/status-tone';

const NO_POSES: PosChoice[] = [];
const NO_PACKAGES: PackageRow[] = [];

const FILTER_KEYS = ['q', 'status', 'pack', 'provider', 'company'] as const;
const LINE_STATUSES = ['active', 'frozen', 'disconnected', 'suspended'];

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
  const [activateOpen, setActivateOpen] = useState(false);
  // The filters live in the address (`?status=frozen&q=…`), so back/forward and links keep them.
  const [filters, setFilters] = useUrlFilters(FILTER_KEYS);
  const { q: needle, pack, provider, company } = filters;
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
    `${needle}|${status}|${pack}|${provider}|${company}`,
    async (cursor) =>
      pick(await api.officeLines({ q: needle, status, packageCode: pack, provider, company, cursor }), (data) => ({ rows: data.lines, next: data.nextCursor, total: data.total, extra: data.poses })),
  );
  const catalog = useApiQuery(sharedKeys.packages, () => api.officePackages());
  const packages = catalog.data?.packages ?? NO_PACKAGES;
  const poses = list.extra ?? NO_POSES;
  const ready = catalog.loaded && list.started;
  const { run, busy } = useAction({ setError, setNote, onDone: list.reload });
  // A failed list is shown once, in the table; the banner is for actions and the catalogue.
  const failure = error || catalog.error;

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
          variant={lineTone(line.status)}
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
        onClear={() => setFilters({ q: '', status: '', pack: '', provider: '', company: '' })}
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
              onChange={(event) => setFilters({ provider: event.target.value, company: '', pack: '' })}
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
            onChange={(event) => setFilters({ company: event.target.value, pack: '' })}
          >
            <option value="">{t.allRows}</option>
            {companyOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </Select>
        </label>
        <label>
          {t.packageName}
          <Select value={pack} onChange={(event) => setFilters({ pack: event.target.value })}>
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
          <Select value={status} onChange={(event) => setFilters({ status: event.target.value })}>
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
