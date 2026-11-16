/*
 * The head, title, body and hint of the home page's panes (Tailwind migration T4.1, ADR 0022), ported from the legacy
 * `.pane-head`, `.pane-head h2`, `.pane-body` and `.pane .hint` rules (desk/pane.css, then graphite.css):
 * - the head: one row, the title at the start and the tools at the end, 8px apart, at least 52px high, 14px / 18px
 *   padding, a 1px `--rd-line` rule under it;
 * - the title: an inline row 8px apart, no margin, 14px (`--rd-text-base`) bold ink;
 * - the body: a grid 12px apart whose rows start at the top, 14px / 18px / 18px padding, its children never wider than
 *   it (a wide table scrolls inside);
 * - the hint: 12px `--rd-muted`, no margin.
 * The pane card itself is `Pane` (components/desk.tsx). Other screens keep the legacy classes until they move.
 */
export const PANE_HEAD = 'flex min-h-13 items-center justify-between gap-2 border-b border-line bg-transparent px-4.5 py-3.5';
export const PANE_TITLE = 'm-0 inline-flex items-center gap-2 text-base font-bold text-ink';
export const PANE_BODY = 'grid content-start gap-3 px-4.5 pt-3.5 pb-4.5 *:min-w-0';
export const PANE_HINT = 'm-0 text-sm text-muted';
