import { submissionSchema } from "@/lib/schemas";
import {
  proposalFormSchema,
  invoiceFormSchema,
  billbackFormSchema,
} from "@/lib/schemas";
import { logger } from "@/lib/logger";
import type { z } from "zod";

// Map form slugs to their validation schemas
const formSchemas: Record<string, z.ZodType<unknown>> = {
  proposal: proposalFormSchema,
  invoice: invoiceFormSchema,
  billback: billbackFormSchema,
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

    const { formSlug, data } = envelope.data;

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

    // TODO: Phase 3 — Insert into Supabase form_submissions table
    // TODO: Phase 2-3 — Send email notifications
    //   invoice -> invoices@psprop.net (Subject: "New Invoice - {Community Name}")
    //   billback -> mgrbillback@psprop.net (Subject: "New Invoice - {entry_id}")
    // TODO: Phase 2-3 — Forward to CloudMailIn addresses

    logger.info("Form submission received", {
      formSlug,
      timestamp: new Date().toISOString(),
    });

    return Response.json({
      success: true,
      message: "Submission received",
      formSlug,
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
