import type { ReactNode } from 'react';
import { Button } from './ui/button';

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
          <Button type="button" variant="secondary" size="sm" className="filter-clear" onClick={onClear}>
            {clearLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
