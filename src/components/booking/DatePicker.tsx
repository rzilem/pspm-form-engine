"use client";

import { useState, useEffect, useCallback } from "react";

interface DatePickerProps {
  amenitySlug: string;
  selectedDate: string | null; // YYYY-MM-DD
  onDateSelect: (date: string) => void;
  className?: string;
}

interface DayStatus {
  date: string;
  available: boolean;
  blackedOut: boolean;
  past: boolean;
  outsideWindow: boolean;
}

const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

function DatePicker({ amenitySlug, selectedDate, onDateSelect, className = "" }: DatePickerProps) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // Minimum date: 2 days from now (48 hours advance)
  const minDate = new Date(today.getTime() + 48 * 60 * 60 * 1000);
  const minDateStr = minDate.toISOString().split("T")[0];

  // Maximum date: 90 days out
  const maxDate = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
  const maxDateStr = maxDate.toISOString().split("T")[0];

  // Fetch availability for visible dates in the current month view
  const fetchMonthAvailability = useCallback(async () => {
    setLoading(true);
    const available = new Set<string>();

    // Get all dates in the current month view
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);

    const promises: Promise<void>[] = [];

    for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      if (dateStr < minDateStr || dateStr > maxDateStr) continue;

      const fetchDate = dateStr; // capture for closure
      promises.push(
        fetch(`${API_BASE}/api/booking/availability?amenity=${amenitySlug}&date=${fetchDate}`)
          .then((r) => r.json())
          .then((data: { slots?: Array<{ available: boolean }>; error?: string }) => {
            if (!data.error && data.slots?.some((s) => s.available)) {
              available.add(fetchDate);
            }
          })
          .catch(() => {
            // Silently skip — date shown as unavailable
          })
      );
    }

    await Promise.all(promises);
    setAvailableDates(available);
    setLoading(false);
  }, [amenitySlug, viewYear, viewMonth, minDateStr, maxDateStr]);

  useEffect(() => {
    void fetchMonthAvailability();
  }, [fetchMonthAvailability]);

  // Build calendar grid
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
  const startDayOfWeek = firstDayOfMonth.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const days: (DayStatus | null)[] = [];

  // Leading blanks
  for (let i = 0; i < startDayOfWeek; i++) {
    days.push(null);
  }

  // Actual days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isPast = dateStr < minDateStr;
    const isOutsideWindow = dateStr > maxDateStr;
    const isAvailable = availableDates.has(dateStr);

    days.push({
      date: dateStr,
      available: isAvailable && !isPast && !isOutsideWindow,
      blackedOut: false,
      past: isPast,
      outsideWindow: isOutsideWindow,
    });
  }

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  // Disable prev if we'd go before current month
  const canGoPrev = viewYear > today.getFullYear() ||
    (viewYear === today.getFullYear() && viewMonth > today.getMonth());

  // Disable next if we'd go past max date month
  const canGoNext = viewYear < maxDate.getFullYear() ||
    (viewYear === maxDate.getFullYear() && viewMonth < maxDate.getMonth());

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          disabled={!canGoPrev}
          className="p-2 rounded-[8px] hover:bg-primary-light transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Previous month"
        >
          <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-semibold text-navy">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          type="button"
          onClick={nextMonth}
          disabled={!canGoNext}
          className="p-2 rounded-[8px] hover:bg-primary-light transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Next month"
        >
          <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {DAY_NAMES.map((name) => (
          <div key={name} className="text-xs font-medium text-muted py-1">
            {name}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Date picker">
        {loading && (
          <div className="col-span-7 text-center py-8 text-sm text-muted">
            Loading availability...
          </div>
        )}
        {!loading &&
          days.map((day, i) => {
            if (!day) {
              return <div key={`blank-${i}`} className="aspect-square" />;
            }

            const isSelected = selectedDate === day.date;
            const isDisabled = !day.available;
            const dayNum = parseInt(day.date.split("-")[2], 10);

            return (
              <button
                key={day.date}
                type="button"
                disabled={isDisabled}
                onClick={() => onDateSelect(day.date)}
                className={`
                  relative aspect-square flex items-center justify-center rounded-[8px] text-sm transition-colors
                  ${isSelected
                    ? "bg-primary text-white font-semibold"
                    : day.available
                      ? "hover:bg-primary-light hover:text-primary cursor-pointer text-foreground"
                      : "text-border cursor-not-allowed"
                  }
                `}
                aria-label={`${day.date}${day.available ? " — available" : " — unavailable"}`}
                aria-pressed={isSelected}
              >
                {dayNum}
                {day.available && !isSelected && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-brand-green" />
                )}
              </button>
            );
          })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted mt-1">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-brand-green" />
          Available
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-border" />
          Unavailable
        </div>
      </div>
    </div>
  );
}

export { DatePicker };
