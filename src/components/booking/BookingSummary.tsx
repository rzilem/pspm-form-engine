"use client";

import { formatTime12h } from "@/lib/booking";

interface BookingSummaryProps {
  amenityName: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  amountCents: number;
  className?: string;
}

function BookingSummary({
  amenityName,
  date,
  startTime,
  endTime,
  amountCents,
  className = "",
}: BookingSummaryProps) {
  const formattedDate = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const amountFormatted = `$${(amountCents / 100).toFixed(2)}`;

  return (
    <div
      className={`rounded-[8px] border border-primary/20 bg-primary-light px-4 py-4 space-y-2 ${className}`}
    >
      <h3 className="text-sm font-semibold text-navy">Reservation Summary</h3>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">Amenity</span>
          <span className="font-medium text-foreground">{amenityName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Date</span>
          <span className="font-medium text-foreground">{formattedDate}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Time</span>
          <span className="font-medium text-foreground">
            {formatTime12h(startTime)} &ndash; {formatTime12h(endTime)}
          </span>
        </div>
        <div className="flex justify-between border-t border-primary/10 pt-2 mt-2">
          <span className="text-muted">Deposit</span>
          <span className="font-semibold text-primary text-base">{amountFormatted}</span>
        </div>
      </div>
    </div>
  );
}

export { BookingSummary };
export type { BookingSummaryProps };
