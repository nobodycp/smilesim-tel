'use client';

import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Switch } from './ui/switch';

/**
 * A saved-on-change switch with its words: the `Switch` primitive (`role="switch"`, green
 * when on, red when off) after its children (a visible label or state text), side by side 8px apart.
 * `data-slot="live-switch"` is its handle; `className` lays it out in its context (a column on an operation card) and
 * comes last (`cn`).
 */
export function LiveSwitch({
  label,
  checked,
  disabled = false,
  title,
  onChange,
  className,
  children,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onChange: (next: boolean) => void;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span data-slot="live-switch" className={cn('inline-flex items-center gap-2', className)}>
      {children}
      <Switch
        checked={checked}
        aria-label={label}
        title={title}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </span>
  );
}
