"use client";

interface FormFieldError {
  message?: string;
}

interface CheckboxOption {
  label: string;
  value: string;
}

interface CheckboxGroupProps {
  name: string;
  label: string;
  options: CheckboxOption[];
  error?: FormFieldError;
  required?: boolean;
  className?: string;
  value?: string[];
  onChange?: (values: string[]) => void;
}

function CheckboxGroup({
  name,
  label,
  options,
  error,
  required,
  className = "",
  value = [],
  onChange,
}: CheckboxGroupProps) {
  const groupId = `checkbox-${name}`;
  const errorId = `${groupId}-error`;

  function handleChange(optionValue: string, checked: boolean) {
    if (!onChange) return;
    if (checked) {
      onChange([...value, optionValue]);
    } else {
      onChange(value.filter((v) => v !== optionValue));
    }
  }

  return (
    <fieldset
      className={`flex flex-col gap-2 ${className}`}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-error ml-0.5" aria-hidden="true">*</span>}
      </legend>
      <div className="flex flex-col gap-2" role="group" aria-label={label}>
        {options.map((option) => {
          const optionId = `${groupId}-${option.value.toLowerCase().replace(/\s+/g, "-")}`;
          const isChecked = value.includes(option.value);
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer
                transition-colors text-sm
                ${isChecked
                  ? "border-primary bg-primary/5 text-primary font-medium"
                  : "border-border hover:border-primary/50 hover:bg-primary/[0.02]"
                }
                ${error ? "border-error" : ""}`}
            >
              <input
                type="checkbox"
                id={optionId}
                name={name}
                value={option.value}
                checked={isChecked}
                onChange={(e) => handleChange(option.value, e.target.checked)}
                className="w-4 h-4 rounded text-primary accent-primary focus:ring-2 focus:ring-primary/40"
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

export { CheckboxGroup };
export type { CheckboxGroupProps, CheckboxOption };
