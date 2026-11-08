'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type PopoverOptions = {
  /**
   * The panel is a `role="menu"`: on open the first `[role="menuitem"]` takes the focus, and ArrowUp/ArrowDown,
   * Home and End move it between the items (the WAI-ARIA menu button pattern).
   */
  menu?: boolean;
  /** Leave the first-item focus to the caller, for a panel that is still hidden when it mounts (RowMenu). */
  deferFocus?: boolean;
};

/**
 * One open/close engine for every popup next to a button: the row menu, the topbar menus, the wallet pop and the
 * language menu. While open, a press outside `root` and `panel` closes it, and Escape closes it and gives the focus
 * back to `trigger`. `panel` is only needed when the panel is portalled out of `root` (RowMenu); otherwise the
 * panel is looked up inside `root`.
 */
export function usePopover({ menu = false, deferFocus = false }: PopoverOptions = {}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((value) => !value), []);

  useEffect(() => {
    if (!open) return;
    const items = () => [...((panel.current ?? root.current)?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const inside = (node: Node | null) => Boolean(node && (root.current?.contains(node) || panel.current?.contains(node)));
    const onPointer = (event: MouseEvent) => {
      if (!inside(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
        return;
      }
      if (!menu || !inside(document.activeElement)) return;
      const list = items();
      if (list.length === 0) return;
      const index = list.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === 'ArrowDown' ? list[(index + 1) % list.length]
        : event.key === 'ArrowUp' ? list[(index - 1 + list.length) % list.length]
        : event.key === 'Home' ? list[0]
        : event.key === 'End' ? list[list.length - 1]
        : null;
      if (!next) return;
      event.preventDefault();
      next.focus();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    if (menu && !deferFocus) items()[0]?.focus();
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, menu, deferFocus]);

  return { open, setOpen, close, toggle, root, panel, trigger };
}
