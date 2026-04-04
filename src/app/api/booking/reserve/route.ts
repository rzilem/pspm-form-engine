import { getSupabase } from "@/lib/supabase";
import { generateConfirmationCode, generateManageToken } from "@/lib/booking";
import { logger } from "@/lib/logger";
import { sendBookingConfirmation, sendAdminBookingNotification } from "@/lib/email";
import { verifyRecaptcha } from "@/lib/recaptcha";
import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";

function getStripe(): Stripe | null {
  if (!STRIPE_SECRET_KEY) return null;
  return new Stripe(STRIPE_SECRET_KEY, { typescript: true });
}

interface ReserveBody {
  formSlug: string;
  amenitySlug: string;
  sessionId: string;
  holdId?: string;
  recaptchaToken?: string;
  data: {
    reservationDate: string;
    startTime: string;
    endTime: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    streetAddress: string;
    city: string;
    state: string;
    zip: string;
    propertyStatus: string;
    attendeeCount: number;
    purposeOfFunction: string;
    activitiesPlanned: string;
    alcoholApproval: string;
    signature: string;
    stripePaymentId?: string;
    textUpdates?: string[];
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReserveBody;
    const { amenitySlug, sessionId, holdId, recaptchaToken, data } = body;

    // Verify reCAPTCHA
    const captchaValid = await verifyRecaptcha(recaptchaToken);
    if (!captchaValid) {
      return Response.json({ error: "Bot detection failed. Please try again." }, { status: 403 });
    }

    if (!amenitySlug || !data.reservationDate || !data.startTime || !data.endTime) {
      return Response.json({ error: "Missing required booking fields" }, { status: 400 });
    }

    if (!data.firstName || !data.lastName || !data.email) {
      return Response.json({ error: "Missing resident information" }, { status: 400 });
    }

    const supabase = getSupabase();

    // 1. Get amenity
    const { data: amenity, error: amenityErr } = await supabase
      .from("amenities")
      .select("id, name, deposit_cents, settings")
      .eq("slug", amenitySlug)
      .eq("is_active", true)
      .single();

    if (amenityErr || !amenity) {
      return Response.json({ error: "Amenity not found" }, { status: 404 });
    }

    // 2. Verify slot is still available (check reservations, not just holds)
    const { data: existingReservations } = await supabase
      .from("reservations")
      .select("id")
      .eq("amenity_id", amenity.id)
      .eq("reservation_date", data.reservationDate)
      .eq("start_time", data.startTime)
      .not("status", "eq", "cancelled");

    if (existingReservations && existingReservations.length > 0) {
      return Response.json(
        { error: "This time slot is no longer available. Please select another time." },
        { status: 409 }
      );
    }

    // 3. Create Stripe PaymentIntent if not already paid
    let stripePaymentIntentId = data.stripePaymentId ?? null;
    let stripeStatus = "pending";

    if (stripePaymentIntentId) {
      // Verify payment with Stripe
      const stripe = getStripe();
      if (stripe) {
        try {
          const pi = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
          stripeStatus = pi.status === "succeeded" ? "succeeded" : pi.status;
        } catch {
          stripeStatus = "pending";
        }
      }
    }

    // 4. Generate confirmation code and manage token
    const confirmationCode = generateConfirmationCode(data.reservationDate);
    const manageToken = generateManageToken();

    // 5. Get request metadata
    const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("cf-connecting-ip") ?? null;
    const userAgent = request.headers.get("user-agent") ?? null;

    // 6. Create reservation
    const { data: reservation, error: insertErr } = await supabase
      .from("reservations")
      .insert({
        amenity_id: amenity.id,
        confirmation_code: confirmationCode,
        reservation_date: data.reservationDate,
        start_time: data.startTime,
        end_time: data.endTime,
        resident_name: `${data.firstName} ${data.lastName}`,
        resident_email: data.email,
        resident_phone: data.phone,
        resident_address: `${data.streetAddress}, ${data.city}, ${data.state} ${data.zip}`,
        property_status: data.propertyStatus,
        event_type: data.purposeOfFunction,
        event_description: data.activitiesPlanned,
        expected_attendees: data.attendeeCount,
        alcohol_present: data.alcoholApproval === "Yes",
        signature_url: data.signature,
        amount_cents: amenity.deposit_cents,
        stripe_payment_intent_id: stripePaymentIntentId,
        stripe_status: stripeStatus,
        status: stripeStatus === "succeeded" ? "confirmed" : "pending",
        manage_token: manageToken,
        ip_address: ip,
        user_agent: userAgent,
      })
      .select("id, confirmation_code, manage_token, status")
      .single();

    if (insertErr) {
      logger.error("Failed to create reservation", { error: insertErr.message });
      return Response.json({ error: "Failed to create reservation" }, { status: 500 });
    }

    // 7. Release the slot hold
    if (holdId && sessionId) {
      await supabase
        .from("slot_holds")
        .delete()
        .eq("id", holdId)
        .eq("session_id", sessionId);
    }

    // 8. Build manage URL
    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
    const manageUrl = `${baseUrl}/booking/manage/${manageToken}`;

    logger.info("Reservation created", {
      confirmation_code: confirmationCode,
      amenity: amenitySlug,
      date: data.reservationDate,
      status: reservation.status,
    });

    // Send confirmation + admin emails (non-blocking)
    sendBookingConfirmation({
      email: data.email,
      name: `${data.firstName} ${data.lastName}`,
      confirmationCode,
      amenityName: amenity.name,
      date: data.reservationDate,
      startTime: data.startTime,
      endTime: data.endTime,
      amount: amenity.deposit_cents,
      manageUrl,
    }).catch((err) => logger.error("Confirmation email failed", { error: String(err) }));

    sendAdminBookingNotification({
      confirmationCode,
      amenityName: amenity.name,
      residentName: `${data.firstName} ${data.lastName}`,
      date: data.reservationDate,
      startTime: data.startTime,
      endTime: data.endTime,
    }).catch((err) => logger.error("Admin notification email failed", { error: String(err) }));

    return Response.json({
      success: true,
      confirmation_code: reservation.confirmation_code,
      manage_token: reservation.manage_token,
      manage_url: manageUrl,
      status: reservation.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Reserve endpoint error", { error: message });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
