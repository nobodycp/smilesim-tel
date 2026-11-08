'use client';

import { createContext, useContext, type ReactNode } from 'react';

// One label/value primitive in three densities (DESIGN.md → Key/value):
// - `tiles` (default): label and value side by side in bordered tiles that repeat across the width; the number card,
//   dialogs.
// - `cards`: a summary card per fact, the value large, an optional icon and tone; the head of the account page.
// - `list`: a compact ruled list for a narrow rail; the task ticket.
type Variant = 'tiles' | 'cards' | 'list';
type Tone = 'good' | 'warn';

const CLASS: Record<Variant, string> = { tiles: 'detail-rows', cards: 'fact-grid', list: 'task-facts' };
const VariantOf = createContext<Variant>('tiles');

export function Facts({ variant = 'tiles', children }: { variant?: Variant; children: ReactNode }) {
  return (
    <VariantOf.Provider value={variant}>
      <dl className={CLASS[variant]}>{children}</dl>
    </VariantOf.Provider>
  );
}

export function Fact({ label, icon, tone, children }: { label: ReactNode; icon?: ReactNode; tone?: Tone; children: ReactNode }) {
  const variant = useContext(VariantOf);
  if (variant === 'cards') {
    return (
      <div className={tone ? `fact-card ${tone}` : 'fact-card'}>
        <div><dt>{label}</dt><dd>{children}</dd></div>
        {icon ? <span className="fact-mark" aria-hidden="true">{icon}</span> : null}
      </div>
    );
  }
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}
