'use client';

import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';
import type { SimRules } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { hasSimRules, simShape } from '../../lib/sim-rules';

/*
 * The SIM settings' pieces that the company page and «إضافة شركة» share (Tailwind migration T4.3, ADR 0022), ported
 * from desk/packages.css and pane.css. Both sit in a pane.
 */

/** A note in a pane (pane.css `.pane .hint`): 12px `--rd-muted`, no margin. */
export const paneHintClass = 'm-0 text-sm text-muted';

/**
 * The fields (legacy `.sim-fields`): a borderless fieldset with no margin or padding, a grid of as many 15rem-or-wider
 * columns as fit, 14px between rows and 16px between columns, each field at the top of its cell.
 */
export function SimFields({ className, ...props }: ComponentPropsWithoutRef<'fieldset'>) {
  return (
    <fieldset
      className={cn('m-0 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] items-start gap-x-4 gap-y-3.5 border-0 p-0', className)}
      {...props}
    />
  );
}

/** The eSIM switch or box with its note (legacy `.sim-toggle`): a grid 4px apart, its rows at the top. */
export const simToggleClass = 'grid content-start gap-1';

/**
 * The SIM's shape as these rules draw it (legacy `.sim-sample`): one wrapping row under a 1px `--rd-line` rule (12px
 * inside), 4px by 10px apart, the words 12px bold `--rd-ink-2`, the shape 16px ink, tracked 0.12em, tabular; without
 * rules the note that any SIM is accepted. `data-testid="sim-sample"` is its handle.
 */
export function SimSample({ rules }: { rules: SimRules }) {
  const { t } = usePrefs();
  return (
    <p
      className="m-0 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-t border-line pt-3 text-sm font-bold text-ink-2"
      data-testid="sim-sample"
    >
      <span>{t.simShape}</span>
      {hasSimRules(rules) ? (
        <bdi className="text-xl tracking-[0.12em] text-ink tabular-nums" dir="ltr">{simShape(rules)}</bdi>
      ) : (
        <span className={paneHintClass}>{t.simAny}</span>
      )}
    </p>
  );
}
