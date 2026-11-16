import { cn } from '../../lib/cn';

/*
 * The look of the «إضافة شركة» and «إضافة رزمة» steps (Tailwind migration T4.3, shared since T4.4; ADR 0022), ported
 * from graphite.css and pane.css. Both screens draw the same steps, so the classes live here once.
 * - a step is a pane; a step after a step sits 12px lower (`stepAfterClass`); its heading's number and words 10px
 *   apart (`stepTitleClass`, on the pane head's `h2`);
 * - the number (`stepNoClass`): a 24px round tag on `--rd-accent-soft`, 12px extra-bold `--rd-accent`;
 * - the provider query (`queryRowClass`, `queryLabelClass`, `queryButtonClass`): one wrapping row 10px apart at the
 *   foot of its fields; the field's label a pane label (grid 4px apart, 11px `--rd-muted`) in bold, at least 18rem (or
 *   the row) wide; under 768px the label takes the row and the button the rest of the next, 44px high;
 * - the offers (`pickGridClass`, `pickCardClass`): as many 200px-or-wider cards as fit, 10px apart; a card is a grid
 *   of rows 4px apart at the start, 12px by 14px inside, a 1px `--rd-line` border with 6px corners on
 *   `--rd-surface-2`, ink; under the pointer the border is `--rd-accent` at 45%; picked (`aria-checked`), an
 *   `--rd-accent` border on `--rd-accent-soft`; already added, at 55% with a plain pointer; on keyboard focus a 2px
 *   `--rd-accent` outline 1px out. Its name 13px (`pickNameClass`), its tick 10px in from the top inline-end corner in
 *   `--rd-accent` (`pickTickClass`). `data-slot="pick-card"` is a card's handle;
 * - the actions (`addActionsClass`): at the end, 8px apart, 12px under the step; under 768px each takes an equal
 *   share, 44px high.
 */
export const stepAfterClass = 'mt-3';
export const stepTitleClass = 'gap-2.5';
export const stepNoClass = 'inline-grid size-6 place-items-center rounded-pill bg-accent-soft text-sm font-extrabold text-accent';
export const queryRowClass = 'pane-body flex flex-wrap items-end gap-2.5';
export const queryLabelClass = 'min-w-[min(100%,18rem)] font-bold max-md:flex-[1_1_100%]';
export const queryButtonClass = 'max-md:min-h-11 max-md:flex-1';
export const pickGridClass = 'grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5';
export const pickCardClass = cn(
  'relative grid cursor-pointer justify-items-start gap-1 rounded-sm border border-line bg-surface-2 px-3.5 py-3 text-start text-ink',
  // The legacy hover mixed 45% `--rd-accent` into `--rd-line` (srgb); `--rd-accent` at 45% is the token form (the
  // line is 8% ink, so the drawn border differs by about 4% of its lightness).
  'enabled:hover:border-accent/45',
  'aria-checked:border-accent aria-checked:bg-accent-soft',
  'disabled:cursor-default disabled:opacity-55',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
);
export const pickNameClass = 'text-md';
export const pickTickClass = 'absolute end-2.5 top-2.5 text-accent';
export const addActionsClass = 'mt-3 flex justify-end gap-2 max-md:*:min-h-11 max-md:*:flex-1';
