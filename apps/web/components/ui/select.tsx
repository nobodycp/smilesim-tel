import * as React from "react";
import { ChevronDown } from "lucide-react";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  /** The 28px field used inside the pager. */
  compact?: boolean;
}

/**
 * A native select with a chevron. Styles live in app/styles/ui.css (.ui-select*). `className` goes on the wrapper,
 * which carries the layout (width, grid placement), so the chevron stays at the field's own end.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, compact, children, ...props }, ref) => {
    const classes = [
      "ui-select-field",
      compact ? "ui-select-compact" : "ui-select-regular",
      invalid && "ui-select-invalid",
    ];
    return (
      <div className={className ? `ui-select ${className}` : "ui-select"}>
        <select ref={ref} className={classes.filter(Boolean).join(" ")} {...props}>
          {children}
        </select>
        <ChevronDown className="ui-select-chevron" />
      </div>
    );
  }
);
Select.displayName = "Select";
