'use client';

import { Fragment, useRef, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '../lib/cn';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';

type RowIcon = 'edit' | 'extend' | 'undo' | 'check' | 'ban' | 'trash' | 'enter' | 'key' | 'fund' | 'move' | 'image' | 'refresh' | 'receipt';

export type RowAction = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  icon?: RowIcon;
};

function Glyph({ name }: { name: RowIcon }) {
  const paths: Record<RowIcon, ReactNode> = {
    edit: <path d="M4 16.5V20h3.5L18 9.5 14.5 6 4 16.5z" />,
    extend: <path d="M12 5v14M5 12h14" />,
    refresh: <><path d="M19 12a7 7 0 1 1-2-4.9" /><path d="M19 4.5V8h-3.5" /></>,
    undo: <path d="M8 8H4v4M4.6 8.4A7.5 7.5 0 1 1 6.2 17" />,
    check: <path d="M5 12.5 9.5 17 19 7" />,
    ban: <><circle cx="12" cy="12" r="7" /><path d="M7 17 17 7" /></>,
    trash: <><path d="M5 7h14" /><path d="M9 7V5h6v2" /><path d="M7 7l1 12h8l1-12" /></>,
    enter: <><path d="M14 5.5h4.5V18.5H14" /><path d="M10 8.5 6 12l4 3.5M6.5 12H15" /></>,
    key: <><circle cx="8" cy="14" r="3" /><path d="M11 14h8.5M16.5 14v2.5M19 14v2" /></>,
    fund: <><path d="M12 4v16" /><path d="M16.5 7.5c0-1.4-1.8-2.5-4.5-2.5S7.5 6.1 7.5 7.5 9.3 10 12 10s4.5 1.1 4.5 2.5S14.7 15 12 15s-4.5-1.1-4.5-2.5" /></>,
    move: <path d="M5 12h14M13 6l6 6-6 6" />,
    image: <><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.4" /><path d="M4 16.5 8.5 12l3 3 2.5-2.5L20 16.5" /></>,
    receipt: <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /><path d="M12 17.5v-11" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/*
 * The row's actions behind ⋯ (or a labelled trigger), on DropdownMenu (components/ui/dropdown-menu.tsx; Radix since
 * Tailwind migration T2.4). It opens from the trigger's inline end, into the table, on its first item; a destructive
 * action comes after a rule. The trigger and the items keep a press inside them from reaching the row (a row can be a
 * link). The ⋯ trigger (legacy `.row-menu-btn`, dialog.css and graphite.css): 28px, no border or fill, 6px corners,
 * `--rd-faint`, weight 400; `--rd-surface-3` and ink under the pointer and while open. `boxed` (a page head, beside
 * other buttons): 34px, the soft track (`--rd-surface-2`, an inset 1px ink line at 11%) in ink, `--rd-surface-3` under
 * the pointer.
 */
const triggerClass = (boxed: boolean) =>
  cn(
    'inline-flex items-center justify-center rounded-sm border-0 p-0 font-normal [&>svg]:size-4',
    boxed
      ? 'size-8.5 bg-surface-2 text-ink inset-ring inset-ring-line-strong hover:bg-surface-3'
      : 'size-7 bg-transparent text-faint hover:bg-surface-3 hover:text-ink aria-expanded:bg-surface-3 aria-expanded:text-ink',
  );

/**
 * `trigger` draws its own content in place of the ⋯ icon (the user page's «المحفظة», the users list's wallet icon);
 * `className` gives it its own look (a Button's classes), otherwise it keeps the ⋯ trigger's. `iconOnly`: the content
 * has no text, so the label names it (and is its tooltip).
 */
export function RowMenu({ label, items, boxed = false, trigger }: { label: string; items: RowAction[]; boxed?: boolean; trigger?: { className?: string; content: ReactNode; iconOnly?: boolean } }) {
  // The menu opens on its first item, from the pointer too: Radix focuses the panel itself when the pointer opened
  // it, and that first focus is handed on. Closing because an item was picked leaves the focus where the action puts
  // it (a dialog's field), as before; Escape gives it back to the trigger.
  const opening = useRef(false);
  const picked = useRef(false);

  if (items.length === 0) return null;
  const firstDanger = items.findIndex((item) => item.danger);
  return (
    <div className="relative inline-flex" data-testid="row-menu">
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          opening.current = open;
          if (open) picked.current = false;
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={trigger?.className ?? triggerClass(boxed)}
            aria-label={trigger && !trigger.iconOnly ? undefined : label}
            title={trigger?.iconOnly ? label : undefined}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            {trigger ? trigger.content : <MoreHorizontal size={16} aria-hidden="true" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align="end"
          onFocus={(event) => {
            if (!opening.current || event.target !== event.currentTarget) return;
            opening.current = false;
            event.currentTarget.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            if (picked.current) event.preventDefault();
            picked.current = false;
          }}
        >
          {items.map((item, index) => (
            <Fragment key={`${index}:${item.label}`}>
              {index === firstDanger && firstDanger > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                danger={Boolean(item.danger)}
                onClick={(event) => event.stopPropagation()}
                onSelect={() => {
                  picked.current = true;
                  item.onClick();
                }}
              >
                {item.icon ? <Glyph name={item.icon} /> : null}
                {item.label}
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
