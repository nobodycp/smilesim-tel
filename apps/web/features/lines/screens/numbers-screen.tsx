'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import { AccountName, accountLabel } from '../../../components/account-name';
import { PagedTable, type Column } from '../../../components/data-table';
import { ActivationResult } from '../../../components/activation-result';
import { Desk, Money, OutcomePick, Pane, applyNote, lineStatus } from '../../../components/desk';
import { CompanyMark } from '../../../components/company-mark';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectItem } from '../../../components/ui/select';
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
import { useDesk } from '../../../lib/desk-session';
import { usePrefs } from '../../../lib/prefs';
import { OPEN_SIM, hasSimRules, simFits, simHint, withPrefix } from '../../../lib/sim-rules';
import { useRequestKey } from '../../../lib/request-key';
import { useAction } from '../../../lib/use-action';
import { pick } from '../../../lib/fetched';
import { pageRows, usePaged } from '../../../lib/use-paged';
import { useDebouncedField, useUrlFilters } from '../../../lib/url-state';
import { lineTone } from '../../../lib/status-tone';
import { EXPIRING_DAYS, daysLeft } from '../../../lib/days-left';
import { Days } from '../days';

const NO_POSES: PosChoice[] = [];
const NO_PACKAGES: PackageRow[] = [];

const FILTER_KEYS = ['q', 'status', 'pack', 'provider', 'company', 'sim'] as const;
// `expiring` is a filter, not a stored status: active lines ending within three days.
const LINE_STATUSES = ['active', 'expiring', 'frozen', 'disconnected', 'suspended'];

/*
 * The look (Tailwind migration T4.5, ADR 0022), ported from desk/table.css, desk/pane.css, dialog.css, responsive.css
 * and graphite.css in their cascade order:
 * - the number cell: one row 10px apart, the number's link 800 ink at the reading start, the SIM badge beside it;
 * - the package cell: one row 10px apart at the reading start, the company's mark (`CompanyMark`), the package's name
 *   600 over its company 11.5px `--rd-muted` 400 at 1.3;
 * - the activation form: a column 12px apart; the point of sale and the package side by side 8px apart (one column
 *   under 768px); the eSIM box in a row 8px from its name, at least 36px high (44px at 720px and under), 13px ink 600.
 */
const CHECK_ROW = 'm-0 flex min-h-9 cursor-pointer items-center gap-2 text-ink max-[721px]:min-h-11';
const FIELD_HINT = 'text-sm font-medium';

