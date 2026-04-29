/**
 * Server-side loader for form_definitions.
 * Used by /forms/[slug] (renderer) and /api/submit (validator) to fetch
 * a published form by slug. Bypasses RLS via service role so submissions
 * can resolve drafts mid-edit if explicitly enabled (admin preview only).
 */
import { getSupabase, getSupabaseAdmin } from "@/lib/supabase";
import {
  formDefinitionSchema,
  type FormDefinition,
  fieldDefinitionSchema,
  notificationConfigSchema,
} from "@/lib/form-definitions";
import { logger } from "@/lib/logger";
import { z } from "zod";

interface LoadOptions {
  /** Include drafts (admin preview). Default false. */
  includeDrafts?: boolean;
}

/**
 * Fetch a form definition by slug. Returns null if not found or if the form
 * is in draft and `includeDrafts` is false.
 *
 * Validates the row against `formDefinitionSchema` so corrupted JSONB
 * (e.g. a partial admin save) surfaces as an explicit failure instead of
 * crashing the renderer with a runtime type error.
 */
export async function loadFormDefinition(
  slug: string,
  options: LoadOptions = {},
): Promise<FormDefinition | null> {
  // Normalize slug — accept "/contact-us" or "contact-us/"
  const normalized = slug.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  if (!/^[a-z0-9-]+$/.test(normalized)) return null;

  const client = options.includeDrafts ? getSupabaseAdmin() : getSupabase();
  const { data, error } = await client
    .from("form_definitions")
    .select("*")
    .eq("slug", normalized)
    .maybeSingle();

  if (error) {
    logger.error("loadFormDefinition query failed", {
      slug: normalized,
      error: error.message,
    });
    return null;
  }
  if (!data) return null;

  // Validate the row before handing it to the renderer. JSONB columns can
  // drift from schema if an admin save bug ships, so a strict parse here
  // catches that before users see a half-rendered form.
  const fieldsResult = z
    .array(fieldDefinitionSchema)
    .safeParse(data.field_schema);
  const notifResult = notificationConfigSchema.safeParse(data.notification_config);

  if (!fieldsResult.success || !notifResult.success) {
    logger.error("Form definition failed schema validation", {
      slug: normalized,
      fieldErrors: fieldsResult.success ? null : fieldsResult.error.issues,
      notifErrors: notifResult.success ? null : notifResult.error.issues,
    });
    return null;
  }

  const parsed = formDefinitionSchema.safeParse({
    ...data,
    field_schema: fieldsResult.data,
    notification_config: notifResult.data,
  });
  if (!parsed.success) {
    logger.error("Form definition envelope failed validation", {
      slug: normalized,
      errors: parsed.error.issues,
    });
    return null;
  }

  if (!options.includeDrafts && parsed.data.status !== "published") {
    return null;
  }

  return parsed.data;
}
