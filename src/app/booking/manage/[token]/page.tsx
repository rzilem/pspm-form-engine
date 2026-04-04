"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { FormLayout } from "@/components/forms/FormLayout";
import { BookingSummary } from "@/components/booking/BookingSummary";
import { BookingCalendar } from "@/components/booking/BookingCalendar";
import { Button } from "@/components/ui/Button";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface ReservationData {
  id: string;
  confirmation_code: string;
  reservation_date: string;
  start_time: string;
  end_time: string;
  resident_name: string;
  resident_email: string;
  resident_phone: string | null;
  amount_cents: number;
  stripe_status: string;
  status: string;
  created_at: string;
  amenity: {
    name: string;
    slug: string;
    community: string;
    location: string;
    settings: Record<string, unknown>;
  } | null;
}

function ManageBookingContent() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [reservation, setReservation] = useState<ReservationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [actionResult, setActionResult] = useState<{
    type: "cancel" | "reschedule";
    success: boolean;
    message: string;
  } | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);

  const fetchReservation = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/booking/manage?token=${token}`);
      const data = (await res.json()) as { reservation?: ReservationData; error?: string };

      if (!res.ok || data.error) {
        setError(data.error ?? "Reservation not found");
        return;
      }
      setReservation(data.reservation ?? null);
    } catch {
      setError("Failed to load reservation");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchReservation();
  }, [fetchReservation]);

  async function handleCancel() {
    if (!token) return;
    setCancelling(true);

    try {
      const res = await fetch(`${API_BASE}/api/booking/manage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          action: "cancel",
          reason: cancelReason || "Cancelled by resident",
        }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        refund_status?: string;
        refund_eligible?: boolean;
        error?: string;
      };

      if (data.success) {
        const refundMsg = data.refund_eligible
          ? data.refund_status === "refunded"
            ? "Your deposit has been refunded."
            : "Refund processing may take a few days."
          : "No refund is available for cancellations within 48 hours of the reservation.";

        setActionResult({
          type: "cancel",
          success: true,
          message: `Reservation cancelled. ${refundMsg}`,
        });
        void fetchReservation();
      } else {
        setActionResult({
          type: "cancel",
          success: false,
          message: data.error ?? "Failed to cancel",
        });
      }
    } catch {
      setActionResult({
        type: "cancel",
        success: false,
        message: "Failed to cancel reservation",
      });
    } finally {
      setCancelling(false);
      setShowCancelConfirm(false);
    }
  }

  async function handleReschedule(date: string, startTime: string, endTime: string) {
    try {
      const res = await fetch(`${API_BASE}/api/booking/manage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          action: "reschedule",
          new_date: date,
          new_start_time: startTime,
          new_end_time: endTime,
        }),
      });

      const data = (await res.json()) as { success?: boolean; error?: string };

      if (data.success) {
        setActionResult({
          type: "reschedule",
          success: true,
          message: "Reservation rescheduled successfully.",
        });
        setShowReschedule(false);
        void fetchReservation();
      } else {
        setActionResult({
          type: "reschedule",
          success: false,
          message: data.error ?? "Failed to reschedule",
        });
      }
    } catch {
      setActionResult({
        type: "reschedule",
        success: false,
        message: "Failed to reschedule reservation",
      });
    }
  }

  if (loading) {
    return (
      <FormLayout title="Manage Reservation" subtitle="Loading your reservation...">
        <div className="text-center py-12 text-muted">Loading...</div>
      </FormLayout>
    );
  }

  if (error || !reservation) {
    return (
      <FormLayout title="Reservation Not Found" subtitle="">
        <div className="text-center py-12 space-y-4">
          <p className="text-muted">{error ?? "Reservation not found"}</p>
          <p className="text-sm text-muted">
            If you believe this is an error, please contact us at{" "}
            <a href="mailto:info@psprop.net" className="text-primary hover:underline">info@psprop.net</a>
            {" "}or call <a href="tel:5122516122" className="text-primary hover:underline">512-251-6122</a>.
          </p>
        </div>
      </FormLayout>
    );
  }

  const isCancelled = reservation.status === "cancelled";
  const statusLabel: Record<string, string> = {
    pending: "Pending",
    confirmed: "Confirmed",
    cancelled: "Cancelled",
    completed: "Completed",
    "no-show": "No-Show",
  };

  const statusColor: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    confirmed: "bg-brand-green-light text-brand-green-dark",
    cancelled: "bg-error-light text-error",
    completed: "bg-primary-light text-primary",
    "no-show": "bg-gray-100 text-gray-600",
  };

  return (
    <FormLayout title="Manage Your Reservation" subtitle={`Confirmation: ${reservation.confirmation_code}`}>
      <div className="space-y-6">
        {/* Status badge */}
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${statusColor[reservation.status] ?? "bg-gray-100 text-gray-600"}`}>
            {statusLabel[reservation.status] ?? reservation.status}
          </span>
          {reservation.stripe_status === "succeeded" && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-brand-green-light text-brand-green-dark">
              Paid
            </span>
          )}
        </div>

        {/* Reservation summary */}
        {reservation.amenity && (
          <BookingSummary
            amenityName={reservation.amenity.name}
            date={reservation.reservation_date}
            startTime={reservation.start_time}
            endTime={reservation.end_time}
            amountCents={reservation.amount_cents}
          />
        )}

        {/* Resident info */}
        <div className="text-sm space-y-1">
          <p><span className="text-muted">Name:</span> {reservation.resident_name}</p>
          <p><span className="text-muted">Email:</span> {reservation.resident_email}</p>
          {reservation.resident_phone && (
            <p><span className="text-muted">Phone:</span> {reservation.resident_phone}</p>
          )}
        </div>

        {/* Action result */}
        {actionResult && (
          <div
            className={`rounded-[8px] border px-4 py-3 text-sm ${
              actionResult.success
                ? "border-brand-green bg-brand-green-light text-brand-green-dark"
                : "border-error bg-error-light text-error"
            }`}
            role="alert"
          >
            {actionResult.message}
          </div>
        )}

        {/* Actions (only if not cancelled) */}
        {!isCancelled && (
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowReschedule(!showReschedule)}
            >
              Reschedule
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowCancelConfirm(true)}
            >
              Cancel Reservation
            </Button>
          </div>
        )}

        {/* Reschedule calendar */}
        {showReschedule && reservation.amenity && (
          <div className="animate-fade-in border border-border rounded-[8px] p-4 space-y-4">
            <h3 className="text-sm font-semibold text-navy">Select a new date and time</h3>
            <BookingCalendar
              amenitySlug={reservation.amenity.slug}
              label="New Date & Time"
              required
              onSlotSelected={handleReschedule}
            />
          </div>
        )}

        {/* Cancel confirmation dialog */}
        {showCancelConfirm && (
          <div className="animate-fade-in border border-error/30 rounded-[8px] p-4 bg-error-light space-y-3">
            <p className="text-sm font-medium text-error">Are you sure you want to cancel?</p>
            <p className="text-xs text-muted">
              Cancellations made 48+ hours before your reservation are eligible for a full refund.
              Cancellations within 48 hours are not refundable.
            </p>
            <div>
              <label htmlFor="cancel-reason" className="text-xs font-medium text-muted block mb-1">
                Reason (optional)
              </label>
              <textarea
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full rounded-[8px] border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                rows={2}
                placeholder="Why are you cancelling?"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? "Cancelling..." : "Yes, Cancel"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCancelConfirm(false)}
              >
                Keep Reservation
              </Button>
            </div>
          </div>
        )}
      </div>
    </FormLayout>
  );
}

export default function ManageBookingPage() {
  return <ManageBookingContent />;
}
