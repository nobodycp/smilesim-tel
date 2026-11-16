'use client';

import { Lock, MessageSquare, Phone } from 'lucide-react';
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
import { PackageFactTiles } from '../../../components/package-facts';
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
const CARD_GRID = cn(
  'grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3 max-sm:grid-cols-2 max-sm:gap-2.5',
  'motion-safe:*:animate-rise',
  'motion-safe:[&>:nth-child(2)]:[animation-delay:40ms] motion-safe:[&>:nth-child(3)]:[animation-delay:80ms]',
  'motion-safe:[&>:nth-child(n+4)]:[animation-delay:120ms]',
);
// The card is the admin's company card (features/catalog/screens/companies-screen.tsx): 6px corners on the surface
// with a 1px inset edge and the tag's cut corner at the top inline end, `--rd-surface-2` under the pointer, a 2px
// accent ring on keyboard focus.
const CARD = cn(
  'relative isolate grid cursor-pointer content-start gap-2 rounded-sm border-0 bg-surface p-4.5 text-ink inset-ring inset-ring-line max-sm:p-3.5',
  '[clip-path:polygon(0_0,calc(100%_-_var(--rd-cut))_0,100%_var(--rd-cut),100%_100%,0_100%)]',
  'rtl:[clip-path:polygon(var(--rd-cut)_0,100%_0,100%_100%,0_100%,0_var(--rd-cut))]',
  'transition-colors duration-fast ease-standard hover:bg-surface-2',
  'focus-visible:inset-ring-2 focus-visible:inset-ring-accent focus-visible:outline-none',
);
/*
 * An offer's card (spec 2026-11-16-package-page, P.8): no edge at all, a wash from the gold of `--rd-warning` at the
 * top start to the accent at the bottom end, and a gold data ring. Under the pointer (or with keyboard focus) four
 * bursts of fireworks go off across it (`OfferShow`); at rest, and when less motion is asked for, it is still.
 */
const OFFER_CARD = cn(
  'group/offer inset-ring-0',
  'bg-[linear-gradient(135deg,var(--rd-warning-soft),var(--rd-surface)_55%,var(--rd-accent-soft))]',
  'hover:bg-[linear-gradient(135deg,var(--rd-warning-soft),var(--rd-surface-2)_55%,var(--rd-accent-soft))]',
);
/** Where each burst sits on the card (from the reading start and the top), and when it goes off. */
const BURSTS = [
  { at: 'start-[20%] top-[26%]', delay: 0 },
  { at: 'start-[78%] top-[42%]', delay: 0.35 },
  { at: 'start-[52%] top-[18%]', delay: 0.7 },
  { at: 'start-[30%] top-[70%]', delay: 1.05 },
];
const SPARKS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

/** A company's picture: the whole picture centred, 72px high across the card, straight on the card with no plate behind it. */
const PLATE = 'flex h-18 w-full items-center justify-center overflow-hidden p-2 max-sm:h-16';
/** The line under a card's rule: the counts, 12px muted with the figure in bold ink. */
const CARD_FOOT = 'mt-1 w-full border-t border-line pt-2 text-sm text-muted';
const LOGO = 'size-16 rounded-panel bg-surface-2 object-contain';
const PRICE = 'm-0 text-4xl font-bold';
const CHECK_ROW = 'm-0 flex min-h-9 cursor-pointer items-center max-touch:min-h-11';
/*
 * The point of sale's flow, one question at a time (spec 2026-11-16-package-page, P.6): the question rises in when
 * motion is allowed; its heading is centred, 20px bold; the cards fill the row from 190px, two in a row on a phone.
 */
const QUESTION = 'grid gap-3 motion-safe:animate-rise';
const ASK = 'm-0 text-center text-3xl font-bold text-balance';

const EYEBROW = 'm-0 text-xs font-bold tracking-head text-muted';
/** A phone's card (a table with `data-cards` whose cells carry their names): graphite.css's price editors rules. */
const IN_CARD_ROW = 'max-sm:[[data-cards]:has(td[data-label])_&]:col-span-full';
const SELL_CELL = cn(
  'inline-flex items-end justify-end gap-2',
  'max-sm:[[data-cards]:has(td[data-label])_&]:flex-wrap max-sm:[[data-cards]:has(td[data-label])_&]:justify-start',
);

