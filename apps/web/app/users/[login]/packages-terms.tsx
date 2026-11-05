'use client';

import { Lock } from 'lucide-react';
import { useState } from 'react';
import { Dialog } from '../../../components/dialog';
import { Money } from '../../../components/desk';
import { EmptyState } from '../../../components/empty-state';
import { LiveSwitch } from '../../../components/live-switch';
import { TableSkeleton } from '../../../components/loading';
import { PriceField } from '../../../components/price-field';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { api, type UserPackageRow } from '../../../lib/api';
import { parseShekel } from '../../../lib/money';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { useLoad } from '../../../lib/use-load';

type Bulk = { hidden: boolean; codes: string[] } | null;

/**
 * Every package on sale, grouped by company, as `login` sees and pays for it. Saves happen on
 * the switch and on blur or Enter in a price field; the page shows errors through `setError`.
 */
export function UserPackagesTab({
  login,
  canEdit,
  setError,
  setNote,
}: {
  login: string;
  canEdit: boolean;
  setError: (text: string) => void;
  setNote: (text: string) => void;
}) {
  const { t, apiText } = usePrefs();
  const [needle, setNeedle] = useState('');
  const [company, setCompany] = useState('');
  const [bulk, setBulk] = useState<Bulk>(null);
  const sheet = useLoad(() => api.userPackages(login), [login]);
  const { run, busy } = useAction({ setError, setNote, onDone: sheet.reload });

  const companies = (sheet.data?.companies ?? [])
    .filter((group) => !company || group.code === company)
    .map((group) => ({
      ...group,
      packages: group.packages.filter((row) => !needle || row.name.includes(needle) || row.code.includes(needle)),
    }))
    .filter((group) => group.packages.length > 0);
  const listed = companies.flatMap((group) => group.packages).filter((row) => !row.hiddenAbove);
  const summary = sheet.data?.summary;

  function save(row: UserPackageRow, body: { hidden?: boolean; price?: number | null; renewalPrice?: number | null }) {
    return run(() => api.setUserPackage(login, row.code, body), { note: t.saved });
  }

  function savePrice(row: UserPackageRow, field: 'price' | 'renewalPrice', text: string) {
    if (text === '') {
      void save(row, { [field]: null });
      return;
    }
    const value = parseShekel(text);
    if (value === null) {
      setError(apiText('بيانات غير صالحة'));
      return;
    }
    void save(row, { [field]: value });
  }

  async function runBulk() {
    if (!bulk) return;
    await run(() => api.setUserPackagesBulk(login, bulk.codes, bulk.hidden), { note: t.saved, then: () => setBulk(null) });
  }

  function groupState(rows: UserPackageRow[]): boolean | 'mixed' {
    const open = rows.filter((row) => !row.hiddenAbove);
    if (open.length === 0) return false;
    const shown = open.filter((row) => !row.hidden).length;
    return shown === 0 ? false : shown === open.length ? true : 'mixed';
  }

  return (
    <>
      <div className="filter-bar terms-filter">
      <div className="filter-panel">
        <label>
          {t.packageName}
          <input value={needle} onChange={(event) => setNeedle(event.target.value)} />
        </label>
        <label>
          {t.company}
          <Select value={company} onChange={(event) => setCompany(event.target.value)}>
            <option value="">{t.allRows}</option>
            {(sheet.data?.companies ?? []).map((group) => (
              <option key={group.code} value={group.code}>{group.name}</option>
            ))}
          </Select>
        </label>
        {summary ? (
          <span className="hint terms-summary">
            {t.termsSummary
              .replace('{total}', String(summary.total))
              .replace('{visible}', String(summary.visible))
              .replace('{custom}', String(summary.custom))}
          </span>
        ) : null}
        {canEdit ? (
          <>
            <Button type="button" variant="secondary" size="sm" disabled={busy || listed.length === 0} onClick={() => setBulk({ hidden: false, codes: listed.map((row) => row.code) })}>
              {t.enableAll}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={busy || listed.length === 0} onClick={() => setBulk({ hidden: true, codes: listed.map((row) => row.code) })}>
              {t.disableAll}
            </Button>
          </>
        ) : null}
        <Button type="button" variant="secondary" size="sm" className="filter-clear" onClick={() => { setNeedle(''); setCompany(''); }}>
          {t.clearFilters}
        </Button>
      </div>
      </div>
      <section className="pane">
        {!sheet.loaded ? (
          <TableSkeleton rows={5} columns={4} />
        ) : companies.length === 0 ? (
          <EmptyState icon="plans">{t.noPackagesForUser}</EmptyState>
        ) : (
          <div className="sheet terms-sheet">
            {companies.map((group) => {
              const state = groupState(group.packages);
              const open = group.packages.filter((row) => !row.hiddenAbove);
              return (
                <section key={group.code} className="terms-group">
                  <header className="terms-group-head">
                    <h3>{group.name}</h3>
                    <span className="hint">{t.termsSummary
                      .replace('{total}', String(group.packages.length))
                      .replace('{visible}', String(group.packages.filter((row) => !row.hidden && !row.hiddenAbove).length))
                      .replace('{custom}', String(group.packages.filter((row) => row.price !== null || row.renewalPrice !== null).length))}
                    </span>
                    <LiveSwitch
                      label={`${group.name}: ${t.allRows}`}
                      checked={state}
                      disabled={!canEdit || busy || open.length === 0}
                      onChange={(next) => void run(() => api.setUserPackagesBulk(login, open.map((row) => row.code), !next), { note: t.saved })}
                    />
                  </header>
                  {group.packages.map((row) => (
                    <TermsRow
                      key={row.code}
                      row={row}
                      canEdit={canEdit}
                      busy={busy}
                      onToggle={(next) => void save(row, { hidden: !next })}
                      onPrice={(field, text) => savePrice(row, field, text)}
                      onReset={() => void save(row, { price: null, renewalPrice: null })}
                    />
                  ))}
                </section>
              );
            })}
          </div>
        )}
      </section>
      <Dialog
        open={bulk !== null}
        size="confirm"
        title={bulk?.hidden ? t.disableAll : t.enableAll}
        closeLabel={t.cancel}
        onClose={() => setBulk(null)}
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={() => setBulk(null)}>{t.cancel}</Button>
            <Button type="button" disabled={busy} onClick={() => void runBulk()}>{t.confirm}</Button>
          </>
        )}
      >
        <p className="hint">
          {t.termsSummary
            .replace('{total}', String(bulk?.codes.length ?? 0))
            .replace('{visible}', String(listed.filter((row) => !row.hidden).length))
            .replace('{custom}', String(listed.filter((row) => row.price !== null || row.renewalPrice !== null).length))}
        </p>
      </Dialog>
    </>
  );
}

