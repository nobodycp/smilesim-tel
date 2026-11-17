'use client';

import type { ReactNode } from 'react';
import { Tabs as TabsRoot, TabsCount, TabsList, TabsTrigger } from './ui/tabs';

export type TabItem<K extends string> = { key: K; label: ReactNode; count?: number | null; disabled?: boolean };

/**
 * The one tab strip (spec 2026-11-08-inner-pages-refresh, §2), composed from components/ui/tabs.tsx on Radix Tabs.
 * A tab may carry a `count`. Keys follow WAI-ARIA tabs: ArrowLeft/Right (mirrored in RTL),
 * Home, End move and select; only the selected tab is in the Tab order. The screens draw the content under the strip
 * themselves (no Radix tab panel), so a tab names no panel (`aria-controls` is left off). `onChange` runs for another
 * tab; a press on the selected tab changes nothing.
 */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (next: K) => void;
  label?: string;
  /** Layout utilities for the strip in one spot (the overview card's head). */
  className?: string;
}) {
  return (
    <TabsRoot value={value} onValueChange={(next) => onChange(next as K)}>
      <TabsList aria-label={label} className={className}>
        {items.map((item) => (
          <TabsTrigger key={item.key} value={item.key} data-tab={item.key} disabled={item.disabled} aria-controls={undefined}>
            {item.label}
            {item.count ? <TabsCount data-testid="tab-count">{item.count}</TabsCount> : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </TabsRoot>
  );
}
