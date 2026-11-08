import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";
import { Select } from "./select";
import { cn } from "../../lib/utils";
import { usePrefs } from "../../lib/prefs";
import { PAGE_SIZES, type PageSize } from "../../lib/document-prefs";

function formatInteger(value: number) {
  return value.toLocaleString("en-US");
}

export const PAGE_SIZE_OPTIONS: PageSize[] = [...PAGE_SIZES, "all"];

export type PaginationProps = {
  page: number;
  pageSize: PageSize;
  count: number;
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
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}: PaginationProps) {
  const { t } = usePrefs();
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(count / pageSize));
  const showSizeSelector = Boolean(onPageSizeChange) && count > 0;
  if (!shouldShowPagination({ count, pageSize, onPageSizeChange })) return null;
  const status = t.pageStatus
    .replace('{page}', String(page))
    .replace('{total}', String(totalPages))
    .replace('{n}', formatInteger(count));

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 py-2 text-[12px] text-[var(--ink-3)]"
      aria-label={t.pages}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="num-tab">{status}</span>
        {showSizeSelector && (
          <label className="inline-flex items-center gap-1.5">
            <span className="text-[11.5px]">{t.perPage}</span>
            <span className="inline-block w-[5.5rem]">
            <Select
              value={String(pageSize)}
              onChange={(event) => onPageSizeChange?.(event.target.value === "all" ? "all" : Number(event.target.value) as PageSize)}
              className="h-7 text-[12px]"
              aria-label={t.perPage}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? t.allRows : option}
                </option>
              ))}
            </Select>
            </span>
          </label>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label={t.pagePrev}
          >
            <ChevronRight className="h-3.5 w-3.5 ltr:hidden" aria-hidden="true" />
            <ChevronLeft className="h-3.5 w-3.5 rtl:hidden" aria-hidden="true" />
            {t.pagerPrev}
          </Button>

          <div className="flex items-center gap-1" role="group" aria-label={t.pages}>
            {pageWindow(page, totalPages).map((item, index) =>
              item === "gap" ? (
                <span key={`gap-${index}`} className="px-1 text-[var(--ink-4)]" aria-hidden="true">
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  onClick={() => onPageChange(item)}
                  aria-current={item === page ? "page" : undefined}
                  className={cn(
                    "num-tab h-8 min-w-8 rounded-lg border px-2 text-[12.5px] font-semibold transition-colors",
                    item === page
                      ? "border-transparent bg-[var(--accent)] text-[var(--accent-fg)]"
                      : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
                  )}
                >
                  {item}
                </button>
              )
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label={t.pageNext}
          >
            {t.pagerNext}
            <ChevronLeft className="h-3.5 w-3.5 ltr:hidden" aria-hidden="true" />
            <ChevronRight className="h-3.5 w-3.5 rtl:hidden" aria-hidden="true" />
          </Button>
        </div>
      )}
    </nav>
  );
}
