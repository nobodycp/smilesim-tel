'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { DataTable, type Column } from '../../components/data-table';
import { ActivationResult } from '../../components/activation-result';
import { Desk, Money } from '../../components/desk';
import { EmptyState } from '../../components/empty-state';
import { FilterBar } from '../../components/filter-bar';
import { RowMenu } from '../../components/row-menu';
import { Button } from '../../components/ui/button';
import { Spinner, TableSkeleton } from '../../components/loading';
import { api, type ApplyResult, type PackageRow } from '../../lib/api';
import { parseShekel, shekelField } from '../../lib/money';
import { hueOf, markOf } from '../../lib/company-mark';
import { useDoor } from '../../lib/door-context';
import { useOffice } from '../../lib/office-session';
import { usePrefs } from '../../lib/prefs';
import { OPEN_SIM, hasSimRules, simFits, simHint } from '../../lib/sim-rules';
import { useAction } from '../../lib/use-action';
import { useLoad } from '../../lib/use-load';

function PosCatalog({
  rows,
  marks,
  loginName,
  loadError,
}: {
  rows: PackageRow[];
  marks: { name: string; image: string }[];
  loginName: string;
  loadError: string;
}) {
  const { t, apiText } = usePrefs();
  const [step, setStep] = useState<'companies' | 'packages' | 'details'>('companies');
  const [company, setCompany] = useState('');
  const [picked, setPicked] = useState<PackageRow | null>(null);
  const [givenNumber, setGivenNumber] = useState('');
  const [currentDetails, setCurrentDetails] = useState('');
  const [iccid, setIccid] = useState('');
  const [esim, setEsim] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<ApplyResult | null>(null);
  const { run } = useAction({ setError, setNote });
  const names = [...new Set(rows.map((row) => row.companyName).filter(Boolean))];
  const imageOf = new Map(marks.map((mark) => [mark.name, mark.image]));
  const packs = rows.filter((row) => row.companyName === company);

  function openCompany(name: string) {
    setCompany(name);
    setPicked(null);
    setStep('packages');
  }

  function openPackage(row: PackageRow) {
    setPicked(row);
    setIccid(row.sim.prefix);
    setStep('details');
  }

  const activation = picked?.providerCode === 'neod' ? 'details' : picked?.providerCode === 'tokman' ? 'number' : 'generated';
  const rules = picked?.sim ?? OPEN_SIM;
  const offersEsim = activation === 'generated' && rules.esim;
  const withEsim = offersEsim && esim;
  const simReady = withEsim || simFits(rules, iccid.trim());

  async function join(event: FormEvent) {
    event.preventDefault();
    if (!picked || !picked.canActivate || !loginName.trim()) return;
    const missing = (!withEsim && !iccid.trim())
      || (activation === 'number' && !/^05\d{8}$/.test(givenNumber.trim()))
      || (activation === 'details' && !currentDetails.trim());
    if (missing) {
      setError(apiText('بيانات غير صالحة'));
      setNote('');
      return;
    }
    await run(
      () => api.activateLine({
        packageCode: picked.code,
        posLogin: loginName,
        esim: withEsim,
        iccid: withEsim ? '' : iccid.trim(),
        msisdn: activation === 'number' ? givenNumber.trim() : '',
        currentDetails: activation === 'details' ? currentDetails.trim() : '',
        outcome: 'success',
      }),
      { then: (data) => { setResult(data); setIccid(rules.prefix); setGivenNumber(''); setCurrentDetails(''); } },
    );
  }

  const canActivate = loginName.trim().length > 0 && simReady;

  return (
    <Desk title={t.plansTitle} lede={t.plansPosLede} error={loadError || error} note={note}>
      <div className="stack">
        <div className="steps" role="tablist">
          <button type="button" role="tab" aria-selected={step === 'companies'} onClick={() => setStep('companies')}>{t.tabCompanies}</button>
          <button type="button" role="tab" aria-selected={step === 'packages'} disabled={!company} onClick={() => setStep('packages')}>{t.tabPackages}</button>
          <button type="button" role="tab" aria-selected={step === 'details'} disabled={!picked} onClick={() => setStep('details')}>{t.tabSubscribe}</button>
        </div>
        {step === 'companies' && (
          <div className="company-grid">
            {names.map((name) => {
              const image = imageOf.get(name) ?? '';
              return (
                <button className="company-card" key={name} type="button" onClick={() => openCompany(name)}>
                  {/* A data URL the browser already holds: next/image has nothing to optimise, so a plain img is right. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {image ? <img className="company-logo" src={image} alt="" /> : <span className="company-mark" style={{ background: `hsl(${hueOf(name)} 42% 42%)` }}>{markOf(name)}</span>}
                  <strong>{name}</strong>
                </button>
              );
            })}
          </div>
        )}
        {step === 'packages' && (
          <div className="pack-grid">
            {packs.map((row) => (
              <button className="pack-card" key={row.code} type="button" onClick={() => openPackage(row)}>
                <strong>{row.name}</strong>
                <p className="pack-price"><Money value={row.price} /></p>
              </button>
            ))}
          </div>
        )}
        {step === 'details' && picked && (
          <form className="pane pane-body stack" onSubmit={join}>
            <h2>{picked.companyName} · {picked.name}</h2>
            <p className="pack-price"><Money value={picked.price + (withEsim ? picked.esimPrice : 0)} /></p>
            {!picked.canActivate && <p className="badge cancelled">{t.activationStopped}</p>}
            {picked.canActivate && offersEsim && (
              <label className="check">
                <input type="checkbox" checked={esim} onChange={(event) => setEsim(event.target.checked)} />
                <span>{t.esim}</span>
              </label>
            )}
            {picked.canActivate && activation === 'details' && (
              <label>
                {t.currentNumberDetails}
                <input value={currentDetails} onChange={(event) => setCurrentDetails(event.target.value)} required />
              </label>
            )}
            {picked.canActivate && activation === 'number' && (
              <label>
                {t.number}
                <input value={givenNumber} inputMode="numeric" dir="ltr" onChange={(event) => setGivenNumber(event.target.value)} required />
              </label>
            )}
            {picked.canActivate && !withEsim && (
              <label>
                {t.iccid}
                <input value={iccid} onChange={(event) => setIccid(event.target.value)} inputMode="numeric" dir="ltr" required />
                {hasSimRules(rules) && <span className="hint">{simHint(t, rules)}</span>}
              </label>
            )}
            {picked.canActivate && <Button type="submit" disabled={!canActivate}>{t.actActivate}</Button>}
          </form>
        )}
      </div>
      <ActivationResult result={result} onClose={() => setResult(null)} />
    </Desk>
  );
}

function CompanyTitle({ name, image, label, heading = false }: { name: string; image: string; label: string; heading?: boolean }) {
  return (
    <div className="company-head">
      {image ? (
        // A data URL the browser already holds: next/image has nothing to optimise, so a plain img is right.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="company-logo" src={image} alt="" />
      ) : (
        <span className="company-mark" style={{ background: `hsl(${hueOf(name)} 42% 42%)` }}>{markOf(name)}</span>
      )}
      <div>
        <p className="eyebrow">{label}</p>
        {heading ? <h2>{name}</h2> : <strong>{name}</strong>}
      </div>
    </div>
  );
}

function BranchPackages({ error, note }: { error: string; note: string }) {
  const { t } = usePrefs();
  const shelf = useLoad(() => api.officeCompanies());
  const [query, setQuery] = useState('');
  const [company, setCompany] = useState('');
  const [provider, setProvider] = useState('');
  const [status, setStatus] = useState('');
  const rows = (shelf.data?.companies ?? []).flatMap((companyRow) => companyRow.providers.flatMap((providerRow) => (
    providerRow.packages.map((item) => ({
      code: item.code,
      name: item.name,
      companyName: companyRow.name,
      providerCode: providerRow.code,
      providerName: providerRow.name,
      activeLines: item.activeLines,
      stoppedLines: item.stoppedLines,
      enabled: item.enabled,
    }))
  )));
  const companies = [...new Set(rows.map((row) => row.companyName))].sort((left, right) => left.localeCompare(right, 'ar'));
  const providers = [...new Set(rows.filter((row) => !company || row.companyName === company).map((row) => row.providerName))].sort((left, right) => left.localeCompare(right, 'ar'));
  const needle = query.trim();
  const shown = rows.filter((row) => {
    if (needle && !row.name.includes(needle)) return false;
    if (company && row.companyName !== company) return false;
    if (provider && row.providerName !== provider) return false;
    if (status === 'on' && !row.enabled) return false;
    if (status === 'off' && row.enabled) return false;
    return true;
  });
  const filtering = Boolean(needle || company || provider || status);
  const columns: Column<typeof rows[number]>[] = [
    {
      key: 'package',
      header: t.packageName,
      render: (row) => (
        <Link className="row-link" href={`/providers/${row.providerCode}/${encodeURIComponent(row.code)}`}>{row.name}</Link>
      ),
    },
    { key: 'company', header: t.company, render: (row) => row.companyName },
    { key: 'provider', header: t.provider, render: (row) => row.providerName },
    {
      key: 'live',
      header: t.status,
      render: (row) => (
        <span className={row.enabled ? 'badge' : 'badge cancelled'}>{row.enabled ? t.lineActive : t.stopped}</span>
      ),
    },
    { key: 'active', header: t.activeNumbers, num: true, render: (row) => row.activeLines },
    { key: 'stopped', header: t.stoppedLines, num: true, render: (row) => row.stoppedLines },
  ];

  return (
    <Desk title={t.plansTitle} lede="" error={error || shelf.error} note={note}>
      <FilterBar onClear={() => { setQuery(''); setCompany(''); setProvider(''); setStatus(''); }} clearLabel={t.clearFilters}>
        <label>
          {t.packageName}
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          {t.company}
          <select value={company} onChange={(event) => {
            const next = event.target.value;
            setCompany(next);
            if (next && provider && !rows.some((row) => row.companyName === next && row.providerName === provider)) setProvider('');
          }}>
            <option value="">{t.allRows}</option>
            {companies.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          {t.provider}
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="">{t.allRows}</option>
            {providers.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          {t.status}
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t.allRows}</option>
            <option value="on">{t.lineActive}</option>
            <option value="off">{t.stopped}</option>
          </select>
        </label>
      </FilterBar>
      <section className="pane fit">
        <DataTable
          columns={columns}
          rows={shown}
          rowKey={(row) => row.code}
          loading={!shelf.loaded}
          skeleton={{ rows: 8, columns: 6 }}
          empty={filtering ? t.noMatches : t.noLines}
        />
      </section>
    </Desk>
  );
}

type SellDraft = { price: string; renewal: string };

export default function PlansPage() {
  const { t, apiText } = usePrefs();
  const [drafts, setDrafts] = useState<Record<string, SellDraft>>({});
  const [companyFilter, setCompanyFilter] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const { me } = useOffice();
  const door = useDoor();
  const layer = me?.layer ?? '';
  const isPos = door.layer === 'pos' || layer === 'pos';
  const loginName = me?.loginName ?? '';
  const catalog = useLoad(() => api.officePackages());
  const rows = catalog.data?.packages ?? [];
  const marks = catalog.data?.companies ?? [];
  const { run } = useAction({ setError, setNote, onDone: catalog.reload });
  const failure = error || catalog.error;

  // A sell price the user has not touched follows the catalog; one they typed stays until it is saved.
  useEffect(() => {
    if (!catalog.data) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const row of catalog.data?.packages ?? []) {
        next[row.code] ??= {
          price: row.sellPrice === null ? '' : shekelField(row.sellPrice),
          renewal: row.sellRenewalPrice === null ? '' : shekelField(row.sellRenewalPrice),
        };
      }
      return next;
    });
  }, [catalog.data]);

  function setDraft(code: string, patch: Partial<SellDraft>) {
    setDrafts((current) => {
      const before = current[code] ?? { price: '', renewal: '' };
      return { ...current, [code]: { ...before, ...patch } };
    });
  }

  /** Drops the own sell price; the fields empty out and show the layer column again. */
  async function reset(row: PackageRow) {
    await run(() => api.clearSellPrice(row.code), {
      note: t.saved,
      then: () => setDraft(row.code, { price: '', renewal: '' }),
    });
  }

  async function save(row: PackageRow) {
    const draft = drafts[row.code] ?? { price: '', renewal: '' };
    const price = parseShekel(draft.price);
    // Empty renewal means "back to the layer default"; malformed text must not be read as empty.
    const renewalEmpty = draft.renewal.trim() === '';
    const renewalPrice = renewalEmpty ? null : parseShekel(draft.renewal);
    if (price === null || (!renewalEmpty && renewalPrice === null)) {
      setError(apiText('بيانات غير صالحة'));
      setNote('');
      return;
    }
    await run(() => api.setSellPrice(row.code, price, renewalPrice), {
      note: t.saved,
      then: () => setDraft(row.code, { price: shekelField(price), renewal: renewalPrice === null ? '' : shekelField(renewalPrice) }),
    });
  }

  const listed = companyFilter ? rows.filter((row) => row.companyName === companyFilter) : rows;
  const companyNames = [...new Set(rows.map((row) => row.companyName).filter(Boolean))];
  const showProvider = listed.some((row) => row.providerName);
  const byCompany = (list: PackageRow[]) => {
    const companies: { name: string; rows: PackageRow[] }[] = [];
    for (const row of list) {
      let company = companies.find((item) => item.name === row.companyName);
      if (!company) {
        company = { name: row.companyName, rows: [] };
        companies.push(company);
      }
      company.rows.push(row);
    }
    return companies;
  };
  const sections: { key: string; provider: string; companies: { name: string; rows: PackageRow[] }[] }[] = [];
  if (showProvider) {
    for (const row of listed) {
      let section = sections.find((item) => item.provider === row.providerName);
      if (!section) {
        section = { key: row.providerName, provider: row.providerName, companies: [] };
        sections.push(section);
      }
      let company = section.companies.find((item) => item.name === row.companyName);
      if (!company) {
        company = { name: row.companyName, rows: [] };
        section.companies.push(company);
      }
      company.rows.push(row);
    }
  } else {
    sections.push({ key: 'companies', provider: '', companies: byCompany(listed) });
  }

  const ladder: Column<PackageRow>[] = [
    { key: 'agent', header: t.agentPrice, num: true, render: (row: PackageRow) => <Money value={row.agentPrice} muted /> },
    { key: 'pos', header: t.posPrice, num: true, render: (row: PackageRow) => <Money value={row.posPrice} muted /> },
    { key: 'subscriber', header: t.subscriberPrice, num: true, render: (row: PackageRow) => <Money value={row.subscriberPrice} muted /> },
  ].filter((column) => layer === 'main_agent' || column.key !== 'agent');
  const columns: Column<PackageRow>[] = [
    { key: 'package', header: t.packageName, render: (row) => row.name },
    { key: 'yours', header: t.yourPrice, num: true, render: (row) => <Money value={row.price} /> },
    ...ladder,
    {
      key: 'sell',
      header: t.sellPrice,
      num: true,
      render: (row) => row.editableField && (
        <div className="sell-cell">
          <label className="terms-price">
            <span>{t.subscriptionShort}</span>
            <input
              aria-label={`${row.name} ${t.subscriptionShort}`}
              value={drafts[row.code]?.price ?? ''}
              placeholder={row.sellDefault === null ? '' : shekelField(row.sellDefault)}
              inputMode="decimal"
              onChange={(event) => setDraft(row.code, { price: event.target.value })}
            />
          </label>
          <label className="terms-price">
            <span>{t.renewalShort}</span>
            <input
              aria-label={`${row.name} ${t.renewalShort}`}
              value={drafts[row.code]?.renewal ?? ''}
              placeholder={row.sellRenewalDefault === null ? '' : shekelField(row.sellRenewalDefault)}
              inputMode="decimal"
              onChange={(event) => setDraft(row.code, { renewal: event.target.value })}
            />
          </label>
          <Button type="button" variant="secondary" size="sm" onClick={() => save(row)}>{t.save}</Button>
          {row.sellPrice !== null && (
            <RowMenu
              label={`${t.rowActions} ${row.name}`}
              items={[{ label: t.resetDefault, icon: 'undo', onClick: () => reset(row) }]}
            />
          )}
        </div>
      ),
    },
  ];
  const priceTable = (list: PackageRow[]) => <DataTable columns={columns} rows={list} rowKey={(row) => row.code} />;

  if (!catalog.loaded) {
    return (
      <Desk title={t.plansTitle} lede="" error={failure} note={note}>
        <section className="pane">
          <header className="pane-head"><Spinner /></header>
          <TableSkeleton />
        </section>
      </Desk>
    );
  }
  if (isPos) {
    return <PosCatalog rows={rows} marks={marks} loginName={loginName} loadError={failure} />;
  }
  if (door.layer === 'branch' || layer === 'branch') {
    return <BranchPackages error={failure} note={note} />;
  }
  if (!me) {
    return (
      <Desk title={t.plansTitle} lede="" error={failure} note={note}>
        <section className="pane">
          <header className="pane-head"><Spinner /></header>
          <TableSkeleton />
        </section>
      </Desk>
    );
  }

  return (
    <Desk title={t.plansTitle} lede="" error={failure} note={note}>
      <FilterBar onClear={() => setCompanyFilter('')} clearLabel={t.clearFilters}>
        <label>
          {t.company}
          <select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}>
            <option value="">{t.allRows}</option>
            {companyNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
      </FilterBar>
      {listed.length === 0 ? (
        <section className="pane">
          <EmptyState>{t.noLines}</EmptyState>
        </section>
      ) : (
        <div className="stack">
          {showProvider
            ? sections.map((section) => (
                <section className="pane" key={section.key}>
                  <header className="pane-head">
                    <div>
                      <p className="eyebrow">{t.provider}</p>
                      <h2>{section.provider}</h2>
                    </div>
                  </header>
                  {section.companies.map((company) => (
                    <div className="pane-body" key={company.name}>
                      <CompanyTitle name={company.name} image={marks.find((mark) => mark.name === company.name)?.image ?? ''} label={t.company} />
                      {priceTable(company.rows)}
                    </div>
                  ))}
                </section>
              ))
            : sections[0]?.companies.map((company) => (
                <section className="pane" key={company.name}>
                  <header className="pane-head">
                    <CompanyTitle name={company.name} image={marks.find((mark) => mark.name === company.name)?.image ?? ''} label={t.company} heading />
                  </header>
                  <div className="pane-body">{priceTable(company.rows)}</div>
                </section>
              ))}
        </div>
      )}
    </Desk>
  );
}
