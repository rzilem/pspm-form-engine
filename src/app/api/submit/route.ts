import { submissionSchema } from "@/lib/schemas";
import {
  proposalFormSchema,
  invoiceFormSchema,
  billbackFormSchema,
  falconPointeSchema,
  reservationSchema,
} from "@/lib/schemas";
import { insuranceFormSchema } from "@/lib/schemas-insurance";
import { logger } from "@/lib/logger";
import { getSupabase } from "@/lib/supabase";
import { sendFormNotification } from "@/lib/email";
import { verifyRecaptcha } from "@/lib/recaptcha";
import { loadFormDefinition } from "@/lib/form-loader";
import { buildSubmissionSchema, type FormDefinition } from "@/lib/form-definitions";
import { generateFormPdf, getPdfFilename } from "@/lib/form-pdf";
import type { z } from "zod";


async function pushLeadToCrm(submissionId: string, data: Record<string, unknown>) {
  const url = process.env.CRM_INTAKE_URL || "https://mksbigirgonwnzlfdndd.supabase.co/functions/v1/intake-lead";
  const key = process.env.CRM_INTAKE_KEY || "intake-lead-2026-bigcountry-x9k4m7p2q8";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({
        first_name: data.firstName, last_name: data.lastName,
        email: data.email, phone: data.phone,
        association_name: data.associationName, units: data.numberOfUnits,
        street: data.streetAddress, city: data.city, state: data.state, zip: data.zip,
        proposal_type: data.proposalType, current_status: data.currentStatus,
        features: data.features, additional_info: data.additionalInfo,
        source: "psprop.net", form_submission_id: submissionId,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      logger.error("intake-lead failed", { status: res.status, body: txt.slice(0, 300) });
    }
  } catch (err) {
    logger.error("intake-lead threw", { error: String(err) });
  }
}

// Legacy hand-coded schemas. Slugs registered here render via per-form
// Next.js pages (/proposal, /invoice, etc.). Anything not in this map
// falls through to form_definitions for the dynamic builder path.
const legacyFormSchemas: Record<string, z.ZodType<unknown>> = {
  proposal: proposalFormSchema,
  invoice: invoiceFormSchema,
  billback: billbackFormSchema,
  "falcon-pointe-portal": falconPointeSchema,
  "indoor-reservation": reservationSchema,
  "pavilion-reservation": reservationSchema,
  insurance: insuranceFormSchema,
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

    // Resolve the form: legacy hand-coded first, then form_definitions.
    // We hold onto the definition (for dynamic forms) so downstream stages
    // — reCAPTCHA bypass, PDF generation, notification routing — don't
    // each re-query Supabase for the same row.
    let formSchema: z.ZodType<unknown> | null = legacyFormSchemas[formSlug] ?? null;
    let formDefinitionId: string | null = null;
    let formDefinition: FormDefinition | null = null;
    let recaptchaRequired = true;

    if (!formSchema) {
      const definition = await loadFormDefinition(formSlug);
      if (!definition) {
        logger.warn("Unknown form slug", { formSlug });
        return Response.json({ error: "Unknown form type" }, { status: 400 });
      }
      formSchema = buildSubmissionSchema(definition.field_schema);
      formDefinitionId = definition.id;
      formDefinition = definition;
      recaptchaRequired = definition.recaptcha_required;
    }

    // Verify reCAPTCHA — legacy forms always require it; dynamic forms
    // opt out via form_definitions.recaptcha_required = false.
    if (recaptchaRequired) {
      const captchaValid = await verifyRecaptcha(recaptchaToken);
      if (!captchaValid) {
        logger.warn("reCAPTCHA failed", { formSlug });
        return Response.json({ error: "Bot detection failed. Please try again." }, { status: 403 });
      }
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
        form_definition_id: formDefinitionId,
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

    // Generate per-submission PDF when the form opted in. Render before
    // notifying so the PDF can attach to the email — Cloud Run's CPU
    // throttling kills any work scheduled after the response returns.
    let pdfAttachment: { filename: string; content: Buffer } | null = null;
    if (formDefinition) {
      const pdfBuffer = await generateFormPdf(
        formDefinition,
        formResult.data as Record<string, unknown>,
        submission.id,
      );
      if (pdfBuffer) {
        pdfAttachment = {
          filename: getPdfFilename(formDefinition, submission.id),
          content: pdfBuffer,
        };
      }
    }

    // Await on Cloud Run — fire-and-forget background work gets cut off
    // by CPU throttling once the response returns. Insurance form generates
    // a carrier XLSX attachment that must complete before we acknowledge.
    try {
      await sendFormNotification(
        formSlug,
        formResult.data as Record<string, unknown>,
        formDefinition ?? undefined,
        pdfAttachment,
      );
    } catch (err) {
      logger.error("Email notification failed", { error: String(err), formSlug });
    }

    if (formSlug === "proposal") {
      // Await on Cloud Run — fire-and-forget gets killed when the response returns
      try {
        await pushLeadToCrm(submission.id, formResult.data as Record<string, unknown>);
      } catch (err) {
        logger.error("intake-lead failed", { error: String(err) });
      }
    }

    logger.info("Form submission saved", {
      formSlug,
      submissionId: submission.id,
      formDefinitionId,
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
