"use client";

interface FormFieldError {
  message?: string;
}

interface ProductLineItemProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  error?: FormFieldError;
  id?: string;
}

function ProductLineItem({
  label,
  value,
  onChange,
  error,
  id,
}: ProductLineItemProps) {
  const inputId = id ?? `line-item-${label.toLowerCase().replace(/\s+/g, "-")}`;
  const errorId = `${inputId}-error`;

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^0-9.]/g, "");
    if (raw === "" || raw === ".") {
      onChange(0);
      return;
    }
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      onChange(Math.round(parsed * 100) / 100);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-4">
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-foreground flex-1 min-w-0"
        >
          {label}
        </label>
        <div className="relative w-32 shrink-0">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted pointer-events-none">
            $
          </span>
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? errorId : undefined}
            value={value === 0 ? "" : value.toFixed(2)}
            placeholder="0.00"
            onChange={handleChange}
            className={`w-full rounded-[8px] border pl-7 pr-3 py-2 text-sm text-right transition-colors
              focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary
              ${error ? "border-error bg-error-light" : "border-border bg-white hover:border-primary/50"}`}
          />
        </div>
      </div>
      {error && (
        <p id={errorId} className="text-xs text-error text-right" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}

export { ProductLineItem };
export type { ProductLineItemProps };
