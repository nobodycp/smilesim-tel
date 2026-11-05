'use client';

import { useState } from 'react';
import { shekelField } from '../lib/money';

// An inline shekel field that saves on blur or Enter, only when the text changed.
// An empty value means "back to the default"; Escape drops the draft.
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
    <label className="terms-price">
      {hint ? <span>{hint}</span> : null}
      <input
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
