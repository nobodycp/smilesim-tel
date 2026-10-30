'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Desk, Money, OutcomePick, whole } from '../../components/desk';
import { Spinner, TableSkeleton } from '../../components/loading';
import { api, type Outcome, type PackageRow } from '../../lib/api';
import { useDoor } from '../../lib/door-context';
import { useOffice } from '../../lib/office-session';
import { usePrefs } from '../../lib/prefs';

function markOf(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  return (parts.length > 1 ? parts.map((part) => part[0]).join('') : name.slice(0, 2)).slice(0, 3);
}

function hueOf(name: string): number {
  return [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
}

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
  const [msisdn, setMsisdn] = useState('');
  const [iccid, setIccid] = useState('');
  const [esim, setEsim] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>('success');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
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
    setStep('details');
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    if (!picked || !loginName.trim()) return;
    setError('');
    setNote('');
    if (!/^05\d{8}$/.test(msisdn) || (!esim && !iccid.trim())) {
      setError(apiText('بيانات غير صالحة'));
      return;
    }
    const result = await api.activateLine({
      packageCode: picked.code,
      posLogin: loginName,
      esim,
      iccid,
      msisdn,
      outcome,
    });
    if (!result.ok) {
      setError(apiText(result.message));
      return;
    }
    setNote(result.data.applied ? t.appliedNow : t.sentToBranch);
    setIccid('');
    setMsisdn('');
  }

  const canActivate = loginName.trim().length > 0;

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
                  {image
                    ? <img className="company-logo" src={image} alt="" />
                    : <span className="company-mark" style={{ background: `hsl(${hueOf(name)} 42% 42%)` }}>{markOf(name)}</span>}
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
                <p className="pack-price"><Money value={row.posPrice} /></p>
              </button>
            ))}
          </div>
        )}
        {step === 'details' && picked && (
          <form className="pane pane-body stack" onSubmit={join}>
            <h2>{picked.companyName} · {picked.name}</h2>
            <p className="pack-price"><Money value={picked.posPrice + (esim ? 5 : 0)} /></p>
            <label>
              {t.lineNumber}
              <input value={msisdn} inputMode="numeric" onChange={(event) => setMsisdn(event.target.value)} required />
            </label>
            <label className="check">
              <input type="checkbox" checked={esim} onChange={(event) => setEsim(event.target.checked)} />
              <span>{t.esim}</span>
            </label>
            {!esim && (
              <label>
                {t.serial}
                <input value={iccid} onChange={(event) => setIccid(event.target.value)} dir="ltr" required />
              </label>
            )}
            <OutcomePick value={outcome} onChange={setOutcome} />
            <button type="submit" disabled={!canActivate}>{t.actActivate}</button>
          </form>
        )}
      </div>
    </Desk>
  );
}

function shown(row: PackageRow): number {
  if (row.editableField === 'main') return row.mainPrice;
  if (row.editableField === 'agent') return row.agentPrice;
  if (row.editableField === 'pos') return row.posPrice;
  return row.posPrice;
}

export default function PlansPage() {
  const { t, apiText } = usePrefs();
  const [rows, setRows] = useState<PackageRow[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [companyFilter, setCompanyFilter] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [marks, setMarks] = useState<{ name: string; image: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { me } = useOffice();
  const door = useDoor();
  const layer = me?.layer ?? '';
  const isPos = door.layer === 'pos' || layer === 'pos';
  const loginName = me?.loginName ?? '';

  const load = useCallback(async () => {
    const result = await api.officePackages();
    if (!result.ok) {
      setError(apiText(result.message));
      setLoaded(true);
      return;
    }
    setRows(result.data.packages);
    setMarks(result.data.companies ?? []);
    setPrices((current) => {
      const next = { ...current };
      for (const row of result.data.packages) next[row.code] ??= String(shown(row));
      return next;
    });
    setLoaded(true);
  }, [apiText]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(row: PackageRow) {
    setError('');
    setNote('');
    const price = whole(prices[row.code] ?? '');
    if (price === null) {
      setError(apiText('بيانات غير صالحة'));
      return;
    }
    const result = await api.setPackagePrice(row.code, price);
    if (!result.ok) {
      setError(apiText(result.message));
      return;
    }
    setNote(t.save);
    setPrices((current) => ({ ...current, [row.code]: String(price) }));
    await load();
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

  const priceTable = (list: PackageRow[]) => (
    <div className="sheet">
      <table className="data">
        <thead>
          <tr>
            <th>{t.packageName}</th>
            <th>{t.branchCost}</th>
            <th>{t.mainPrice}</th>
            <th>{t.agentPrice}</th>
            <th>{t.posPrice}</th>
            <th>{t.subscriberPrice}</th>
            <th>{t.yourPrice}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((row) => (
            <tr key={row.code}>
              <td>{row.name}</td>
              <td><Money value={row.branchCost} /></td>
              <td><Money value={row.mainPrice} /></td>
              <td><Money value={row.agentPrice} /></td>
              <td><Money value={row.posPrice} /></td>
              <td><Money value={row.subscriberPrice} /></td>
              <td>
                {row.editableField && (
                  <div className="field-row">
                    <input
                      aria-label={t.yourPrice}
                      value={prices[row.code] ?? ''}
                      inputMode="numeric"
                      onChange={(event) => setPrices((current) => ({ ...current, [row.code]: event.target.value }))}
                    />
                    <button type="button" onClick={() => save(row)}>{t.save}</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (!loaded) {
    return (
      <Desk title={t.plansTitle} lede="" error={error} note={note}>
        <section className="pane">
          <header className="pane-head"><Spinner /></header>
          <TableSkeleton />
        </section>
      </Desk>
    );
  }
  if (isPos) {
    return <PosCatalog rows={rows} marks={marks} loginName={loginName} loadError={error} />;
  }
  if (!me) {
    return (
      <Desk title={t.plansTitle} lede="" error={error} note={note}>
        <section className="pane">
          <header className="pane-head"><Spinner /></header>
          <TableSkeleton />
        </section>
      </Desk>
    );
  }

  return (
    <Desk title={t.plansTitle} lede="" error={error} note={note}>
      <div className="filter-bar">
        <div className="filter-panel">
          <label>
            {t.company}
            <select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}>
              <option value="">{t.allRows}</option>
              {companyNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
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
                    <div>
                      <p className="eyebrow">{t.company}</p>
                      <strong>{company.name}</strong>
                    </div>
                    {priceTable(company.rows)}
                  </div>
                ))}
              </section>
            ))
          : sections[0]?.companies.map((company) => (
              <section className="pane" key={company.name}>
                <header className="pane-head">
                  <div>
                    <p className="eyebrow">{t.company}</p>
                    <h2>{company.name}</h2>
                  </div>
                </header>
                <div className="pane-body">{priceTable(company.rows)}</div>
              </section>
            ))}
      </div>
    </Desk>
  );
}
