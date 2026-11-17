import { Fragment, type ReactNode } from 'react';

/*
 * The system monitor's shared looks. A pane's head as the home panes draw it: at least 52px, a rule under it, the
 * title 15px bold ink with its icon 8px away, anything else (a state badge) at the end. A cell's sub line: a block
 * 11.5px muted (the audit log's).
 */
export const PANE_HEAD = 'flex min-h-13 items-center justify-between gap-2 border-b border-line bg-transparent px-4.5 py-3.5';
export const PANE_TITLE = 'm-0 inline-flex items-center gap-2 text-base font-bold text-ink';
export const CELL_SUB = 'block text-caption leading-1-3 font-normal text-muted';

/** A route pattern that may break after each slash on a narrow card, not inside a word. */
export function routeText(route: string): ReactNode {
  return route.split('/').map((piece, index) => (
    <Fragment key={index}>
      {index > 0 ? <>/<wbr /></> : null}
      {piece}
    </Fragment>
  ));
}
