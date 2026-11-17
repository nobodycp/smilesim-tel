'use client';

import { ChevronDown, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { TableSheet } from '../../../components/ui/table';
import { Dialog } from '../../../components/dialog';
import { Money, Pane } from '../../../components/desk';
import { EmptyState } from '../../../components/empty-state';
import { LinePricesDialog } from '../../../components/line-prices-dialog';
import { LiveSwitch } from '../../../components/live-switch';
import { TableSkeleton } from '../../../components/loading';
import { RowMenu, type RowAction } from '../../../components/row-menu';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { NameField } from '../../../components/name-field';
import { api, type UserPackageRow } from '../../../lib/api';
import { markColor, markOf } from '../../../lib/company-mark';
import { formatShekel, parseShekel, shekelField } from '../../../lib/money';
import { useDesk } from '../../../lib/desk-session';
import { usePrefs } from '../../../lib/prefs';
import { sharedKeys } from '../../../lib/query';
import { termsTone } from '../../../lib/status-tone';
import { useAction } from '../../../lib/use-action';
import { useApiQuery } from '../../../lib/use-api-query';
import { cn } from '../../../lib/cn';

type Group = { code: string; name: string; packages: UserPackageRow[] };

/*
 * The look (Tailwind migration T4.2, ADR 0022), ported from desk/users.css (user terms), desk/filters.css and
 * graphite.css in their cascade order.
 * The filter card (the legacy hand-written `.filter-bar` / `.filter-panel`): the bar is FilterBar's — a row 6px apart
 * (8px on a phone), 12px / 16px padding, 6px corners, the surface fill and a 1px inset `--rd-line` ring, its bottom
 * corners square over the pane under it; the panel one wrapping row 8px apart with nothing of its own, hidden on a
 * phone (under 768px: this card has no «كل الفلاتر» drawer). Each field grows from 9rem and its control fills the chip;
 * the summary takes its own width on one line (its own line, wrapping, under 1100px); the clear sits at the row's end
 * and shows once a field holds a value. The chips themselves are still the legacy rules that read
 * `[data-slot='filter-panel'] > label`, as on every FilterBar.
 */
const FILTER_BAR = cn(
  'relative flex flex-nowrap items-center gap-1.5 rounded-sm border-0 bg-surface px-4 py-3 inset-ring inset-ring-line max-md:gap-2',
  'has-[+section]:rounded-es-none has-[+section]:rounded-ee-none',
);
const FILTER_PANEL = 'flex w-full flex-wrap items-center gap-2 overflow-visible border-0 bg-transparent p-0 max-md:hidden';
const FILTER_FIELD = 'flex-[1_1_9rem] [&>*:last-child]:min-w-0 [&>*:last-child]:flex-1';
const FILTER_CLEAR = cn(
  'ms-auto px-2 text-xs text-accent hover:text-accent',
  "[[data-slot=filter-panel]:not(:has(>label_:is([data-slot=chip-clear],input:not([type=checkbox]):not([value=''])),>label_input[type=checkbox]:checked))_&]:hidden",
);

/*
 * The sheet: one column of company sections, each at its own height, ruled off from the one before (1px `--rd-line`).
 * A section's head is a sticky full-width button (`--rd-z-raised`) at least 58px high, 4px / 18px padding, on
 * `--rd-surface-2` in ink at the reading start, its parts 12px apart: the company's 32px cut-corner mark (4px corners,
 * a 13px bold `--rd-on-mark` letter on the company colour, the cut 7px at the top inline end), the name (14px extra
 * bold) over its summary (12px `--rd-muted`, 1px apart), and the 16px `--rd-muted` chevron at the end, turned over
 * (180ms) while the section is open; an open head draws a 1px `--rd-line-soft` rule under it.
 * The rows scroll sideways inside their own positioned box (so the readers-only header labels never widen the page). A
 * stopped or locked package reads `--rd-muted` (its cells but the actions at 70%, the switch's own cell excepted), its
 * name struck through in `--rd-line`; a badge's glyph is 12px.
 */
// Whole class names only: Tailwind reads them from the source as written.
const TERMS_ROWS = cn(
  'relative overflow-x-auto [&_[data-slot=badge]_svg]:size-3',
  '[&_tr:has(button[role=switch][aria-checked=false])_td:not([data-actions])]:text-muted',
  '[&_tr:has([role=switch][aria-checked=false])_td:not([data-actions]):not(:has([role=switch]))]:opacity-70',
);
const OFF_NAME = cn(
  '[tr:has(button[role=switch][aria-checked=false])_&]:text-muted [tr:has(button[role=switch][aria-checked=false])_&]:line-through',
  '[tr:has(button[role=switch][aria-checked=false])_&]:decoration-line',
);
const GROUP_HEAD = cn(
  'group sticky top-0 z-raised flex min-h-14.5 w-full cursor-pointer items-center gap-3 border-0 bg-surface-2 px-4.5 py-1 text-start text-ink',
  'aria-expanded:border-b aria-expanded:border-line-soft',
);
const CO_MARK = cn(
  'grid size-8 flex-none place-items-center rounded-xs object-cover text-md font-bold text-on-mark',
  '[clip-path:polygon(0_0,calc(100%_-_7px)_0,100%_7px,100%_100%,0_100%)] rtl:[clip-path:polygon(7px_0,100%_0,100%_100%,0_100%,0_7px)]',
);

/**
 * Every package on sale, grouped by company, as `login` sees and pays for it (spec 2026-11-08-user-packages-tab-redesign).
 * Each company folds; each package is one line with its switch, buy and sell prices, margin and what is special about
 * it. The price is changed from the row menu, in a dialog. The page shows errors through `setError`.
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
  // The package's own page (durations, special prices, the excluded accounts) is the branch's; the row leads there.
  const router = useRouter();
  const { me } = useDesk();
  const opensPackage = me?.layer === 'branch';
  const [needle, setNeedle] = useState('');
  const [company, setCompany] = useState('');
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<UserPackageRow | null>(null);
  const [pricing, setPricing] = useState<UserPackageRow | null>(null);
  const sheet = useApiQuery(sharedKeys.accountPackages(login), () => api.userPackages(login));
  const { run, busy } = useAction({ setError, setNote, onDone: sheet.reload });

  const needleText = needle.trim();
  const companies: Group[] = (sheet.data?.companies ?? [])
    .filter((group) => !company || group.code === company)
    .map((group) => ({
      ...group,
      packages: group.packages.filter((row) => !needleText || row.name.includes(needleText) || row.code.includes(needleText)),
    }))
    .filter((group) => group.packages.length > 0);
  const summary = sheet.data?.summary;
  // A search or a chosen company opens what it found; otherwise a company opens when its header is pressed.
  const isOpen = (code: string) => Boolean(needleText) || company === code || unfolded.has(code);

  function toggleGroup(code: string) {
    setUnfolded((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function save(row: UserPackageRow, body: { hidden?: boolean; price?: number | null; renewalPrice?: number | null }, then?: () => void) {
    return run(() => api.setUserPackage(login, row.code, body), { note: t.saved, then });
  }

  const summaryOf = (rows: UserPackageRow[]) => t.termsSummary
    .replace('{total}', String(rows.length))
    .replace('{visible}', String(rows.filter((row) => !row.hidden && !row.hiddenAbove).length))
    .replace('{custom}', String(rows.filter((row) => row.source === 'custom').length));

  const columns: Column<UserPackageRow>[] = [
    {
      key: 'package',
      header: t.packageName,
      render: (row) => (
        // The name over its data, 1px apart, on one line each: 14px ink bold (struck through while stopped) over 11.5px
        // `--rd-muted` 500 tabular figures.
        <span className="grid items-baseline gap-px whitespace-nowrap">
          <strong
            className={cn('text-base font-bold text-ink', OFF_NAME)}
          >
            {row.name}
          </strong>
          {row.dataGb === null ? null : <bdi dir="ltr" className="m-0 text-caption font-medium text-muted tabular-nums">{row.dataGb} GB</bdi>}
        </span>
      ),
    },
    { key: 'buy', header: t.buyPair, num: true, render: (row) => <PricePair first={row.parentBuy} second={row.parentRenewalBuy} /> },
    { key: 'sell', header: t.sellPair, num: true, render: (row) => <PricePair first={row.effective} second={row.renewalEffective} strong={row.source === 'custom'} /> },
    { key: 'margin', header: t.margin, num: true, render: (row) => <Money value={row.effective - row.parentBuy} signed /> },
    {
      key: 'state',
      header: t.status,
      render: (row) => {
        const locked = row.hiddenAbove !== null;
        const custom = row.source === 'custom';
        if (!locked && !row.hidden && !custom) return null;
        return (
          <Badge variant={termsTone({ locked, hidden: row.hidden, custom })} dot>
            {locked ? <><Lock aria-hidden="true" />{t.stoppedAbove}</> : row.hidden ? t.stopped : t.customPrice}
          </Badge>
        );
      },
    },
    {
      key: 'switch',
      header: <span className="sr-only">{t.status}</span>,
      fit: true,
      render: (row) => {
        const locked = row.hiddenAbove !== null;
        return (
          <LiveSwitch
            label={row.name}
            checked={!row.hidden && !locked}
            disabled={!canEdit || busy || locked}
            title={locked ? t.hiddenBy.replace('{login}', row.hiddenAbove ?? '') : undefined}
            onChange={(next) => void save(row, { hidden: !next })}
          />
        );
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t.rowActions}</span>,
      actions: true,
      render: (row) => {
        const locked = row.hiddenAbove !== null;
        const items: RowAction[] = [
          ...(canEdit && !locked ? [{ label: t.editPrice, icon: 'edit' as const, onClick: () => setEditing(row) }] : []),
          ...(canEdit && !locked && row.source === 'custom'
            ? [{ label: t.resetDefault, icon: 'undo' as const, onClick: () => void save(row, { price: null, renewalPrice: null }) }]
            : []),
          // Numbers that already renewed under another price change only here, never by writing a price above.
          ...(canEdit && row.lines > 0 ? [{ label: t.linePricesMenu, icon: 'receipt' as const, onClick: () => setPricing(row) }] : []),
          ...(opensPackage && row.companyCode
            ? [{ label: t.openPackagePage, icon: 'enter' as const, onClick: () => router.push(`/companies/${encodeURIComponent(row.companyCode)}/packages/${encodeURIComponent(row.code)}`) }]
            : []),
        ];
        return <RowMenu label={`${t.rowActions} ${row.name}`} items={items} />;
      },
    },
  ];

  return (
    <>
      {/* A filter card of its own (no drawer); the slots let the chip rules, which read FilterBar's `data-slot`s, reach
          its fields, and tuck the pane under it. */}
      <div className={FILTER_BAR} data-slot="filter-bar">
        <div className={FILTER_PANEL} data-slot="filter-panel">
          <label className={FILTER_FIELD}>
            {t.packageName}
            <input value={needle} onChange={(event) => setNeedle(event.target.value)} />
          </label>
          <label className={FILTER_FIELD}>
            {t.company}
            <NameField value={company} allLabel={t.allRows} onChange={setCompany} options={(sheet.data?.companies ?? []).map((group) => ({ value: group.code, label: group.name, keys: [group.code] }))} />
          </label>
          {summary ? (
            <span className="flex-[1_0_auto] whitespace-nowrap max-xl:basis-full max-xl:whitespace-normal">
              {t.termsSummary
                .replace('{total}', String(summary.total))
                .replace('{visible}', String(summary.visible))
                .replace('{custom}', String(summary.custom))}
            </span>
          ) : null}
          <Button type="button" variant="secondary" size="sm" className={FILTER_CLEAR} onClick={() => { setNeedle(''); setCompany(''); }}>
            {t.clearFilters}
          </Button>
        </div>
      </div>
      <Pane>
        {!sheet.loaded ? (
          <TableSkeleton rows={5} columns={4} />
        ) : sheet.error ? (
          <EmptyState icon="plans">{sheet.error}</EmptyState>
        ) : companies.length === 0 ? (
          <EmptyState icon="plans">{t.noPackagesForUser}</EmptyState>
        ) : (
          <TableSheet className="grid grid-cols-1 content-start">
            {companies.map((group) => {
              const open = isOpen(group.code);
              const body = `terms-${group.code}`;
              return (
                <section key={group.code} className="min-w-0 border-line not-first:border-t">
                  <button type="button" className={GROUP_HEAD} aria-expanded={open} aria-controls={body} onClick={() => toggleGroup(group.code)}>
                    <span className={CO_MARK} style={{ background: markColor(group.name) }} aria-hidden="true">{markOf(group.name)}</span>
                    <span className="grid gap-px text-start">
                      <strong className="text-base font-bold">{group.name}</strong>
                      <span className="min-w-0 flex-1 text-sm text-muted">{summaryOf(group.packages)}</span>
                    </span>
                    <ChevronDown
                      className="ms-auto size-4 flex-none text-muted transition-transform duration-base ease-standard group-aria-expanded:rotate-180"
                      aria-hidden="true"
                    />
                  </button>
                  {open ? (
                    <div id={body} className={TERMS_ROWS} data-testid="terms-rows">
                      <DataTable
                        bare
                        sortable={false}
                        columns={columns}
                        rows={group.packages}
                        rowKey={(row) => row.code}
                        cellClassName="h-14 py-1.5"
                        headClassName="static"
                      />
                    </div>
                  ) : null}
                </section>
              );
            })}
          </TableSheet>
        )}
      </Pane>
      {editing ? (
        <PriceDialog
          row={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(price, renewalPrice) => void save(editing, { price, renewalPrice }, () => setEditing(null))}
          onInvalid={() => setError(apiText('بيانات غير صالحة'))}
        />
      ) : null}
      <LinePricesDialog
        open={pricing !== null}
        code={pricing?.code ?? ''}
        packageName={pricing?.name ?? ''}
        scope={login}
        onClose={() => setPricing(null)}
        onSaved={(lines) => {
          setNote(t.linePricesSaved.replace('{n}', String(lines)));
          void sheet.reload();
        }}
      />
    </>
  );
}

