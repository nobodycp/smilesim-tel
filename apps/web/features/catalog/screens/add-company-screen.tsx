'use client';

import { Check, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Desk, Pane } from '../../../components/desk';
import { NameField } from '../../../components/name-field';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { api, type ProviderCatalogCompany } from '../../../lib/api';
import { cn } from '../../../lib/cn';
import { parseShekel, shekelField } from '../../../lib/money';
import { useDesk } from '../../../lib/desk-session';
import { usePageTitle } from '../../../lib/page-title';
import { usePrefs } from '../../../lib/prefs';
import { sharedKeys } from '../../../lib/query';
import { useApiQuery } from '../../../lib/use-api-query';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { SimFields, SimSample, paneHintClass, simToggleClass } from '../sim-fields';

/*
 * The steps' look (Tailwind migration T4.3, ADR 0022), ported from graphite.css and pane.css:
 * - a step is a pane; a step after a step sits 12px lower; its heading's number and words 10px apart;
 * - the number: a 24px round tag on `--rd-accent-soft`, 12px extra-bold `--rd-accent`;
 * - the provider query: one wrapping row 10px apart at the foot of its fields; the field's label a grid 4px apart, at
 *   least 18rem (or the row) wide, 11px bold `--rd-muted`; under 768px the label takes the row and the button the rest
 *   of the next, 44px high;
 * - the companies on offer: as many 200px-or-wider cards as fit, 10px apart; a card is a grid of rows 4px apart at the
 *   start, 12px by 14px inside, a 1px `--rd-line` border with 6px corners on `--rd-surface-2`, ink; under the pointer
 *   the border is `--rd-accent` at 45%; picked, an `--rd-accent` border on `--rd-accent-soft`; already
 *   added, at 55% with a plain pointer; on keyboard focus a 2px `--rd-accent` outline 1px out. Its name 13px, its code
 *   a pane note, its tick 10px in from the top inline-end corner in `--rd-accent`;
 * - the eSIM box: a pane label laid out as a row 4px apart, at least 36px high (44px under 721px), its words at 11px
 *   `--rd-muted` 600 (the pane's label rule outranked `.check`'s 13px ink);
 * - the actions: at the end, 8px apart, 12px under the step; under 768px each takes an equal share, 44px high.
 * `data-slot="pick-card"` is a card's handle.
 */
const STEP_TITLE = 'gap-2.5';
const STEP_NO = 'inline-grid size-6 place-items-center rounded-pill bg-accent-soft text-sm font-extrabold text-accent';
const PICK_CARD = cn(
  'relative grid cursor-pointer justify-items-start gap-1 rounded-sm border border-line bg-surface-2 px-3.5 py-3 text-start text-ink',
  // The legacy hover mixed 45% `--rd-accent` into `--rd-line` (srgb); `--rd-accent` at 45% is the token form (the
  // line is 8% ink, so the drawn border differs by about 4% of its lightness).
  'enabled:hover:border-accent/45',
  'aria-checked:border-accent aria-checked:bg-accent-soft',
  'disabled:cursor-default disabled:opacity-55',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
);

/**
 * «إضافة شركة» (spec 2026-11-09-admin-review, 3): pick the provider and query it; pick one of the companies it sells;
 * its name and SIM rules come from the provider and can be changed before saving. The provider is simulated for now.
 */
