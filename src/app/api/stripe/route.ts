import { logger } from "@/lib/logger";
import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";

function getStripeClient(): Stripe | null {
  if (!STRIPE_SECRET_KEY) return null;
  return new Stripe(STRIPE_SECRET_KEY);
}

export async function POST(request: Request) {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      logger.error("Stripe not configured — missing STRIPE_SECRET_KEY");
      return Response.json(
        { error: "Payment processing is not configured" },
        { status: 503 }
      );
    }

    const body = (await request.json()) as { amountCents?: number };
    const { amountCents } = body;

    if (
      typeof amountCents !== "number" ||
      !Number.isInteger(amountCents) ||
      amountCents <= 0
    ) {
      return Response.json(
        { error: "Invalid amount. Must be a positive integer (cents)." },
        { status: 400 }
      );
    }

    // Cap at $10,000 as a safety limit
    if (amountCents > 1_000_000) {
      return Response.json(
        { error: "Amount exceeds maximum allowed" },
        { status: 400 }
      );
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        source: "pspm-form-engine",
      },
    });

    logger.info("PaymentIntent created", {
      id: paymentIntent.id,
      amount: amountCents,
    });

    return Response.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Stripe PaymentIntent creation failed", { error: message });
    return Response.json(
      { error: "Failed to initialize payment" },
      { status: 500 }
    );
  }
}
