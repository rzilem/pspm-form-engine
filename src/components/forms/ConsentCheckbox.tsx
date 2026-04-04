"use client";

import { useState } from "react";

interface FormFieldError {
  message?: string;
}

interface ConsentCheckboxProps {
  name: string;
  label: string;
  detailText?: string;
  required?: boolean;
  error?: FormFieldError;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  className?: string;
}

function ConsentCheckbox({
  name,
  label,
  detailText,
  required,
  error,
  checked = false,
  onChange,
  className = "",
}: ConsentCheckboxProps) {
  const [expanded, setExpanded] = useState(false);
  const fieldId = `consent-${name}`;
  const errorId = `${fieldId}-error`;
  const detailId = `${fieldId}-detail`;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div
        className={`rounded-[8px] border px-4 py-3 transition-colors
          ${
            error
              ? "border-error bg-error-light"
              : checked
                ? "border-primary bg-primary-light"
                : "border-border hover:border-primary/50"
          }`}
      >
        <label
          htmlFor={fieldId}
          className="flex items-start gap-3 cursor-pointer"
        >
          <input
            type="checkbox"
            id={fieldId}
            name={name}
            checked={checked}
            onChange={(e) => onChange?.(e.target.checked)}
            required={required}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={
              [error ? errorId : null, detailText ? detailId : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
            className="mt-0.5 w-4 h-4 rounded text-primary accent-primary focus:ring-2 focus:ring-primary/40 shrink-0"
          />
          <span className="text-sm text-foreground">
            {label}
            {required && (
              <span className="text-error ml-0.5" aria-hidden="true">
                *
              </span>
            )}
          </span>
        </label>

        {detailText && (
          <div className="ml-7 mt-2">
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-xs font-medium text-primary hover:text-primary-hover transition-colors flex items-center gap-1"
              aria-expanded={expanded}
              aria-controls={detailId}
            >
              {expanded ? "Hide details" : "Read full terms"}
              <svg
                className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            {expanded && (
              <p
                id={detailId}
                className="mt-2 text-xs text-muted leading-relaxed animate-fade-in"
              >
                {detailText}
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <p id={errorId} className="text-xs text-error" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}

export { ConsentCheckbox };
export type { ConsentCheckboxProps };
