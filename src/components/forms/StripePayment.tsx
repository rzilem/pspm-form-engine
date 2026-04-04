"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import type { StripeCardElementChangeEvent } from "@stripe/stripe-js";
import { TotalDisplay } from "@/components/forms/TotalDisplay";

const STRIPE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

const stripePromise = STRIPE_PUBLISHABLE_KEY
  ? loadStripe(STRIPE_PUBLISHABLE_KEY)
  : null;

interface FormFieldError {
  message?: string;
}

interface StripePaymentProps {
  amountCents: number;
  label: string;
  error?: FormFieldError;
  onPaymentSuccess?: (paymentIntentId: string) => void;
  onPaymentError?: (errorMessage: string) => void;
  onProcessingChange?: (processing: boolean) => void;
  className?: string;
}

/** Card element styles matching PSPM brand */
const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: "14px",
      fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
      color: "#1a1a2e",
      "::placeholder": {
        color: "#6b7280",
      },
    },
    invalid: {
      color: "#dc2626",
      iconColor: "#dc2626",
    },
  },
};

const STRIPE_API_URL = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api/stripe`
  : "/api/stripe";

function StripeCardForm({
  amountCents,
  label,
  error: externalError,
  onPaymentSuccess,
  onPaymentError,
  onProcessingChange,
  className = "",
}: StripePaymentProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [cardError, setCardError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Create PaymentIntent on mount
  useEffect(() => {
    if (amountCents <= 0) return;

    let cancelled = false;
    async function createIntent() {
      try {
        const response = await fetch(STRIPE_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amountCents }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `Payment setup failed (${response.status})`);
        }
        const data = (await response.json()) as { clientSecret: string };
        if (!cancelled) {
          setClientSecret(data.clientSecret);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Payment setup failed";
          setFetchError(message);
          onPaymentError?.(message);
        }
      }
    }

    void createIntent();
    return () => {
      cancelled = true;
    };
  }, [amountCents, onPaymentError]);

  const handleCardChange = useCallback(
    (event: StripeCardElementChangeEvent) => {
      setCardError(event.error ? event.error.message : null);
    },
    []
  );

  const confirmPayment = useCallback(async (): Promise<boolean> => {
    if (!stripe || !elements || !clientSecret) return false;

    const card = elements.getElement(CardElement);
    if (!card) return false;

    setProcessing(true);
    onProcessingChange?.(true);

    try {
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card },
      });

      if (result.error) {
        const message = result.error.message ?? "Payment failed";
        setCardError(message);
        onPaymentError?.(message);
        return false;
      }

      if (result.paymentIntent?.id) {
        onPaymentSuccess?.(result.paymentIntent.id);
        return true;
      }

      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Payment failed";
      setCardError(message);
      onPaymentError?.(message);
      return false;
    } finally {
      setProcessing(false);
      onProcessingChange?.(false);
    }
  }, [stripe, elements, clientSecret, onPaymentSuccess, onPaymentError, onProcessingChange]);

  // Expose confirmPayment to parent via a custom attribute on a hidden div
  // Parent forms will call this through the ref pattern
  useEffect(() => {
    const el = document.getElementById("stripe-confirm-fn");
    if (el) {
      (el as HTMLElement & { confirmPayment?: () => Promise<boolean> }).confirmPayment =
        confirmPayment;
    }
  }, [confirmPayment]);

  const displayError = cardError ?? fetchError ?? externalError?.message ?? null;
  const amountDollars = amountCents / 100;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Amount display */}
      <TotalDisplay total={amountDollars} label={label} />

      {/* Card input */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">
          Credit or Debit Card
          <span className="text-error ml-0.5" aria-hidden="true">
            *
          </span>
        </label>
        <div
          className={`rounded-[8px] border px-3 py-3 transition-colors bg-white
            ${displayError ? "border-error" : "border-border hover:border-primary/50"}
            focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary`}
        >
          <CardElement
            options={CARD_ELEMENT_OPTIONS}
            onChange={handleCardChange}
          />
        </div>
      </div>

      {/* Processing indicator */}
      {processing && (
        <div
          className="flex items-center gap-2 text-sm text-primary"
          role="status"
          aria-live="polite"
        >
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Processing payment...
        </div>
      )}

      {/* Error display */}
      {displayError && !processing && (
        <div
          className="rounded-[8px] border border-error bg-error-light px-4 py-3 text-sm text-error"
          role="alert"
        >
          {displayError}
        </div>
      )}

      {/* Hidden element for confirmPayment reference */}
      <div id="stripe-confirm-fn" className="hidden" aria-hidden="true" />
    </div>
  );
}

/** Wrapper that provides the Stripe Elements context */
function StripePayment(props: StripePaymentProps) {
  if (!stripePromise) {
    return (
      <div className="rounded-[8px] border border-border bg-gray-50 px-4 py-6 text-center">
        <p className="text-sm text-muted">
          Payment processing is not configured. Please set the{" "}
          <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
            NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
          </code>{" "}
          environment variable.
        </p>
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise}>
      <StripeCardForm {...props} />
    </Elements>
  );
}

export { StripePayment };
export type { StripePaymentProps };
