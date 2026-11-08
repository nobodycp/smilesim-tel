'use client';

import type { ReactNode } from 'react';

/**
 * The `.live-switch` control: a `role="switch"` button with a sliding knob, saved on change: green when on, red
 * when off. Children render before the button (a visible label and state text).
 */
export function LiveSwitch({
  label,
  checked,
  disabled = false,
  title,
  onChange,
  children,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onChange: (next: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <span className="live-switch">
      {children}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        title={title}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="track"><span /></span>
      </button>
    </span>
  );
}
