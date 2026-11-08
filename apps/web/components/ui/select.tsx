import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "h-9 w-full appearance-none rounded-lg border bg-[var(--rd-surface)] px-3 pe-9 text-sm text-[var(--rd-ink)] shadow-sm transition-shadow",
            "focus:outline-none focus:ring-2 focus:ring-[var(--rd-focus)] focus:border-[var(--rd-primary-bg)]",
            "disabled:cursor-not-allowed disabled:bg-[var(--rd-surface-2)] disabled:opacity-60",
            invalid ? "border-[var(--rd-danger)] focus:border-[var(--rd-danger)] focus:ring-[var(--rd-danger)]/25" : "border-[var(--rd-line)]",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute inset-y-0 end-3 my-auto h-4 w-4 text-[var(--rd-faint)]" />
      </div>
    );
  }
);
Select.displayName = "Select";
