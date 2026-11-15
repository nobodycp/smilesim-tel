'use client';

import { useState } from 'react';
import { shekelField } from '../lib/money';
import { Input } from './ui/input';

// An inline shekel field that saves on blur or Enter, only when the text changed.
// An empty value means "back to the default"; Escape drops the draft.
//
// Look (Tailwind migration T2.2), ported from desk/users.css `.terms-price` with the rules that reach it in every
// place it is used — a `.pane` on the desk (package add-ons, the package sheet's offers) or inside a dialog (the line
// prices table): the label is a column with a 4px gap (`.pane label`) in 11px semibold `--rd-muted`, the optional hint
// 10px semibold `--rd-muted`; the field is 6.5rem wide and 34px tall (`.pane input`; 44px at 720px and under), 8px
// sides, a 1px border at 70% of `--rd-field` (graphite.css over users.css), 4px corners, the `--rd-surface` fill
// (`.pane input`), 13px bold ink (`.pane input` sets the size over users.css's 14px), tabular, left to right, the
// placeholder `--rd-muted` medium, the crimson focus thread, `--rd-surface-2` and `--rd-muted` when disabled.
// `data-slot="price-field"` is the handle graphite.css's phone-card cap (`max-inline-size: 100%`) reads.
export function PriceField({
  label,
  hint,
  value,
  placeholder,
  disabled,
  onSave,
}: {
  label: string;
  hint?: string;
  value: number | null;
  placeholder: number;
  disabled?: boolean;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const saved = value === null ? '' : shekelField(value);
  const shown = draft ?? saved;
  function commit() {
    if (draft !== null && draft.trim() !== saved) onSave(draft.trim());
    setDraft(null);
  }
  return (
    <label data-slot="price-field" className="inline-flex flex-col gap-1 text-start text-xs font-semibold text-muted">
      {hint ? <span className="text-2xs font-semibold text-muted">{hint}</span> : null}
      <Input
        surface="surface"
        dir="ltr"
        className="w-26 min-w-0 rounded-xs px-2 text-md font-bold tabular-nums text-start placeholder:font-medium placeholder:text-muted disabled:bg-surface-2 disabled:text-muted"
        inputMode="decimal"
        aria-label={label}
        value={shown}
        placeholder={shekelField(placeholder)}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            setDraft(null);
          }
        }}
      />
    </label>
  );
}
