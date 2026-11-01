import type { ReactNode } from 'react';

/**
 * A thin wrapper over `.filter-bar` / `.filter-panel`. It writes the markup content-ui.mdc
 * defines ("Filters: `.filter-bar` > `.filter-panel`, above the table") and nothing else.
 * Each field is a plain `<label>` child; this component only owns the card chrome and the
 * optional trailing clear button.
 */
export function FilterBar({
  children,
  onClear,
  clearLabel,
}: {
  children: ReactNode;
  onClear?: () => void;
  clearLabel?: string;
}) {
  return (
    <div className="filter-bar">
      <div className="filter-panel">
        {children}
        {onClear ? (
          <button type="button" className="secondary" onClick={onClear}>
            {clearLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
