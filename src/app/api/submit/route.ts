import { submissionSchema } from "@/lib/schemas";
import {
  proposalFormSchema,
  invoiceFormSchema,
  billbackFormSchema,
  falconPointeSchema,
  reservationSchema,
} from "@/lib/schemas";
import { logger } from "@/lib/logger";
import { getSupabase } from "@/lib/supabase";
import { sendFormNotification } from "@/lib/email";
import { verifyRecaptcha } from "@/lib/recaptcha";
import type { z } from "zod";

// Map form slugs to their validation schemas
const formSchemas: Record<string, z.ZodType<unknown>> = {
  proposal: proposalFormSchema,
  invoice: invoiceFormSchema,
  billback: billbackFormSchema,
  "falcon-pointe-portal": falconPointeSchema,
  "indoor-reservation": reservationSchema,
  "pavilion-reservation": reservationSchema,
};

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();

    // Validate the submission envelope
    const envelope = submissionSchema.safeParse(body);
    if (!envelope.success) {
      logger.warn("Invalid submission envelope", {
        errors: envelope.error.issues.map((i) => i.message),
      });
      return Response.json(
        { error: "Invalid submission format" },
        { status: 400 }
      );
    }

    const { formSlug, data, recaptchaToken } = envelope.data;

    // Verify reCAPTCHA
    const captchaValid = await verifyRecaptcha(recaptchaToken);
    if (!captchaValid) {
      logger.warn("reCAPTCHA failed", { formSlug });
      return Response.json({ error: "Bot detection failed. Please try again." }, { status: 403 });
    }

    // Validate form-specific data
    const formSchema = formSchemas[formSlug];
    if (!formSchema) {
      logger.warn("Unknown form slug", { formSlug });
      return Response.json({ error: "Unknown form type" }, { status: 400 });
    }

    const formResult = formSchema.safeParse(data);
    if (!formResult.success) {
      const issues =
        "error" in formResult && formResult.error
          ? formResult.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            }))
          : [];
      logger.warn("Form validation failed", { formSlug, issues });
      return Response.json(
        { error: "Validation failed", details: issues },
        { status: 422 }
      );
    }

    // Save to Supabase
    const supabase = getSupabase();
    const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("cf-connecting-ip") ?? null;
    const userAgent = request.headers.get("user-agent") ?? null;

    const { data: submission, error: insertErr } = await supabase
      .from("form_submissions")
      .insert({
        form_slug: formSlug,
        data: formResult.data as Record<string, unknown>,
        ip_address: ip,
        user_agent: userAgent,
      })
      .select("id")
      .single();

    if (insertErr) {
      logger.error("Failed to save form submission", { error: insertErr.message, formSlug });
      return Response.json({ error: "Failed to save submission" }, { status: 500 });
    }

    // Send email notification (non-blocking)
    sendFormNotification(formSlug, formResult.data as Record<string, unknown>).catch((err) => {
      logger.error("Email notification failed", { error: String(err), formSlug });
    });

    logger.info("Form submission saved", {
      formSlug,
      submissionId: submission.id,
    });

    return Response.json({
      success: true,
      message: "Submission received",
      formSlug,
      id: submission.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Submission handler error", { error: message });
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
