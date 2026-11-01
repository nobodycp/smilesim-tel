"use client";

import * as React from "react";
import { cn } from "../../lib/utils";
import { Card } from "./card";
import { EmptyState } from "../empty-state";

/**
 * Table container — enterprise data-table styling: card shell, tinted header
 * band, compact rows, horizontal scroll on overflow.
 *
 * On phones (< md) rows restack into label/value cards (`.data-table--stack`
 * in globals.css) instead of forcing a wide horizontal scroll. The per-cell
 * labels come from the column headers and are injected as `data-label`
 * attributes at runtime (see useMobileCellLabels), so the ~25 existing call
 * sites don't need to repeat their header text on every cell. Pass
 * `mobileStack={false}` for matrix-style tables where row-by-row stacking
 * doesn't make sense (e.g. side-by-side comparisons).
 */
export function Table({
  className,
  bare = false,
  stickyHeader = false,
  mobileStack = true,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & {
  bare?: boolean;
  /** Keeps the header visible while the table body scrolls (useful for long lists). */
  stickyHeader?: boolean;
  /** Restack rows into label/value cards on phones (default). */
  mobileStack?: boolean;
}) {
  const wrapperRef = useMobileCellLabels(mobileStack);
  const table = (
    <table
      className={cn(
        "data-table w-full min-w-full text-start text-[12.5px]",
        mobileStack && "data-table--stack",
        stickyHeader && "[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10",
        className
      )}
      {...props}
    />
  );
  if (bare) {
    return (
      <div
        ref={wrapperRef}
        className={cn(
          // pan-x + pan-y: horizontal overflow scroll still works, but vertical
          // swipes are not trapped (bare pan-x blocked page scroll on phones).
          "max-w-full touch-pan-x touch-pan-y overflow-x-auto overscroll-x-contain",
          stickyHeader && "max-h-[70vh] overflow-y-auto",
        )}
      >
        {table}
      </div>
    );
  }
  return (
    <Card className="overflow-hidden">
      <div
        ref={wrapperRef}
        className={cn(
          "max-w-full touch-pan-x touch-pan-y overflow-x-auto overscroll-x-contain",
          stickyHeader && "max-h-[70vh] overflow-y-auto",
        )}
      >
        {table}
      </div>
    </Card>
  );
}

/**
 * Copies each column header's text onto the matching body cells as a
 * `data-label` attribute, which the mobile stacked layout renders as the
 * cell's inline label (globals.css `.data-table--stack td::before`).
 *
 * Done against the DOM instead of via React context so every existing
 * `<Table>` call site gets mobile labels for free. A MutationObserver keeps
 * labels in sync when rows are added/removed (pagination, live refetch).
 * Cells spanning multiple columns (colSpan) and columns with empty headers
 * (action/checkbox columns) get no label and render full-width.
 */
function useMobileCellLabels(enabled: boolean) {
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!enabled) return;
    const table = wrapperRef.current?.querySelector("table");
    if (!table) return;

    const apply = () => {
      const headers = Array.from(table.querySelectorAll(":scope > thead th")).map(
        (th) => (th.textContent ?? "").trim()
      );
      if (headers.length === 0) return;
      for (const row of table.querySelectorAll(":scope > tbody > tr")) {
        let column = 0;
        for (const cell of Array.from(row.children) as HTMLTableCellElement[]) {
          const span = cell.colSpan || 1;
          const label = span === 1 ? headers[column] : "";
          if (label) {
            cell.setAttribute("data-label", label);
          } else {
            cell.removeAttribute("data-label");
          }
          column += span;
        }
      }
    };

    apply();
    // childList only: apply() itself mutates attributes, so watching
    // attributes here would loop forever.
    const observer = new MutationObserver(apply);
    observer.observe(table, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [enabled]);

  return wrapperRef;
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn("border-b border-[var(--line)] bg-[var(--surface-2)]", className)}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-[var(--line-soft)]", className)} {...props} />;
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("transition-colors duration-100 hover:bg-[var(--surface-2)]", className)}
      {...props}
    />
  );
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn("table-header whitespace-nowrap px-2.5 py-1.5 sm:px-3", className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("whitespace-nowrap px-2.5 py-1.5 text-[var(--ink-2)] sm:px-3", className)}
      {...props}
    />
  );
}

/**
 * Mixed AR/EN label text inside RTL layouts. Keeps English word order (e.g. "1 Day Unlimited")
 * while aligning toward the inline-start (sidebar side).
 */
export function MixedLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span dir="ltr" className={cn("inline-block max-w-full truncate text-end", className)}>
      {children}
    </span>
  );
}

/**
 * Label column for RTL tables (names, titles). Never use dir="auto" here — mixed
 * English/Arabic names otherwise flip the cell to LTR and visually drift into
 * the next column under text-align: start.
 */
export function TdLabel({ className, children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <Td className={cn("max-w-[280px] text-start", className)} {...props}>
      <MixedLabel>{children}</MixedLabel>
    </Td>
  );
}

/** Re-exported for backwards compatibility — see components/ui/empty-state. */
export { EmptyState };