export function NumbersScreen() {
  const { t, locale, apiText } = usePrefs();
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
  // The eSIM code is not read from the list (plan 2026-11-10-activation-settlement, S.5c): it is asked for from
  // the line's own detail when the user opens it, held in this state only, and dropped when the dialog closes.
  const [qr, setQr] = useState<{ asking: string } | { shown: { msisdn: string; iccid: string | null; esim: boolean; esimQr: string } } | null>(null);
  const qrAsk = useRef(0);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const { me } = useDesk();
  const door = useDoor();
  const isPos = door.layer === 'pos' || me?.layer === 'pos';
  const verdict: Outcome = isPos ? 'success' : outcome;

  // The server filters and pages. Each filter set has a key; a page only shows while its key is current.
  const list = usePaged<LineRow, PosChoice[]>(
    `${needle}|${status}|${pack}|${provider}|${company}|${sim}`,
    async (cursor) =>
      pick(await api.lines({ q: needle, status, packageCode: pack, provider, company, sim, cursor }), (data) => ({ ...pageRows(data), extra: data.poses })),
  );
  const catalog = useApiQuery(sharedKeys.packages, () => api.packages());
  const packages = catalog.data?.packages ?? NO_PACKAGES;
  const poses = list.extra ?? NO_POSES;
  const ready = catalog.loaded && list.started;
  const { run, busy } = useAction({ setError, setNote, onDone: list.reload });
  const requestKey = useRequestKey();
  // A failed list is shown once, in the table; the banner is for actions and the catalogue.
  const failure = error || catalog.error;

  /** Asks the line's detail for its eSIM code and shows it. Nothing of a line is shown before its own answer. */
  async function openQr(row: LineRow) {
    if (qr && 'asking' in qr && qr.asking === row.id) return;
    const ask = (qrAsk.current += 1);
    setError('');
    setNote('');
    // Whatever was on screen for another line goes now, before this one is asked for.
    setQr({ asking: row.id });
    const read = await api.line(row.id);
    // Another line was asked for meanwhile, or this was closed: the answer is not used.
    if (ask !== qrAsk.current) return;
    if (!read.ok) {
      setQr(null);
      setError(apiText(read));
      return;
    }
    const { line } = read.data;
    if (line.id !== row.id || !line.esim || !line.esimQr) {
      setQr(null);
      setNote(t.esimNoQrFor.replace('{number}', row.msisdn));
      return;
    }
    setQr({ shown: { msisdn: line.msisdn, iccid: line.iccid, esim: true, esimQr: line.esimQr } });
  }

  /** Closing drops the code from this screen's state, and any answer still on its way. */
  function closeQr() {
    qrAsk.current += 1;
    setQr(null);
  }

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
    const body = {
      packageCode: chosen?.code || '',
      posLoginName: posLoginName || poses[0]?.loginName || '',
      esim: withEsim,
      iccid: withEsim ? '' : iccid.trim(),
      msisdn: activation === 'number' ? givenNumber : '',
      currentDetails: activation === 'details' ? currentDetails : '',
      outcome: verdict,
    };
    // The same activation sent again keeps its key; once answered, the next one is another (ADR 0019, D14).
    await run(
      () => api.activateLine(body, requestKey.keyFor(body)),
      { then: (data) => { requestKey.spent(); setResult(data); setIccid(''); setCurrentDetails(''); setGivenNumber(''); setActivateOpen(false); } },
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
  const activeFilters = Number(Boolean(query.trim())) + Number(Boolean(status)) + Number(Boolean(pack)) + Number(Boolean(provider)) + Number(Boolean(company)) + Number(Boolean(sim));

  // The table as in the approved design (Graphite): the number with its SIM, the package with its company's mark,
  // the point of sale, the status, what is left (crimson when it ends soon), the price.
  const columns: Column<LineRow>[] = [
    {
      key: 'number',
      header: t.number,
      kind: 'msisdn',
      render: (line) => (
        <span className="inline-flex items-center gap-2.5" data-testid="line-cell">
          <Link className="text-start font-extrabold text-ink no-underline" href={`/numbers/${line.id}`}><bdi dir="ltr">{line.msisdn}</bdi></Link>
          <SimBadge line={{ esim: line.esim }} label={`${t.showQr} ${line.msisdn}`} busy={qr !== null && 'asking' in qr && qr.asking === line.id} onOpen={() => void openQr(line)} />
        </span>
      ),
    },
    {
      key: 'package',
      header: t.packageName,
      render: (line) => (
        <span className="inline-flex items-center gap-2.5 text-start">
          <CompanyMark name={line.companyName || '?'} image={line.companyImage} />
          <span>
            <b className="block font-semibold">{line.packageName}</b>
            <span className="block text-[11.5px] leading-[1.3] font-normal text-muted">{line.companyName || '—'}</span>
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
      render: (line) => {
        const ends = new Date(line.endsAt).toLocaleDateString(locale === 'he' ? 'he' : locale === 'en' ? 'en' : 'ar-u-nu-latn');
        if (line.status !== 'active') return <Days tone="off" data-testid="days-off" title={ends}>—</Days>;
        const days = daysLeft(line.endsAt);
        if (days <= 0) return <Days tone="out" data-testid="days-out" title={ends}>{t.lineEndedShort}</Days>;
        if (days <= EXPIRING_DAYS) return <Days tone="soon" data-testid="days-soon" title={ends}>{t.expiringSoon} · <span>{days}</span> {t.dayUnit}</Days>;
        return <Days tone="left" data-testid="days-left" title={ends}><span>{days}</span> {t.dayUnit}</Days>;
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
        <Button type="button" onClick={openActivate}><Plus size={16} aria-hidden="true" />{t.activateLine}</Button>
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
          <Select value={status} onValueChange={(next) => setFilters({ status: next })}>
            <SelectItem value="">{t.allRows}</SelectItem>
            <SelectItem value="active">{t.lineActive}</SelectItem>
            <SelectItem value="expiring">{t.expiringSoon}</SelectItem>
            <SelectItem value="frozen">{t.lineFrozen}</SelectItem>
            <SelectItem value="disconnected">{t.lineDisconnected}</SelectItem>
            <SelectItem value="suspended">{t.lineSuspended}</SelectItem>
          </Select>
        </label>
        {/* SIM or eSIM (spec 2026-11-11-ui-consistency-pass, D1). */}
        <label>
          {t.simType}
          <Select value={sim} onValueChange={(next) => setFilters({ sim: next })}>
            <SelectItem value="">{t.allRows}</SelectItem>
            <SelectItem value="sim">{t.physicalSim}</SelectItem>
            <SelectItem value="esim">{t.esim}</SelectItem>
          </Select>
        </label>
      </FilterBar>
      <Pane id="lines">
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
            <form id="activate-line" className="grid content-start gap-3" onSubmit={activate}>
              <div className="grid grid-cols-[1fr_1fr] gap-2 max-md:grid-cols-[1fr]">
                <Label tone="dialog">
                  {t.pointOfSale}
                  <NameField
                    value={posLoginName || poses[0]?.loginName || ''}
                    onChange={setPosLoginName}
                    options={poses.map((pos) => ({ value: pos.loginName, label: accountLabel(pos.loginName, pos.nickname), keys: [pos.loginName] }))}
                  />
                </Label>
                <Label tone="dialog">
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
                </Label>
              </div>
              {chosen ? <PackageFacts facts={chosen} /> : null}
              {offersEsim && (
                <Label className={CHECK_ROW}>
                  <Checkbox checked={esim} onCheckedChange={(next) => setEsim(next === true)} />
                  {t.esim}
                </Label>
              )}
              {activation === 'details' && (
                <Label tone="dialog">
                  {t.currentNumberDetails}
                  <Input value={currentDetails} onChange={(event) => setCurrentDetails(event.target.value)} />
                </Label>
              )}
              {activation === 'number' && (
                <Label tone="dialog">
                  {t.number}
                  <Input value={givenNumber} onChange={(event) => setGivenNumber(event.target.value)} dir="ltr" />
                </Label>
              )}
              {!withEsim && (
                <Label tone="dialog">
                  {t.iccid}
                  <Input value={iccid} onChange={(event) => setIccid(event.target.value)} inputMode="numeric" dir="ltr" />
                  {hasSimRules(rules) && <span className={FIELD_HINT}>{simHint(t, rules)}</span>}
                </Label>
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
        <EsimDialog line={qr && 'shown' in qr ? qr.shown : null} onClose={closeQr} />
        <ActivationResult result={result} onClose={() => setResult(null)} />
        <DisconnectConfirm
          line={ending}
          busy={busy}
          failing={verdict === 'fail'}
          onClose={() => setEnding(null)}
          onConfirm={(line) => run(() => api.disconnectLine(line.id, verdict), applied)}
        />
      </Pane>
    </Desk>
  );
}
