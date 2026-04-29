/**
 * Admin REST endpoints for form_definitions CRUD.
 *
 *   GET  /api/admin/forms             — list all definitions (any status)
 *   POST /api/admin/forms             — create a new draft
 *
 * Per-id endpoints live at ./[id]/route.ts.
 *
 * Auth: shared admin password via X-Admin-Password header / admin_token
 * cookie / Bearer token. Same gate as /api/admin/reservations.
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/admin-auth";
import { logger } from "@/lib/logger";
import { z } from "zod";

const createSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only")
    .min(2)
    .max(80),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export async function GET(request: Request) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("form_definitions")
      .select("id, slug, title, status, updated_at, published_at")
      .order("updated_at", { ascending: false });

    if (error) {
      logger.error("Admin list forms failed", { error: error.message });
      return Response.json({ error: "Failed to load forms" }, { status: 500 });
    }

    return Response.json({ forms: data ?? [] });
  } catch (err) {
    logger.error("Admin list forms threw", { error: String(err) });
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();

  try {
    const body: unknown = await request.json();
    const parsed = createSchema.safeParse(body);
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

    // Reserve slugs that collide with legacy hand-coded routes so an admin
    // can't accidentally shadow /proposal etc. with a draft form.
    const RESERVED = new Set([
      "proposal",
      "invoice",
      "billback",
      "falcon-pointe-portal",
      "indoor-reservation",
      "pavilion-reservation",
      "insurance",
    ]);
    if (RESERVED.has(parsed.data.slug)) {
      return Response.json(
        { error: `Slug '${parsed.data.slug}' is reserved for a legacy hand-coded form.` },
        { status: 409 },
      );
    }

    const { data, error } = await supabase
      .from("form_definitions")
      .insert({
        slug: parsed.data.slug,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        status: "draft",
        field_schema: [],
        notification_config: { rules: [] },
      })
      .select("id, slug")
      .single();

    if (error) {
      // Unique violation on slug
      if (error.code === "23505") {
        return Response.json({ error: "A form with that slug already exists." }, { status: 409 });
      }
      logger.error("Admin create form failed", { error: error.message });
      return Response.json({ error: "Failed to create form" }, { status: 500 });
    }

    return Response.json({ id: data.id, slug: data.slug });
  } catch (err) {
    logger.error("Admin create form threw", { error: String(err) });
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
