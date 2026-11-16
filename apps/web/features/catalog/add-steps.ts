
/*
 * The look of the «إضافة شركة» and «إضافة رزمة» steps (Tailwind migration T4.3, shared since T4.4; ADR 0022), ported
 * from graphite.css and pane.css. Both screens draw the same steps, so the classes live here once.
 * - a step is a pane; a step after a step sits 12px lower (`stepAfterClass`); its heading's number and words 10px
 *   apart (`stepTitleClass`, on the pane head's `h2`);
 * - the number (`stepNoClass`): a 24px round tag on `--rd-accent-soft`, 12px bold `--rd-accent` (800 until T6.3, ADR 0021 D7);
 * - the provider query (`queryRowClass`, `queryLabelClass`, `queryButtonClass`): one wrapping row 10px apart at the
 *   foot of its fields; the field's label a pane label (grid 4px apart, 11px `--rd-muted`) in bold, at least 18rem (or
 *   the row) wide; under 768px the label takes the row and the button the rest of the next, 44px high;
 * - the offers (`pickGridClass`): as many 200px-or-wider cards as fit, 10px apart; each card is a `RadioCard`
 *   (components/ui/radio-card.tsx, Tailwind migration T6.3: the look these cards had, with the system's disabled and
 *   focus marks and the radio group's arrow keys), its name 13px (`pickNameClass`); `data-slot="pick-card"` is a
 *   card's handle;
 * - the actions (`addActionsClass`): at the end, 8px apart, 12px under the step; under 768px each takes an equal
 *   share, 44px high.
 */
export const stepAfterClass = 'mt-3';
export const stepTitleClass = 'gap-2.5';
export const stepNoClass = 'inline-grid size-6 place-items-center rounded-pill bg-accent-soft text-sm font-bold text-accent';
export const queryRowClass = 'pane-body flex flex-wrap items-end gap-2.5';
export const queryLabelClass = 'min-w-[min(100%,18rem)] font-bold max-md:flex-[1_1_100%]';
export const queryButtonClass = 'max-md:min-h-11 max-md:flex-1';
export const pickGridClass = 'grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5';
export const pickNameClass = 'text-md';
export const addActionsClass = 'mt-3 flex justify-end gap-2 max-md:*:min-h-11 max-md:*:flex-1';
