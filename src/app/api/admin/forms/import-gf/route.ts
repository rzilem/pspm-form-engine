/**
 * Bulk-import a Gravity Forms JSON export.
 *
 * Two-step UX:
 *   1. POST { mode: "preview", payload: <gf json> }
 *      → returns parsed forms with field counts + warnings, no DB writes.
 *   2. POST { mode: "create", forms: [{ ...payloadFromPreview, slug }] }
 *      → writes new form_definitions rows in `draft` status.
 *
 * Splitting preview/create lets the admin sanity-check the field map and
 * the warnings list before anything lands. Avoids the "I clicked import
 * and now I have 14 garbage drafts" footgun.
 */
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { importGfExport, type ImportResult } from "@/lib/gravity-forms-import";
import {
  fieldDefinitionSchema,
  notificationConfigSchema,
} from "@/lib/form-definitions";
import { z } from "zod";

const RESERVED = new Set([
  "proposal",
  "invoice",
  "billback",
  "falcon-pointe-portal",
  "indoor-reservation",
  "pavilion-reservation",
  "insurance",
]);

const previewBodySchema = z.object({
  mode: z.literal("preview"),
  payload: z.unknown(),
});

const createFormSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only")
    .min(2)
    .max(80),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  field_schema: z.array(fieldDefinitionSchema),
  notification_config: notificationConfigSchema,
  confirmation_message: z.string().min(1).max(500),
  recaptcha_required: z.boolean().default(true),
});

const createBodySchema = z.object({
  mode: z.literal("create"),
  forms: z.array(createFormSchema).min(1).max(50),
});

const bodySchema = z.discriminatedUnion("mode", [
  previewBodySchema,
  createBodySchema,
]);

export async function POST(request: Request) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (parsed.data.mode === "preview") {
    let results: ImportResult[];
    try {
      results = importGfExport(parsed.data.payload);
    } catch (err) {
      logger.error("GF import preview failed", { error: String(err) });
      return Response.json(
        { error: "Could not parse Gravity Forms export" },
        { status: 400 },
      );
    }
    if (results.length === 0) {
      return Response.json(
        { error: "No forms found in export" },
        { status: 400 },
      );
    }
    return Response.json({
      forms: results.map((r) => ({
        ...r,
        // Flag reserved slugs in the preview so the admin picks an
        // alternative before clicking Create.
        slugReserved: RESERVED.has(r.suggestedSlug),
      })),
    });
  }

  // mode === "create"
  const supabase = getSupabaseAdmin();
  const created: Array<{ id: string; slug: string }> = [];
  const errors: Array<{ slug: string; error: string }> = [];

  for (const form of parsed.data.forms) {
    if (RESERVED.has(form.slug)) {
      errors.push({ slug: form.slug, error: "Slug is reserved" });
      continue;
    }
    const { data, error } = await supabase
      .from("form_definitions")
      .insert({
        slug: form.slug,
        title: form.title,
        description: form.description ?? null,
        status: "draft",
        field_schema: form.field_schema,
        notification_config: form.notification_config,
        confirmation_message: form.confirmation_message,
        recaptcha_required: form.recaptcha_required,
      })
      .select("id, slug")
      .single();
    if (error) {
      if (error.code === "23505") {
        errors.push({ slug: form.slug, error: "Slug already in use" });
      } else {
        logger.error("GF import create failed", {
          slug: form.slug,
          error: error.message,
        });
        errors.push({ slug: form.slug, error: "Database insert failed" });
      }
      continue;
    }
    created.push({ id: data.id, slug: data.slug });
  }

  return Response.json({ created, errors });
}
