'use client';

export function TableSearch({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="table-search">
      <label>
        <SearchIcon />
        <span>{label}</span>
        <input value={value} aria-label={label} onChange={(event) => onChange(event.target.value)} />
      </label>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
