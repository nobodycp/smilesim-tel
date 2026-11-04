'use client';

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

type RowIcon = 'edit' | 'extend' | 'undo' | 'check' | 'ban' | 'trash' | 'enter' | 'key' | 'fund' | 'move' | 'image';

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
    undo: <path d="M8 8H4v4M4.6 8.4A7.5 7.5 0 1 1 6.2 17" />,
    check: <path d="M5 12.5 9.5 17 19 7" />,
    ban: <><circle cx="12" cy="12" r="7" /><path d="M7 17 17 7" /></>,
    trash: <><path d="M5 7h14" /><path d="M9 7V5h6v2" /><path d="M7 7l1 12h8l1-12" /></>,
    enter: <><path d="M14 5.5h4.5V18.5H14" /><path d="M10 8.5 6 12l4 3.5M6.5 12H15" /></>,
    key: <><circle cx="8" cy="14" r="3" /><path d="M11 14h8.5M16.5 14v2.5M19 14v2" /></>,
    fund: <><path d="M12 4v16" /><path d="M16.5 7.5c0-1.4-1.8-2.5-4.5-2.5S7.5 6.1 7.5 7.5 9.3 10 12 10s4.5 1.1 4.5 2.5S14.7 15 12 15s-4.5-1.1-4.5-2.5" /></>,
    move: <path d="M5 12h14M13 6l6 6-6 6" />,
    image: <><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.4" /><path d="M4 16.5 8.5 12l3 3 2.5-2.5L20 16.5" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function RowMenu({ label, items }: { label: string; items: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !button.current) return;
    const place = () => {
      const rect = button.current?.getBoundingClientRect();
      if (!rect) return;
      const width = panel.current?.offsetWidth || 160;
      const height = panel.current?.offsetHeight || 40;
      const rtl = document.documentElement.dir === 'rtl';
      // Pin the menu to the trigger's inline end so it opens into the table.
      let left = rtl ? rect.left : rect.right - width;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width);
      if (left < 8) left = 8;
      let top = rect.bottom + 4;
      if (top + height > window.innerHeight - 8 && rect.top > height + 4) top = rect.top - height - 4;
      if (top < 8) top = 8;
      setBox({ top, left });
    };
    place();
    const frame = requestAnimationFrame(place);
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (root.current?.contains(target) || panel.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
        return;
      }
      const list = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
      const inMenu = panel.current?.contains(document.activeElement) || document.activeElement === button.current;
      if (!inMenu || list.length === 0) return;
      const index = list.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        list[(index + 1) % list.length]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        list[(index - 1 + list.length) % list.length]?.focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        list[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        list[list.length - 1]?.focus();
      }
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    panel.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (items.length === 0) return null;
  const firstDanger = items.findIndex((item) => item.danger);
  return (
    <div className="row-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="row-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={panel}
          className="row-menu-panel"
          role="menu"
          style={{ top: box?.top ?? -9999, left: box?.left ?? 8, visibility: box ? 'visible' : 'hidden' }}
        >
          {items.map((item, index) => (
            <Fragment key={item.label}>
              {index === firstDanger && firstDanger > 0 ? <span className="row-menu-rule" role="separator" /> : null}
              <button
                type="button"
                role="menuitem"
                className={item.danger ? 'danger' : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.icon ? <Glyph name={item.icon} /> : null}
                {item.label}
              </button>
            </Fragment>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
