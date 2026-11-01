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
            "h-9 w-full appearance-none rounded-lg border bg-[var(--surface)] px-3 pe-9 text-sm text-[var(--ink)] shadow-sm transition-shadow",
            "focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] focus:border-[var(--accent)]",
            "disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:opacity-60",
            invalid ? "border-[var(--bad)] focus:border-[var(--bad)] focus:ring-[var(--bad)]/25" : "border-[var(--line)]",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute inset-y-0 end-3 my-auto h-4 w-4 text-[var(--ink-4)]" />
      </div>
    );
  }
);
Select.displayName = "Select";
