import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";
import { Select, SelectItem } from "./select";
import { usePrefs } from "../../lib/prefs";
import { PAGE_SIZES, type PageSize } from "../../lib/document-prefs";
import { cn } from "../../lib/cn";

function formatInteger(value: number) {
  return value.toLocaleString("en-US");
}

export const PAGE_SIZE_OPTIONS: PageSize[] = [...PAGE_SIZES, "all"];

/*
 * The pager (ADR 0022):
 * - the row: wrapping, items centred, the facts at the start and the page buttons at the end, 16px / 8px between
 *   them, 12px / 16px padding under a 1px `--rd-line` hairline, 12px `--rd-muted`;
 * - the facts: the status line, then the per-page field (its 11.5px label 6px before an 88px `Select place="pager"`);
 * - previous / next: a quiet secondary, 30px, no fill and no inset line until hovered, ink-2 text, 14px chevrons that
 *   face the reading direction;
 * - a page: 30px square at least, 8px sides, no border, 4px corners, no fill, 12.5px bold `--rd-ink-2`, the colour
 *   transition; hovered `--rd-surface-2`; the current one ink on the page colour; at least 44 × 44 at 720px and
 *   under (the touch rule); on keyboard focus the 2px `--rd-accent` outline drawn inside it (the focus mark of an
 *   item in a strip or a list);
 * - the gap: an ellipsis with 4px sides in `--rd-faint`.
 */
const NAV_BUTTON = "h-7.5 bg-transparent text-ink-2 inset-ring-0 hover:bg-surface-2";
const ARROW = "size-3.5";

export type PaginationProps = {
  page: number;
  pageSize: PageSize;
  count: number;
  /**
   * The server counted the list up to its cap and more rows wait (database plan DB.8): the status reads
   * «more than {moreThan} results» and names no last page, since the last page is not known yet.
   */
  moreThan?: number;
  onPageChange: (page: number) => void;
  /** When provided, renders the per-page size selector (resets to page 1 on change). */
  onPageSizeChange?: (pageSize: PageSize) => void;
  pageSizeOptions?: PageSize[];
};

/** True when Pagination would render controls (not an empty footer strip). */
export function shouldShowPagination({
  count,
  pageSize,
  onPageSizeChange,
}: Pick<PaginationProps, "count" | "pageSize" | "onPageSizeChange">): boolean {
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(count / pageSize));
  const showSizeSelector = Boolean(onPageSizeChange) && count > 0;
  return totalPages > 1 || showSizeSelector;
}

/** Sliding window of page numbers with ellipsis: 1 … 4 [5] 6 … 12 */
function pageWindow(page: number, totalPages: number): Array<number | "gap"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);

  const out: Array<number | "gap"> = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push("gap");
    out.push(p);
    prev = p;
  }
  return out;
}

export function Pagination({
  page,
  pageSize,
  count,
  moreThan,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}: PaginationProps) {
  const { t } = usePrefs();
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(count / pageSize));
  const showSizeSelector = Boolean(onPageSizeChange) && count > 0;
  if (!shouldShowPagination({ count, pageSize, onPageSizeChange })) return null;
  const status = moreThan !== undefined
    ? t.pageStatusCapped.replace('{page}', String(page)).replace('{n}', formatInteger(moreThan))
    : t.pageStatus
      .replace('{page}', String(page))
      .replace('{total}', String(totalPages))
      .replace('{n}', formatInteger(count));

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-4 py-3 text-sm text-muted"
      aria-label={t.pages}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span>{status}</span>
        {showSizeSelector && (
          <label className="inline-flex items-center gap-1.5">
            <span className="text-caption">{t.perPage}</span>
            <span className="inline-block w-22">
            <Select
              value={String(pageSize)}
              onValueChange={(next) => onPageSizeChange?.(next === "all" ? "all" : Number(next) as PageSize)}
              place="pager"
              aria-label={t.perPage}
            >
              {pageSizeOptions.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option === "all" ? t.allRows : option}
                </SelectItem>
              ))}
            </Select>
            </span>
          </label>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            className={NAV_BUTTON}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label={t.pagePrev}
          >
            <ChevronRight className={cn(ARROW, "ltr:hidden")} aria-hidden="true" />
            <ChevronLeft className={cn(ARROW, "rtl:hidden")} aria-hidden="true" />
            {t.pagerPrev}
          </Button>

          <div className="flex items-center gap-1" role="group" aria-label={t.pages}>
            {pageWindow(page, totalPages).map((item, index) =>
              item === "gap" ? (
                <span key={`gap-${index}`} className="px-1 text-faint" aria-hidden="true">
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  onClick={() => onPageChange(item)}
                  aria-current={item === page ? "page" : undefined}
                  className={cn(
                    "h-7.5 min-w-7.5 rounded-xs border-0 bg-transparent px-2 text-chip font-bold text-ink-2",
                    "transition-[color,background-color,border-color,text-decoration-color,fill,stroke] duration-fast ease-standard",
                    "hover:bg-surface-2 aria-[current=page]:bg-ink aria-[current=page]:text-bg",
                    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                    "max-touch:min-h-11 max-touch:min-w-11",
                  )}
                >
                  {item}
                </button>
              )
            )}
          </div>

          <Button
            variant="secondary"
            size="sm"
            className={NAV_BUTTON}
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label={t.pageNext}
          >
            {t.pagerNext}
            <ChevronLeft className={cn(ARROW, "ltr:hidden")} aria-hidden="true" />
            <ChevronRight className={cn(ARROW, "rtl:hidden")} aria-hidden="true" />
          </Button>
        </div>
      )}
    </nav>
  );
}
