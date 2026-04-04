"use client";

import { forwardRef } from "react";

interface FormFieldError {
  message?: string;
}

interface SelectOption {
  label: string;
  value: string;
}

interface SelectFieldProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: SelectOption[];
  error?: FormFieldError;
  helperText?: string;
  placeholder?: string;
}

const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  (
    { label, options, error, helperText, placeholder, id, required, className = "", ...props },
    ref
  ) => {
    const inputId = id ?? `select-${label.toLowerCase().replace(/\s+/g, "-")}`;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-error ml-0.5" aria-hidden="true">*</span>}
        </label>
        <select
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={
            [error ? errorId : null, helperText ? helperId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
          className={`rounded-lg border px-3 py-2.5 text-sm transition-colors appearance-none
            bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20d%3D%22M6%208L1%203h10z%22%20fill%3D%22%236b7280%22%2F%3E%3C%2Fsvg%3E')]
            bg-no-repeat bg-[position:right_12px_center]
            focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary
            disabled:opacity-50 disabled:cursor-not-allowed
            ${error ? "border-error bg-error-light" : "border-border bg-white hover:border-primary/50"}`}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {helperText && !error && (
          <p id={helperId} className="text-xs text-muted">
            {helperText}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-xs text-error" role="alert">
            {error.message}
          </p>
        )}
      </div>
    );
  }
);

SelectField.displayName = "SelectField";

export { SelectField };
export type { SelectFieldProps, SelectOption };
