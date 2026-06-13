import { z } from "zod";
import { logger } from "@/lib/logger";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadFormDefinition } from "@/lib/form-loader";
import { verifyRecaptcha } from "@/lib/recaptcha";
import {
  buildResumeUrl,
  findSubmitterEmail,
  generateResumeToken,
  partialDataByteSize,
  PARTIAL_DATA_MAX_BYTES,
  sanitizePartialData,
} from "@/lib/form-partials";
import { sendResumeLinkEmail } from "@/lib/email";

/** Raw request body cap (slightly above stored data cap). */
const MAX_REQUEST_BYTES = 300 * 1024;

const saveProgressSchema = z.object({
  slug: z.string().min(1).max(80),
  data: z.record(z.string(), z.unknown()),
  currentPage: z.number().int().min(0).max(500).optional(),
  token: z.string().min(1).max(128).optional(),
  hp: z.string().optional(),
  recaptchaToken: z.string().optional(),
  /** Optional: email the resume link to this address (best-effort). */
  emailTo: z.string().max(320).optional(),
});

/** Accept any string; only use it as a recipient when it is a valid email. */
function normalizeEmailRecipient(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const parsed = z.string().email().safeParse(trimmed);
  return parsed.success ? trimmed : undefined;
}

export async function POST(request: Request) {
  try {
    const rawText = await request.text();
    if (Buffer.byteLength(rawText, "utf8") > MAX_REQUEST_BYTES) {
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawText);
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = saveProgressSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    const { slug, data, currentPage, token, hp, emailTo, recaptchaToken } =
      parsed.data;

    if (hp && hp.trim() !== "") {
      logger.warn("Honeypot triggered on save-progress", { slug });
      return Response.json({ error: "Request rejected." }, { status: 400 });
    }

    const definition = await loadFormDefinition(slug);
    if (!definition) {
      return Response.json({ error: "Unknown form" }, { status: 400 });
    }

    if (!definition.save_resume_enabled) {
      return Response.json(
        { error: "Save and continue is not enabled for this form" },
        { status: 403 },
      );
    }

    if (definition.recaptcha_required) {
      const captchaValid = await verifyRecaptcha(recaptchaToken);
      if (!captchaValid) {
        logger.warn("reCAPTCHA failed on save-progress", { slug });
        return Response.json(
          { error: "Bot detection failed. Please try again." },
          { status: 403 },
        );
      }
    }

    const sanitized = sanitizePartialData(data, definition.field_schema);
    const byteSize = partialDataByteSize(sanitized);
    if (byteSize > PARTIAL_DATA_MAX_BYTES) {
      return Response.json(
        { error: "Saved progress is too large" },
        { status: 413 },
      );
    }

    const supabase = getSupabaseAdmin();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    let resumeToken = token?.trim() ?? "";

    if (resumeToken) {
      const { data: existing, error: fetchErr } = await supabase
        .from("form_partials")
        .select("id, expires_at")
        .eq("resume_token", resumeToken)
        .eq("slug", definition.slug)
        .eq("form_id", definition.id)
        .maybeSingle();

      if (fetchErr) {
        logger.error("save-progress lookup failed", { error: fetchErr.message });
        return Response.json({ error: "Failed to save progress" }, { status: 500 });
      }

      if (!existing) {
        resumeToken = "";
      } else {
        const exp = new Date(existing.expires_at);
        if (Number.isNaN(exp.getTime()) || exp <= now) {
          resumeToken = "";
        } else {
          const { error: updateErr } = await supabase
            .from("form_partials")
            .update({
              data: sanitized,
              current_page: currentPage ?? null,
              expires_at: expiresAt,
            })
            .eq("id", existing.id);

          if (updateErr) {
            logger.error("save-progress update failed", {
              error: updateErr.message,
            });
            return Response.json(
              { error: "Failed to save progress" },
              { status: 500 },
            );
          }
        }
      }
    }

    if (!resumeToken) {
      resumeToken = generateResumeToken();
      const { error: insertErr } = await supabase.from("form_partials").insert({
        form_id: definition.id,
        slug: definition.slug,
        resume_token: resumeToken,
        data: sanitized,
        current_page: currentPage ?? null,
        expires_at: expiresAt,
      });

      if (insertErr) {
        logger.error("save-progress insert failed", { error: insertErr.message });
        return Response.json({ error: "Failed to save progress" }, { status: 500 });
      }
    }

    const resumeUrl = buildResumeUrl(definition.slug, resumeToken, request);

    const recipient =
      normalizeEmailRecipient(emailTo) ||
      findSubmitterEmail(definition, sanitized);
    if (recipient) {
      try {
        await sendResumeLinkEmail({
          to: recipient,
          formTitle: definition.title,
          resumeUrl,
        });
      } catch (err) {
        logger.warn("Resume link email failed (progress still saved)", {
          error: String(err),
          slug: definition.slug,
        });
      }
    }

    logger.info("Form progress saved", {
      slug: definition.slug,
      byteSize,
      updated: Boolean(token),
    });

    return Response.json({ token: resumeToken, resumeUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("save-progress handler error", { error: message });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}