"use client";

import { useState, useCallback, useRef } from "react";
import { DatePicker } from "@/components/booking/DatePicker";
import { TimeSlotPicker } from "@/components/booking/TimeSlotPicker";

interface BookingCalendarProps {
  amenitySlug: string;
  amenityId?: string;
  label: string;
  required?: boolean;
  error?: { message?: string };
  onSlotSelected: (date: string, startTime: string, endTime: string) => void;
  onHoldCreated?: (holdId: string, expiresAt: string) => void;
  className?: string;
}

function BookingCalendar({
  amenitySlug,
  amenityId: externalAmenityId,
  label,
  required,
  error,
  onSlotSelected,
  onHoldCreated,
  className = "",
}: BookingCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ start: string; end: string } | null>(null);
  const [amenityId, setAmenityId] = useState<string | undefined>(externalAmenityId);
  const sessionIdRef = useRef(crypto.randomUUID());

  // Fetch amenity ID if not provided
  const fetchAmenityId = useCallback(async () => {
    if (amenityId) return amenityId;
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
    try {
      const res = await fetch(`${API_BASE}/api/booking/amenities`);
      const data = (await res.json()) as { amenities?: Array<{ id: string; slug: string }> };
      const match = data.amenities?.find((a) => a.slug === amenitySlug);
      if (match) {
        setAmenityId(match.id);
        return match.id;
      }
    } catch {
      // Fall through
    }
    return undefined;
  }, [amenityId, amenitySlug]);

  const handleDateSelect = useCallback(
    async (date: string) => {
      setSelectedDate(date);
      setSelectedSlot(null);
      // Ensure we have the amenity ID
      if (!amenityId) await fetchAmenityId();
    },
    [amenityId, fetchAmenityId]
  );

  const handleSlotSelect = useCallback(
    (start: string, end: string) => {
      setSelectedSlot({ start, end });
      if (selectedDate) {
        onSlotSelected(selectedDate, start, end);
      }
    },
    [selectedDate, onSlotSelected]
  );

  const handleHoldExpired = useCallback(() => {
    setSelectedSlot(null);
  }, []);

  const fieldId = `booking-calendar-${amenitySlug}`;
  const errorId = `${fieldId}-error`;

  return (
    <fieldset
      className={`flex flex-col gap-4 ${className}`}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="text-error ml-0.5" aria-hidden="true">*</span>
        )}
      </legend>

      <DatePicker
        amenitySlug={amenitySlug}
        selectedDate={selectedDate}
        onDateSelect={handleDateSelect}
      />

      {selectedDate && (
        <TimeSlotPicker
          amenitySlug={amenitySlug}
          date={selectedDate}
          selectedSlot={selectedSlot}
          onSlotSelect={handleSlotSelect}
          onHoldCreated={onHoldCreated}
          onHoldExpired={handleHoldExpired}
          amenityId={amenityId}
          sessionId={sessionIdRef.current}
        />
      )}

      {error && (
        <p id={errorId} className="text-xs text-error" role="alert">
          {error.message}
        </p>
      )}
    </fieldset>
  );
}

export { BookingCalendar };
export type { BookingCalendarProps };