/** A count's words with the figure in bold ink, as on the admin's company card («**6** رزمة»). */
function counted(template: string, n: number) {
  const [before, after] = template.split('{n}');
  return <>{before}<b className="font-bold text-ink">{n}</b>{after}</>;
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
  const [givenNumber, setGivenNumber] = useState('');
  const [kind, setKind] = useState<ActivationChoice>('new');
  const [currentDetails, setCurrentDetails] = useState('');
  const [iccid, setIccid] = useState('');
  const [esim, setEsim] = useState(false);
  const [customer, setCustomer] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<ApplyResult | null>(null);
  const { run } = useAction({ setError, setNote });
  const requestKey = useRequestKey();
  const { me } = useDesk();
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
  const stepIndex = step === 'companies' ? 0 : step === 'packages' ? 1 : 2;
  // The ring of a package is its data against the largest of the company's packages.
  const maxGb = Math.max(1, ...packs.map((row) => row.dataGb ?? 0));
  const durationOf = (months: number) => (months === 1 ? t.monthOne : months === 2 ? t.monthTwo : `${months} ${t.months}`);
  const factOf = (value: number | null | undefined, unlimited: string, counted: string) => (value === null || value === undefined ? '' : value === -1 ? unlimited : counted.replace('{n}', String(value)));
  const due = picked && stepIndex === 2 ? picked.price + (withEsim ? picked.esimPrice : 0) : 0;
  const balance = typeof me?.balance === 'number' ? me.balance : null;

  return (
    <Desk title={t.plansTitle} lede={t.plansPosLede} error={loadError || error} note={note}>
      <div className={COLUMN} data-testid="pos-flow">
        {/* One question at a time (spec 2026-11-16-package-page, P.6): the bar fills by thirds, the answers given so far
            sit above as lines with «تغيير», and the question in hand rises in under them. */}
        <div className="h-0.75 overflow-hidden rounded-xs bg-surface-3" aria-hidden="true">
          <i className={cn('block h-full origin-right bg-accent transition-transform duration-300 ease-out rtl:origin-right ltr:origin-left motion-reduce:transition-none', stepIndex === 0 ? 'scale-x-[0.33]' : stepIndex === 1 ? 'scale-x-[0.66]' : 'scale-x-100')} />
        </div>
        {stepIndex > 0 ? (
          <div className="grid gap-1" data-testid="pos-answers">
            <Answer label={t.company} value={company} change={t.posChange} onChange={() => setStep('companies')} />
            {stepIndex > 1 && picked ? <Answer label={t.packageName} value={picked.name} change={t.posChange} onChange={() => setStep('packages')} /> : null}
          </div>
        ) : null}
        {step === 'companies' && (
          <div className={QUESTION} key="companies">
            <h2 className={ASK}>{t.posAskCompany}</h2>
            <div className={CARD_GRID}>
              {names.map((name) => {
                const image = imageOf.get(name) ?? '';
                return (
                  <button className={cn(CARD, 'justify-items-center text-center')} data-slot="pos-company" data-testid="company-card" key={name} type="button" onClick={() => openCompany(name)}>
                    {/* The whole picture, centred; a company without one shows its letters there. */}
                    <span className={PLATE}>
                      {image ? <DataImage className="block max-h-full max-w-full object-contain" src={image} alt="" /> : <span className="grid size-16 place-items-center rounded-card text-2xl font-bold text-on-mark" style={{ background: markColor(name) }}>{markOf(name)}</span>}
                    </span>
                    <strong className="text-lg">{name}</strong>
                    <span className={CARD_FOOT}>{counted(t.coPackages, rows.filter((row) => row.companyName === name).length)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {step === 'packages' && (
          <div className={QUESTION} key="packages">
            <h2 className={ASK}>{t.posAskPackage}</h2>
            <div className={CARD_GRID}>
              {packs.map((row) => (
                <button className={cn(CARD, 'justify-items-stretch text-start', row.offer && OFFER_CARD)} data-slot="pack-card" data-testid="pack-card" data-offer={row.offer ? '' : undefined} key={row.code} type="button" onClick={() => openPackage(row)}>
                  {row.offer ? <OfferShow /> : null}
                  <span className="flex items-center gap-2.5">
                    <GbRing gb={row.dataGb} max={maxGb} unlimited={t.unlimited} gold={row.offer} />
                    <span className="grid min-w-0">
                      <strong>{row.name} {row.offer ? <Badge variant="warning">{t.offerBadge}</Badge> : null}</strong>
                      <span className="text-sm text-muted">{durationOf(row.months)}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm font-semibold text-ink-2">
                    {factOf(row.minutes, t.factMinutesUnlimited, t.factMinutes) ? <span className="inline-flex items-center gap-1"><Phone size={13} aria-hidden="true" />{factOf(row.minutes, t.factMinutesUnlimited, t.factMinutes)}</span> : null}
                    {factOf(row.smsCount, t.factSmsUnlimited, t.factSms) ? <span className="inline-flex items-center gap-1"><MessageSquare size={13} aria-hidden="true" />{factOf(row.smsCount, t.factSmsUnlimited, t.factSms)}</span> : null}
                  </span>
                  {row.noDisconnect ? <span className="inline-flex items-center gap-1 text-sm font-semibold text-muted"><Lock size={13} aria-hidden="true" />{t.noDisconnectMark}</span> : null}
                  <span className="mt-auto grid gap-0.5 border-t border-line pt-2">
                    <span className={cn(PRICE, 'text-accent')} data-testid="pack-price"><Money value={row.price} /></span>
                    {row.offer && row.offerNote ? <span className="text-sm text-muted">{row.offerNote}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {step === 'details' && picked && (
          <div className={QUESTION} key="details">
            <h2 className={ASK}>{t.posAskWho}</h2>
            <Pane>
              <form className="pane-body block" id="subscribe-form" data-testid="subscribe-form" onSubmit={join}>
                <PackageFactTiles facts={picked} />
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
                {/* The customer's name is here as a shape only (owner, 2026-11-16): the request does not carry it yet. */}
                {picked.canActivate && (
                  <Label tone="pane">
                    {t.customerName}
                    <Input surface="surface" className="text-md" value={customer} maxLength={60} placeholder={t.optional} onChange={(event) => setCustomer(event.target.value)} />
                  </Label>
                )}
              </form>
            </Pane>
          </div>
        )}
        {/* What is being bought and what the wallet holds after it; the button carries the price. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-card bg-surface-2 px-3.5 py-2.5" data-testid="pos-pay">
          <div className="grid min-w-0">
            <strong>{picked && stepIndex === 2 ? `${picked.name} · ${durationOf(picked.months)}` : stepIndex === 1 ? `${company}: ${t.posAskPackage}` : t.posAskCompany}</strong>
            {balance !== null ? (
              <span className="text-sm text-muted">
                {t.balance} <Money value={balance} /> ← {t.posAfter} <b className="text-ink"><Money value={balance - due} /></b>
              </span>
            ) : null}
          </div>
          {picked && stepIndex === 2 && picked.canActivate ? (
            <Button type="submit" form="subscribe-form" disabled={!canActivate} className="max-sm:w-full">
              {t.actActivate} · <Money value={due} />
            </Button>
          ) : null}
        </div>
      </div>
      <ActivationResult result={result} onClose={() => setResult(null)} />
    </Desk>
  );
}

/** The fireworks on an offer's card: four bursts of sparks while the pointer is over it, behind its content. Decoration only. */
function OfferShow() {
  return (
    <span className="pointer-events-none absolute inset-0 -z-1 overflow-hidden motion-reduce:hidden" aria-hidden="true" data-slot="offer-show">
      {BURSTS.map((burst) => (
        <span key={burst.at} className={cn('absolute size-0', burst.at)}>
          {SPARKS.map((turn, index) => (
            <i
              key={turn}
              className={cn(
                'absolute size-2 rounded-pill opacity-0',
                'motion-safe:group-hover/offer:animate-[offer-spark_1.6s_ease-out_infinite] motion-safe:group-focus-visible/offer:animate-[offer-spark_1.6s_ease-out_infinite]',
                index % 2 ? 'bg-accent' : 'bg-warning',
              )}
              style={{ '--spark-turn': `${turn}deg`, '--spark-reach': index % 3 === 0 ? '72px' : index % 3 === 1 ? '52px' : '36px', animationDelay: `${burst.delay}s` } as React.CSSProperties}
            />
          ))}
        </span>
      ))}
    </span>
  );
}

/** An answer already given, as a line: what was asked, what was picked, and «تغيير» to go back to it. */
function Answer({ label, value, change, onChange }: { label: string; value: string; change: string; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-sm bg-surface-2 px-3 py-1.5 motion-safe:animate-rise" data-testid="pos-answer">
      <span className="min-w-0 truncate"><span className="text-muted">{label}</span> · <b>{value}</b></span>
      <button type="button" className="shrink-0 cursor-pointer border-0 bg-transparent px-1 font-semibold text-accent" onClick={onChange}>{change}</button>
    </div>
  );
}

/**
 * A package's data as a ring: the share of the company's largest package drawn around the figure. Unlimited is a
 * full ring; a package that states no data has an empty one.
 */
function GbRing({ gb, max, unlimited, gold = false }: { gb: number | null; max: number; unlimited: string; gold?: boolean }) {
  const share = gb === null ? 0 : gb === -1 ? 100 : Math.round((gb / max) * 100);
  return (
    <span
      className={cn(
        'grid size-16 shrink-0 place-items-center rounded-pill',
        gold
          ? 'bg-[conic-gradient(var(--rd-warning)_calc(var(--share)*1%),var(--rd-surface-3)_0)]'
          : 'bg-[conic-gradient(var(--rd-ink-2)_calc(var(--share)*1%),var(--rd-surface-3)_0)]',
      )}
      style={{ '--share': share } as React.CSSProperties}
      data-slot="gb-ring"
    >
      <span className="grid size-12 place-items-center rounded-pill bg-surface text-center text-base leading-none font-bold tabular-nums">
        {gb === null ? '—' : gb === -1 ? <span className="text-xs">{unlimited}</span> : gb}
      </span>
    </span>
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
