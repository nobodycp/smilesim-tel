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
 * 2026-11-09-admin-review, 3): the subscription and the renewal ladders, each layer with its margin over the one above
 * it under its price. `children` adds more cards to the board (the package page's eSIM price).
 */
export function ChainBoard({ prices, onChange, children }: {
  prices: Record<PriceKey, string>;
  onChange: (key: PriceKey, value: string) => void;
  children?: React.ReactNode;
}) {
  const { t } = usePrefs();
  const labels = [t.branchCost, t.layerMain, t.layerAgent, t.layerPos, t.subscriberPrice];
  const groups: { title: string; keys: readonly PriceKey[] }[] = [
    { title: t.subscriptionPrices, keys: SUBSCRIPTION_KEYS },
    { title: t.renewalPrices, keys: RENEWAL_KEYS },
  ];
  return (
    <div className="pane-body price-board" aria-label={t.chainTab}>
      {groups.map((group) => (
        <div className="account-fund" key={group.title}>
          <h3>{group.title}</h3>
          {group.keys.map((key, index) => {
            const here = Number(prices[key]);
            const above = index > 0 ? Number(prices[group.keys[index - 1]]) : NaN;
            const margin = Number.isFinite(here) && Number.isFinite(above) && prices[key] !== '' ? Math.round((here - above) * 100) : null;
            return (
              <div key={key} className="chain-step">
                <label>
                  {labels[index]}
                  <input className="num" inputMode="numeric" value={prices[key]} onChange={(event) => onChange(key, event.target.value)} />
                </label>
                {index > 0 && margin !== null ? <span className="step-note"><Money value={margin} signed /></span> : null}
              </div>
            );
          })}
        </div>
      ))}
      {children}
    </div>
  );
}