function PricePair({ first, second, strong = false }: { first: number; second: number; strong?: boolean }) {
  return (
    // The pair follows the reading direction, like its header «اشتراك / تجديد»; each amount stays left to right. One
    // line 6px apart on a shared baseline, bold tabular figures, the slash `--rd-faint`; a custom price extra bold in
    // `--rd-success`.
    <span className={cn('inline-flex items-baseline gap-1.5 whitespace-nowrap tabular-nums', strong && 'font-bold text-success')} data-slot="terms-pair">
      <span className="font-bold tabular-nums" dir="ltr">{formatShekel(first)}</span>
      <span className="text-faint" aria-hidden="true">/</span>
      <span className="font-bold tabular-nums" dir="ltr">{formatShekel(second)}</span>
    </span>
  );
}

const PRICE_LINE = cn(
  'm-0 flex items-baseline justify-between gap-3 text-sm text-muted',
  '[&_[data-slot=terms-pair]]:font-bold [&_[data-slot=terms-pair]]:text-ink [&_[data-slot=money]]:font-bold [&_[data-slot=money]]:text-ink',
);

/** «تعديل السعر»: the sell prices of one package for this account. An empty field goes back to the default price. */
function PriceDialog({
  row,
  busy,
  onClose,
  onSave,
  onInvalid,
}: {
  row: UserPackageRow;
  busy: boolean;
  onClose: () => void;
  onSave: (price: number | null, renewalPrice: number | null) => void;
  onInvalid: () => void;
}) {
  const { t } = usePrefs();
  const shown = (value: number | null) => (value === null ? '' : shekelField(value));
  const [price, setPrice] = useState(shown(row.price));
  const [renewal, setRenewal] = useState(shown(row.renewalPrice));
  const read = (text: string) => (text.trim() === '' ? null : parseShekel(text));
  const priceValue = read(price);
  const renewalValue = read(renewal);
  const margin = (priceValue ?? (row.price === null ? row.effective : null)) ?? null;

  function submit() {
    if ((price.trim() !== '' && priceValue === null) || (renewal.trim() !== '' && renewalValue === null)) {
      onInvalid();
      return;
    }
    onSave(priceValue, renewalValue);
  }

  return (
    <Dialog
      open
      size="form"
      title={t.editPrice}
      lede={row.name}
      mark="wallet"
      closeLabel={t.cancel}
      onClose={onClose}
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t.cancel}</Button>
          <Button type="button" disabled={busy} onClick={submit}>{t.save}</Button>
        </>
      )}
    >
      {/* A column 12px apart. The buy and margin lines: the name at the reading start in 12px `--rd-muted`, the figures at
          the end in ink bold, on one baseline 12px apart. The hint is a plain paragraph: no hint rule reaches it in a
          dialog. */}
      <div className="grid gap-3">
        <p className={PRICE_LINE}>
          <span>{t.buyPair}</span>
          <PricePair first={row.parentBuy} second={row.parentRenewalBuy} />
        </p>
        <Label tone="dialog">
          {t.subscriptionShort}
          <Input inputMode="decimal" dir="ltr" value={price} placeholder={shown(row.effective)} onChange={(event) => setPrice(event.target.value)} />
        </Label>
        <Label tone="dialog">
          {t.renewalShort}
          <Input inputMode="decimal" dir="ltr" value={renewal} placeholder={shown(row.renewalEffective)} onChange={(event) => setRenewal(event.target.value)} />
        </Label>
        <p>{t.priceEmptyIsDefault}</p>
        {margin !== null ? (
          <p className={PRICE_LINE}>
            <span>{t.margin}</span>
            <Money value={margin - row.parentBuy} signed />
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
