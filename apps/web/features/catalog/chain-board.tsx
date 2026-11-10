'use client';

import { Money } from '../../components/desk';
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
  const cell = (keys: readonly PriceKey[], index: number, label: string) => {
    const margin = marginOf(keys, index);
    return (
      <td>
        <span className="chain-cell">
          <input className="num" inputMode="numeric" aria-label={label} value={prices[keys[index]]} onChange={(event) => onChange(keys[index], event.target.value)} />
          {margin !== null ? <span className="step-note"><Money value={margin} signed /></span> : <span className="step-note" aria-hidden="true" />}
        </span>
      </td>
    );
  };
  return (
    <div className="pane-body price-board" aria-label={t.chainTab}>
      <div className="chain-wrap">
        <table className="chain-grid">
          <thead>
            <tr>
              <th scope="col">{t.layer}</th>
              <th scope="col">{t.subscriptionPrices}</th>
              <th scope="col">{t.renewalPrices}</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((label, index) => (
              <tr key={label} className={index === 0 ? 'chain-cost' : undefined}>
                <th scope="row">{label}</th>
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
