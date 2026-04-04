"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { formatTime12h } from "@/lib/booking";

interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

interface TimeSlotPickerProps {
  amenitySlug: string;
  date: string; // YYYY-MM-DD
  selectedSlot: { start: string; end: string } | null;
  onSlotSelect: (start: string, end: string) => void;
  onHoldCreated?: (holdId: string, expiresAt: string) => void;
  onHoldExpired?: () => void;
  amenityId?: string;
  sessionId: string;
  className?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

function TimeSlotPicker({
  amenitySlug,
  date,
  selectedSlot,
  onSlotSelect,
  onHoldCreated,
  onHoldExpired,
  amenityId,
  sessionId,
  className = "",
}: TimeSlotPickerProps) {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [holdId, setHoldId] = useState<string | null>(null);
  const [holdExpiresAt, setHoldExpiresAt] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch slots for selected date
  useEffect(() => {
    if (!date || !amenitySlug) return;

    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/api/booking/availability?amenity=${amenitySlug}&date=${date}`)
      .then((r) => r.json())
      .then((data: { slots?: TimeSlot[]; error?: string }) => {
        if (data.error) {
          setError(data.error);
          setSlots([]);
        } else {
          setSlots(data.slots ?? []);
        }
      })
      .catch(() => {
        setError("Failed to load available times");
        setSlots([]);
      })
      .finally(() => setLoading(false));
  }, [amenitySlug, date]);

  // Countdown timer for hold
  useEffect(() => {
    if (!holdExpiresAt) {
      setCountdown(0);
      return;
    }

    function tick() {
      const remaining = Math.max(0, Math.floor((new Date(holdExpiresAt!).getTime() - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining <= 0) {
        setHoldId(null);
        setHoldExpiresAt(null);
        onHoldExpired?.();
        if (countdownRef.current) clearInterval(countdownRef.current);
      }
    }

    tick();
    countdownRef.current = setInterval(tick, 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [holdExpiresAt, onHoldExpired]);

  // Create hold when slot is selected
  const handleSlotSelect = useCallback(
    async (start: string, end: string) => {
      if (!amenityId) return;

      // Release previous hold (best-effort, don't block new selection)
      if (holdId) {
        try {
          await fetch(
            `${API_BASE}/api/booking/hold?id=${holdId}&session_id=${sessionId}`,
            { method: "DELETE" }
          );
        } catch {
          // Previous hold will expire naturally if release fails
        }
      }

      // Create new hold
      try {
        const res = await fetch(`${API_BASE}/api/booking/hold`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amenity_id: amenityId,
            date,
            start_time: start,
            end_time: end,
            session_id: sessionId,
          }),
        });

        const data = (await res.json()) as {
          hold_id?: string;
          expires_at?: string;
          error?: string;
        };

        if (!res.ok || data.error) {
          setError(data.error ?? "Failed to hold this time slot");
          return;
        }

        setHoldId(data.hold_id ?? null);
        setHoldExpiresAt(data.expires_at ?? null);
        setError(null);
        onSlotSelect(start, end);
        if (data.hold_id && data.expires_at) {
          onHoldCreated?.(data.hold_id, data.expires_at);
        }
      } catch {
        setError("Failed to hold this time slot");
      }
    },
    [amenityId, date, holdId, sessionId, onSlotSelect, onHoldCreated]
  );

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className={`text-center py-6 text-sm text-muted ${className}`}>
        Loading available times...
      </div>
    );
  }

  if (error && slots.length === 0) {
    return (
      <div className={`rounded-[8px] border border-border bg-gray-50 px-4 py-6 text-center text-sm text-muted ${className}`}>
        {error}
      </div>
    );
  }

  const availableSlots = slots.filter((s) => s.available);

  if (availableSlots.length === 0 && slots.length > 0) {
    return (
      <div className={`rounded-[8px] border border-border bg-gray-50 px-4 py-6 text-center text-sm text-muted ${className}`}>
        No available times for this date. Please select another date.
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 animate-fade-in ${className}`}>
      <span className="text-xs font-medium text-muted">
        Available times for {new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      </span>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Available time slots">
        {slots.map((slot) => {
          const isSelected =
            selectedSlot?.start === slot.start && selectedSlot?.end === slot.end;
          const slotKey = `${slot.start}-${slot.end}`;

          return (
            <button
              key={slotKey}
              type="button"
              disabled={!slot.available}
              onClick={() => handleSlotSelect(slot.start, slot.end)}
              className={`
                flex flex-col items-center justify-center rounded-[8px] border px-3 py-3 text-sm transition-colors
                ${isSelected
                  ? "border-primary bg-primary-light text-primary font-medium ring-2 ring-primary/40"
                  : slot.available
                    ? "border-border hover:border-primary/50 hover:bg-primary/[0.02] cursor-pointer"
                    : "border-border bg-gray-50 text-border cursor-not-allowed"
                }
              `}
              aria-pressed={isSelected}
              aria-label={`${formatTime12h(slot.start)} to ${formatTime12h(slot.end)}${slot.available ? "" : " — unavailable"}`}
            >
              <span>{formatTime12h(slot.start)}</span>
              <span className="text-xs text-muted">to {formatTime12h(slot.end)}</span>
            </button>
          );
        })}
      </div>

      {/* Hold countdown */}
      {holdId && countdown > 0 && (
        <div className="flex items-center gap-2 text-sm text-primary bg-primary-light rounded-[8px] px-3 py-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            Slot held for you — <strong>{formatCountdown(countdown)}</strong> remaining
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-[8px] border border-error bg-error-light px-4 py-3 text-sm text-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export { TimeSlotPicker };
export type { TimeSlotPickerProps };
