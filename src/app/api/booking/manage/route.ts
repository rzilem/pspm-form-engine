import { getSupabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { sendCancellationEmail } from "@/lib/email";
import type { AmenitySettings } from "@/lib/database.types";
import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";

function getStripe(): Stripe | null {
  if (!STRIPE_SECRET_KEY) return null;
  return new Stripe(STRIPE_SECRET_KEY, { typescript: true });
}

/** GET /api/booking/manage?token=xxx — fetch reservation by manage token */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return Response.json({ error: "Missing token" }, { status: 400 });
    }

    const supabase = getSupabase();

    const { data: reservation, error } = await supabase
      .from("reservations")
      .select(`
        id, confirmation_code, reservation_date, start_time, end_time,
        resident_name, resident_email, resident_phone,
        amount_cents, stripe_status, status,
        amenity_id, created_at
      `)
      .eq("manage_token", token)
      .single();

    if (error || !reservation) {
      return Response.json({ error: "Reservation not found" }, { status: 404 });
    }

    // Get amenity info
    const { data: amenity } = await supabase
      .from("amenities")
      .select("name, slug, community, location, settings")
      .eq("id", reservation.amenity_id)
      .single();

    return Response.json({
      reservation: {
        ...reservation,
        amenity: amenity ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Manage GET error", { error: message });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** POST /api/booking/manage — cancel or reschedule */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      token: string;
      action: "cancel" | "reschedule";
      reason?: string;
      new_date?: string;
      new_start_time?: string;
      new_end_time?: string;
    };

    const { token, action } = body;

    if (!token || !action) {
      return Response.json({ error: "Missing token or action" }, { status: 400 });
    }

    const supabase = getSupabase();

    // Fetch reservation
    const { data: reservation, error: fetchErr } = await supabase
      .from("reservations")
      .select("id, amenity_id, reservation_date, start_time, end_time, status, stripe_payment_intent_id, amount_cents")
      .eq("manage_token", token)
      .single();

    if (fetchErr || !reservation) {
      return Response.json({ error: "Reservation not found" }, { status: 404 });
    }

    if (reservation.status === "cancelled") {
      return Response.json({ error: "Reservation is already cancelled" }, { status: 400 });
    }

    if (action === "cancel") {
      return handleCancel(supabase, reservation, body.reason ?? "Cancelled by resident");
    }

    if (action === "reschedule") {
      if (!body.new_date || !body.new_start_time || !body.new_end_time) {
        return Response.json({ error: "Missing new date/time for reschedule" }, { status: 400 });
      }
      return handleReschedule(supabase, reservation, body.new_date, body.new_start_time, body.new_end_time);
    }

    return Response.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Manage POST error", { error: message });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function handleCancel(
  supabase: ReturnType<typeof getSupabase>,
  reservation: { id: string; amenity_id: string; reservation_date: string; stripe_payment_intent_id: string | null; amount_cents: number },
  reason: string
) {
  // Check cancellation window
  const { data: amenity } = await supabase
    .from("amenities")
    .select("settings")
    .eq("id", reservation.amenity_id)
    .single();

  const settings = (amenity?.settings ?? {}) as AmenitySettings;
  const cancellationHours = settings.cancellation_window_hours ?? 48;

  const reservationDateTime = new Date(`${reservation.reservation_date}T00:00:00`);
  const hoursUntil = (reservationDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
  const eligibleForRefund = hoursUntil >= cancellationHours;

  // Cancel the reservation
  const { error } = await supabase
    .from("reservations")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_reason: reason,
      cancelled_by: "resident",
    })
    .eq("id", reservation.id);

  if (error) {
    logger.error("Failed to cancel reservation", { error: error.message });
    return Response.json({ error: "Failed to cancel reservation" }, { status: 500 });
  }

  // Process refund if eligible
  let refundStatus = "no_refund";
  if (eligibleForRefund && reservation.stripe_payment_intent_id) {
    const stripe = getStripe();
    if (stripe) {
      try {
        await stripe.refunds.create({
          payment_intent: reservation.stripe_payment_intent_id,
        });
        refundStatus = "refunded";

        await supabase
          .from("reservations")
          .update({ stripe_status: "refunded" })
          .eq("id", reservation.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        logger.error("Refund failed", { error: msg, reservation_id: reservation.id });
        refundStatus = "refund_failed";
      }
    }
  }

  logger.info("Reservation cancelled", {
    reservation_id: reservation.id,
    refund_status: refundStatus,
    eligible_for_refund: eligibleForRefund,
  });

  // Send cancellation email (non-blocking) — need to fetch name + amenity
  const { data: fullRes } = await supabase
    .from("reservations")
    .select("resident_email, resident_name, confirmation_code, reservation_date, amenity_id")
    .eq("id", reservation.id)
    .single();

  if (fullRes) {
    const { data: am } = await supabase.from("amenities").select("name").eq("id", fullRes.amenity_id).single();
    sendCancellationEmail({
      email: fullRes.resident_email,
      name: fullRes.resident_name,
      confirmationCode: fullRes.confirmation_code,
      amenityName: am?.name ?? "Amenity",
      date: fullRes.reservation_date,
      refundStatus,
    }).catch((err) => logger.error("Cancellation email failed", { error: String(err) }));
  }

  return Response.json({
    success: true,
    cancelled: true,
    refund_status: refundStatus,
    refund_eligible: eligibleForRefund,
    cancellation_window_hours: cancellationHours,
  });
}

async function handleReschedule(
  supabase: ReturnType<typeof getSupabase>,
  reservation: { id: string; amenity_id: string; reservation_date: string; start_time: string; end_time: string },
  newDate: string,
  newStartTime: string,
  newEndTime: string
) {
  // Check new slot availability
  const { data: conflicts } = await supabase
    .from("reservations")
    .select("id")
    .eq("amenity_id", reservation.amenity_id)
    .eq("reservation_date", newDate)
    .eq("start_time", newStartTime)
    .not("status", "eq", "cancelled")
    .neq("id", reservation.id);

  if (conflicts && conflicts.length > 0) {
    return Response.json(
      { error: "The new time slot is not available" },
      { status: 409 }
    );
  }

  const { error } = await supabase
    .from("reservations")
    .update({
      reservation_date: newDate,
      start_time: newStartTime,
      end_time: newEndTime,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reservation.id);

  if (error) {
    logger.error("Failed to reschedule", { error: error.message });
    return Response.json({ error: "Failed to reschedule reservation" }, { status: 500 });
  }

  logger.info("Reservation rescheduled", {
    reservation_id: reservation.id,
    old_date: reservation.reservation_date,
    new_date: newDate,
  });

  return Response.json({
    success: true,
    rescheduled: true,
    new_date: newDate,
    new_start_time: newStartTime,
    new_end_time: newEndTime,
  });
}
