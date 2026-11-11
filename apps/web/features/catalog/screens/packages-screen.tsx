'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { ActivationResult } from '../../../components/activation-result';
import { Desk, Money } from '../../../components/desk';
import { EmptyState } from '../../../components/empty-state';
import { FilterBar } from '../../../components/filter-bar';
import { RowMenu } from '../../../components/row-menu';
import { Button } from '../../../components/ui/button';
import { PageSkeleton, Spinner, TableSkeleton } from '../../../components/loading';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { api, type ApplyResult, type PackageRow } from '../../../lib/api';
import { parseShekel, shekelField } from '../../../lib/money';
import { markColor, markOf } from '../../../lib/company-mark';
import { useDoor } from '../../../lib/door-context';
import { useOffice } from '../../../lib/office-session';
import { usePrefs } from '../../../lib/prefs';
import { OPEN_SIM, hasSimRules, simFits, simHint } from '../../../lib/sim-rules';
import { useAction } from '../../../lib/use-action';
import { Badge } from '../../../components/ui/badge';
import { NameField } from '../../../components/name-field';
import { DataImage } from '../../../components/data-image';
import { Tabs } from '../../../components/tabs';
import { PackageFacts } from '../../../components/package-facts';

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

  const activation = picked?.activateInput === 'current-details' ? 'details' : picked?.activateInput === 'number-and-sim' ? 'number' : 'generated';
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
        posLoginName: loginName,
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
        <Tabs
          items={[
            { key: 'companies', label: t.tabCompanies },
            { key: 'packages', label: t.tabPackages, disabled: !company },
            { key: 'details', label: t.tabSubscribe, disabled: !picked },
          ]}
          value={step}
          onChange={setStep}
        />
        {step === 'companies' && (
          <div className="company-grid">
            {names.map((name) => {
              const image = imageOf.get(name) ?? '';
              return (
                <button className="company-card" key={name} type="button" onClick={() => openCompany(name)}>
                  {image ? <DataImage className="company-logo" src={image} alt="" /> : <span className="company-mark" style={{ background: markColor(name) }}>{markOf(name)}</span>}
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
                <PackageFacts facts={row} withDetails={false} />
                <p className="pack-price"><Money value={row.price} /></p>
              </button>
            ))}
          </div>
        )}
        {step === 'details' && picked && (
          <form className="pane pane-body stack" onSubmit={join}>
            <h2>{picked.companyName} · {picked.name}</h2>
            <PackageFacts facts={picked} />
            <p className="pack-price"><Money value={picked.price + (withEsim ? picked.esimPrice : 0)} /></p>
            {!picked.canActivate && <Badge variant="danger" dot>{t.activationStopped}</Badge>}
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
        <DataImage className="company-logo" src={image} alt="" />
      ) : (
        <span className="company-mark" style={{ background: markColor(name) }}>{markOf(name)}</span>
      )}
      <div>
        <p className="eyebrow">{label}</p>
        {heading ? <h2>{name}</h2> : <strong>{name}</strong>}
      </div>
    </div>
  );
}

/**
 * The branch has no packages list of its own (spec 2026-11-09-admin-review, 4): the company is the catalog's root,
 * and each company's page lists its packages. `/packages` moves the branch to «الشركات والرزم».
 */
function BranchToCompanies() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/companies');
  }, [router]);
  return <PageSkeleton />;
}

type SellDraft = { price: string; renewal: string };

export function PackagesScreen() {
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
  const catalog = useApiQuery(sharedKeys.packages, () => api.officePackages());
  const rows = catalog.data?.packages ?? [];
  const marks = catalog.data?.companies ?? [];
  const { run } = useAction({ setError, setNote, onDone: catalog.reload });
  const failure = error || catalog.error;

  // A sell price the user has not touched follows the catalog; one they typed stays until it is saved. Merged while
  // rendering, when a new answer arrives, instead of in an effect.
  const [mergedFrom, setMergedFrom] = useState<typeof catalog.data>(null);
  if (catalog.data && catalog.data !== mergedFrom) {
    const fresh = catalog.data;
    setMergedFrom(fresh);
    setDrafts((current) => {
      const next = { ...current };
      for (const row of fresh.packages) {
        next[row.code] ??= {
          price: row.sellPrice === null ? '' : shekelField(row.sellPrice),
          renewal: row.sellRenewalPrice === null ? '' : shekelField(row.sellRenewalPrice),
        };
      }
      return next;
    });
  }

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
    { key: 'agent', header: t.agentPrice, num: true, render: (row: PackageRow) => (row.agentPrice === null ? '—' : <Money value={row.agentPrice} muted />) },
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
      // The cell holds the edit fields; the header sorts by the price in force (own, else the default).
      sortValue: (row) => (row.editableField ? row.sellPrice ?? row.sellDefault : null),
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
          <Button type="button" size="sm" onClick={() => save(row)}>{t.save}</Button>
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
    return <BranchToCompanies />;
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
          <NameField value={companyFilter} allLabel={t.allRows} onChange={setCompanyFilter} options={companyNames.map((name) => ({ value: name, label: name }))} />
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
