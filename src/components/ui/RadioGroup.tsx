"use client";

import { forwardRef } from "react";

interface FormFieldError {
  message?: string;
}

interface RadioOption {
  label: string;
  value: string;
}

interface RadioGroupProps {
  name: string;
  label: string;
  options: RadioOption[];
  error?: FormFieldError;
  required?: boolean;
  className?: string;
  value?: string;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
}

const RadioGroup = forwardRef<HTMLInputElement, RadioGroupProps>(
  ({ name, label, options, error, required, className = "", value, onChange, onBlur }, ref) => {
    const groupId = `radio-${name}`;
    const errorId = `${groupId}-error`;

    return (
      <fieldset
        className={`flex flex-col gap-2 ${className}`}
        aria-describedby={error ? errorId : undefined}
      >
        <legend className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-error ml-0.5" aria-hidden="true">*</span>}
        </legend>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label={label}>
          {options.map((option) => {
            const optionId = `${groupId}-${option.value.toLowerCase().replace(/\s+/g, "-")}`;
            return (
              <label
                key={option.value}
                htmlFor={optionId}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer
                  transition-colors text-sm
                  ${value === option.value
                    ? "border-primary bg-primary/5 text-primary font-medium"
                    : "border-border hover:border-primary/50 hover:bg-primary/[0.02]"
                  }
                  ${error ? "border-error" : ""}`}
              >
                <input
                  ref={ref}
                  type="radio"
                  id={optionId}
                  name={name}
                  value={option.value}
                  checked={value === option.value}
                  onChange={onChange}
                  onBlur={onBlur}
                  className="w-4 h-4 text-primary accent-primary focus:ring-2 focus:ring-primary/40"
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
        {error && (
          <p id={errorId} className="text-xs text-error" role="alert">
            {error.message}
          </p>
        )}
      </fieldset>
    );
  }
);

RadioGroup.displayName = "RadioGroup";

export { RadioGroup };
export type { RadioGroupProps, RadioOption };
