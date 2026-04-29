/**
 * Admin per-form endpoints: GET/PATCH/DELETE a single form_definition.
 *
 * PATCH semantics:
 *  - Any subset of editable fields can be sent.
 *  - field_schema and notification_config are validated against their
 *    canonical Zod shapes — bad JSON is rejected with field-level errors.
 *  - Setting status to 'published' stamps published_at if it was null.
 *
 * DELETE is a soft archive — sets status='archived'. Hard delete is left
 * out so we can't lose form_submissions history (FK ON DELETE SET NULL
 * would orphan them).
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/admin-auth";
import { logger } from "@/lib/logger";
import {
  fieldDefinitionSchema,
  notificationConfigSchema,
  pdfConfigSchema,
} from "@/lib/form-definitions";
import { z } from "zod";

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  field_schema: z.array(fieldDefinitionSchema).optional(),
  notification_config: notificationConfigSchema.optional(),
  pdf_config: pdfConfigSchema.optional(),
  confirmation_message: z.string().min(1).max(500).optional(),
  recaptcha_required: z.boolean().optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, ctx: RouteContext) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("form_definitions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logger.error("Admin get form failed", { id, error: error.message });
    return Response.json({ error: "Failed to load form" }, { status: 500 });
  }
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json(data);
}

export async function PATCH(request: Request, ctx: RouteContext) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const body: unknown = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          error: "Invalid input",
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    // If transitioning to published, stamp published_at when not already set.
    // Read current state first so we don't clobber an existing timestamp.
    let publishedAtUpdate: Record<string, string | null> = {};
    if (parsed.data.status === "published") {
      const { data: existing } = await supabase
        .from("form_definitions")
        .select("published_at")
        .eq("id", id)
        .maybeSingle();
      if (existing && !existing.published_at) {
        publishedAtUpdate = { published_at: new Date().toISOString() };
      }
    }

    const { data, error } = await supabase
      .from("form_definitions")
      .update({
        ...parsed.data,
        ...publishedAtUpdate,
      })
      .eq("id", id)
      .select("id, slug, status, updated_at, published_at")
      .single();

    if (error) {
      logger.error("Admin update form failed", { id, error: error.message });
      return Response.json({ error: "Failed to update form" }, { status: 500 });
    }
    if (!data) return Response.json({ error: "Not found" }, { status: 404 });

    return Response.json(data);
  } catch (err) {
    logger.error("Admin update form threw", { id, error: String(err) });
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: RouteContext) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  // Soft archive — preserves form_submissions FK link so we don't lose
  // submission history if a form is decommissioned.
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("form_definitions")
    .update({ status: "archived" })
    .eq("id", id);

  if (error) {
    logger.error("Admin archive form failed", { id, error: error.message });
    return Response.json({ error: "Failed to archive form" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
