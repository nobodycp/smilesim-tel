'use client';

import { Money } from '../../components/desk';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/cn';
import { usePrefs } from '../../lib/prefs';

export type PriceKey =
  | 'branchCost'
  | 'mainPrice'
  | 'agentPrice'
  | 'posPrice'
  | 'subscriberPrice'
  | 'renewalBranchCost'
  | 'renewalMainPrice'
  | 'renewalAgentPrice'
  | 'renewalPosPrice'
  | 'renewalSubscriberPrice';

export const SUBSCRIPTION_KEYS = ['branchCost', 'mainPrice', 'agentPrice', 'posPrice', 'subscriberPrice'] as const;
export const RENEWAL_KEYS = ['renewalBranchCost', 'renewalMainPrice', 'renewalAgentPrice', 'renewalPosPrice', 'renewalSubscriberPrice'] as const;

/*
 * The board's look (ADR 0022):
 * - the board: a pane body laid out as two columns (one under 721px), 16px between rows and 24px between columns, its
 *   cells at the top. The chain's table takes the whole row and scrolls sideways when it does not fit; a Button the
 *   caller puts in takes a whole row at the start. The cards the package page puts in lay themselves out
 *   (features/catalog/screens/package-sheet-screen.tsx);
 * - the table: full width up to 720px, collapsed borders; every cell 6px by 10px (6px by 4px under 641px) over a 1px
 *   `--rd-line` rule, at the reading start; the column heads 11px bold `--rd-muted`, the layer names 13px bold ink on
 *   one line; the branch's cost row on `--rd-accent-soft`;
 * - a cell: its field and the margin over the layer above side by side 10px apart (stacked 2px apart under 641px);
 *   the field a pane field (34px, 44px under 721px, on `--rd-surface`, 13px) in bold centred tabular figures; the
 *   margin at least 4.5rem wide (no minimum under 641px), 12px bold (11.5px under 641px).
 * The field sets no width of its own, so it is as wide as its own default size in the cell.
 */
const BOARD = cn(
  'pane-body grid-cols-2 items-start gap-x-6 gap-y-4 max-touch:grid-cols-1',
  '[&>[data-slot=button]]:col-span-full [&>[data-slot=button]]:justify-self-start',
);
const CELL_RULE = 'border-b border-line px-2.5 py-1.5 text-start max-sm:px-1';
const HEAD = 'text-xs font-bold text-muted';
const NOTE = 'min-w-18 text-sm font-bold max-sm:min-w-0 max-sm:text-caption';

/**
 * The price chain as shekel fields (the package page's «الأسعار», shared with «إضافة رزمة»; spec
 * 2026-11-09-admin-review, 3), compact since spec 2026-11-11-ui-consistency-pass (D6): one row per layer, from the
 * branch's cost to the subscriber, with its subscription and its renewal price side by side and each one's margin
 * over the layer above it. `children` adds cards under the table (the package page's eSIM price and re-pricing).
 */
export function ChainBoard({ prices, onChange, children }: {
  prices: Record<PriceKey, string>;
  onChange: (key: PriceKey, value: string) => void;
  children?: React.ReactNode;
}) {
  const { t } = usePrefs();
  const labels = [t.branchCost, t.layerMain, t.layerAgent, t.layerPos, t.subscriberPrice];
  const marginOf = (keys: readonly PriceKey[], index: number) => {
    if (index === 0 || prices[keys[index]] === '') return null;
    const here = Number(prices[keys[index]]);
    const above = Number(prices[keys[index - 1]]);
    return Number.isFinite(here) && Number.isFinite(above) ? Math.round((here - above) * 100) : null;
  };
  // The branch's cost row is tinted.
  const tint = (index: number) => (index === 0 ? 'bg-accent-soft' : undefined);
  const cell = (keys: readonly PriceKey[], index: number, label: string) => {
    const margin = marginOf(keys, index);
    const cost = tint(index);
    return (
      <td className={cn(CELL_RULE, cost)}>
        <span className="inline-flex items-center gap-2.5 max-sm:grid max-sm:gap-0.5">
          <Input surface="surface" className="text-center text-md font-bold tabular-nums" inputMode="numeric" aria-label={label} value={prices[keys[index]]} onChange={(event) => onChange(keys[index], event.target.value)} />
          {margin !== null ? <span className={NOTE}><Money value={margin} signed /></span> : <span className={NOTE} aria-hidden="true" />}
        </span>
      </td>
    );
  };
  return (
    <div className={BOARD} aria-label={t.chainTab} data-slot="chain-board">
      <div className="col-span-full overflow-x-auto">
        <table className="w-full max-w-180 border-collapse" data-testid="chain-grid">
          <thead>
            <tr>
              <th scope="col" className={cn(CELL_RULE, HEAD)}>{t.layer}</th>
              <th scope="col" className={cn(CELL_RULE, HEAD)}>{t.subscriptionPrices}</th>
              <th scope="col" className={cn(CELL_RULE, HEAD)}>{t.renewalPrices}</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((label, index) => (
              <tr key={label}>
                <th scope="row" className={cn(CELL_RULE, 'whitespace-nowrap text-md font-bold text-ink', tint(index))}>{label}</th>
                {cell(SUBSCRIPTION_KEYS, index, label)}
                {cell(RENEWAL_KEYS, index, `${t.renewalPrices} · ${label}`)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {children}
    </div>
  );
}
