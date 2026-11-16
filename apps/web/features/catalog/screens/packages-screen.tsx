'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { ActivationKindChoice, offeredKind, type ActivationChoice } from '../../../components/activation-kind';
import { ActivationResult } from '../../../components/activation-result';
import { Desk, Money, Pane } from '../../../components/desk';
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
import { useDesk } from '../../../lib/desk-session';
import { usePrefs } from '../../../lib/prefs';
import { OPEN_SIM, hasSimRules, simFits, simHint } from '../../../lib/sim-rules';
import { useRequestKey } from '../../../lib/request-key';
import { useAction } from '../../../lib/use-action';
import { Badge } from '../../../components/ui/badge';
import { NameField } from '../../../components/name-field';
import { DataImage } from '../../../components/data-image';
import { pointerGlowClass } from '../../../components/stat';
import { Tabs } from '../../../components/tabs';
import { PackageFacts } from '../../../components/package-facts';
import { priceFieldClass } from '../../../components/price-field';
import { Checkbox } from '../../../components/ui/checkbox';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { cn } from '../../../lib/cn';
import { paneHintClass } from '../sim-fields';

/*
 * The look (Tailwind migration T4.4, ADR 0022), ported from desk/packages.css, frame.css, pane.css, graphite.css and
 * responsive.css in their cascade order:
 * - the page column (`COLUMN`): a flex column 12px apart that keeps its content's height (the legacy `.desk > .stack`);
 *   it keeps the `stack` class as the handle the desk column, the canvas and `Pane` size by;
 * - the point of sale's cards (`CARD_GRID`, `CARD`): 180px columns at the start, 12px apart, each rising in when
 *   motion is allowed; a card is a grid 10px apart, at least 148px high, 16px inside, a 1px `--rd-line` border with 8px
 *   corners on `--rd-surface`, ink, its border ink under the pointer, with the soft `--rd-glow` light under the pointer
 *   (the shell sets `--mx` / `--my` on a card it finds by `data-slot="pos-company"` / `"pack-card"`) and a 2px lift
 *   when motion is allowed. A company card centres its picture (64px, 10px corners, contained on `--rd-surface-2`)
 *   or its letters (a 64px tile, 8px corners, 18px bold `--rd-on-mark`) over its name; a package card lines its
 *   rows at the start; its price 22px bold (weights capped at 700 since T6.3, ADR 0021 D7);
 * - the subscribe step: a pane whose body is the form, laid out as a block with no row gap (the legacy form was the
 *   pane itself, a child of `.desk > .stack`, so `.desk > .stack > .pane` made it a block and neither `.pane-body`'s
 *   12px nor `.pane form`'s 8px reached it); fields are pane labels and fields, the eSIM box a pane label laid out as
 *   a row (at least 36px, 44px under 721px); the button inline at the start;
 * - a company's title (`CompanyTitle`): a row 12px apart, the picture 64px as above or the letters on a 48px tile
 *   (8px corners, 14px bold); the eyebrow 11px bold `--rd-muted`, tracked 0.02em;
 * - the sell cell: its two price fields (`PriceField`'s look) and the save at the inline end and the foot, 8px apart;
 *   on a phone's card the cell takes the card's whole row and its parts wrap from the start.
 */
