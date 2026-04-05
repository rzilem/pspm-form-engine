import { logger } from "@/lib/logger";
import { getSupabase } from "@/lib/supabase";
import { sendBookingConfirmation } from "@/lib/email";
import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

export async function POST(request: Request) {
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    logger.error("Stripe webhook not configured");
    return Response.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY);
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return Response.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown";
    logger.error("Stripe webhook signature verification failed", { error: message });
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = getSupabase();

  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const { data: updatedRows, error } = await supabase
        .from("reservations")
        .update({ stripe_status: "succeeded", status: "confirmed" })
        .eq("stripe_payment_intent_id", pi.id)
        .select("id, confirmation_code, manage_token, resident_name, resident_email, reservation_date, start_time, end_time, amount_cents, amenity_id");

      if (error) {
        logger.error("Failed to update reservation on payment success", { error: error.message, pi_id: pi.id });
      } else {
        logger.info("Payment succeeded, reservation confirmed", { pi_id: pi.id });

        // Send confirmation email now that payment is confirmed
        const row = updatedRows?.[0];
        if (row) {
          const { data: amenity } = await supabase
            .from("amenities")
            .select("name")
            .eq("id", row.amenity_id)
            .single();

          const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
          sendBookingConfirmation({
            email: row.resident_email,
            name: row.resident_name,
            confirmationCode: row.confirmation_code,
            amenityName: amenity?.name ?? "Amenity",
            date: row.reservation_date,
            startTime: row.start_time,
            endTime: row.end_time,
            amount: row.amount_cents,
            manageUrl: `${baseUrl}/booking/manage/${row.manage_token}`,
          }).catch((err) => logger.error("Confirmation email failed in webhook", { error: String(err) }));
        }
      }
      break;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      await supabase
        .from("reservations")
        .update({ stripe_status: "failed" })
        .eq("stripe_payment_intent_id", pi.id);

      logger.warn("Payment failed", { pi_id: pi.id });
      break;
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (piId) {
        await supabase
          .from("reservations")
          .update({ stripe_status: "refunded" })
          .eq("stripe_payment_intent_id", piId);

        logger.info("Charge refunded", { pi_id: piId });
      }
      break;
    }

    default:
      logger.info("Unhandled Stripe event", { type: event.type });
  }

  return Response.json({ received: true });
}