export function AddCompanyScreen() {
  const { t, apiText } = usePrefs();
  const router = useRouter();
  const { me } = useDesk();
  const allowed = useRequireLayer(['branch']);
  const canEdit = Boolean(me && (me.isBranchOwner || me.grants.includes('edit')) && !me.impersonating);
  const providers = useApiQuery(sharedKeys.providers, () => api.providers(), { enabled: allowed });
  usePageTitle(t.addCompany);

  const [provider, setProvider] = useState('');
  const [offered, setOffered] = useState<ProviderCatalogCompany[] | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [picked, setPicked] = useState<ProviderCatalogCompany | null>(null);
  const [name, setName] = useState('');
  const [length, setLength] = useState('');
  const [prefix, setPrefix] = useState('');
  const [esim, setEsim] = useState(true);
  const [esimPrice, setEsimPrice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function query() {
    if (!provider) return;
    setError('');
    setBusy(true);
    setPicked(null);
    const result = await api.providerCatalogCompanies(provider);
    setBusy(false);
    if (!result.ok) {
      setOffered(null);
      setError(apiText(result));
      return;
    }
    setOffered(result.data.companies);
    setSimulated(result.data.simulated);
  }

  function pick(next: ProviderCatalogCompany) {
    setPicked(next);
    setName(next.name);
    setLength(next.sim.length === null ? '' : String(next.sim.length));
    setPrefix(next.sim.prefix);
    setEsim(next.sim.esim);
    setEsimPrice(shekelField(next.esimPrice));
  }

  async function save() {
    if (!picked) return;
    setError('');
    const price = parseShekel(esimPrice);
    const digits = length.trim();
    if (!name.trim() || price === null || (digits && !/^\d+$/.test(digits)) || (prefix.trim() && !/^\d+$/.test(prefix.trim()))) {
      setError(t.errors.INVALID);
      return;
    }
    setBusy(true);
    const result = await api.createCompany({
      providerCode: provider,
      companyCode: picked.code,
      name: name.trim(),
      simLength: digits ? Number(digits) : null,
      simPrefix: prefix.trim(),
      esim,
      esimPrice: price,
    });
    setBusy(false);
    if (!result.ok) {
      setError(apiText(result));
      return;
    }
    router.push(`/companies/${encodeURIComponent(result.data.code)}`);
  }

  if (!allowed) return null;
  const rules = { length: length.trim() ? Number(length) : null, prefix: prefix.trim(), esim };

  return (
    <Desk title={t.addCompany} lede="" error={error} note="">
      {/* Outside a pane no legacy rule reached this note: a plain paragraph. */}
      {!canEdit && me ? <p>{t.addNeedsEdit}</p> : null}
      <Pane>
        <header className="pane-head"><h2 className={STEP_TITLE}><span className={STEP_NO}>1</span>{t.stepProvider}</h2></header>
        <div className="pane-body flex flex-wrap items-end gap-2.5">
          <Label tone="pane" className="min-w-[min(100%,18rem)] font-bold max-md:flex-[1_1_100%]">
            {t.provider}
            <NameField
              value={provider}
              onChange={(next) => { setProvider(next); setOffered(null); setPicked(null); }}
              options={(providers.data?.providers ?? []).map((row) => ({ value: row.code, label: row.name, keys: [row.code] }))}
            />
          </Label>
          <Button type="button" className="max-md:min-h-11 max-md:flex-1" disabled={!provider || busy || !canEdit} onClick={() => void query()}>
            <Search size={16} aria-hidden="true" />
            {t.queryProvider}
          </Button>
        </div>
        {offered ? (
          <div className="pane-body">
            {simulated ? <p className={paneHintClass}>{t.simulatedProvider}</p> : null}
            {offered.length === 0 ? <p className={paneHintClass}>{t.noProviderCompanies}</p> : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5" role="radiogroup" aria-label={t.providerCompanies}>
                {offered.map((row) => (
                  <button
                    key={row.code}
                    type="button"
                    role="radio"
                    aria-checked={picked?.code === row.code}
                    className={PICK_CARD}
                    data-slot="pick-card"
                    disabled={row.added}
                    onClick={() => pick(row)}
                  >
                    <b className="text-md">{row.name}</b>
                    <span className={paneHintClass} dir="ltr">{row.code}</span>
                    {row.added ? <Badge variant="muted">{t.alreadyAdded}</Badge> : null}
                    {picked?.code === row.code ? <Check className="absolute end-2.5 top-2.5 text-accent" size={16} aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </Pane>

      {picked ? (
        <>
          <Pane className="mt-3">
            <header className="pane-head"><h2 className={STEP_TITLE}><span className={STEP_NO}>2</span>{t.stepSim}</h2></header>
            <div className="pane-body gap-3.5">
              <SimFields>
                <Label tone="pane">
                  {t.companyNameLabel}
                  <Input surface="surface" className="text-md" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
                </Label>
                <Label tone="pane">
                  {t.simLength}
                  <Input surface="surface" className="text-md" value={length} inputMode="numeric" dir="ltr" onChange={(event) => setLength(event.target.value)} />
                  <span className={paneHintClass}>{t.simLengthHint}</span>
                </Label>
                <Label tone="pane">
                  {t.simPrefix}
                  <Input surface="surface" className="text-md" value={prefix} inputMode="numeric" dir="ltr" onChange={(event) => setPrefix(event.target.value)} />
                  <span className={paneHintClass}>{t.simPrefixHint}</span>
                </Label>
                <div className={simToggleClass}>
                  <Label tone="pane" className="m-0 flex min-h-9 cursor-pointer items-center max-[721px]:min-h-11">
                    <Checkbox checked={esim} onCheckedChange={(next) => setEsim(next === true)} />
                    {t.simEsim}
                  </Label>
                </div>
                <Label tone="pane">
                  {t.esimPriceCompany}
                  <Input surface="surface" className="text-md" value={esimPrice} inputMode="decimal" dir="ltr" onChange={(event) => setEsimPrice(event.target.value)} />
                </Label>
              </SimFields>
              <SimSample rules={rules} />
            </div>
          </Pane>
          <div className="mt-3 flex justify-end gap-2 max-md:*:min-h-11 max-md:*:flex-1">
            <Button type="button" variant="secondary" onClick={() => router.push('/companies')}>{t.cancel}</Button>
            <Button type="button" disabled={busy || !canEdit} onClick={() => void save()}>{t.saveCompany}</Button>
          </div>
        </>
      ) : null}
    </Desk>
  );
}