const COLUMN = 'stack flex min-h-auto min-w-0 max-w-full flex-none flex-col gap-3 overflow-visible *:min-w-0';
const CARD_GRID = 'grid grid-cols-[repeat(auto-fill,180px)] justify-start gap-3 motion-safe:*:animate-rise';
const CARD = cn(
  'relative isolate grid min-h-37 gap-2.5 rounded-card border border-line bg-surface p-4 text-ink hover:border-ink',
  pointerGlowClass,
);
const LOGO = 'size-16 rounded-panel bg-surface-2 object-contain';
const PRICE = 'm-0 text-4xl font-bold';
const CHECK_ROW = 'm-0 flex min-h-9 cursor-pointer items-center max-touch:min-h-11';
const EYEBROW = 'm-0 text-xs font-bold tracking-head text-muted';
/** A phone's card (a table with `data-cards` whose cells carry their names): graphite.css's price editors rules. */
const IN_CARD_ROW = 'max-sm:[[data-cards]:has(td[data-label])_&]:col-span-full';
const SELL_CELL = cn(
  'inline-flex items-end justify-end gap-2',
  'max-sm:[[data-cards]:has(td[data-label])_&]:flex-wrap max-sm:[[data-cards]:has(td[data-label])_&]:justify-start',
);

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
  const [kind, setKind] = useState<ActivationChoice>('new');
  const [currentDetails, setCurrentDetails] = useState('');
  const [iccid, setIccid] = useState('');
  const [esim, setEsim] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<ApplyResult | null>(null);
  const { run } = useAction({ setError, setNote });
  const requestKey = useRequestKey();
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

  // A porting or a conversion takes the number and the serial, whatever the provider asks for a new number.
  const special = offeredKind(kind, picked);
  const activation = special ? 'number' : picked?.activateInput === 'current-details' ? 'details' : picked?.activateInput === 'number-and-sim' ? 'number' : 'generated';
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
    const body = {
      packageCode: picked.code,
      posLoginName: loginName,
      esim: withEsim,
      iccid: withEsim ? '' : iccid.trim(),
      msisdn: activation === 'number' ? givenNumber.trim() : '',
      currentDetails: activation === 'details' ? currentDetails.trim() : '',
      ...(special ? { kind: special } : {}),
      outcome: 'success' as const,
    };
    // The same activation sent again keeps its key; once answered, the next one is another (ADR 0019, D14).
    await run(
      () => api.activateLine(body, requestKey.keyFor(body)),
      { then: (data) => { requestKey.spent(); setResult(data); setIccid(rules.prefix); setGivenNumber(''); setCurrentDetails(''); } },
    );
  }

  const canActivate = loginName.trim().length > 0 && simReady;

  return (
    <Desk title={t.plansTitle} lede={t.plansPosLede} error={loadError || error} note={note}>
      <div className={COLUMN}>
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
          <div className={CARD_GRID}>
            {names.map((name) => {
              const image = imageOf.get(name) ?? '';
              return (
                <button className={cn(CARD, 'cursor-pointer justify-items-center text-center')} data-slot="pos-company" data-testid="company-card" key={name} type="button" onClick={() => openCompany(name)}>
                  {image ? <DataImage className={LOGO} src={image} alt="" /> : <span className="grid size-16 place-items-center rounded-card text-2xl font-bold text-on-mark" style={{ background: markColor(name) }}>{markOf(name)}</span>}
                  <strong>{name}</strong>
                </button>
              );
            })}
          </div>
        )}
        {step === 'packages' && (
          <div className={CARD_GRID}>
            {packs.map((row) => (
              <button className={cn(CARD, 'justify-items-stretch text-start')} data-slot="pack-card" data-testid="pack-card" key={row.code} type="button" onClick={() => openPackage(row)}>
                <strong>{row.name}</strong>
                <PackageFacts facts={row} withDetails={false} />
                <p className={PRICE} data-testid="pack-price"><Money value={row.price} /></p>
              </button>
            ))}
          </div>
        )}
        {step === 'details' && picked && (
          <Pane>
            <form className="pane-body block" data-testid="subscribe-form" onSubmit={join}>
              <h2>{picked.companyName} · {picked.name}</h2>
              <PackageFacts facts={picked} />
              <p className={PRICE} data-testid="pack-price"><Money value={picked.price + (withEsim ? picked.esimPrice : 0)} /></p>
              {!picked.canActivate && <Badge variant="danger" dot>{t.activationStopped}</Badge>}
              {picked.canActivate ? <ActivationKindChoice value={kind} onChange={setKind} pkg={picked} /> : null}
              {picked.canActivate && offersEsim && (
                <Label tone="pane" className={CHECK_ROW}>
                  <Checkbox checked={esim} onCheckedChange={(next) => setEsim(next === true)} />
                  <span>{t.esim}</span>
                </Label>
              )}
              {picked.canActivate && activation === 'details' && (
                <Label tone="pane">
                  {t.currentNumberDetails}
                  <Input surface="surface" className="text-md" value={currentDetails} onChange={(event) => setCurrentDetails(event.target.value)} required />
                </Label>
              )}
              {picked.canActivate && activation === 'number' && (
                <Label tone="pane">
                  {t.number}
                  <Input surface="surface" className="text-md" value={givenNumber} inputMode="numeric" dir="ltr" onChange={(event) => setGivenNumber(event.target.value)} required />
                </Label>
              )}
              {picked.canActivate && !withEsim && (
                <Label tone="pane">
                  {t.iccid}
                  <Input surface="surface" className="text-md" value={iccid} onChange={(event) => setIccid(event.target.value)} inputMode="numeric" dir="ltr" required />
                  {hasSimRules(rules) && <span className={paneHintClass}>{simHint(t, rules)}</span>}
                </Label>
              )}
              {picked.canActivate && <Button type="submit" disabled={!canActivate}>{t.actActivate}</Button>}
            </form>
          </Pane>
        )}
      </div>
      <ActivationResult result={result} onClose={() => setResult(null)} />
    </Desk>
  );
}

