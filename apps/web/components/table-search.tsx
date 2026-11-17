'use client';

/*
 * The search line above a table (under the filter panel's label rules, `[data-slot=filter-panel] label`: no minimum
 * width, one line): a row with a soft hairline under it; the label is a 28px box (16rem, never wider than the row)
 * with a 1px `--rd-line` border, 4px corners, the surface fill, the 14px icon, the name in 11px semibold `--rd-muted`,
 * then the field: no box of its own (no border, fill, ring or padding), 22px, 12px medium ink text, and no focus mark.
 */
export function TableSearch({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center border-b border-line-soft px-2 py-1.5" data-testid="table-search">
      <label className="m-0 inline-flex h-7 w-[min(16rem,100%)] min-w-0 flex-row items-center gap-1.5 whitespace-nowrap rounded-xs border border-solid border-line bg-surface px-2 text-start text-xs font-semibold text-muted">
        <SearchIcon />
        <span className="flex-none">{label}</span>
        <input
          className="h-5.5 w-auto min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-sm font-medium text-ink shadow-none outline-none"
          value={value}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className="size-3.5 flex-none" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
