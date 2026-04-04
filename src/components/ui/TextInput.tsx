"use client";

import { forwardRef } from "react";

interface FormFieldError {
  message?: string;
}

interface TextInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: FormFieldError;
  helperText?: string;
}

const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ label, error, helperText, id, required, className = "", ...props }, ref) => {
    const inputId = id ?? `input-${label.toLowerCase().replace(/\s+/g, "-")}`;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-error ml-0.5" aria-hidden="true">*</span>}
        </label>
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={
            [error ? errorId : null, helperText ? helperId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
          className={`rounded-lg border px-3 py-2.5 text-sm transition-colors
            focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary
            disabled:opacity-50 disabled:cursor-not-allowed
            ${error ? "border-error bg-error-light" : "border-border bg-white hover:border-primary/50"}`}
          {...props}
        />
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

TextInput.displayName = "TextInput";

export { TextInput };
export type { TextInputProps };