function CompanyTitle({ name, image, label, heading = false }: { name: string; image: string; label: string; heading?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {image ? (
        <DataImage className={LOGO} src={image} alt="" />
      ) : (
        <span className="grid size-12 place-items-center rounded-card text-base font-bold text-on-mark" style={{ background: markColor(name) }}>{markOf(name)}</span>
      )}
      <div>
        <p className={EYEBROW}>{label}</p>
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
  const { me } = useDesk();
  const door = useDoor();
  const layer = me?.layer ?? '';
  const isPos = door.layer === 'pos' || layer === 'pos';
  const loginName = me?.loginName ?? '';
  const catalog = useApiQuery(sharedKeys.packages, () => api.packages());
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
      cell: IN_CARD_ROW,
      render: (row) => row.editableField && (
        <div className={SELL_CELL} data-testid="sell-cell">
          <label className={priceFieldClass.label}>
            <span className={priceFieldClass.hint}>{t.subscriptionShort}</span>
            <Input
              surface="surface"
              dir="ltr"
              className={cn(priceFieldClass.input, 'max-sm:[[data-cards]:has(td[data-label])_&]:max-w-full')}
              aria-label={`${row.name} ${t.subscriptionShort}`}
              value={drafts[row.code]?.price ?? ''}
              placeholder={row.sellDefault === null ? '' : shekelField(row.sellDefault)}
              inputMode="decimal"
              onChange={(event) => setDraft(row.code, { price: event.target.value })}
            />
          </label>
          <label className={priceFieldClass.label}>
            <span className={priceFieldClass.hint}>{t.renewalShort}</span>
            <Input
              surface="surface"
              dir="ltr"
              className={cn(priceFieldClass.input, 'max-sm:[[data-cards]:has(td[data-label])_&]:max-w-full')}
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
        <Pane>
          <header className="pane-head"><Spinner /></header>
          <TableSkeleton />
        </Pane>
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
        <Pane>
          <header className="pane-head"><Spinner /></header>
          <TableSkeleton />
        </Pane>
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
        <Pane>
          <EmptyState>{t.noLines}</EmptyState>
        </Pane>
      ) : (
        <div className={COLUMN}>
          {showProvider
            ? sections.map((section) => (
                <Pane key={section.key}>
                  <header className="pane-head">
                    <div>
                      <p className={EYEBROW}>{t.provider}</p>
                      <h2>{section.provider}</h2>
                    </div>
                  </header>
                  {section.companies.map((company) => (
                    <div className="pane-body" key={company.name}>
                      <CompanyTitle name={company.name} image={marks.find((mark) => mark.name === company.name)?.image ?? ''} label={t.company} />
                      {priceTable(company.rows)}
                    </div>
                  ))}
                </Pane>
              ))
            : sections[0]?.companies.map((company) => (
                <Pane key={company.name}>
                  <header className="pane-head">
                    <CompanyTitle name={company.name} image={marks.find((mark) => mark.name === company.name)?.image ?? ''} label={t.company} heading />
                  </header>
                  <div className="pane-body">{priceTable(company.rows)}</div>
                </Pane>
              ))}
        </div>
      )}
    </Desk>
  );
}