function TermsRow({
  row,
  canEdit,
  busy,
  onToggle,
  onPrice,
  onReset,
}: {
  row: UserPackageRow;
  canEdit: boolean;
  busy: boolean;
  onToggle: (shown: boolean) => void;
  onPrice: (field: 'price' | 'renewalPrice', text: string) => void;
  onReset: () => void;
}) {
  const { t } = usePrefs();
  const locked = row.hiddenAbove !== null;
  const margin = row.effective - row.parentBuy;
  const size = row.dataGb === null ? '' : `${row.dataGb} GB`;
  const stateClass = locked ? 'terms-row locked' : row.hidden ? 'terms-row off' : 'terms-row';
  return (
    <div className={stateClass} data-code={row.code}>
      <LiveSwitch
        label={row.name}
        checked={!row.hidden && !locked}
        disabled={!canEdit || busy || locked}
        title={locked ? t.hiddenBy.replace('{login}', row.hiddenAbove ?? '') : undefined}
        onChange={onToggle}
      />
      <div className="terms-name">
        <strong>{row.name}</strong>
        {size ? <bdi dir="ltr" className="hint num">{size}</bdi> : null}
      </div>
      <div className="terms-figures">
        <div className="terms-figure">
          <span>{t.yourBuy}</span>
          <Money value={row.parentBuy} />
        </div>
        <div className="terms-figure his">
          <span>{t.hisPrice}</span>
          <span className="terms-fields">
            <PriceField
              label={`${row.name} ${t.subscriptionShort}`}
              hint={t.subscriptionShort}
              value={row.price}
              placeholder={row.effective}
              disabled={!canEdit || busy || locked}
              onSave={(text) => onPrice('price', text)}
            />
            <PriceField
              label={`${row.name} ${t.renewalShort}`}
              hint={t.renewalShort}
              value={row.renewalPrice}
              placeholder={row.renewalEffective}
              disabled={!canEdit || busy || locked}
              onSave={(text) => onPrice('renewalPrice', text)}
            />
          </span>
        </div>
        <div className="terms-figure">
          <span>{t.margin}</span>
          <Money value={margin} />
        </div>
      </div>
      <div className="terms-state">
        {row.source === 'custom' && canEdit && !locked ? (
          <button type="button" className="link-btn hint" disabled={busy} onClick={onReset}>
            {t.resetDefault}
          </button>
        ) : null}
        {locked ? (
          <span className="badge cancelled"><Lock aria-hidden="true" />{t.stoppedAbove}</span>
        ) : row.source === 'custom' ? (
          <span className="badge">{t.customPrice}</span>
        ) : (
          <span className="badge neutral">{t.inherited}</span>
        )}
      </div>
    </div>
  );
}
