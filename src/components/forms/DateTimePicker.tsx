"use client";

interface FormFieldError {
  message?: string;
}

interface DateTimePickerProps {
  label: string;
  required?: boolean;
  error?: FormFieldError;
  dateValue?: string;
  timeValue?: string;
  onDateChange?: (date: string) => void;
  onTimeChange?: (time: string) => void;
  className?: string;
}

const TIME_SLOTS = [
  "8:00 AM",
  "9:00 AM",
  "10:00 AM",
  "11:00 AM",
  "12:00 PM",
  "1:00 PM",
  "2:00 PM",
  "3:00 PM",
  "4:00 PM",
  "5:00 PM",
  "6:00 PM",
  "7:00 PM",
] as const;

function getTomorrowDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split("T")[0];
}

function DateTimePicker({
  label,
  required,
  error,
  dateValue = "",
  timeValue = "",
  onDateChange,
  onTimeChange,
  className = "",
}: DateTimePickerProps) {
  const fieldId = `datetime-${label.toLowerCase().replace(/\s+/g, "-")}`;
  const errorId = `${fieldId}-error`;
  const minDate = getTomorrowDate();

  return (
    <fieldset
      className={`flex flex-col gap-4 ${className}`}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="text-error ml-0.5" aria-hidden="true">
            *
          </span>
        )}
      </legend>

      {/* Date picker */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${fieldId}-date`} className="text-xs font-medium text-muted">
          Select Date
        </label>
        <input
          type="date"
          id={`${fieldId}-date`}
          value={dateValue}
          min={minDate}
          onChange={(e) => onDateChange?.(e.target.value)}
          required={required}
          className={`rounded-[8px] border px-3 py-2.5 text-sm transition-colors
            focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary
            ${
              error && !dateValue
                ? "border-error bg-error-light"
                : "border-border bg-white hover:border-primary/50"
            }`}
        />
      </div>

      {/* Time slot selector */}
      {dateValue && (
        <div className="flex flex-col gap-2 animate-fade-in">
          <span className="text-xs font-medium text-muted">
            Select Time
          </span>
          <div
            className="grid grid-cols-3 sm:grid-cols-4 gap-2"
            role="radiogroup"
            aria-label="Available time slots"
          >
            {TIME_SLOTS.map((slot) => {
              const slotId = `${fieldId}-time-${slot.replace(/[:\s]/g, "-")}`;
              const isSelected = timeValue === slot;
              return (
                <label
                  key={slot}
                  htmlFor={slotId}
                  className={`flex items-center justify-center rounded-[8px] border px-2 py-2.5 text-sm cursor-pointer transition-colors text-center
                    ${
                      isSelected
                        ? "border-primary bg-primary-light text-primary font-medium"
                        : "border-border hover:border-primary/50 hover:bg-primary/[0.02]"
                    }
                    ${error && !timeValue ? "border-error" : ""}`}
                >
                  <input
                    type="radio"
                    id={slotId}
                    name={`${fieldId}-time`}
                    value={slot}
                    checked={isSelected}
                    onChange={() => onTimeChange?.(slot)}
                    className="sr-only"
                  />
                  {slot}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <p id={errorId} className="text-xs text-error" role="alert">
          {error.message}
        </p>
      )}
    </fieldset>
  );
}

export { DateTimePicker, TIME_SLOTS };
export type { DateTimePickerProps };
