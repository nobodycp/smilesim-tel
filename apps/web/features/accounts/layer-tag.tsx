'use client';

import { layerName } from '../../components/desk';
import { cn } from '../../lib/cn';
import { usePrefs } from '../../lib/prefs';

/*
 * An account's layer as an outlined tag in the layer's own hue (Tailwind migration T4.2, ADR 0022), ported from
 * graphite.css `.layer-tag` / `.layer-tag.l-*`: 22px high, 8px sides, 4px corners, 11.5px bold on one line, a 1px inset
 * line in its own colour. A layer without a hue (staff) takes the text colour around it, as `.l-staff` did.
 * `data-slot="layer-tag"` is its handle. The audit and report screens still draw the legacy class until their slices.
 */
const HUE: Record<string, string> = {
  branch: 'text-layer-branch',
  main_agent: 'text-layer-main',
  agent: 'text-layer-agent',
  pos: 'text-layer-pos',
};

export function LayerTag({ layer }: { layer: string }) {
  const { t } = usePrefs();
  return (
    <span
      data-slot="layer-tag"
      className={cn('inline-flex h-5.5 items-center rounded-xs px-2 text-[11.5px] font-bold whitespace-nowrap inset-ring inset-ring-current', HUE[layer])}
    >
      {layerName(t, layer)}
    </span>
  );
}
